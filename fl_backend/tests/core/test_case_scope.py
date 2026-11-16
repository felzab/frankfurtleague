"""
TESTS · the scope every async case runs in (`tests/database.py :: bounded_case`)

Invariants:
- Every async case runs under the case's bound, which `tests/conftest.py :: pytest_collection_modifyitems` applies by
  wrapping what pytest-asyncio runs: a case reaching here unwrapped runs unbounded, and a rival deadlocked on its own
  write's transaction waits out MongoDB's abort and passes on the retry. Work past its bound is cut; a `TimeoutError`
  the work raises itself passes as it was.
- A task the work starts and leaves running fails the scope that left it, and is cancelled there rather than running
  into the next case, as is a task one of those starts as it unwinds. A task still running once cancelled refuses every
  later scope until it ends. A task started outside the scope is not the scope's, nor is a shared client's monitor,
  wherever that client was first asked for and whichever scope pymongo restarts it from; a client the scope opens and
  leaves open fails it.
- Every async fixture's setup and teardown run in a scope of their own, which a task they leave running fails.
- A clean database is entered in a case's body alone, and a module's corpus is judged after the module's cases: it is
  refused when released in the task that seeded it, and nothing clears it while it is held.
- A variable a corpus's seed binds stays out of the fixture's context, which pytest-asyncio carries into every case of
  the module.
"""

import asyncio
import contextlib
import contextvars
from collections.abc import AsyncIterator
from typing import Any

import pymongo
import pytest
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.periodic_executor import AsyncPeriodicExecutor

from app.core.collections import Collection
from app.core.logging import NO_REQUEST_SENTINEL, trace_id_var
from tests.config import UNANSWERED_DEADLINE_S, UNANSWERED_URI
from tests.database import CASE_BOUND_S, a_clean_database, bounded, bounded_case, case_deadline, held_corpus, in_a_scope, shared_client
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


async def test_a_timeout_the_work_raises_itself_passes_as_it_was():
    raised = TimeoutError("the work's own")

    async def times_out() -> None:
        raise raised

    with pytest.raises(TimeoutError) as caught:
        await bounded(times_out())

    assert caught.value is raised


@pytest.fixture
async def set_up_in_a_scope() -> AsyncIterator[bool]:
    yield in_a_scope()


async def test_an_async_fixture_runs_in_a_scope_of_its_own(set_up_in_a_scope: bool):
    assert set_up_in_a_scope, "the fixture ran outside any scope: `tests/conftest.py :: pytest_fixture_setup` did not wrap it"


async def test_a_task_left_running_fails_its_scope_and_is_cancelled():
    started: list[asyncio.Task[None]] = []

    async def never_finishes() -> None:
        await asyncio.Event().wait()

    async def starts_one() -> None:
        started.append(asyncio.create_task(never_finishes()))

    with pytest.raises(AssertionError, match=r"left 1 task\(s\) running, cancelled here: .*never_finishes"):
        await bounded(starts_one())

    assert [task.cancelled() for task in started] == [True]


async def test_a_task_started_outside_the_scope_is_not_its_own():
    """A monitor opened before the scope, as an earlier case opens the shared client's, starting a read during it."""

    asked, started = asyncio.Event(), asyncio.Event()
    children: list[asyncio.Task[bool]] = []

    async def outside() -> None:
        await asked.wait()
        children.append(asyncio.create_task(asyncio.Event().wait()))
        started.set()

    async def asks_for_one() -> None:
        asked.set()
        await started.wait()

    parent = asyncio.create_task(outside())
    try:
        await bounded(asks_for_one())

        assert [child.cancelled() for child in children] == [False]
    finally:
        for task in [parent, *children]:
            task.cancel()
        await asyncio.wait([parent, *children])


async def test_a_task_started_as_a_left_task_unwinds_is_cancelled_too():
    started: list[asyncio.Task[None]] = []

    async def never_finishes() -> None:
        await asyncio.Event().wait()

    running = asyncio.Event()

    async def starts_another_as_it_unwinds() -> None:
        try:
            running.set()
            await asyncio.Event().wait()
        finally:
            started.append(asyncio.create_task(never_finishes()))

    async def starts_one() -> None:
        started.append(asyncio.create_task(starts_another_as_it_unwinds()))
        # Running, or its cancellation would land before its `try`.
        await running.wait()

    with pytest.raises(AssertionError, match=r"left 2 task\(s\) running, cancelled here: .*never_finishes, .*starts_another_as_it_unwinds"):
        await bounded(starts_one())

    assert [task.cancelled() for task in started] == [True, True]


async def test_a_task_running_past_its_cancellation_refuses_every_later_scope_until_it_ends():
    """A case leaving it, then the next case's scope, which names that case by its node id."""

    released, running = asyncio.Event(), asyncio.Event()
    started: list[asyncio.Task[None]] = []

    async def ignores_its_cancellation() -> None:
        running.set()
        while not released.is_set():
            # Swallowed on purpose: the defect a scope cannot cancel away.
            with contextlib.suppress(asyncio.CancelledError):
                await released.wait()

    async def starts_one() -> None:
        started.append(asyncio.create_task(ignores_its_cancellation()))
        # Running, or its cancellation would land before its loop.
        await running.wait()

    with pytest.raises(AssertionError, match=r"still running 5 s after their cancellation: .*ignores_its_cancellation"):
        await bounded_case(starts_one(), "tests/the_first.py::case")
    try:
        with pytest.raises(AssertionError, match=r"this case was not run: tests/the_first\.py::case left task\(s\) .*ignores_its_cancellation"):
            await bounded_case(asyncio.sleep(0), "tests/the_next.py::case")
    finally:
        released.set()
        await asyncio.wait(started)

    # Once it ended, nothing runs that a later scope needs isolating from.
    await bounded(asyncio.sleep(0))


@contextlib.asynccontextmanager
async def _a_server_that_never_answers() -> AsyncIterator[tuple[str, asyncio.Event]]:
    """A url whose server takes a client's first `hello` and never answers it, and the event set once it has.

    Its tasks, a Windows loop's accept among them, run in a context of their own, as a real server runs outside the case.
    A client of it closes inside the block, since the server's close waits on its connections.
    """

    received = asyncio.Event()

    async def never_answers(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        await reader.read(1)
        received.set()
        # Until the client closes the connection.
        await reader.read()
        writer.close()

    server = await asyncio.create_task(asyncio.start_server(never_answers, "127.0.0.1", 0), context=contextvars.Context())
    async with server:
        port = server.sockets[0].getsockname()[1]
        yield f"mongodb://127.0.0.1:{port}/?directConnection=true&serverMonitoringMode=poll", received


async def _reading(received: asyncio.Event) -> None:
    """Once the monitor's first check is in flight, which `aconnect` starts without selecting the server."""

    await received.wait()
    reading = {getattr(task.get_coro(), "__qualname__", None) for task in asyncio.all_tasks()}
    assert "PyMongoProtocol.read" in reading, "the monitor's read is not in flight, so the scope's end judges none"


async def test_a_client_the_scope_opens_and_leaves_open_fails_it():
    async with _a_server_that_never_answers() as (url, received):
        client: AsyncMongoClient = AsyncMongoClient(url)

        async def opens_it() -> None:
            await client.aconnect()
            await _reading(received)

        try:
            with pytest.raises(AssertionError, match=r"cancelled here: .*AsyncPeriodicExecutor\._run"):
                await bounded(opens_it())
        finally:
            await client.close()


async def test_a_shared_client_s_monitor_mid_check_is_not_the_scope_s():
    """The shared client opened inside the scope, as the first case of a session opens it."""

    async with _a_server_that_never_answers() as (url, received):
        opened: list[AsyncMongoClient] = []

        async def opens_it() -> None:
            opened.append(await shared_client(url))
            await _reading(received)

        try:
            await bounded(opens_it())
        finally:
            # Its own: no other case asks for this url, and `close_the_shared_clients` closing it again is a no-op.
            for client in opened:
                await client.close()


async def test_a_background_task_first_started_outside_every_scope_is_restarted_outside_them():
    """pymongo's own executor, as it restarts a shared client's monitor from a later case's server selection."""

    started: list[asyncio.Task[Any]] = []
    restarted = asyncio.Event()

    async def target() -> bool:
        running = asyncio.current_task()
        assert running is not None
        started.append(running)
        restarted.set()
        # The first run stops the executor, its task ending uncancelled as a monitor's does when its check raises.
        return len(started) > 1

    executor = AsyncPeriodicExecutor(interval=60, min_interval=0.01, target=target, name="the_shared_monitor")
    contextvars.Context().run(executor.open)
    await restarted.wait()
    await asyncio.wait(started)
    restarted.clear()

    async def restarts_it() -> None:
        executor.open()
        await restarted.wait()

    try:
        await bounded(restarts_it())

        assert [task.done() for task in started] == [True, False], "the restarted task was cancelled as the scope's own"
    finally:
        executor.close()
        await asyncio.wait(started)


async def test_a_clean_database_entered_outside_a_case_is_refused():
    async def entered_as_a_fixture_would() -> None:
        # Past the refusal, the first selection fails at once rather than after pymongo's 30 s, the case's own bound.
        with pymongo.timeout(UNANSWERED_DEADLINE_S):
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
        await (await shared_client(mongo_replica_set_url))[DATABASE_NAME][Collection.SAISONS].insert_one(
            dict(saison_document("2127", "future"))
        )

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
