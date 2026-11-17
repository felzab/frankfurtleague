"""
TESTS · the bound every async case runs under (`tests/database.py :: bounded_case`), and a module's corpus

Invariants:
- Every async case runs under the case's bound, which `tests/conftest.py :: pytest_collection_modifyitems` applies by
  wrapping what pytest-asyncio runs: a case reaching here unwrapped runs unbounded, and a rival deadlocked on its own
  write's transaction waits until the server ends the transaction, and the retry that follows passes the case. Work
  past its bound is cut, and fails as cut whatever it raises as it unwinds; a `TimeoutError` the work raises itself
  passes as it was.
- A module's corpus is judged after the module's cases: a case that wrote to it fails the module.
"""

import asyncio

import pytest
from pymongo.asynchronous.database import AsyncDatabase

from app.core.collections import Collection
from app.core.concurrency import concurrently
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


async def test_work_cut_by_its_bound_is_named_cut_whatever_it_raises_as_it_unwinds():
    crash = KeyError("raised as it unwound")

    async def crashes_once_cancelled() -> None:
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            raise crash from None

    async with asyncio.timeout(5):
        with pytest.raises(TimeoutError, match=r"this ran past 0.05 s and was cancelled") as caught:
            await bounded(concurrently(asyncio.Event().wait(), crashes_once_cancelled()), bound_s=0.05)

    assert caught.value.__cause__ is crash


async def test_a_timeout_the_work_raises_itself_passes_as_it_was():
    raised = TimeoutError("the work's own")

    async def times_out() -> None:
        raise raised

    with pytest.raises(TimeoutError) as caught:
        await bounded(times_out())

    assert caught.value is raised


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
