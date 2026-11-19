import asyncio
import contextvars
import time
import traceback
from collections.abc import AsyncGenerator, Awaitable, Callable, Iterable, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
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
from app.core.logging import fl_logger
from app.core.middlewares import request_deadline_var

NO_DATA_TEXT: Final = "//- No Data -//"

# The time a request's aborts may run past its deadline, all of them together, charged after each abort: the first
# abort past the deadline gets the whole grace, and each later one what the earlier ones left. Never time counted from
# the deadline: the request reaches an abort only when its next database operation meets the deadline, however long
# after it, and every moment between would come out of the abort that frees the transaction's documents. Never a grace
# apiece either: a loop of cut transactions would wait one out per transaction. Far above a round trip, and inside the
# page's margin.
ABORT_GRACE_S: Final = 1.0

# NoSuchTransaction and TransactionCommitted: the server holds nothing open, the driver's own abort
# or the commit having landed.
NOTHING_LEFT_OPEN: Final = frozenset({251, 256})

# The driver's label on a commit whose answer was lost: the write may have landed.
UNKNOWN_COMMIT_RESULT: Final = "UnknownTransactionCommitResult"


def _abort_budget() -> float:
    """What is left of the request's deadline and of its grace, counted as `ABORT_GRACE_S` says, or a whole grace outside a request."""

    deadline = request_deadline_var.get()
    if deadline is None:
        return ABORT_GRACE_S

    return max(0.0, deadline.at - time.monotonic()) + ABORT_GRACE_S - deadline.aborting_s


def _spent_aborting(started: float) -> None:
    """Charge the request's grace with the part of an abort begun at `started` that ran past its deadline."""

    deadline = request_deadline_var.get()
    if deadline is not None:
        deadline.aborting_s += max(0.0, time.monotonic() - max(started, deadline.at))


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

    The timeout it refreshes to is what `_abort_budget` leaves.
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

    started = time.monotonic()
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
    finally:
        _spent_aborting(started)


@asynccontextmanager
async def transaction_session(client: AsyncMongoClient) -> AsyncGenerator[AsyncClientSession]:
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


async def transact[T](client: AsyncMongoClient, callback: Callable[[AsyncClientSession], Awaitable[T]]) -> T:
    """`callback` in one transaction on a session of its own, run, committed and retried by the driver's `with_transaction`.

    The driver runs `callback` again from its start on a write conflict or a transient error, and commits again where a
    commit went unanswered, until the request's deadline; a rolled-back attempt leaves nothing. So a callback reads all
    it judges through `session`, and a retry judges afresh what a rival write left, while what every attempt must share,
    such as the press's instant or a value it mints, is made outside the callback.
    """

    async with transaction_session(client) as session:
        return await session.with_transaction(callback)


def _of_row[Row, T](save: Callable[[AsyncClientSession, Row], Awaitable[T]], row: Row) -> Callable[[AsyncClientSession], Awaitable[T]]:
    """`save` bound to one row, the callback `transact` runs and may run again."""

    return lambda session: save(session, row)


@dataclass
class Saved[T]:
    """What an hourly pass's step saved, row by row: each row's answer, the rows passed over, and whether the deadline cut it."""

    answers: list[T] = field(default_factory=list)
    failed: int = 0
    cut: bool = False


async def save_each[Row: Mapping[str, Any], T](
    *,
    db: AsyncMongoClient,
    rows: Iterable[Row],
    # Run in a transaction of its own for each row, which it judges again there: the read naming the rows was taken
    # outside any.
    save: Callable[[AsyncClientSession, Row], Awaitable[T]],
    what: str,
    clock: str,
) -> Saved[T]:
    """Each row saved in a transaction of its own: one that fails is logged and passed over, and the rest are saved.

    The deadline ends the step at the row it cuts, which stays due with every row after it for the next pass.
    """

    saved: Saved[T] = Saved()
    for row in rows:
        # Caught outside the row's session: a failure the session never saw leaves its transaction open.
        try:
            saved.answers.append(await transact(db, _of_row(save, row)))
        # Any class, or the next pass stops at this row again and holds back every one behind it; not `BaseException`,
        # so a cancellation still ends the call.
        except Exception as failure:
            # The only branch an unanswered commit reaches: `transact` retries one until the deadline and raises it as a
            # timeout keeping the label.
            if isinstance(failure, PyMongoError) and failure.timeout:
                uncertain = failure.has_error_label(UNKNOWN_COMMIT_RESULT)
                # Below a failed row's ERROR: no record is at fault, and every later row would fail the same way.
                fl_logger.warning(
                    "transactions.pass_cut",
                    extra={
                        "error_code": Code.UNKNOWN_OUTCOME if uncertain else Code.DATABASE_FAILED,
                        "what": what,
                        "row_id": str(row["_id"]),
                        "clock": clock,
                        "unanswered": uncertain,
                    },
                )
                saved.cut = True
                return saved

            log_passed(what=what, row_id=row["_id"], clock=clock, failure=failure)
            saved.failed += 1

    return saved


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
    # No unanswered commit reaches here: `with_transaction` retries one until the deadline, and `save_each` warns of
    # that as the pass's cut.
    code, diagnosis = diagnosis_of(failure)
    fl_logger.error(
        "transactions.row_passed_over", extra={"error_code": code, "what": what, "row_id": str(row_id), "clock": clock, "diagnosis": diagnosis}
    )
