from collections.abc import Awaitable, Callable, Iterator
from typing import Any

import pytest
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.public_router import get_frame, get_saison
from app.api.saisons.visibility import resolve_public_saison
from app.core.collections import Collection
from app.core.exceptions import DocumentNotFoundError
from tests.database import a_clean_database, on_the_seed_loop, shared_client
from tests.documents import saison_document
from tests.worker import worker_database

from .conftest import unwritten

DATABASE_NAME = worker_database("fl_saison_visibility_test")

ARCHIVED = "2024"
RUNNING = "2025"
PLANNED = "2026"
# An id naming no season at all: what the withheld one has to be indistinguishable from.
UNKNOWN = "2099"


SEEDED = [saison_document(ARCHIVED, "past"), saison_document(RUNNING, "active"), saison_document(PLANNED, "future")]


Body = Callable[[AsyncDatabase], Awaitable[Any]]


# Module-scoped: every case below reads this corpus and none writes it, which `unwritten` keeps
# from being left as a claim.
@pytest.fixture(scope="module")
def seeded_league(mongo_replica_set_url: str) -> Iterator[str]:
    """The finished, the running and the planned season."""

    async def _seed() -> None:
        async with a_clean_database(mongo_replica_set_url, DATABASE_NAME) as (_, database):
            await database[Collection.SAISONS].insert_many([dict(document) for document in SEEDED])

    on_the_seed_loop(_seed())

    with unwritten(mongo_replica_set_url, DATABASE_NAME):
        yield mongo_replica_set_url


def on_a_league(url: str, body: Body) -> Any:
    async def _run() -> Any:
        return await body(shared_client(url)[DATABASE_NAME])

    return on_the_seed_loop(_run())


@pytest.mark.db
class TestAPlannedSeasonIsWithheldFromTheBaseTier:
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


async def frame_read(database: AsyncDatabase) -> Any:
    return await get_frame(saisons_collection=database[Collection.SAISONS])


@pytest.mark.db
class TestTheFrame:
    def test_it_lists_the_readable_seasons_newest_first_beside_the_active_one(self, seeded_league: str):
        response = on_a_league(seeded_league, frame_read)

        assert ([saison.id for saison in response.saisons], response.active_saison_id) == ([RUNNING, ARCHIVED], RUNNING)
