import asyncio
import logging
import re
import time
from collections.abc import Awaitable, Callable, Mapping
from http import HTTPStatus
from types import SimpleNamespace
from typing import Any, cast

import anyio
import pytest
from bson import ObjectId
from fastapi import FastAPI
from pydantic import BaseModel, Field, ValidationError
from pymongo import AsyncMongoClient, monitoring
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.errors import ExecutionTimeout, OperationFailure
from starlette.types import Message, Scope

from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError
from app.core.logging import JSONFormatter, fl_logger
from app.core.middlewares import request_deadline_var
from app.core.transactions import (
    ABORT_GRACE_S,
    Batch,
    StalledPage,
    drain,
    run_isolated,
    transaction_session,
)
from app.main import create_app
from tests.config import TEST_BASE_URL, UNANSWERED_URI, build_test_config
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

PAGE = 3


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

        async def loeschen_a_page(session: Any, _: Batch) -> tuple[int, int, int]:
            assert session.open, "a page ran outside the session it was handed"
            handed.append(session)
            return pages[len(handed) - 1]

        geloescht, redacted, _ = asyncio.run(
            drain(
                db=cast(AsyncMongoClient, client),
                page_of=loeschen_a_page,
                page=PAGE,
                what="Row",
                clock="test",
            )
        )

        assert handed == client.sessions
        assert len(handed) == len(pages)
        assert (geloescht, redacted) == (sum(page[1] for page in pages), sum(page[2] for page in pages))


class _FailedInTheCallback(Exception):
    """The callback's own failure."""


# A stored value each failure below quotes in its message, as a driver's or a model's can.
A_STORED_VALUE = "Quillhilde"


class _Answer(BaseModel):
    geburtsdatum: str = Field(pattern=r"^[0-9]{4}$")


def _refused_by_the_answer() -> ValidationError:
    try:
        _Answer.model_validate({"geburtsdatum": A_STORED_VALUE})
    except ValidationError as refused:
        return refused
    raise AssertionError("the answer took a value its pattern refuses")


async def _page(standing: list[int], batch: Batch) -> list[dict[str, int]]:
    """The rows standing under the filter `Batch.within` builds over a clock's empty one, read as the server reads it."""

    terms = [term["_id"] for term in batch.within({}).get("$and", [])[1:]]
    admitted = [row for row in standing if all(row in term.get("$in", [row]) and row not in term.get("$nin", ()) for term in terms)]

    return [{"_id": row} for row in admitted[: PAGE + 1]]


class _Rows:
    """The rows a clock's transaction reads, one past `PAGE` under its batch's term, raising whatever `raises` answers for what it read."""

    def __init__(self, count: int, raises: Callable[[list[int]], Exception | None]) -> None:
        self.standing = list(range(count))
        self.raises = raises
        self.read: list[list[int]] = []

    async def loeschen(self, _: Any, batch: Batch) -> tuple[int, int, int]:
        rows = [row["_id"] for row in await batch.saw(_page(self.standing, batch))]
        self.read.append(rows)
        if (failure := self.raises(rows)) is not None:
            raise failure

        for row in rows:
            self.standing.remove(row)
        return len(rows), len(rows), 0


def _isolated(rows: _Rows, *, owes: bool = False) -> tuple[list[tuple[int, int, int]], list[Any]]:
    return asyncio.run(
        run_isolated(
            db=cast(AsyncMongoClient, _Client()),
            batch=Batch(),
            attempt=rows.loeschen,
            moved=lambda page: page[1],
            owes=owes,
            what="Row",
            clock="test",
        )
    )


class _RefusedOnSomeAttempts:
    """A share clock whose judge refuses row 1 on the driver's attempts named alone, `_Client(attempts=2)` running it twice."""

    def __init__(self, refused_on: set[int]) -> None:
        self.standing = list(range(PAGE + 1))
        self.refused_on = refused_on
        self.attempts = 0

    async def remind(self, _: Any, batch: Batch) -> list[int]:
        self.attempts += 1
        attempt = self.attempts
        rows = await batch.saw(_page(self.standing, batch))

        def judge(row: Mapping[str, Any]) -> None:
            if row["_id"] == 1 and attempt in self.refused_on:
                raise _FailedInTheCallback

        taken = batch.took([row for row, _ in batch.judged(rows, judge)][: batch.share])
        return [row["_id"] for row in taken]


class TestARowFailingAloneIsPassedOver:
    """Over doubles, for the failures no row carries, which no database case reaches cheaply."""

    @pytest.mark.parametrize(
        ("failure", "code", "diagnosis"),
        [
            pytest.param(
                lambda: _FailedInTheCallback(A_STORED_VALUE),
                Code.UNHANDLED_CRASH,
                r"_FailedInTheCallback in loeschen at .+test_transactions\.py:\d+",
                id="not the database's, located by its innermost frame",
            ),
            pytest.param(
                lambda: OperationFailure(A_STORED_VALUE, 121, {"errInfo": {"details": {"missingProperties": ["trace_id"]}}}),
                Code.DATABASE_FAILED,
                re.escape("OperationFailure, code 121: [{'loc': 'trace_id', 'type': 'required', 'msg': 'property is missing'}]"),
                id="refused, with the properties the validator refused",
            ),
            pytest.param(
                lambda: _refused_by_the_answer(),
                Code.STORED_DATA_INVALID,
                re.escape("ValidationError: ")
                + re.escape(
                    "[{'loc': 'geburtsdatum', 'type': 'string_pattern_mismatch', 'msg': \"String should match pattern '^[0-9]{4}$'\"}]"
                ),
                id="a stored value the answer refuses, with the fields it refused",
            ),
        ],
    )
    def test_the_rest_of_its_page_goes_and_no_later_page_reads_it_again(
        self, caplog: pytest.LogCaptureFixture, failure: Callable[[], Exception], code: str, diagnosis: str
    ):
        rows = _Rows(2 * PAGE + 1, lambda read: failure() if 1 in read else None)

        with caplog.at_level(logging.ERROR, logger=fl_logger.name):
            geloescht, _, passed = asyncio.run(
                drain(
                    db=cast(AsyncMongoClient, _Client()),
                    page_of=rows.loeschen,
                    page=PAGE,
                    what="Row",
                    clock="test",
                )
            )

        assert (geloescht, rows.standing, passed) == (2 * PAGE, [1], [1])
        # The page after the one it failed in, read without it: read with it, it fails that page whole again.
        assert rows.read[-1] == [4, 5, 6]
        [record] = caplog.records
        line = JSONFormatter().format(record)
        assert (record.getMessage(), getattr(record, "error_code", None)) == ("transactions.row_passed_over", code)
        assert (getattr(record, "what", None), getattr(record, "row_id", None), getattr(record, "clock", None)) == ("Row", "1", "test")
        assert re.fullmatch(diagnosis, getattr(record, "diagnosis", "")) is not None, line
        # The record's value reaches no line: a line about an erasure would outlive it.
        assert A_STORED_VALUE not in line

    def test_a_row_failing_on_a_page_after_a_committed_one_is_passed_over_alone_too(self):
        """The first page commits whole before row 5 fails: a drain taking apart only its first page raises the whole pass here."""

        rows = _Rows(2 * PAGE + 1, lambda read: _FailedInTheCallback() if 5 in read else None)

        geloescht, _, passed = asyncio.run(
            drain(
                db=cast(AsyncMongoClient, _Client()),
                page_of=rows.loeschen,
                page=PAGE,
                what="Row",
                clock="test",
            )
        )

        assert (rows.read[0], geloescht, rows.standing, passed) == ([0, 1, 2, 3], 2 * PAGE, [5], [5])

    @pytest.mark.parametrize("owes", [True, False], ids=("owing a message", "owing none"))
    def test_a_deadline_is_never_halved_and_is_answered_only_where_a_committed_half_owes_a_message(self, owes: bool):
        """Row 1 fails alone; whatever reads row 2 meets the deadline, which every half of `[2, 3]` would meet too."""

        def raises(read: list[int]) -> Exception | None:
            if 1 in read:
                return _FailedInTheCallback()
            return ExecutionTimeout("deadline", 50) if 2 in read else None

        rows = _Rows(4, raises)

        if owes:
            assert _isolated(rows, owes=owes) == ([(1, 1, 0)], [1])
        else:
            with pytest.raises(ExecutionTimeout):
                _isolated(rows, owes=owes)

        assert rows.read == [[0, 1, 2, 3], [0, 1], [0], [1], [2, 3]]

    def test_a_commit_the_deadline_leaves_unanswered_names_the_rows_it_may_have_written(self, caplog: pytest.LogCaptureFixture):
        """As the driver raises one, a timeout keeping the label: read as "the rest stay due", written rows whose message is lost go unnamed."""

        def raises(read: list[int]) -> Exception | None:
            if 1 in read:
                return _FailedInTheCallback()
            unanswered = ExecutionTimeout("unanswered", 50, {"errorLabels": ["UnknownTransactionCommitResult"]})
            return unanswered if 2 in read else None

        with caplog.at_level(logging.WARNING, logger=fl_logger.name):
            answered = _isolated(_Rows(4, raises), owes=True)

        assert answered == ([(1, 1, 0)], [1])
        assert [
            (getattr(record, "error_code", None), record.getMessage(), getattr(record, "what", None), getattr(record, "row_ids", None))
            for record in caplog.records
            if record.levelname == "WARNING"
        ] == [(Code.UNKNOWN_OUTCOME, "transactions.isolation_commit_unanswered", "Row", ["2", "3"])]

    def test_a_failure_before_any_row_was_read_is_raised_rather_than_halved(self):
        """No row to halve, so taking it apart would answer an empty success over a read that failed."""

        attempts: list[Batch] = []

        async def unread(_: Any, batch: Batch) -> tuple[int, int, int]:
            attempts.append(batch)
            raise _FailedInTheCallback

        with pytest.raises(_FailedInTheCallback):
            asyncio.run(
                run_isolated(
                    db=cast(AsyncMongoClient, _Client()),
                    batch=Batch(),
                    attempt=unread,
                    moved=lambda page: page[1],
                    owes=True,
                    what="Row",
                    clock="test",
                )
            )

        assert len(attempts) == 1

    def test_a_stalled_page_is_raised_rather_than_halved(self):
        """Its halves read under the page, so taking it apart would hide the stall `refuse_a_stalled_page` declares."""

        rows = _Rows(PAGE + 1, lambda read: StalledPage("stalled"))

        with pytest.raises(StalledPage):
            _isolated(rows)

        assert rows.read == [[0, 1, 2, 3]]

    def test_a_retry_whose_read_fails_is_raised_rather_than_halved_over_the_read_before_it(self):
        """The driver runs the callback again on a transient error: the rows the first attempt read carry no failure of the second's read."""

        reads: list[int] = []

        async def failing_the_second_time() -> list[dict[str, int]]:
            reads.append(len(reads))
            if len(reads) > 1:
                raise _FailedInTheCallback
            return [{"_id": row} for row in range(PAGE + 1)]

        async def read(_: Any, batch: Batch) -> tuple[int, int, int]:
            rows = await batch.saw(failing_the_second_time())
            return len(rows), 0, 0

        with pytest.raises(_FailedInTheCallback):
            asyncio.run(
                run_isolated(
                    db=cast(AsyncMongoClient, _Client(attempts=2)),
                    batch=Batch(),
                    attempt=read,
                    moved=lambda page: page[1],
                    owes=False,
                    what="Row",
                    clock="test",
                )
            )

        assert reads == [0, 1]

    @pytest.mark.parametrize(
        ("refused_on", "answered"),
        [
            pytest.param({2}, ([[0, 2, 3]], [1]), id="on the retry alone"),
            pytest.param({1}, ([[0, 1, 2, 3]], []), id="on the first attempt alone"),
        ],
    )
    def test_a_retry_passes_over_only_the_rows_it_refused_itself(
        self, caplog: pytest.LogCaptureFixture, refused_on: set[int], answered: tuple[list[list[int]], list[int]]
    ):
        """The second case is load-bearing: kept from the attempt before, a refusal the retry did not repeat counts and logs a written row."""

        clock = _RefusedOnSomeAttempts(refused_on)

        with caplog.at_level(logging.ERROR, logger=fl_logger.name):
            result = asyncio.run(
                run_isolated(
                    db=cast(AsyncMongoClient, _Client(attempts=2)),
                    batch=Batch(share=PAGE + 1),
                    attempt=clock.remind,
                    moved=len,
                    owes=True,
                    what="Row",
                    clock="test",
                )
            )

        assert (result, len(caplog.records)) == (answered, len(answered[1]))

    def test_a_refusal_the_request_answers_is_raised_rather_than_halved(self):
        """Every half meets it too: halved, the call would answer 200 for a request it refuses."""

        refusal = APIError(HTTPStatus.FORBIDDEN, Code.ACTOR_NOT_ADMIN)
        rows = _Rows(PAGE + 1, lambda read: refusal)

        with pytest.raises(APIError):
            _isolated(rows)

        assert rows.read == [[0, 1, 2, 3]]


class TestABatchNarrowsTheClocksOwnFilter:
    def test_a_filter_naming_its_own_ids_keeps_them_beside_the_rows_passed_over(self):
        """Merged rather than set beside, the term replaces the list's own ids and the read takes every row the rest admits."""

        own = {"_id": {"$in": [1, 2]}, "status": "eingereicht"}

        assert Batch(passed=[3]).within(own) == {"$and": [own, {"_id": {"$nin": [3]}}]}


class _Share:
    """A share clock's transaction: it passes `refused` over in place, takes the rest up to its share, and fails writing `failing`."""

    def __init__(self, count: int, *, refused: int, failing: int) -> None:
        self.standing = list(range(count))
        self.refused = refused
        self.failing = failing
        self.read: list[list[int]] = []

    async def remind(self, _: Any, batch: Batch) -> list[int]:
        rows = [row["_id"] for row in await batch.saw(_page(self.standing, batch))]
        self.read.append(rows)
        taken = [row for row, _ in batch.judged([{"_id": row} for row in rows], self._judge)][: batch.share]
        batch.took(taken)
        if any(row["_id"] == self.failing for row in taken):
            raise OperationFailure("refused", 121)

        return [row["_id"] for row in taken]

    def _judge(self, row: Mapping[str, Any]) -> None:
        if row["_id"] == self.refused:
            raise _FailedInTheCallback


def _a_share(clock: _Share, *, share: int, owes: bool = True) -> tuple[list[list[int]], list[Any]]:
    return asyncio.run(
        run_isolated(
            db=cast(AsyncMongoClient, _Client()),
            batch=Batch(share=share),
            attempt=clock.remind,
            moved=len,
            owes=owes,
            what="Row",
            clock="test",
        )
    )


class TestAShareIsTakenApartOverTheRowsItTook:
    """Halving its whole read would re-read the page past the share, at its share's cost."""

    def test_the_halves_read_no_row_passed_over_in_place_or_left_past_the_share(self, caplog: pytest.LogCaptureFixture):
        """Row 0 is passed over in place, rows 1 and 2 are the share, row 3 is past it, and writing row 2 fails."""

        clock = _Share(PAGE + 1, refused=0, failing=2)

        with caplog.at_level(logging.ERROR, logger=fl_logger.name):
            answered = _a_share(clock, share=2)

        assert answered == ([[1]], [0, 2])
        assert clock.read == [[0, 1, 2, 3], [1], [2]]
        # Each logged once, the row passed over in place by the attempt that judged it.
        assert sorted(str(getattr(record, "row_id", "")) for record in caplog.records) == ["0", "2"]

    def test_a_row_passed_over_in_place_is_answered_beside_a_committed_share(self):
        assert _a_share(_Share(3, refused=1, failing=-1), share=4) == ([[0, 2]], [1])


class TestAnIsolationOwingAMessageStopsWithinTheDeadline:
    """Once a half owing a message has committed, the call answers it whatever stops the rest."""

    @staticmethod
    def _owing(rows: _Rows, *, deadline_s: float | None) -> tuple[list[tuple[int, int, int]], list[Any]]:
        token = request_deadline_var.set(None if deadline_s is None else time.monotonic() + deadline_s)
        try:
            return _isolated(rows, owes=True)
        finally:
            request_deadline_var.reset(token)

    def test_no_attempt_starts_that_the_deadline_left_cannot_hold(self, caplog: pytest.LogCaptureFixture):
        """Started anyway, the deadline cuts it, and a cut commit may land with its answer lost."""

        rows = _Rows(4, lambda read: OperationFailure("refused", 121) if 3 in read else None)

        with caplog.at_level(logging.WARNING, logger=fl_logger.name):
            answered = self._owing(rows, deadline_s=-1.0)

        assert (answered, rows.read) == (([(2, 2, 0)], []), [[0, 1, 2, 3], [0, 1]])
        assert [(record.levelname, getattr(record, "error_code", None)) for record in caplog.records] == [("WARNING", Code.DATABASE_FAILED)]

    def test_the_same_isolation_inside_its_deadline_takes_every_half(self):
        """The control: with time left, the halves after the first are run, and the failing row alone is passed over."""

        rows = _Rows(4, lambda read: OperationFailure("refused", 121) if 3 in read else None)

        assert self._owing(rows, deadline_s=None) == ([(2, 2, 0), (1, 1, 0)], [3])

    def test_a_failure_no_row_carries_after_a_committed_half_is_answered_rather_than_raised(self, caplog: pytest.LogCaptureFixture):
        """Raised, the call would answer an error in place of the messages the committed half owes."""

        refusal = APIError(HTTPStatus.FORBIDDEN, Code.ACTOR_NOT_ADMIN)

        def raises(read: list[int]) -> Exception | None:
            if read == [0, 1, 2, 3]:
                return OperationFailure("refused", 121)
            return refusal if 2 in read else None

        with caplog.at_level(logging.WARNING, logger=fl_logger.name):
            answered = self._owing(_Rows(4, raises), deadline_s=None)

        assert answered == ([(2, 2, 0)], [])
        assert [getattr(record, "error_code", None) for record in caplog.records] == [Code.UNHANDLED_CRASH]


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
        assert [getattr(record, "error_code", None) for record in caplog.records] == [Code.DATABASE_FAILED]

    def test_a_session_whose_work_finished_is_sent_no_abort(self):
        """A committed transaction answers an abort harmlessly, so only this case keeps one round trip off every write."""

        assert _aborts_sent(fails=False, deadline=time.monotonic()) == []


class _RefusedFirst(Exception):
    """A route's own refusal, raised inside its callback before it sends anything."""


class TestASessionNoCommandCarriedIsSentNoAbort:
    def test_a_failure_before_any_command_waits_on_no_server(self, caplog: pytest.LogCaptureFixture):
        """Against a server that never answers, where an abort sent waits out the grace and logs its failure.

        Every route cut before its first command takes this path, a deadline spent on server selection among them.
        """

        async def run() -> None:
            client = AsyncMongoClient(UNANSWERED_URI)
            try:

                async def refuse(_session: AsyncClientSession) -> None:
                    raise _RefusedFirst

                with pytest.raises(_RefusedFirst):
                    async with transaction_session(client) as session:
                        await session.with_transaction(refuse)
            finally:
                await client.close()

        with caplog.at_level(logging.ERROR, logger=fl_logger.name):
            asyncio.run(run())

        assert [record for record in caplog.records if getattr(record, "error_code", None) == Code.DATABASE_FAILED] == []


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


class TestTheRouteRunsInTheServersTask:
    def test_no_layer_moves_it_into_a_task_of_its_own(self):
        """`app/core/middlewares.py :: TraceContextMiddleware`'s reason: a task group around the app cancels it at every await.

        The shield holds the helper's abort there, so only this case fails for pymongo's own cleanup awaits.
        """

        ran_in: list[asyncio.Task[Any] | None] = []

        async def records_its_task() -> None:
            ran_in.append(asyncio.current_task())

        served = create_app(build_test_config())
        served.add_api_route(_HELD, records_its_task)

        async def serve() -> asyncio.Task[Any] | None:
            await served(_SCOPE, _never_disconnects, _discarded)
            return asyncio.current_task()

        assert ran_in == [asyncio.run(serve())]


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
            async with a_clean_database(mongo_replica_set_url, DATABASE_NAME, constraints=False):
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
        assert [record for record in caplog.records if getattr(record, "error_code", None) == Code.DATABASE_FAILED] == []


class _FailedAfterTheCommit(Exception):
    """Work inside the session failing once its transaction has committed, as a response built from the result can."""


@pytest.mark.db
class TestAFailureAfterTheCommitRaisesNoAlarm:
    def test_the_abort_the_commit_answers_is_not_logged(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """The server answers this helper's abort TransactionCommitted: the write stands and nothing is left open."""

        aborts = _Aborts()

        async def body() -> int:
            async with a_clean_database(mongo_replica_set_url, DATABASE_NAME, constraints=False):
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
        assert [record for record in caplog.records if getattr(record, "error_code", None) == Code.DATABASE_FAILED] == []
