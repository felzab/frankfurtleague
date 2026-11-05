from collections.abc import Awaitable, Callable, Iterator
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.admin_router import get_saisons_admin
from app.api.saisons.public_router import get_frame, get_saison
from app.api.saisons.schemas import FLSaisonsFilterParams
from app.api.saisons.services import base_tier_status_term
from app.api.saisons.visibility import resolve_public_saison
from app.core.collections import Collection
from app.core.exceptions import DocumentNotFoundError
from tests.database import a_clean_database, on_the_seed_loop, shared_client
from tests.documents import saison_document, spiel_document
from tests.worker import worker_database

from .conftest import unwritten

DATABASE_NAME = worker_database("fl_saison_visibility_test")
FRESH_DATABASE_NAME = worker_database("fl_saison_visibility_fresh_test")

ARCHIVED = "2024"
RUNNING = "2025"
PLANNED = "2026"
# An id naming no season at all: what the withheld one has to be indistinguishable from.
UNKNOWN = "2099"


SEEDED = [saison_document(ARCHIVED, "past"), saison_document(RUNNING, "active"), saison_document(PLANNED, "future")]

# The day the admin read is asked on: the finished and the running season start before it, the planned
# one after it. Only the finished season holds a fixture that has taken place; the running one's is
# dated and unplayed, which fixes nothing.
TODAY = "2025-12-01"
FIXTURES = [
    spiel_document(spiel_id=ObjectId(), saison_id=ARCHIVED, spiel_nr=1, spieltag_id=ObjectId(), datum="2024-09-07", ergebnis="2:1"),
    spiel_document(spiel_id=ObjectId(), saison_id=RUNNING, spiel_nr=1, spieltag_id=ObjectId(), datum="2025-09-06"),
    spiel_document(spiel_id=ObjectId(), saison_id=PLANNED, spiel_nr=1, spieltag_id=ObjectId(), datum="2026-09-05"),
]


class TestTheTermItselfWithholdsThePlannedSeason:
    """No database: what a real `mongod` does with the term is the class below."""

    def test_a_read_excludes_the_planned_status(self):
        assert base_tier_status_term() == {"status": {"$ne": "future"}}


Body = Callable[[AsyncDatabase], Awaitable[Any]]


# Module-scoped: every case below reads this corpus and none writes it, which `unwritten` keeps
# from being left as a claim.
@pytest.fixture(scope="module")
def seeded_league(mongo_replica_set_url: str) -> Iterator[str]:
    """The finished, the running and the planned season."""

    async def _seed() -> None:
        async with a_clean_database(mongo_replica_set_url, DATABASE_NAME) as (_, database):
            await database[Collection.SAISONS].insert_many([dict(document) for document in SEEDED])
            await database[Collection.SPIELE].insert_many([dict(document) for document in FIXTURES])

    on_the_seed_loop(_seed())

    with unwritten(mongo_replica_set_url, DATABASE_NAME):
        yield mongo_replica_set_url


def on_a_league(url: str, body: Body) -> Any:
    async def _run() -> Any:
        return await body(shared_client(url)[DATABASE_NAME])

    return on_the_seed_loop(_run())


@pytest.mark.db
class TestAPlannedSeasonIsWithheldFromTheBaseTier:
    @pytest.mark.parametrize("saison_id", [ARCHIVED, RUNNING])
    def test_a_readable_season_is_still_served_by_id(self, saison_id: str, seeded_league: str):
        async def body(database: AsyncDatabase) -> Any:
            return await get_saison(saison_id=saison_id, saisons_collection=database[Collection.SAISONS])

        assert on_a_league(seeded_league, body).saison.id == saison_id

    def test_the_planned_season_is_a_404_and_never_a_403(self, seeded_league: str):
        """404 because the FILTER excludes it: a 403 would confirm that next season's draw exists."""

        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(DocumentNotFoundError) as refusal:
                await get_saison(saison_id=PLANNED, saisons_collection=database[Collection.SAISONS])

            return refusal.value

        assert on_a_league(seeded_league, body).status_code == 404


@pytest.mark.db
class TestThePublicSeasonResolver:
    """The one resolve every base-tier read scoped by a season makes, and the two refusals it answers alike."""

    @pytest.mark.parametrize("saison_id", [pytest.param(PLANNED, id="withheld"), pytest.param(UNKNOWN, id="unknown")])
    def test_it_misses_a_season_this_tier_may_not_read_as_one_nobody_created(self, saison_id: str, seeded_league: str):
        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(DocumentNotFoundError) as refusal:
                await resolve_public_saison(saisons_collection=database[Collection.SAISONS], saison_id=saison_id)

            return refusal.value

        assert on_a_league(seeded_league, body).status_code == 404

    def test_naming_none_resolves_the_active_season(self, seeded_league: str):
        async def body(database: AsyncDatabase) -> Any:
            return await resolve_public_saison(saisons_collection=database[Collection.SAISONS], saison_id=None)

        assert on_a_league(seeded_league, body).id == RUNNING


async def frame_read(database: AsyncDatabase) -> Any:
    return await get_frame(saisons_collection=database[Collection.SAISONS])


@pytest.mark.db
class TestTheFrame:
    def test_it_lists_the_readable_seasons_newest_first_beside_the_active_one(self, seeded_league: str):
        response = on_a_league(seeded_league, frame_read)

        assert ([saison.id for saison in response.saisons], response.active_saison_id) == ([RUNNING, ARCHIVED], RUNNING)

    def test_a_league_no_season_was_activated_in_names_none(self, mongo_replica_set_url: str):
        """A fresh league whose first season is still being drawn up: the frontend shows the status page's empty state."""

        async def body() -> Any:
            async with a_clean_database(mongo_replica_set_url, FRESH_DATABASE_NAME) as (_, database):
                await database[Collection.SAISONS].insert_one(saison_document(PLANNED, "future"))

                return await frame_read(database)

        response = on_the_seed_loop(body())

        assert (response.saisons, response.active_saison_id) == ([], None)


@pytest.mark.db
class TestTheAdminTierReadsEverySeason:
    def test_the_planned_season_is_listed_beside_the_others(self, seeded_league: str):
        """An admin who cannot select a planned season cannot enter a club into one, which is the only window there is."""

        response = on_a_league(seeded_league, admin_read(FLSaisonsFilterParams()))

        assert [saison.id for saison in response.saisons] == [ARCHIVED, RUNNING, PLANNED]

    def test_each_season_says_whether_it_has_started(self, seeded_league: str):
        """`has_started` off each season's own `start_date`, which every start lock refuses on: a control closed on it closes exactly that."""

        response = on_a_league(seeded_league, admin_read(FLSaisonsFilterParams()))

        assert {saison.id: saison.begun for saison in response.saisons} == {ARCHIVED: True, RUNNING: True, PLANNED: False}

    def test_each_season_says_whether_a_fixture_has_taken_place(self, seeded_league: str):
        """What fixes the start date (`saison_start_taken_place`), per season, so the field closes exactly where the edit refuses."""

        response = on_a_league(seeded_league, admin_read(FLSaisonsFilterParams()))

        assert {saison.id: saison.taken_place for saison in response.saisons} == {ARCHIVED: True, RUNNING: False, PLANNED: False}

    def test_it_still_honours_a_status_filter(self, seeded_league: str):
        assert [saison.id for saison in on_a_league(seeded_league, admin_read(FLSaisonsFilterParams(status="future"))).saisons] == [PLANNED]


def admin_read(filters: FLSaisonsFilterParams) -> Body:
    async def body(database: AsyncDatabase) -> Any:
        return await get_saisons_admin(
            saisons_collection=database[Collection.SAISONS], spiele_collection=database[Collection.SPIELE], filters=filters, today=TODAY
        )

    return body
