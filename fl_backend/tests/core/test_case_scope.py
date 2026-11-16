"""
TESTS · the scope every async case runs in (`tests/database.py :: bounded_case`)

Invariants:
- Every async case runs under the case's bound, which `tests/conftest.py :: pytest_collection_modifyitems` applies by
  wrapping what pytest-asyncio runs: a case reaching here unwrapped runs unbounded, and a rival deadlocked on its own
  write's transaction waits out MongoDB's abort and passes on the retry.
- A task the work starts and leaves running fails the scope that left it, and is cancelled there rather than running
  into the next case; the driver's own monitors, which outlive a case by design, do not.
- A clean database is entered in a case's body alone, and a module's corpus is judged after the module's cases: it is
  refused when released in the task that seeded it, and nothing clears it while it is held.
- A variable a corpus's seed binds stays out of the fixture's context, which pytest-asyncio carries into every case of
  the module.
"""

import asyncio
import contextvars

import pytest
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.core.collections import Collection
from app.core.logging import NO_REQUEST_SENTINEL, trace_id_var
from tests.config import UNANSWERED_URI
from tests.database import CASE_BOUND_S, a_clean_database, bounded, case_deadline, held_corpus, shared_client
from tests.documents import saison_document
from tests.worker import worker_database

DATABASE_NAME = worker_database("fl_case_scope_test")


async def test_a_case_runs_inside_its_bound():
    deadline = case_deadline()

    assert deadline is not None, "this case runs outside `bounded_case`: the collection hook did not wrap it"
    assert 0 < deadline - asyncio.get_running_loop().time() <= CASE_BOUND_S


async def test_a_task_left_running_fails_its_scope_and_is_cancelled():
    started: list[asyncio.Task[None]] = []

    async def never_finishes() -> None:
        await asyncio.Event().wait()

    async def starts_one() -> None:
        started.append(asyncio.create_task(never_finishes()))

    with pytest.raises(AssertionError, match=r"left 1 task\(s\) running, cancelled here: .*never_finishes"):
        await bounded(starts_one())

    assert [task.cancelled() for task in started] == [True]


async def test_a_driver_s_monitor_is_no_task_left_behind():
    client: AsyncMongoClient = AsyncMongoClient(UNANSWERED_URI)
    try:
        # Opens the topology, whose monitors keep polling after the call returns, without selecting a server.
        await bounded(client.aconnect())
    finally:
        await client.close()


async def test_a_clean_database_entered_outside_a_case_is_refused():
    async def entered_as_a_fixture_would() -> None:
        async with a_clean_database(UNANSWERED_URI, DATABASE_NAME):
            pass

    with pytest.raises(RuntimeError, match="entered outside a case"):
        # An empty context, as a fixture's setup runs outside any case.
        await asyncio.create_task(entered_as_a_fixture_would(), context=contextvars.Context())


async def _one_season(database: AsyncDatabase) -> None:
    await database[Collection.SAISONS].insert_one(dict(saison_document("2126", "active")))


@pytest.mark.db
class TestAModuleCorpus:
    """Driven by hand across two tasks, as pytest-asyncio runs a module fixture's setup and its teardown."""

    async def test_released_in_the_task_that_seeded_it_is_refused(self, mongo_replica_set_url: str):
        with pytest.raises(RuntimeError, match="released in the task that seeded it"):
            async with held_corpus(mongo_replica_set_url, DATABASE_NAME, _one_season):
                pass

    async def test_is_cleared_by_nothing_while_it_is_held(self, mongo_replica_set_url: str):
        corpus = held_corpus(mongo_replica_set_url, DATABASE_NAME, _one_season)
        await asyncio.create_task(corpus.__aenter__())
        try:
            with pytest.raises(RuntimeError, match="held as a module's corpus"):
                async with a_clean_database(mongo_replica_set_url, DATABASE_NAME):
                    pass
        finally:
            await asyncio.create_task(corpus.__aexit__(None, None, None))

    async def test_fails_where_a_case_wrote_to_it(self, mongo_replica_set_url: str):
        corpus = held_corpus(mongo_replica_set_url, DATABASE_NAME, _one_season)
        await asyncio.create_task(corpus.__aenter__())
        await shared_client(mongo_replica_set_url)[DATABASE_NAME][Collection.SAISONS].insert_one(dict(saison_document("2127", "future")))

        with pytest.raises(AssertionError, match=r"holds documents its seed did not put there \(saisons\)"):
            await asyncio.create_task(corpus.__aexit__(None, None, None))

    async def test_keeps_what_its_seed_binds_out_of_the_fixture_s_context(self, mongo_replica_set_url: str):
        async def binds_a_trace(database: AsyncDatabase) -> None:
            trace_id_var.set("0af7651916cd43dd8448eb211c80319c")
            await _one_season(database)

        corpus = held_corpus(mongo_replica_set_url, DATABASE_NAME, binds_a_trace)
        setup = asyncio.create_task(corpus.__aenter__())
        await setup
        try:
            assert setup.get_context().run(trace_id_var.get) == NO_REQUEST_SENTINEL
        finally:
            await asyncio.create_task(corpus.__aexit__(None, None, None))
