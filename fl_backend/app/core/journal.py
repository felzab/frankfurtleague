"""
CORE · the journal: one line for each erasure, withdrawal and objection, the acts a restore undoes

A restore rolls the database and its action log back together, so what must be done again stands in the backend's
stream instead (`docs/ops/runbooks.md` §13). A line names the act and where its person stands by id, never a value, an
address or a name, since it outlives the erasure it reports.

Invariant: a line is written once its transaction committed or lost its answer, never by an attempt that rolled back.
"""

from collections.abc import Awaitable, Callable, Sequence
from types import TracebackType
from typing import Literal

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.errors import PyMongoError

from app.core.logging import fl_logger
from app.core.transactions import UNKNOWN_COMMIT_RESULT

PrivacyAct = Literal["erasure", "withdrawal", "objection"]


def privacy_line(
    act: PrivacyAct, records: Sequence[str], choices: Sequence[str] = (), seats: Sequence[str] = (), rows: Sequence[str] = ()
) -> None:
    """One INFO line naming the act and each record as `collection/id`, with a withdrawal's choices and an objection's slots by name.

    Every key stands on every line, so a reader can rely on it. An erasure's `records` hold one person each, a seat's row
    holds three, so its `seats` read `collection/id/slot`, a confirmed slot's confirmation day after them, which tells its
    sitter apart on a restored row; its `rows` are every other field that named the address, as
    `collection/id/path`, which is how an address holding no record of its own is found again, and how a row naming two
    people says which of them this is.
    """

    fl_logger.info(
        "journal.act",
        extra={"act": act, "records": list(records), "choices": list(choices), "seats": list(seats), "rows": list(rows)},
    )


def _lost_its_answer(failure: BaseException | None) -> bool:
    """Whether a transaction's failure is a commit whose answer never came: it may have landed."""

    return isinstance(failure, PyMongoError) and failure.has_error_label(UNKNOWN_COMMIT_RESULT)


class Journal:
    """Entered around a transaction block, writing what its last attempt noted once the commit lands or loses its answer.

    Outside the block, whose abort a failure meets first; never in the callback.
    """

    def __init__(self) -> None:
        self._noted: list[tuple[PrivacyAct, Sequence[str], Sequence[str], Sequence[str], Sequence[str]]] = []

    def attempted[T, *Arguments](
        self, callback: Callable[[AsyncClientSession, *Arguments], Awaitable[T]]
    ) -> Callable[[AsyncClientSession, *Arguments], Awaitable[T]]:
        """`callback`, noting afresh in each attempt: the driver runs it again on a transient error, and a rolled-back attempt did nothing."""

        async def noting_afresh(session: AsyncClientSession, *arguments: *Arguments) -> T:
            self._noted = []
            return await callback(session, *arguments)

        return noting_afresh

    def note(
        self, act: PrivacyAct, records: Sequence[str], choices: Sequence[str] = (), seats: Sequence[str] = (), rows: Sequence[str] = ()
    ) -> None:
        self._noted.append((act, records, choices, seats, rows))

    async def __aenter__(self) -> Journal:
        return self

    async def __aexit__(self, kind: type[BaseException] | None, failure: BaseException | None, traceback: TracebackType | None) -> None:
        # A lost answer writes too: the act may have landed, and repeating what its person asked for wrongs nobody.
        if failure is None or _lost_its_answer(failure):
            for noted in self._noted:
                privacy_line(*noted)
