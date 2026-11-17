"""
TESTS · the scope every async case runs in (`tests/database.py :: bounded_case`)

Invariants:
- Every async case runs under the case's bound, which `tests/conftest.py :: pytest_collection_modifyitems` applies by
  wrapping what pytest-asyncio runs: a case reaching here unwrapped runs unbounded, and a rival deadlocked on its own
  write's transaction waits until the server's transaction lifetime, far past the run. Work past its bound is cut, and
  fails as cut whatever it raises as it unwinds; a `TimeoutError` the work raises itself passes as it was.
- A task the work starts and leaves running fails the scope that left it, and is cancelled there rather than running
  into the next case, as is a task one of those starts as it unwinds. A task still running once cancelled refuses every
  later case and fixture setup until it ends, and no teardown, which is what may end it. A task started outside the
  scope is not the scope's, nor is a shared client's monitor, wherever that client was first asked for and whichever
  scope pymongo restarts it from; a client the scope opens and leaves open fails it.
- Every async fixture's setup and teardown run in a scope of their own, under the fixture's bound, in every shape a
  fixture takes: a coroutine, a generator, on a class and parametrised.
- A clean database is entered in a case's body alone, and a module's corpus is judged after the module's cases: it is
  refused when released in the task that seeded it, and nothing clears it while it is held.
- A transaction a scope leaves open fails that scope, whatever clean database it entered meanwhile, and is ended there
  rather than holding the next case.
- A variable a corpus's seed binds stays out of the fixture's context, which pytest-asyncio carries into every case of
  the module.
"""

import asyncio
import contextlib
import contextvars
from collections.abc import AsyncIterator, Iterator
from types import CoroutineType
from typing import Any

import pymongo
import pytest
from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import PyMongoError

from app.core.collections import Collection
from app.core.concurrency import concurrently
from app.core.db import new_client
from app.core.logging import NO_REQUEST_SENTINEL, trace_id_var
from tests.config import UNANSWERED_DEADLINE_S, UNANSWERED_URI
from tests.database import (
    CASE_BOUND_S,
    FIXTURE_BOUND_S,
    a_clean_database,
    bounded,
    bounded_case,
    case_deadline,
    fixture_phase,
    held_corpus,
    scope_deadline,
    shared_client,
)
from tests.documents import saison_document
from tests.worker import worker_database

DATABASE_NAME = worker_database("fl_case_scope_test")
# A second database, one a case enters while a transaction it began elsewhere stands open.
ANOTHER_DATABASE_NAME = worker_database("fl_case_scope_other_test")


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


def _in_its_phase() -> None:
    """Inside a fixture's phase, under the fixture's own bound; an assertion here fails the case's setup or its teardown."""

    deadline = scope_deadline()
    assert deadline is not None, "the fixture ran outside a bounded scope: `tests/conftest.py :: pytest_fixture_setup` did not wrap it"
    left = deadline - asyncio.get_running_loop().time()
    assert CASE_BOUND_S < left <= FIXTURE_BOUND_S, f"the fixture's phase is cut {left:.0f} s on, not at the fixture's own bound"


@pytest.fixture
async def a_generator() -> AsyncIterator[None]:
    _in_its_phase()
    yield
    _in_its_phase()


@pytest.fixture
async def a_coroutine() -> None:
    _in_its_phase()


@pytest.fixture(params=["first", "second"])
async def parametrised(request: pytest.FixtureRequest) -> AsyncIterator[str]:
    _in_its_phase()
    yield request.param
    _in_its_phase()


class TestAnAsyncFixture:
    @pytest.fixture
    async def on_a_class(self) -> AsyncIterator[None]:
        _in_its_phase()
        yield
        _in_its_phase()

    async def test_runs_each_phase_in_a_bounded_scope(self, a_generator: None, a_coroutine: None, parametrised: str, on_a_class: None):
        """Judged in the fixtures themselves, their teardowns included: each phase asserts its own scope."""


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


class _Stray:
    """A task that ignores its cancellation until released."""

    def __init__(self) -> None:
        self.released = asyncio.Event()
        self.running = asyncio.Event()
        self.tasks: list[asyncio.Task[None]] = []

    async def _ignores_its_cancellation(self) -> None:
        self.running.set()
        while not self.released.is_set():
            # Swallowed on purpose: the defect a scope cannot cancel away.
            with contextlib.suppress(asyncio.CancelledError):
                await self.released.wait()

    async def starts_one(self) -> None:
        self.tasks.append(asyncio.create_task(self._ignores_its_cancellation()))
        # Running, or its cancellation would land before its loop.
        await self.running.wait()


@pytest.fixture
def stray() -> Iterator[_Stray]:
    """The stray task, released again once the async teardown below has run or been refused.

    So a refused teardown fails the case's teardown rather than leaving the task to hold the session's loop open.
    """

    held = _Stray()
    yield held
    held.released.set()


@pytest.fixture
async def released_in_its_teardown(stray: _Stray) -> AsyncIterator[_Stray]:
    """The case's stray task, which this fixture's teardown releases and waits out: a teardown refused fails here."""

    yield stray
    stray.released.set()
    await asyncio.wait(stray.tasks)


async def test_a_task_running_past_its_cancellation_refuses_a_fixture_s_setup_and_no_teardown(released_in_its_teardown: _Stray):
    """The teardown releasing the task runs after this case, in a phase of its own, while the task still runs."""

    with pytest.raises(AssertionError, match=r"still running 5 s after their cancellation"):
        await bounded_case(released_in_its_teardown.starts_one(), "tests/the_first.py::case")

    with pytest.raises(AssertionError, match=r"the setup of 'the next' was not run: tests/the_first\.py::case left task\(s\)"):
        await fixture_phase(asyncio.sleep(0), "the setup of 'the next'", setup=True)


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
        client: AsyncMongoClient = new_client(url)

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


def _monitor_tasks() -> set[asyncio.Task[Any]]:
    return {task for task in asyncio.all_tasks() if task.get_name() == "pymongo_server_monitor_task"}


async def test_a_shared_client_s_monitor_restarted_by_a_scope_s_server_selection_is_not_the_scope_s():
    """pymongo's own restart: a shared monitor whose task ended uncancelled, reopened by a later case's server selection."""

    async with _a_server_that_never_answers() as (url, received):
        before = _monitor_tasks()
        # A check failing at once rather than at the connect timeout, so the monitor sleeps between its checks.
        client = await shared_client(f"{url}&connectTimeoutMS=100")
        try:
            await received.wait()
            [monitor] = _monitor_tasks() - before
            # Ended uncancelled, as a check that raised leaves it: the flag pymongo's executor sets then, read between
            # checks. The only step here not pymongo's own.
            running = monitor.get_coro()
            assert isinstance(running, CoroutineType) and running.cr_frame is not None, running
            running.cr_frame.f_locals["self"]._stopped = True
            await asyncio.wait([monitor], timeout=5)
            assert monitor.done() and not monitor.cancelled(), "the shared monitor did not end uncancelled"

            async def selects_a_server() -> None:
                # No server answers, so the selection runs the topology's opening again, which restarts the monitor.
                with pymongo.timeout(0.5), contextlib.suppress(PyMongoError):
                    await client.admin.command("ping")

            await bounded(selects_a_server())

            restarted = _monitor_tasks() - before - {monitor}
            assert [task.done() for task in restarted] == [False], "the selection restarted no monitor, so the scope judged none"
        finally:
            # Its own: no other case asks for this url, and `close_the_shared_clients` closing it again is a no-op.
            await client.close()


async def test_a_clean_database_entered_outside_a_case_is_refused():
    async def entered_as_a_fixture_would() -> None:
        # Past the refusal, the first selection fails at once rather than after pymongo's 30 s, the case's own bound.
        with pymongo.timeout(UNANSWERED_DEADLINE_S):
            async with a_clean_database(UNANSWERED_URI, DATABASE_NAME):
                pass

    with pytest.raises(RuntimeError, match="entered outside a case"):
        # An empty context, as a fixture's setup runs outside any case.
        await asyncio.create_task(entered_as_a_fixture_would(), context=contextvars.Context())


async def _one_season(database: AsyncDatabase, session: AsyncClientSession | None = None) -> None:
    await database[Collection.SAISONS].insert_one(dict(saison_document("2126", "active")), session=session)


@pytest.mark.db
async def test_a_transaction_left_open_fails_the_scope_that_began_it_and_is_ended(mongo_replica_set_url: str):
    client = await shared_client(mongo_replica_set_url)
    session = client.start_session()

    async def leaves_one_open() -> None:
        async with a_clean_database(mongo_replica_set_url, DATABASE_NAME) as (_, database):
            await session.start_transaction()
            await _one_season(database, session=session)
        # A clean database entered and left while it stands is not the one that judges it.
        async with a_clean_database(mongo_replica_set_url, ANOTHER_DATABASE_NAME):
            pass

    try:
        with pytest.raises(AssertionError, match=r"^this left 1 transaction\(s\) open, ended here"):
            await bounded(leaves_one_open())

        standing = await (
            await client.admin.aggregate(
                [{"$currentOp": {"allUsers": True, "idleSessions": True}}, {"$match": {"lsid.id": session.session_id["id"]}}]
            )
        ).to_list(length=None)
        assert [found for found in standing if "transaction" in found] == [], "the transaction left open was not ended"
    finally:
        await session.end_session()


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
