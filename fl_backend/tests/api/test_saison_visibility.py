from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

import pytest
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.public_router import get_frame
from app.core.collections import Collection
from tests.database import held_corpus, shared_client
from tests.documents import saison_document
from tests.worker import worker_database

DATABASE_NAME = worker_database("fl_saison_visibility_test")

ARCHIVED = "2024"
RUNNING = "2025"
PLANNED = "2026"


SEEDED = [saison_document(ARCHIVED, "past"), saison_document(RUNNING, "active"), saison_document(PLANNED, "future")]


Body = Callable[[AsyncDatabase], Awaitable[Any]]


# Module-scoped: every case below reads this corpus and none writes it, which `held_corpus` keeps
# from being left as a claim.
@pytest.fixture(scope="module")
async def seeded_league(mongo_replica_set_url: str) -> AsyncIterator[str]:
    """The finished, the running and the planned season."""

    async def seed(database: AsyncDatabase) -> None:
        await database[Collection.SAISONS].insert_many([dict(document) for document in SEEDED])

    async with held_corpus(mongo_replica_set_url, DATABASE_NAME, seed):
        yield mongo_replica_set_url


async def on_a_league(url: str, body: Body) -> Any:
    return await body((await shared_client(url))[DATABASE_NAME])


async def frame_read(database: AsyncDatabase) -> Any:
    return await get_frame(saisons_collection=database[Collection.SAISONS])


@pytest.mark.db
class TestTheFrame:
    async def test_it_lists_the_readable_seasons_newest_first_beside_the_active_one(self, seeded_league: str):
        response = await on_a_league(seeded_league, frame_read)

        assert ([saison.id for saison in response.saisons], response.active_saison_id) == ([RUNNING, ARCHIVED], RUNNING)
