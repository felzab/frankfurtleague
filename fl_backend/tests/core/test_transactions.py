import asyncio
import logging
import re
import time
from collections.abc import Awaitable, Callable, Mapping, Sequence
from types import SimpleNamespace
from typing import Any, cast

import anyio
import pytest
from fastapi import FastAPI
from pydantic import BaseModel, Field, ValidationError
from pymongo import AsyncMongoClient
from pymongo.errors import ExecutionTimeout, OperationFailure
from starlette.types import Message, Scope

from app.core.codes import Code
from app.core.logging import JSONFormatter, fl_logger
from app.core.middlewares import RequestDeadline, request_deadline_var
from app.core.transactions import ABORT_GRACE_S, save_each, transaction_session
from app.main import create_shell
from tests.config import TEST_BASE_URL


class _Session:
    # No transaction number, as on a session no transaction reached a server through: a failure inside
    # it is sent no abort.
    _server_session = object()
    _transaction_id = 0

    def __init__(self, attempts: int = 1) -> None:
        self.open = False
        self.attempts = attempts

    async def __aenter__(self) -> _Session:
        self.open = True
        return self

    async def __aexit__(self, *_: Any) -> None:
        self.open = False

    async def with_transaction(self, callback: Callable[[Any], Awaitable[Any]]) -> Any:
        """As the driver runs one: the callback handed the session itself, once per attempt, the last attempt's answer returned."""

        answer = None
        for _ in range(self.attempts):
            answer = await callback(self)

        return answer


class _Client:
    def __init__(self, attempts: int = 1) -> None:
        self.sessions: list[_Session] = []
        self.attempts = attempts

    def start_session(self) -> _Session:
        self.sessions.append(_Session(self.attempts))
        return self.sessions[-1]


class _FailedInTheCallback(Exception):
    """The callback's own failure."""


# A stored value each failure below quotes in its message, as a driver's or a model's can.
A_STORED_VALUE = "Quillhilde"


class _Answer(BaseModel):
    birth_date: str = Field(pattern=r"^[0-9]{4}$")


def _refused_by_the_answer() -> ValidationError:
    try:
        _Answer.model_validate({"birth_date": A_STORED_VALUE})
    except ValidationError as refused:
        return refused
    raise AssertionError("the answer took a value its pattern refuses")


ROWS = [{"_id": position} for position in range(3)]


class TestARowFailingAloneIsPassedOver:
    """Over doubles, for the failures no database case reaches cheaply."""

    @pytest.mark.parametrize(
        ("failure", "code", "diagnosis"),
        [
            pytest.param(
                lambda: _FailedInTheCallback(A_STORED_VALUE),
                Code.UNHANDLED_CRASH,
                r"_FailedInTheCallback in save at .+test_transactions\.py:\d+",
                id="not the database's, located by its innermost frame",
            ),
            pytest.param(
                lambda: OperationFailure(A_STORED_VALUE, 2, {"ok": 0, "code": 2, "errmsg": A_STORED_VALUE}),
                Code.DATABASE_FAILED,
                re.escape("OperationFailure, code 2"),
                id="the database's, named by its type and code alone",
            ),
            pytest.param(
                lambda: _refused_by_the_answer(),
                Code.STORED_DATA_INVALID,
                re.escape("ValidationError: ")
                + re.escape("[{'loc': 'birth_date', 'type': 'string_pattern_mismatch', 'msg': \"String should match pattern '^[0-9]{4}$'\"}]"),
                id="a stored value the answer refuses, with the fields it refused",
            ),
        ],
    )
    async def test_the_rows_after_it_are_saved_each_in_a_session_of_its_own(
        self, caplog: pytest.LogCaptureFixture, failure: Callable[[], Exception], code: str, diagnosis: str
    ):
        client = _Client()

        async def save(session: Any, row: Mapping[str, Any]) -> int:
            assert session.open, "a row was saved outside the session it was handed"
            if row["_id"] == 1:
                raise failure()
            return row["_id"]

        with caplog.at_level(logging.ERROR, logger=fl_logger.name):
            saved = await save_each(db=cast(AsyncMongoClient, client), rows=ROWS, save=save, what="Row", clock="test")

        assert (saved.answers, saved.failed, saved.cut, len(client.sessions)) == ([0, 2], 1, False, len(ROWS))
        [record] = caplog.records
        line = JSONFormatter().format(record)
        assert (record.getMessage(), getattr(record, "error_code", None)) == ("transactions.row_passed_over", code)
        assert (getattr(record, "what", None), getattr(record, "row_id", None), getattr(record, "clock", None)) == ("Row", "1", "test")
        assert re.fullmatch(diagnosis, getattr(record, "diagnosis", "")) is not None, line
        # The record's value reaches no line: a line about an erasure would outlive it.
        assert A_STORED_VALUE not in line


class TestTheDeadlineEndsThePass:
    @pytest.mark.parametrize(
        ("labels", "code", "unanswered"),
        [
            pytest.param([], Code.DATABASE_FAILED, False, id="its commit never sent"),
            # As the driver raises one: `with_transaction` retries an unanswered commit until the deadline, keeping the label.
            pytest.param(["UnknownTransactionCommitResult"], Code.UNKNOWN_OUTCOME, True, id="its commit unanswered"),
        ],
    )
    async def test_it_warns_once_naming_the_row_it_cut_and_tries_none_after_it(
        self, caplog: pytest.LogCaptureFixture, labels: list[str], code: str, unanswered: bool
    ):
        """Every later row would meet the same deadline, and an unanswered commit may have written the row it names."""

        tried: list[int] = []

        async def save(_: Any, row: Mapping[str, Any]) -> int:
            tried.append(row["_id"])
            if row["_id"] == 1:
                raise ExecutionTimeout("deadline", 50, {"errorLabels": labels})
            return row["_id"]

        with caplog.at_level(logging.WARNING, logger=fl_logger.name):
            saved = await save_each(db=cast(AsyncMongoClient, _Client()), rows=ROWS, save=save, what="Row", clock="test")

        assert (saved.answers, saved.failed, saved.cut, tried) == ([0], 0, True, [0, 1])
        assert [
            (
                record.levelname,
                record.getMessage(),
                getattr(record, "error_code", None),
                getattr(record, "row_id", None),
                getattr(record, "unanswered", None),
            )
            for record in caplog.records
        ] == [("WARNING", "transactions.pass_cut", code, "1", unanswered)]


class _TransactedSession(_Session):
    """A session whose transaction number says a transaction ran on it, recording every command its client is sent."""

    # Anything but pymongo's placeholder, as on a session a command has carried to a server.
    _server_session = object()
    _transaction_id = 3

    def __init__(self) -> None:
        super().__init__()
        self.sent: list[dict[str, Any]] = []
        self.client = SimpleNamespace(admin=SimpleNamespace(command=self._command))

    async def _command(self, command: dict[str, Any], **_: Any) -> None:
        self.sent.append(command)


# Far above the event loop's timer resolution, about 16 ms on Windows, and far under the grace.
ANSWERED_AFTER_S = 0.1


class _SlowlyAnsweredSession(_TransactedSession):
    """A session whose client answers a command `after_s` after it is sent, noting when it was sent."""

    def __init__(self, after_s: float = ANSWERED_AFTER_S) -> None:
        super().__init__()
        self.after_s = after_s
        self.sent_at: float | None = None

    async def _command(self, command: dict[str, Any], **_: Any) -> None:
        self.sent_at = time.monotonic()
        await asyncio.sleep(self.after_s)
        self.sent.append(command)


class _TransactingClient:
    def __init__(self, session: _TransactedSession) -> None:
        self.session = session

    def start_session(self) -> _TransactedSession:
        return self.session


async def _aborts_sent_in_turn(
    *,
    deadline: RequestDeadline | None,
    sessions: Sequence[_TransactedSession],
    fails: bool = True,
    between_s: float = 0.0,
    deadline_after_s: float | None = None,
) -> list[list[dict[str, Any]]]:
    """What each session's client is sent once the work inside it fails or finishes, the sessions one after another in one request.

    `between_s` stands for the request's work without the database between two sessions. `deadline_after_s` moves
    `deadline` to that long after the loop has started, so however slowly a loaded worker starts one, the first
    session meets the deadline as far ahead as the case says.
    """

    if deadline is not None and deadline_after_s is not None:
        deadline.at = time.monotonic() + deadline_after_s
    token = request_deadline_var.set(deadline)
    try:
        for index, session in enumerate(sessions):
            if index:
                await asyncio.sleep(between_s)
            try:
                async with transaction_session(cast(AsyncMongoClient, _TransactingClient(session))):
                    if fails:
                        raise RuntimeError("the work inside the session failed")
            except RuntimeError:
                pass
    finally:
        request_deadline_var.reset(token)

    return [session.sent for session in sessions]


async def _aborts_sent(*, fails: bool, deadline: RequestDeadline | None, session: _TransactedSession | None = None) -> list[dict[str, Any]]:
    """What one session's client is sent once the work inside it fails or finishes, under the request deadline `deadline`."""

    [sent] = await _aborts_sent_in_turn(deadline=deadline, sessions=[session or _TransactedSession()], fails=fails)

    return sent


class TestAFailedSessionAbortsInsideItsGrace:
    async def test_a_failure_reached_long_after_the_deadline_still_sends_the_abort(self):
        """The request meets its deadline only at its next database operation, however long after the deadline that falls.

        A grace counted from the deadline would leave this abort nothing, and the transaction's documents
        locked until the server's lifetime limit.
        """

        assert await _aborts_sent(fails=True, deadline=RequestDeadline(time.monotonic() - ABORT_GRACE_S - 1)) == [
            {"abortTransaction": 1, "txnNumber": 3, "autocommit": False}
        ]

    async def test_a_failure_past_the_grace_sends_nothing_and_says_so(self, caplog: pytest.LogCaptureFixture):
        """Load-bearing: pymongo reads a deadline of zero as none, so a spent grace handed on would wait without bound."""

        with caplog.at_level(logging.ERROR, logger=fl_logger.name):
            sent = await _aborts_sent(fails=True, deadline=RequestDeadline(time.monotonic() - 1, aborting_s=ABORT_GRACE_S))

        assert sent == []
        assert [getattr(record, "error_code", None) for record in caplog.records] == [Code.DATABASE_FAILED]

    @pytest.mark.parametrize(
        ("deadline_in_s", "charged"),
        [pytest.param(-1.0, True, id="an abort past the deadline"), pytest.param(10.0, False, id="an abort inside the deadline")],
    )
    async def test_an_abort_charges_the_grace_with_its_time_past_the_deadline(self, deadline_in_s: float, charged: bool):
        """Uncharged, a loop of cut transactions against a server that never answers waits out a whole grace apiece."""

        deadline = RequestDeadline(time.monotonic() + deadline_in_s)

        await _aborts_sent(fails=True, deadline=deadline, session=_SlowlyAnsweredSession())

        if charged:
            # Above zero rather than above the answer's wait: asyncio may end a sleep up to one clock tick early.
            assert 0 < deadline.aborting_s < ABORT_GRACE_S
        else:
            assert deadline.aborting_s == 0


# Over the event loop's timer resolution, about 16 ms on Windows, by which a sleep may end early.
PAST_BY_S = 0.1


class TestARequestsAbortsShareOneGrace:
    async def test_an_abort_begun_inside_the_deadline_charges_what_it_ran_past_it(self, caplog: pytest.LogCaptureFixture):
        """Uncharged, the next abort would open a second whole grace, against a server that answers neither."""

        # Placed once the loop runs, `PAST_BY_S` ahead of the first abort.
        deadline = RequestDeadline(at=0.0)
        # Answered only once the whole grace has passed the deadline, as an abort nothing answers runs to its timeout.
        unanswered = _SlowlyAnsweredSession(after_s=PAST_BY_S + ABORT_GRACE_S + PAST_BY_S)

        with caplog.at_level(logging.ERROR, logger=fl_logger.name):
            first, second = await _aborts_sent_in_turn(
                deadline=deadline, sessions=[unanswered, _TransactedSession()], deadline_after_s=PAST_BY_S
            )

        assert unanswered.sent_at is not None and unanswered.sent_at < deadline.at, "the first abort began past the deadline"
        assert (len(first), second) == (1, [])
        assert [getattr(record, "error_code", None) for record in caplog.records] == [Code.DATABASE_FAILED]

    async def test_work_between_two_cut_transactions_leaves_the_second_abort_its_share(self):
        """Charged to the grace, the request's work without the database between two cut transactions would leave the second abort nothing."""

        deadline = RequestDeadline(time.monotonic() - PAST_BY_S)

        sent = await _aborts_sent_in_turn(
            deadline=deadline, sessions=[_TransactedSession(), _TransactedSession()], between_s=ABORT_GRACE_S + PAST_BY_S
        )

        assert sent == [[{"abortTransaction": 1, "txnNumber": 3, "autocommit": False}]] * 2


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

    # In a group, so a request failing before it is inside fails the case at once, and one the case leaves is drained.
    async with asyncio.TaskGroup() as group:
        serving = group.create_task(served(_SCOPE, _never_disconnects, _discarded))
        await inside.wait()
        serving.cancel()

    # Propagated rather than swallowed: the app answers the cancel by ending, as uvicorn expects of it.
    assert serving.cancelled()


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
    async def test_the_abort_is_answered(self, cancel: Callable[[FastAPI, asyncio.Event], Awaitable[None]]):
        """Through the app's own middleware stack, which decides whether a cancellation arrives once or at every await.

        The scope's case holds the abort's shield; the server's holds `transaction_session` catching a cancellation at all.
        """

        client = _AnsweringClient()
        inside = asyncio.Event()

        async def held_inside_a_session() -> None:
            async with transaction_session(cast(AsyncMongoClient, client)):
                inside.set()
                await anyio.sleep_forever()

        served = create_shell()
        served.add_api_route(_HELD, held_inside_a_session)

        await cancel(served, inside)

        assert client.session.sent == [{"abortTransaction": 1, "txnNumber": 3, "autocommit": False}]


class TestTheRouteRunsInTheServersTask:
    async def test_no_layer_moves_it_into_a_task_of_its_own(self):
        """`app/core/middlewares.py :: TraceContextMiddleware`'s reason: a task group around the app cancels it at every await.

        The shield holds the helper's abort there, so only this case fails for pymongo's own cleanup awaits.
        """

        ran_in: list[asyncio.Task[Any] | None] = []

        async def records_its_task() -> None:
            ran_in.append(asyncio.current_task())

        served = create_shell()
        served.add_api_route(_HELD, records_its_task)

        async def serve() -> asyncio.Task[Any] | None:
            await served(_SCOPE, _never_disconnects, _discarded)
            return asyncio.current_task()

        assert ran_in == [await serve()]
