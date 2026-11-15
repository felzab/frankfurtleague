from collections.abc import Awaitable, Callable, Iterator
from typing import Any

import pytest
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.public_router import get_frame
from app.core.collections import Collection
from tests.database import a_clean_database, on_the_seed_loop, shared_client
from tests.documents import saison_document
from tests.worker import worker_database

from .conftest import unwritten

DATABASE_NAME = worker_database("fl_saison_visibility_test")

ARCHIVED = "2024"
RUNNING = "2025"
PLANNED = "2026"


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


async def frame_read(database: AsyncDatabase) -> Any:
    return await get_frame(saisons_collection=database[Collection.SAISONS])


@pytest.mark.db
class TestTheFrame:
    def test_it_lists_the_readable_seasons_newest_first_beside_the_active_one(self, seeded_league: str):
        response = on_a_league(seeded_league, frame_read)

        assert ([saison.id for saison in response.saisons], response.active_saison_id) == ([RUNNING, ARCHIVED], RUNNING)
