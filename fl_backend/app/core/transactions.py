import asyncio
import contextvars
import time
import traceback
from collections.abc import AsyncIterator, Awaitable, Callable, Iterable, Mapping, Sequence
from contextlib import asynccontextmanager
from typing import Any, Final

import anyio
import pymongo
from pydantic import ValidationError
from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.client_session_shared import _EmptyServerSession
from pymongo.errors import OperationFailure, PyMongoError

from app.core.codes import Code
from app.core.exception_handlers import rejected_fields_of
from app.core.exceptions import APIError
from app.core.logging import fl_logger
from app.core.middlewares import request_deadline_var

NO_DATA_TEXT: Final = "//- No Data -//"

# Shared by every abort a request sends past its deadline, or a loop of cut transactions waits out
# one apiece; far above a round trip, and inside the page's margin.
ABORT_GRACE_S: Final = 1.0

# NoSuchTransaction and TransactionCommitted: the server holds nothing open, the driver's own abort
# or the commit having landed.
NOTHING_LEFT_OPEN: Final = frozenset({251, 256})

# The driver's label on a commit whose answer was lost: the write may have landed.
UNKNOWN_COMMIT_RESULT: Final = "UnknownTransactionCommitResult"


def _abort_budget() -> float:
    """What is left of the request's grace, or a whole grace outside a request."""

    deadline = request_deadline_var.get()
    return ABORT_GRACE_S if deadline is None else deadline + ABORT_GRACE_S - time.monotonic()


def _log_left_open(cause: str) -> None:
    # Never raised: the request answers the failure that brought it here.
    # The transaction may stand open on the server until its lifetime limit.
    fl_logger.error("transactions.left_open", extra={"error_code": Code.DATABASE_FAILED, "cause": cause})


async def _abort_on_the_server(session: AsyncClientSession) -> None:
    """Send the abort pymongo sends under the expired deadline and whose failure it swallows.

    The client-side operations timeout specification has `withTransaction` refresh the timeout for its
    `abortTransaction`, since an open transaction keeps its documents locked; pymongo does not, so one
    the deadline cut holds them until the server's lifetime limit. A workaround the owner approved
    (https://github.com/felzab/frankfurtleague/issues/244): it goes in the commit taking a pymongo
    release that refreshes that timeout.
    """

    # pymongo's placeholder until a command carries the session: no server holds its transaction.
    # Ahead of the number, whose read mints a server session that an abort and the client's
    # `endSessions` then wait on where no server answers.
    if isinstance(session._server_session, _EmptyServerSession):
        return

    # Private, pymongo publishing no transaction number.
    transaction_number = session._transaction_id
    if not transaction_number:
        return

    budget = _abort_budget()
    # Checked rather than handed on: pymongo reads a deadline of zero as none at all.
    if budget <= 0:
        _log_left_open(f"the request's {ABORT_GRACE_S} s of aborts past its deadline are spent")
        return

    async def abort() -> None:
        with pymongo.timeout(budget):
            await session.client.admin.command({"abortTransaction": 1, "txnNumber": transaction_number, "autocommit": False}, session=session)

    try:
        # Shielded: inside an anyio cancel scope a cancelled request is cancelled again at every await,
        # so this abort would be cancelled unsent; `pymongo.timeout` still bounds it.
        with anyio.CancelScope(shield=True):
            # A context of its own: `pymongo.timeout` only narrows the deadline it is entered under,
            # and the request's may have passed.
            await asyncio.create_task(abort(), context=contextvars.Context())
    except PyMongoError as failure:
        code = failure.code if isinstance(failure, OperationFailure) else None
        if code not in NOTHING_LEFT_OPEN:
            _log_left_open(f"its abort failed ({type(failure).__name__}, code {code})")


@asynccontextmanager
async def transaction_session(client: AsyncMongoClient) -> AsyncIterator[AsyncClientSession]:
    """The session every transaction runs on: work failing inside it leaves the server no transaction."""

    async with client.start_session() as session:
        try:
            yield session
        # `BaseException`, as the driver's own abort catches it: a cancelled request leaves a
        # transaction open as surely as a failed one.
        except BaseException:
            # Inside the session: once it ends, the pool hands its server session to the next caller,
            # whose work this abort would then reach.
            await _abort_on_the_server(session)
            raise


class StalledPage(ValueError):
    """A full page that moved nothing: no row carries it, so `isolate` never halves it."""


class Batch:
    """One transaction of a sweep's clock: which rows it may take, and what its last attempt read, took and passed over.

    `isolate` halves what a failed one took, or its whole read where it took nothing yet.
    """

    def __init__(self, *, among: Sequence[Any] | None = None, passed: Sequence[Any] = (), share: int | None = None) -> None:
        self.among = among
        self.passed = passed
        # The rows the transaction may still write where its clock takes a share, `None` where it takes the page.
        self.share = share
        self.ids: list[Any] = []
        self.taken: list[Any] | None = None
        self.refused: list[tuple[Any, Exception]] = []
        # The reminder clocks' mailboxes a ban kept back, counted over the attempt's whole read: halves of a
        # failed share read only the rows it took, so a count summed over them would miss every one.
        self.withheld = 0

    def within(self, db_filter: Mapping[str, Any]) -> Mapping[str, Any]:
        """The clock's own filter, narrowed to a half of a failed read, or to the read without the rows passed over."""

        if self.among is not None:
            term: Mapping[str, Any] = {"_id": {"$in": list(self.among)}}
        elif self.passed:
            term = {"_id": {"$nin": list(self.passed)}}
        else:
            return db_filter

        # Beside the filter rather than merged into it: a filter naming its own `_id` would lose it,
        # and a passed-over term would then read every row the rest of the filter admits.
        return {"$and": [db_filter, term]}

    async def saw[Row: Mapping[str, Any]](self, read: Awaitable[list[Row]]) -> list[Row]:
        """The attempt's read, which every clock's callback makes first, its ids recorded once it answers."""

        # Begun afresh before the read: the driver runs the callback again on a transient error, and an
        # attempt failing in its read would otherwise be halved over what an earlier attempt read.
        self.ids, self.taken, self.refused, self.withheld = [], None, [], 0
        rows = await read
        self.ids = [row["_id"] for row in rows]
        return rows

    def judged[Row: Mapping[str, Any], T](self, rows: Iterable[Row], judge: Callable[[Row], T]) -> list[tuple[Row, T]]:
        """Each row beside what `judge` answers for it; one it raises on is passed over in place, nothing written.

        Its stored data fails in code alone, so no attempt is taken apart for it.
        """

        answered: list[tuple[Row, T]] = []
        for row in rows:
            try:
                answered.append((row, judge(row)))
            # Any class, as `isolate` would halve any; not `BaseException`, so a cancellation still ends the call.
            except Exception as refusal:
                self.refused.append((row["_id"], refusal))

        return answered

    def took[Row: Mapping[str, Any]](self, rows: list[Row]) -> list[Row]:
        """The rows the attempt writes, which are all a failure after it can be carried by."""

        self.taken = [row["_id"] for row in rows]
        return rows

    @property
    def suspects(self) -> list[Any]:
        """The rows a failure of this attempt can be carried by: those it took, or its whole read where it failed before taking any."""

        return self.ids if self.taken is None else self.taken


def _settled(batch: Batch, *, what: str, clock: str) -> list[Any]:
    """The rows an attempt passed over in place, each logged once that attempt is over: a retried one began its record afresh."""

    for row_id, refusal in batch.refused:
        log_passed(what=what, row_id=row_id, clock=clock, failure=refusal)

    return [row_id for row_id, _ in batch.refused]


def _deadline_left() -> float | None:
    """What is left of the request's deadline, `None` outside a request."""

    deadline = request_deadline_var.get()
    return None if deadline is None else deadline - time.monotonic()


async def _transacted[T](db: AsyncMongoClient, callback: Callable[[AsyncClientSession, Batch], Awaitable[T]], batch: Batch) -> T:
    """`callback` over `batch` in one transaction, handed the session by the driver's own `with_transaction`."""

    async with transaction_session(db) as session:
        return await session.with_transaction(lambda transacting: callback(transacting, batch))


def carried_by_a_row(failure: Exception) -> bool:
    """Whether halving the rows can isolate a failure.

    A deadline meets every half too, a stalled page is the page's own, and a refusal the request
    answers is the request's.
    """

    return not isinstance(failure, (StalledPage, APIError)) and not (isinstance(failure, PyMongoError) and failure.timeout)


def diagnosis_of(failure: Exception) -> tuple[str, str]:
    """A failure's code, and what locates its cause with no value of the record it met.

    What the request's own handler logs for it, so a row passed over is found as a failed call's write is.
    """

    if isinstance(failure, PyMongoError):
        return Code.DATABASE_FAILED, f"{type(failure).__name__}, code {getattr(failure, 'code', None)}"
    if isinstance(failure, ValidationError):
        return Code.STORED_DATA_INVALID, f"{type(failure).__name__}: {rejected_fields_of(failure.errors()) or NO_DATA_TEXT}"

    # The innermost frame rather than the message, which can quote the value the code met.
    frames = traceback.extract_tb(failure.__traceback__)
    where = f"{frames[-1].name} at {frames[-1].filename}:{frames[-1].lineno}" if frames else NO_DATA_TEXT
    return Code.UNHANDLED_CRASH, f"{type(failure).__name__} in {where}"


def log_passed(*, what: str, row_id: Any, clock: str, failure: Exception) -> None:
    # Never `str(failure)`: it can quote the record, which a line about an erasure would then outlive.
    # No unanswered commit reaches here: `with_transaction` retries one until the deadline, which
    # `isolate` never halves.
    code, diagnosis = diagnosis_of(failure)
    fl_logger.error(
        "transactions.row_passed_over", extra={"error_code": code, "what": what, "row_id": str(row_id), "clock": clock, "diagnosis": diagnosis}
    )


async def isolate[T](
    *,
    db: AsyncMongoClient,
    failed: Batch,
    failure: Exception,
    # The clock's callback, run in a transaction of its own over each half.
    attempt: Callable[[AsyncClientSession, Batch], Awaitable[T]],
    moved: Callable[[T], int],
    owes: bool,
    what: str,
    clock: str,
    # How long the failed attempt ran: the first measure of what one more costs.
    spent: float,
) -> tuple[list[T], list[Any]]:
    """Each half of a failed transaction's rows run on its own, down to each row failing alone, which is logged and left standing.

    Answers what committed and the ids passed over, in place or alone.
    """

    committed: list[T] = []
    passed: list[Any] = []
    remaining = failed.share
    # The rows of the attempt the deadline cut, which may have been written where its commit went unanswered.
    cut: list[Any] = []
    longest = spent
    stopped = False

    async def split(batch: Batch, failed_with: Exception) -> None:
        passed.extend(_settled(batch, what=what, clock=clock))
        # The rows the attempt took and no other: one it read and judged in place, or left past its share, carries nothing.
        suspects = batch.suspects
        if len(suspects) == 1:
            log_passed(what=what, row_id=suspects[0], clock=clock, failure=failed_with)
            passed.append(suspects[0])
            return

        middle = len(suspects) // 2
        for half in (suspects[:middle], suspects[middle:]):
            await run(half)

    async def run(part: Sequence[Any]) -> None:
        nonlocal remaining, longest, stopped
        # A share the halves have already filled: the rows after it stay due for the next pass.
        if remaining == 0 or stopped:
            return

        # Once a half owing a message has committed, no attempt the deadline would cut: cut, its commit could go
        # unanswered. The longest attempt yet stands for the next, a half reading no more than the attempt before it.
        left = _deadline_left()
        if owes and committed and left is not None and left < longest:
            stopped = True
            return

        batch = Batch(among=part, share=remaining)
        started = time.monotonic()
        try:
            result = await _transacted(db, attempt, batch)
        except Exception as failed_with:
            longest = max(longest, time.monotonic() - started)
            if not carried_by_a_row(failed_with) or not batch.suspects:
                cut[:] = part if batch.taken is None else batch.taken
                raise
            await split(batch, failed_with)
            return

        longest = max(longest, time.monotonic() - started)
        passed.extend(_settled(batch, what=what, clock=clock))
        committed.append(result)
        if remaining is not None:
            remaining -= moved(result)

    try:
        await split(failed, failure)
    except Exception as stop:
        # Answered rather than raised once a half owing a message has committed.
        if not owes or not committed:
            raise
        _log_stopped(stop, what=what, clock=clock, cut=cut)

    if stopped:
        fl_logger.warning("transactions.isolation_out_of_time", extra={"error_code": Code.DATABASE_FAILED, "clock": clock})

    return committed, passed


def _log_stopped(stop: Exception, *, what: str, clock: str, cut: Sequence[Any]) -> None:
    """The warning of an isolation owing a message that stopped once a half had committed."""

    if not (isinstance(stop, PyMongoError) and stop.timeout):
        code, diagnosis = diagnosis_of(stop)
        fl_logger.warning("transactions.isolation_stopped", extra={"error_code": code, "clock": clock, "diagnosis": diagnosis})
    # The label survives the driver's own timeout: an unanswered commit is retried until the deadline and raised as one.
    elif stop.has_error_label(UNKNOWN_COMMIT_RESULT):
        # Those rows may have been written with nobody told; the call answers what else committed.
        fl_logger.warning(
            "transactions.isolation_commit_unanswered",
            extra={"error_code": Code.UNKNOWN_OUTCOME, "clock": clock, "what": what, "row_ids": [str(row_id) for row_id in cut]},
        )
    else:
        fl_logger.warning("transactions.isolation_cut", extra={"error_code": Code.DATABASE_FAILED, "clock": clock})


async def run_isolated[T](
    *,
    db: AsyncMongoClient,
    batch: Batch,
    # The clock's callback, run in a transaction over `batch`.
    attempt: Callable[[AsyncClientSession, Batch], Awaitable[T]],
    moved: Callable[[T], int],
    owes: bool,
    what: str,
    clock: str,
) -> tuple[list[T], list[Any]]:
    """`attempt` over `batch` in one transaction, taken apart by `isolate` where that fails: what committed, and the ids passed over."""

    started = time.monotonic()
    try:
        result = await _transacted(db, attempt, batch)
    except Exception as failure:
        # Nothing read or nothing taken: the failure came before any row or after every one the attempt
        # wrote, and halving none would swallow it.
        if not batch.suspects or not carried_by_a_row(failure):
            raise

        return await isolate(
            db=db,
            failed=batch,
            failure=failure,
            attempt=attempt,
            moved=moved,
            owes=owes,
            what=what,
            clock=clock,
            spent=time.monotonic() - started,
        )

    return [result], _settled(batch, what=what, clock=clock)


async def drain(
    *,
    db: AsyncMongoClient,
    # The clock's callback, run in a transaction of its own over each page.
    page_of: Callable[[AsyncClientSession, Batch], Awaitable[tuple[int, int, int]]],
    # The callback reads one row past it, or a full page reads as the last one.
    page: int,
    what: str,
    clock: str,
) -> tuple[int, int, list[Any]]:
    """A full page is erased and read again: the population filling it is the one only the erasure shrinks.

    Answers what it erased, what it redacted, and the ids it passed over.
    """

    geloescht_total, redacted_total = 0, 0
    passed: list[Any] = []
    while True:
        # Without the rows passed over, or a page of them would be read, and fail, for ever.
        batch = Batch(passed=passed)
        started = time.monotonic()
        try:
            read, geloescht, redacted = await _transacted(db, page_of, batch)
        except Exception as failure:
            # Nothing read or nothing taken, as `run_isolated` reads it.
            if not batch.suspects or not carried_by_a_row(failure):
                raise

            # Owing nothing, so a deadline is raised as it was before the halving.
            committed, left = await isolate(
                db=db,
                failed=batch,
                failure=failure,
                attempt=page_of,
                moved=lambda page_geloescht: page_geloescht[1],
                owes=False,
                what=what,
                clock=clock,
                spent=time.monotonic() - started,
            )
            read = len(batch.ids)
            geloescht = sum(result[1] for result in committed)
            redacted = sum(result[2] for result in committed)
            # A page that failed whole and whose halves neither moved nor passed a row would be read
            # again, the same way, for ever.
            if read > page and not geloescht and not left:
                raise

            passed.extend(left)
        else:
            passed.extend(_settled(batch, what=what, clock=clock))

        geloescht_total += geloescht
        redacted_total += redacted
        if read <= page:
            return geloescht_total, redacted_total, passed


def refuse_a_stalled_page(*, read: int, moved: int, page: int, clock: str, saison_id: str) -> None:
    """Raise where a full page moved nothing: the same rows come back for ever.

    Beside `drain`, which takes the page the same way: each slice keeps its own `SWEEP_PAGE`.
    """

    if read > page and moved == 0:
        raise StalledPage(
            f"season {saison_id} fills the {clock} clock's page of {page} with rows it takes none of, so no pass can make progress"
        )
