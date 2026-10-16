import asyncio
import contextvars
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping, Sequence
from contextlib import AbstractAsyncContextManager, asynccontextmanager, nullcontext
from contextvars import ContextVar
from typing import Any, Final

import anyio
import pymongo
from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.client_session_shared import _EmptyServerSession
from pymongo.errors import OperationFailure, PyMongoError

from app.core.exception_handlers import DATABASE_FAILED, UNHANDLED_CRASH, UNKNOWN_OUTCOME
from app.core.exceptions import BaseAPIException
from app.core.logging import fl_logger
from app.core.middlewares import request_deadline_var
from app.core.recording import actor_var

# Shared by every abort a request sends past its deadline, or a loop of cut transactions waits out
# one apiece; far above a round trip, and inside the page's margin (`docs/backend/spec.md :: I320`).
ABORT_GRACE_S: Final = 1.0

# NoSuchTransaction and TransactionCommitted: the server holds nothing open, the driver's own abort
# or the commit having landed.
NOTHING_LEFT_OPEN: Final = frozenset({251, 256})


def _abort_budget() -> float:
    """What is left of the request's grace, or a whole grace outside a request."""

    deadline = request_deadline_var.get()
    return ABORT_GRACE_S if deadline is None else deadline + ABORT_GRACE_S - time.monotonic()


def _log_left_open(cause: str) -> None:
    # Never raised: the request answers the failure that brought it here.
    fl_logger.error(
        f"A transaction this request opened may stand open on the server until its lifetime limit: {cause}",
        extra={"error_code": DATABASE_FAILED},
    )


async def _abort_on_the_server(session: AsyncClientSession) -> None:
    """Send the abort the driver may not have: it swallows its own abort's failure, the deadline's refusal included."""

    # pymongo's placeholder until a command carries the session: no server holds its transaction.
    # Ahead of the number, whose read mints a server session that an abort and the client's
    # `endSessions` then wait on where no server answers.
    if isinstance(session._server_session, _EmptyServerSession):
        return

    # Private, pymongo publishing no transaction number; a renamed attribute fails
    # `tests/core/test_request_deadline.py :: TestATransactionPastTheRequestDeadlineCommitsNothing`.
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


# What a request's actor is judged by inside each attempt of every transaction it opens: entered in
# the attempt's session before its callback, and left once the callback has returned.
ActorJudge = Callable[[AsyncClientSession], AbstractAsyncContextManager[object]]

# Bound beside `app/core/recording.py :: actor_var` by the binder that bound the actor, and reset with it.
actor_judge_var: ContextVar[ActorJudge | None] = ContextVar("actor_judge", default=None)

# The actor kinds no grant and no ban can judge. Named rather than the judged ones, so a kind added
# later is refused until its binder binds a judge, never let through unjudged.
UNJUDGED_KINDS: Final = frozenset({"system", "public"})


def _unjudged(_session: AsyncClientSession) -> AbstractAsyncContextManager[object]:
    return nullcontext()


class JudgedSession:
    """What `transaction_session` yields: the driver's session, every transaction run on it judging the request's actor first.

    Never handed to the driver as `session=`, which refuses it: each callback is handed the driver's own.
    """

    def __init__(self, session: AsyncClientSession, judge: ActorJudge) -> None:
        self._session = session
        self._judge = judge

    async def with_transaction[T, *Arguments](
        self, callback: Callable[[AsyncClientSession, *Arguments], Awaitable[T]], *arguments: *Arguments
    ) -> T:
        """`callback` in one transaction, the actor judged again in each attempt the driver retries (`docs/backend/spec.md :: I575`)."""

        async def judged(session: AsyncClientSession) -> T:
            async with self._judge(session):
                return await callback(session, *arguments)

        return await self._session.with_transaction(judged)


@asynccontextmanager
async def transaction_session(client: AsyncMongoClient) -> AsyncIterator[JudgedSession]:
    """The session every transaction runs on: work failing inside it leaves the server no transaction (`docs/backend/spec.md :: I539`)."""

    actor = actor_var.get()
    judge = actor_judge_var.get()
    # Refused rather than run unjudged: a binder that bound such an actor and no judge would let a
    # revoked administrator or a barred person write.
    if judge is None and actor.kind not in UNJUDGED_KINDS:
        raise LookupError(f"a transaction of a `{actor.kind}` actor has no judge bound")

    async with client.start_session() as session:
        try:
            yield JudgedSession(session, judge or _unjudged)
        # `BaseException`, as the driver's own abort catches it: a cancelled request leaves a
        # transaction open as surely as a failed one.
        except BaseException:
            # Inside the session: once it ends, the pool hands its server session to the next caller,
            # whose work this abort would then reach.
            await _abort_on_the_server(session)
            raise


class StalledPage(ValueError):
    """A full page that moved nothing (`docs/backend/spec.md :: I295`): no row carries it, so `isolate` never halves it."""


class Batch:
    """Which rows one transaction of a sweep's clock may take, and the ids its read answered.

    A failed transaction's ids are what `isolate` halves (`docs/backend/spec.md :: I720`).
    """

    def __init__(self, *, among: Sequence[Any] | None = None, passed: Sequence[Any] = (), share: int | None = None) -> None:
        self.among = among
        self.passed = passed
        # The rows the transaction may still write where its clock takes a share, `None` where it takes the page.
        self.share = share
        self.ids: list[Any] = []

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

        # Emptied before the read: the driver runs the callback again on a transient error, and an
        # attempt failing in its read would otherwise be halved over the ids an earlier attempt read.
        self.ids = []
        rows = await read
        self.ids = [row["_id"] for row in rows]
        return rows


def carried_by_a_row(failure: Exception) -> bool:
    """Whether halving the rows can isolate a failure.

    A deadline meets every half too, a stalled page is the page's own, and a refusal the request
    answers -- a judge's (`docs/backend/spec.md :: I575`) among them -- is the request's.
    """

    return not isinstance(failure, (StalledPage, BaseAPIException)) and not (isinstance(failure, PyMongoError) and failure.timeout)


def log_passed(*, what: str, row_id: Any, clock: str, failure: Exception) -> None:
    # The id and the class alone: `str(failure)` can quote the record, which a line about an erasure
    # would then outlive.
    if isinstance(failure, PyMongoError):
        ungewiss = failure.has_error_label("UnknownTransactionCommitResult")
        fl_logger.error(
            f"{what} {row_id} was {'written or not' if ungewiss else 'passed over'} by the {clock} clock"
            f"{', its commit unanswered' if ungewiss else ''}: {type(failure).__name__}",
            extra={"error_code": UNKNOWN_OUTCOME if ungewiss else DATABASE_FAILED},
        )
        return

    fl_logger.error(
        f"{what} {row_id} was passed over by the {clock} clock, the failure not the database's: {type(failure).__name__}",
        extra={"error_code": UNHANDLED_CRASH},
    )


async def isolate[T](
    *,
    db: AsyncMongoClient,
    failure: Exception,
    ids: Sequence[Any],
    # The caller's `session.with_transaction(<callback>, batch)`, for `drain`'s `page_of`'s reason.
    attempt: Callable[[JudgedSession, Batch], Awaitable[T]],
    moved: Callable[[T], int],
    share: int | None,
    owes: bool,
    what: str,
    clock: str,
) -> tuple[list[T], list[Any]]:
    """Each half of a failed transaction's rows in a transaction of its own, down to each row failing alone.

    That row is logged and left standing (`docs/backend/spec.md :: I720`). Answers what committed,
    and the ids passed over.
    """

    committed: list[T] = []
    passed: list[Any] = []
    remaining = share

    async def split(part: Sequence[Any], failed: Exception) -> None:
        if len(part) == 1:
            log_passed(what=what, row_id=part[0], clock=clock, failure=failed)
            passed.append(part[0])
            return

        middle = len(part) // 2
        for half in (part[:middle], part[middle:]):
            await run(half)

    async def run(part: Sequence[Any]) -> None:
        nonlocal remaining
        # A share the halves have already filled: the rows after it stay due for the next pass.
        if remaining == 0:
            return

        try:
            async with transaction_session(db) as session:
                result = await attempt(session, Batch(among=part, share=remaining))
        except Exception as failed:
            if not carried_by_a_row(failed):
                raise
            await split(part, failed)
            return

        committed.append(result)
        if remaining is not None:
            remaining -= moved(result)

    try:
        await split(ids, failure)
    except PyMongoError as stopped:
        # Answered rather than raised once a half owing a message has committed (`docs/backend/spec.md :: I323`).
        if not stopped.timeout or not owes or not committed:
            raise
        fl_logger.warning(
            f"Database deadline passed taking the {clock} clock's rows apart: the call answers what committed, and the rest stay due",
            extra={"error_code": DATABASE_FAILED},
        )

    return committed, passed


async def run_isolated[T](
    *,
    db: AsyncMongoClient,
    batch: Batch,
    # The caller's `session.with_transaction(<callback>, batch)`, for `drain`'s `page_of`'s reason.
    attempt: Callable[[JudgedSession, Batch], Awaitable[T]],
    moved: Callable[[T], int],
    owes: bool,
    what: str,
    clock: str,
) -> tuple[list[T], list[Any]]:
    """`attempt` over `batch` in one transaction, taken apart by `isolate` where that fails: what committed, and the ids passed over."""

    try:
        async with transaction_session(db) as session:
            return [await attempt(session, batch)], []
    except Exception as failure:
        # Nothing read: the failure came before any row, and halving nothing would swallow it.
        if not batch.ids or not carried_by_a_row(failure):
            raise

        return await isolate(
            db=db, failure=failure, ids=batch.ids, attempt=attempt, moved=moved, share=batch.share, owes=owes, what=what, clock=clock
        )


async def drain(
    *,
    db: AsyncMongoClient,
    # The caller's `session.with_transaction(<callback>, batch)`, never the callback itself:
    # `tests/core/app_source.py :: _callbacks` reads a callback where `with_transaction` is handed
    # it, and would find none here.
    page_of: Callable[[JudgedSession, Batch], Awaitable[tuple[int, int, int]]],
    # The callback reads one row past it, or a full page reads as the last one.
    page: int,
    what: str,
    clock: str,
) -> tuple[int, int]:
    """A full page is erased and read again: the population filling it is the one only the erasure shrinks (`docs/backend/spec.md :: I295`)."""

    erased_total, redacted_total = 0, 0
    passed: list[Any] = []
    while True:
        # Without the rows passed over, or a page of them would be read, and fail, for ever.
        batch = Batch(passed=passed)
        try:
            async with transaction_session(db) as session:
                read, erased, redacted = await page_of(session, batch)
        except Exception as failure:
            # Nothing read: the failure came before any row, and halving nothing would swallow it.
            if not batch.ids or not carried_by_a_row(failure):
                raise

            # Owing nothing, so a deadline is raised as it was before the halving.
            committed, left = await isolate(
                db=db,
                failure=failure,
                ids=batch.ids,
                attempt=page_of,
                moved=lambda page_erased: page_erased[1],
                share=None,
                owes=False,
                what=what,
                clock=clock,
            )
            read = len(batch.ids)
            erased = sum(result[1] for result in committed)
            redacted = sum(result[2] for result in committed)
            # A page that failed whole and whose halves neither moved nor passed a row would be read
            # again, the same way, for ever.
            if read > page and not erased and not left:
                raise

            passed.extend(left)

        erased_total += erased
        redacted_total += redacted
        if read <= page:
            return erased_total, redacted_total


def refuse_a_stalled_page(*, read: int, moved: int, page: int, clock: str, saison_id: str) -> None:
    """Raise where a full page moved nothing: the same rows come back for ever (`docs/backend/spec.md :: I295`).

    Beside `drain`, which takes the page the same way: each slice keeps its own `SWEEP_PAGE`.
    """

    if read > page and moved == 0:
        raise StalledPage(
            f"season {saison_id} fills the {clock} clock's page of {page} with rows it takes none of, so no pass can make progress"
        )
