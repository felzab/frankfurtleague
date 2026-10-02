import ast
import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from types import SimpleNamespace
from typing import Any, cast

import anyio
import pytest
from bson import ObjectId
from fastapi import FastAPI
from pymongo import AsyncMongoClient, monitoring
from pymongo.asynchronous.client_session import AsyncClientSession
from starlette.types import Message, Scope

from app.core.collections import Collection
from app.core.exception_handlers import DATABASE_FAILED
from app.core.logging import fl_logger
from app.core.middlewares import request_deadline_var
from app.core.transactions import ABORT_GRACE_S, drain, transaction_session
from app.main import create_app
from tests.config import TEST_BASE_URL, build_test_config
from tests.core.app_source import APP_ROOT, BACKEND_ROOT, app_calls, callee, parsed
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

PAGE = 3

TRANSACTION_SESSION = "transaction_session"


class _Session:
    def __init__(self) -> None:
        self.open = False

    async def __aenter__(self) -> _Session:
        self.open = True
        return self

    async def __aexit__(self, *_: Any) -> None:
        self.open = False


class _Client:
    def __init__(self) -> None:
        self.sessions: list[_Session] = []

    def start_session(self) -> _Session:
        self.sessions.append(_Session())
        return self.sessions[-1]


class TestAFullPageIsRunAgain:
    @pytest.mark.parametrize(
        "pages",
        [
            pytest.param([(PAGE, 2, 1)], id="a page at the bound is the last"),
            pytest.param([(PAGE + 1, 4, 2), (PAGE - 1, 2, 0)], id="a page past the bound, then a short one"),
            pytest.param([(PAGE + 1, 4, 2), (PAGE + 1, 4, 3), (0, 0, 0)], id="two past the bound, then an empty one"),
        ],
    )
    def test_the_pages_run_until_one_is_no_longer_than_the_bound(self, pages: list[tuple[int, int, int]]):
        """The first case is the load-bearing one.

        A page of exactly the bound is whole, and one its clock leaves standing would be read for ever.
        """

        client = _Client()
        handed: list[_Session] = []

        async def page_of(session: Any) -> tuple[int, int, int]:
            assert session.open, "a page ran outside the session it was handed"
            handed.append(session)
            return pages[len(handed) - 1]

        erased, redacted = asyncio.run(drain(db=cast(AsyncMongoClient, client), page_of=page_of, page=PAGE))

        assert handed == client.sessions
        assert len(handed) == len(pages)
        assert (erased, redacted) == (sum(page[1] for page in pages), sum(page[2] for page in pages))


class _TransactedSession(_Session):
    """A session whose transaction number says a transaction ran on it, recording every command its client is sent."""

    _transaction_id = 3

    def __init__(self) -> None:
        super().__init__()
        self.sent: list[dict[str, Any]] = []
        self.client = SimpleNamespace(admin=SimpleNamespace(command=self._command))

    async def _command(self, command: dict[str, Any], **_: Any) -> None:
        self.sent.append(command)


class _TransactingClient:
    def __init__(self) -> None:
        self.session = _TransactedSession()

    def start_session(self) -> _TransactedSession:
        return self.session


def _aborts_sent(*, fails: bool, deadline: float | None) -> list[dict[str, Any]]:
    """What one session's client is sent once the work inside it fails or finishes, under a request deadline at `deadline`."""

    client = _TransactingClient()

    async def run() -> None:
        token = request_deadline_var.set(deadline)
        try:
            async with transaction_session(cast(AsyncMongoClient, client)):
                if fails:
                    raise RuntimeError("the work inside the session failed")
        except RuntimeError:
            pass
        finally:
            request_deadline_var.reset(token)

    asyncio.run(run())

    return client.session.sent


class TestAFailedSessionAbortsInsideItsGrace:
    def test_a_failure_inside_the_grace_sends_the_abort(self):
        """The control: without it, a helper sending nothing at all would pass the case below."""

        assert _aborts_sent(fails=True, deadline=time.monotonic() - ABORT_GRACE_S / 2) == [
            {"abortTransaction": 1, "txnNumber": 3, "autocommit": False}
        ]

    def test_a_failure_past_the_grace_sends_nothing_and_says_so(self, caplog: pytest.LogCaptureFixture):
        """Load-bearing: pymongo reads a deadline of zero as none, so a spent grace handed on would wait without bound."""

        with caplog.at_level(logging.ERROR, logger=fl_logger.name):
            sent = _aborts_sent(fails=True, deadline=time.monotonic() - ABORT_GRACE_S - 1)

        assert sent == []
        assert [getattr(record, "error_code", None) for record in caplog.records] == [DATABASE_FAILED]

    def test_a_session_whose_work_finished_is_sent_no_abort(self):
        """A committed transaction answers an abort harmlessly, so only this case keeps one round trip off every write."""

        assert _aborts_sent(fails=False, deadline=time.monotonic()) == []


class _AnsweringSession(_TransactedSession):
    """A session whose client answers a command one round trip after it is sent, where a cancellation delivered again takes it."""

    async def _command(self, command: dict[str, Any], **_: Any) -> None:
        await asyncio.sleep(0)
        self.sent.append(command)


class _AnsweringClient:
    def __init__(self) -> None:
        self.session = _AnsweringSession()

    def start_session(self) -> _AnsweringSession:
        return self.session


_HELD = "/held"

_SCOPE: Scope = {
    "type": "http",
    "asgi": {"version": "3.0"},
    "http_version": "1.1",
    "method": "GET",
    "scheme": "http",
    "path": _HELD,
    "raw_path": _HELD.encode(),
    "query_string": b"",
    "headers": [(b"host", TEST_BASE_URL.removeprefix("http://").encode())],
    "client": ("127.0.0.1", 1),
    "server": ("testserver", 80),
}


async def _never_disconnects() -> Message:
    await anyio.sleep_forever()
    raise AssertionError("unreachable")


async def _discarded(_message: Message) -> None:
    return None


async def _cancelled_by_the_server(served: FastAPI, inside: asyncio.Event) -> None:
    """What uvicorn does to a request still running when its shutdown grace runs out: one cancel of the task serving it."""

    serving = asyncio.create_task(served(_SCOPE, _never_disconnects, _discarded))
    await inside.wait()
    serving.cancel()
    with pytest.raises(asyncio.CancelledError):
        await serving


async def _cancelled_by_a_scope(served: FastAPI, inside: asyncio.Event) -> None:
    """An anyio cancel scope around the request, which cancels it again at every await until it leaves the scope."""

    async with anyio.create_task_group() as group:
        group.start_soon(served, _SCOPE, _never_disconnects, _discarded)
        await inside.wait()
        group.cancel_scope.cancel()


class TestACancelledRequestStillAbortsItsTransaction:
    @pytest.mark.parametrize(
        "cancel",
        [
            pytest.param(_cancelled_by_the_server, id="the server cancelling the request's task"),
            pytest.param(_cancelled_by_a_scope, id="an anyio cancel scope around the request"),
        ],
    )
    def test_the_abort_is_answered(self, cancel: Callable[[FastAPI, asyncio.Event], Awaitable[None]]):
        """Through the app's own middleware stack, which decides whether a cancellation arrives once or at every await.

        The scope's case holds the abort's shield; the server's holds `transaction_session` catching a cancellation at all.
        """

        client = _AnsweringClient()
        inside = asyncio.Event()

        async def held_inside_a_session() -> None:
            async with transaction_session(cast(AsyncMongoClient, client)):
                inside.set()
                await anyio.sleep_forever()

        served = create_app(build_test_config())
        served.add_api_route(_HELD, held_inside_a_session)

        asyncio.run(cancel(served, inside))

        assert client.session.sent == [{"abortTransaction": 1, "txnNumber": 3, "autocommit": False}]


DATABASE_NAME = worker_database("fl_transactions_test")

NO_SUCH_TRANSACTION = 251
TRANSACTION_COMMITTED = 256


class _Aborts(monitoring.CommandListener):
    """The code each `abortTransaction` the client sends is answered with, `None` for one that succeeded."""

    def __init__(self) -> None:
        self.answered: list[int | None] = []

    def started(self, event: monitoring.CommandStartedEvent) -> None:
        """Required by the listener interface; an abort is judged by its answer."""

    def succeeded(self, event: monitoring.CommandSucceededEvent) -> None:
        if event.command_name == "abortTransaction":
            self.answered.append(None)

    def failed(self, event: monitoring.CommandFailedEvent) -> None:
        if event.command_name == "abortTransaction":
            self.answered.append(event.failure.get("code"))


class _Refused(Exception):
    """A route's own refusal, raised inside its callback once a write has gone."""


@pytest.mark.db
class TestARefusedTransactionalWriteRaisesNoAlarm:
    def test_the_abort_the_driver_already_sent_is_not_logged(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """`with_transaction` aborts first, so the server answers this helper's abort NoSuchTransaction.

        Every refusal a route raises inside its transaction takes this path, so an alarm here would sound on each.
        """

        aborts = _Aborts()

        async def body() -> None:
            async with a_clean_database(mongo_replica_set_url, DATABASE_NAME, constraints=False, collections=(Collection.AKTIONEN,)):
                # A client of this case's own, so the listener sees this transaction's commands and none of the seeding.
                watched = AsyncMongoClient(mongo_replica_set_url, event_listeners=[aborts])
                try:
                    written = watched[DATABASE_NAME][Collection.AKTIONEN]

                    async def write_then_refuse(session: AsyncClientSession) -> None:
                        await written.insert_one({"_id": ObjectId()}, session=session)
                        raise _Refused

                    with pytest.raises(_Refused):
                        async with transaction_session(watched) as session:
                            await session.with_transaction(write_then_refuse)
                finally:
                    await watched.close()

        with caplog.at_level(logging.ERROR, logger=fl_logger.name):
            on_the_seed_loop(body())

        # The control: the driver's abort, then this helper's; a helper sending nothing would also log nothing.
        assert aborts.answered == [None, NO_SUCH_TRANSACTION]
        assert [record for record in caplog.records if getattr(record, "error_code", None) == DATABASE_FAILED] == []


class _FailedAfterTheCommit(Exception):
    """Work inside the session failing once its transaction has committed, as a response built from the result can."""


@pytest.mark.db
class TestAFailureAfterTheCommitRaisesNoAlarm:
    def test_the_abort_the_commit_answers_is_not_logged(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """The server answers this helper's abort TransactionCommitted: the write stands and nothing is left open."""

        aborts = _Aborts()

        async def body() -> int:
            async with a_clean_database(mongo_replica_set_url, DATABASE_NAME, constraints=False, collections=(Collection.AKTIONEN,)):
                # A client of this case's own, so the listener sees this transaction's commands and none of the seeding.
                watched = AsyncMongoClient(mongo_replica_set_url, event_listeners=[aborts])
                try:
                    written = watched[DATABASE_NAME][Collection.AKTIONEN]

                    async def write(session: AsyncClientSession) -> None:
                        await written.insert_one({"_id": ObjectId()}, session=session)

                    with pytest.raises(_FailedAfterTheCommit):
                        async with transaction_session(watched) as session:
                            await session.with_transaction(write)
                            raise _FailedAfterTheCommit
                    return await written.count_documents({})
                finally:
                    await watched.close()

        with caplog.at_level(logging.ERROR, logger=fl_logger.name):
            stored = on_the_seed_loop(body())

        # The control: this helper's abort, answered; a helper sending nothing would also log nothing.
        assert (aborts.answered, stored) == ([TRANSACTION_COMMITTED], 1)
        assert [record for record in caplog.records if getattr(record, "error_code", None) == DATABASE_FAILED] == []


def _is_a_snapshot(call: ast.Call) -> bool:
    snapshot = [keyword.value for keyword in call.keywords if keyword.arg == "snapshot"]
    return any(isinstance(value, ast.Constant) and value.value is True for value in snapshot)


def _sessions_opened_past_the_helper() -> set[str]:
    """Every site opening a session that can hold a transaction: a snapshot session cannot."""

    return {f"{module} :: {scope}" for module, scope, call in app_calls() if callee(call) == "start_session" and not _is_a_snapshot(call)}


# Every one, never a list of managers known to swallow: whether an `__exit__` swallows what the block
# raised is the manager's choice at run time (`contextlib.suppress`, an anyio cancel scope), and no
# block needs one.
_CONTEXT_MANAGED = (ast.With, ast.AsyncWith)


def _transaction_sessions() -> list[tuple[str, ast.AsyncWith]]:
    return [
        (path.relative_to(BACKEND_ROOT).as_posix(), node)
        for path in sorted(APP_ROOT.rglob("*.py"))
        for node in ast.walk(parsed(path))
        if isinstance(node, ast.AsyncWith)
        and any(isinstance(item.context_expr, ast.Call) and callee(item.context_expr) == TRANSACTION_SESSION for item in node.items)
    ]


class TestEveryTransactionRunsOnTheHelpersSession:
    """`docs/backend/spec.md :: I539`: a session opened past `transaction_session`, or a failure caught inside one, ends with no abort sent."""

    def test_no_session_able_to_transact_is_opened_past_it(self):
        assert _sessions_opened_past_the_helper() == {f"app/core/transactions.py :: {TRANSACTION_SESSION}"}

    def test_no_failure_is_caught_inside_one(self):
        blocks = _transaction_sessions()
        # Non-empty, so a helper renamed past this sweep's spelling fails rather than finding nothing to judge.
        assert blocks

        catching = [
            f"{module}:{node.lineno}"
            for module, block in blocks
            for node in ast.walk(block)
            if node is not block and isinstance(node, (ast.Try, ast.TryStar, *_CONTEXT_MANAGED))
        ]
        assert catching == []
