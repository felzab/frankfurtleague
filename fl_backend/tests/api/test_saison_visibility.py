import asyncio
from typing import Any, Awaitable, Callable, Iterator

import pytest
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.api.saisons.admin_router import get_saisons_for_admin
from app.api.saisons.cache import invalidate_saison_cache
from app.api.saisons.router import get_saison, get_saisons
from app.api.saisons.schemas import FLSaisonsFilterParams
from app.api.saisons.services import base_tier_status_term
from app.core.collections import Collection
from app.core.exceptions import DocumentNotFoundException
from tests.database import a_clean_database

from .conftest import unwritten

DATABASE_NAME = "fl_saison_visibility_test"

ARCHIVED = "2024"
RUNNING = "2025"
PLANNED = "2026"


def saison_document(saison_id: str, status: str) -> dict[str, Any]:
    """Complete, because every season read here is validated as `FLSaison` on the way back out."""

    return {
        "_id": saison_id,
        "start_date": f"{saison_id}-01-01",
        "end_date": f"{saison_id}-06-30",
        "status": status,
        "rules": {
            "win_points": 3,
            "draw_points": 1,
            "qualifiers_per_group": 2,
            "number_of_groups": 4,
            "teams_per_group": 4,
            "tiebreak_order": "tordifferenz",
            "max_kadergroesse": 18,
            "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
            "erlaubte_stufen": ["E1", "Q1", "Q2", "Q3", "Q4"],
        },
    }


SEEDED = [saison_document(ARCHIVED, "past"), saison_document(RUNNING, "active"), saison_document(PLANNED, "future")]


class TestTheTermItselfWithholdsThePlannedSeason:
    """No database: what a real `mongod` does with these two operators is the class below."""

    def test_an_unfiltered_read_excludes_the_planned_status(self):
        assert base_tier_status_term() == {"status": {"$ne": "future"}}

    @pytest.mark.parametrize("requested", ["past", "active"])
    def test_a_requested_status_keeps_the_exclusion_beside_it(self, requested):
        assert base_tier_status_term(requested) == {"status": {"$eq": requested, "$ne": "future"}}

    def test_asking_for_the_planned_status_outright_yields_a_term_nothing_can_satisfy(self):
        """`$eq` and `$ne` on one value: the request is answered with an empty list rather than dropped."""

        assert base_tier_status_term("future") == {"status": {"$eq": "future", "$ne": "future"}}


Body = Callable[[AsyncIOMotorDatabase], Awaitable[Any]]


# Module-scoped: every case below reads this corpus and none writes it, which `unwritten` keeps
# from being left as a claim.
@pytest.fixture(scope="module")
def seeded_league(mongo_replica_set_url: str) -> Iterator[str]:
    """The finished, the running and the planned season."""

    async def _seed() -> None:
        async with a_clean_database(mongo_replica_set_url, DATABASE_NAME) as (_, database):
            await database[Collection.SAISONS].insert_many([dict(document) for document in SEEDED])

    asyncio.run(_seed())

    with unwritten(mongo_replica_set_url, DATABASE_NAME):
        yield mongo_replica_set_url


def on_a_league(url: str, body: Body) -> Any:
    """One client and event loop per call: Motor binds to the loop it first ran on."""

    async def _run() -> Any:
        client = AsyncIOMotorClient(url)
        try:
            # Process-global and keyed by season id, so an entry another test left would answer for this one.
            invalidate_saison_cache()

            return await body(client[DATABASE_NAME])
        finally:
            client.close()

    return asyncio.run(_run())


@pytest.mark.db
class TestAPlannedSeasonIsWithheldFromTheBaseTier:
    def test_the_list_serves_the_finished_and_the_running_season_only(self, seeded_league: str):
        async def body(database: AsyncIOMotorDatabase) -> Any:
            return await get_saisons(saisons_collection=database[Collection.SAISONS], filters=FLSaisonsFilterParams())

        response = on_a_league(seeded_league, body)

        assert [saison.id for saison in response.saisons] == [ARCHIVED, RUNNING]

    def test_asking_for_the_planned_status_answers_an_empty_list(self, seeded_league: str):
        """The compound term is what makes this empty rather than the whole season list."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            return await get_saisons(saisons_collection=database[Collection.SAISONS], filters=FLSaisonsFilterParams(status="future"))

        assert on_a_league(seeded_league, body).saisons == []

    @pytest.mark.parametrize("saison_id", [ARCHIVED, RUNNING])
    def test_a_readable_season_is_still_served_by_id(self, saison_id: str, seeded_league: str):
        async def body(database: AsyncIOMotorDatabase) -> Any:
            return await get_saison(saison_id=saison_id, saisons_collection=database[Collection.SAISONS])

        assert on_a_league(seeded_league, body).saison.id == saison_id

    def test_the_planned_season_is_a_404_and_never_a_403(self, seeded_league: str):
        """404 because the FILTER excludes it: a 403 would confirm that next season's draw exists."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            with pytest.raises(DocumentNotFoundException) as refusal:
                await get_saison(saison_id=PLANNED, saisons_collection=database[Collection.SAISONS])

            return refusal.value

        assert on_a_league(seeded_league, body).status_code == 404


@pytest.mark.db
class TestTheAdminTierReadsEverySeason:
    def test_the_planned_season_is_listed_beside_the_others(self, seeded_league: str):
        """An admin who cannot select a planned season cannot enter a club into one, which is the only window there is."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            return await get_saisons_for_admin(saisons_collection=database[Collection.SAISONS], filters=FLSaisonsFilterParams())

        response = on_a_league(seeded_league, body)

        assert [saison.id for saison in response.saisons] == [ARCHIVED, RUNNING, PLANNED]

    def test_it_still_honours_a_status_filter(self, seeded_league: str):
        async def body(database: AsyncIOMotorDatabase) -> Any:
            return await get_saisons_for_admin(saisons_collection=database[Collection.SAISONS], filters=FLSaisonsFilterParams(status="future"))

        assert [saison.id for saison in on_a_league(seeded_league, body).saisons] == [PLANNED]
