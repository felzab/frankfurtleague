import asyncio
import contextvars
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Final

import pymongo
from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.errors import OperationFailure, PyMongoError

from app.core.exception_handlers import DATABASE_FAILED
from app.core.logging import fl_logger
from app.core.middlewares import request_deadline_var

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
        # A context of its own: `pymongo.timeout` only narrows the deadline it is entered under, and
        # the request's may have passed.
        await asyncio.create_task(abort(), context=contextvars.Context())
    except PyMongoError as failure:
        code = failure.code if isinstance(failure, OperationFailure) else None
        if code not in NOTHING_LEFT_OPEN:
            _log_left_open(f"its abort failed ({type(failure).__name__}, code {code})")


@asynccontextmanager
async def transaction_session(client: AsyncMongoClient) -> AsyncIterator[AsyncClientSession]:
    """The session every transaction runs on: work failing inside it leaves the server no transaction (`docs/backend/spec.md :: I539`)."""

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


async def drain(
    *,
    db: AsyncMongoClient,
    # The caller's `session.with_transaction(<callback>)`, never the callback itself:
    # `tests/core/app_source.py :: _callbacks` reads a callback where `with_transaction` is handed
    # it, and would find none here.
    page_of: Callable[[AsyncClientSession], Awaitable[tuple[int, int, int]]],
    # The callback reads one row past it, or a full page reads as the last one.
    page: int,
) -> tuple[int, int]:
    """A full page is erased and read again: the population filling it is the one only the erasure shrinks (`docs/backend/spec.md :: I295`)."""

    erased_total, redacted_total = 0, 0
    while True:
        async with transaction_session(db) as session:
            read, erased, redacted = await page_of(session)
        erased_total += erased
        redacted_total += redacted
        if read <= page:
            return erased_total, redacted_total


def refuse_a_stalled_page(*, read: int, moved: int, page: int, clock: str, saison_id: str) -> None:
    """Raise where a full page moved nothing: the same rows come back for ever (`docs/backend/spec.md :: I295`).

    Beside `drain`, which takes the page the same way: each slice keeps its own `SWEEP_PAGE`.
    """

    if read > page and moved == 0:
        raise ValueError(
            f"season {saison_id} fills the {clock} clock's page of {page} with rows it takes none of, so no pass can make progress"
        )
