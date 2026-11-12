"""
The journal: a line for each erasure, withdrawal and objection, the acts a restore undoes.

A restore rolls the database and its action log back together, so what must be done again stands in the backend's
stream instead. A line names the act and where its person stands by id, a confirmed seat's
day beside it, never an address or a name, since it outlives the erasure it reports.

Invariant: a line is written once its transaction committed or lost its answer, never by an attempt that rolled back.
"""

import secrets
from collections.abc import Awaitable, Callable, Sequence
from itertools import batched
from types import TracebackType
from typing import Final, Literal

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.errors import PyMongoError

from app.core.logging import fl_logger
from app.core.transactions import UNKNOWN_COMMIT_RESULT

PrivacyAct = Literal["erasure", "withdrawal", "objection"]

# Docker cuts a line at 16 KiB, and a `grep` for the message misses everything past a cut. The longest entry, a
# seat's, is 67 bytes once quoted, so a part stays near 8 KiB.
PART_ENTRIES_MAX: Final = 120


def privacy_line(
    act: PrivacyAct, records: Sequence[str], choices: Sequence[str] = (), seats: Sequence[str] = (), rows: Sequence[str] = ()
) -> None:
    """INFO lines naming the act and each record as `collection/id`, with a withdrawal's choices and, on a seat, its slots by name.

    One line, or as many as `PART_ENTRIES_MAX` asks of a former owner's hundreds of rows, each carrying the same `act_id` and
    its `part` of `parts`. Every key stands on every line, so a reader can rely on it.

    An erasure's `records` hold one person each, a seat's row holds three, so its `seats` read `collection/id/slot`, a
    confirmed slot's confirmation day after them, which tells its sitter apart on a restored row; its `rows` are every other
    field that named the address, as `collection/id/path`, which is how an address holding no record of its own is found
    again, and how a row naming two people says which of them this is. A withdrawal's or an objection's `records` hold the
    record it landed on, a seat's row or application among them, so its `seats` name the slots that say whose block it was.
    """

    held = {"records": records, "choices": choices, "seats": seats, "rows": rows}
    entries = [(key, entry) for key, values in held.items() for entry in values]
    parts = list(batched(entries, PART_ENTRIES_MAX, strict=False)) or [()]
    act_id = secrets.token_hex(8)
    for part, chunk in enumerate(parts, start=1):
        fl_logger.info(
            "journal.act",
            extra={
                "act": act,
                "act_id": act_id,
                "part": part,
                "parts": len(parts),
                **{key: [entry for owner, entry in chunk if owner == key] for key in held},
            },
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
