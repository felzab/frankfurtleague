"""
TESTS · the bound every async case runs under (`tests/database.py :: bounded_case`), and a module's corpus

Invariants:
- Every async case runs under the case's bound, which `tests/conftest.py :: pytest_collection_modifyitems` applies by
  wrapping what pytest-asyncio runs: a case reaching here unwrapped runs unbounded, and a rival deadlocked on its own
  write's transaction waits until the server ends the transaction, and the retry that follows passes the case. Work
  past its bound is cut.
- A module's corpus is judged after the module's cases: a case that wrote to it fails the module.
"""

import asyncio

import pytest
from pymongo.asynchronous.database import AsyncDatabase

from app.core.collections import Collection
from tests.database import CASE_BOUND_S, bounded, case_deadline, held_corpus, shared_client
from tests.documents import saison_document
from tests.worker import worker_database

DATABASE_NAME = worker_database("fl_case_scope_test")


async def test_a_case_runs_inside_its_bound():
    deadline = case_deadline()

    assert deadline is not None, "this case runs outside `bounded_case`: the collection hook did not wrap it"
    assert 0 < deadline - asyncio.get_running_loop().time() <= CASE_BOUND_S


async def test_work_running_past_its_bound_is_cut_by_it():
    # A backstop, so a bound that never fires fails this case here rather than hanging it.
    async with asyncio.timeout(5):
        with pytest.raises(TimeoutError, match=r"this ran past 0.05 s and was cancelled"):
            await bounded(asyncio.Event().wait(), bound_s=0.05)


async def _one_season(database: AsyncDatabase) -> None:
    await database[Collection.SAISONS].insert_one(dict(saison_document("2126", "active")))


@pytest.mark.db
async def test_a_module_corpus_fails_where_a_case_wrote_to_it(mongo_replica_set_url: str):
    """Driven across two tasks, as pytest-asyncio runs a module fixture's setup and its teardown."""

    corpus = held_corpus(mongo_replica_set_url, DATABASE_NAME, _one_season)
    await asyncio.create_task(corpus.__aenter__())
    await shared_client(mongo_replica_set_url)[DATABASE_NAME][Collection.SAISONS].insert_one(dict(saison_document("2127", "future")))

    with pytest.raises(AssertionError, match=r"holds documents its seed did not put there \(saisons\)"):
        await asyncio.create_task(corpus.__aexit__(None, None, None))
