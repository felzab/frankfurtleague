"""
CORE · the erasure journal: one line for each act a restore from a snapshot would undo, kept outside the database

A restore rolls the database and its action log back together, so what it must run again is written to the
backend's stream instead, which the host keeps as day files (`docs/ops/runbooks.md` §13). A line names its
person by keyed hash, beside the act and the record that act changed; an erasure's line also by the log's
pseudonym, the one key to the rows a restore brings back where it brings back no address.

Invariants:
- A line is written once its transaction committed or lost its answer, never by an attempt that rolled back.
- A choice's line carries the instant its evidence was stamped with, so its replay stamps no later one.
"""

import re
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from types import MappingProxyType, TracebackType
from typing import Any, Final, Literal, get_args

from bson import ObjectId
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.errors import PyMongoError

from app.core.collections import Collection
from app.core.logging import journal_logger
from app.core.transactions import UNKNOWN_COMMIT_RESULT
from app.shared.einwilligung_nachweis import WAHLEN, FLEinwilligungWahl, ist_erteilt
from app.shared.schemas.custom import parse_object_id

# What every line opens with: a token rather than a sentence, so the host's export matches a line by it whatever
# follows (`scripts/ops/export_journal.sh :: JOURNAL_TOKEN`).
JOURNAL_TOKEN: Final = "loeschung-journal"

# An erasure, which an administrator runs again on its page, and each act the replay writes again. An end that told
# somebody has an art of its own: the replay tells them again from the art alone.
JournalArt = Literal[
    "loeschung",
    "widerruf",
    "widerspruch",
    "adresswechsel_abgelehnt",
    "adresswechsel_gestoppt",
    "adresswechsel_verworfen",
    "adresswechsel_verworfen_mitgeteilt",
    "adresswechsel_wirksam",
    "antrag_abgelehnt",
    "antrag_zurueckgezogen",
    "antrag_beendet",
]

# The collections each act is made on: a line naming any other is unreadable rather than replayed there.
DATENSAETZE: Final[Mapping[JournalArt, frozenset[Collection]]] = {
    "loeschung": frozenset(),
    "widerruf": frozenset(
        {Collection.SPIELER, Collection.SCHIEDSRICHTER, Collection.REGISTRIERUNGEN, Collection.SAISON_TEAMS, Collection.BEWERBUNGEN}
    ),
    "widerspruch": frozenset({Collection.SAISON_TEAMS, Collection.BEWERBUNGEN}),
    # Each on the change's own record, whose id names one change: a start never reuses one.
    "adresswechsel_abgelehnt": frozenset({Collection.ADRESSWECHSEL}),
    "adresswechsel_gestoppt": frozenset({Collection.ADRESSWECHSEL}),
    # Ended telling nobody: by an administrator, by a start replacing it, or by its own press finding nothing to move.
    "adresswechsel_verworfen": frozenset({Collection.ADRESSWECHSEL}),
    # Ended at its effect by the hourly pass or an approval, which told its new mailbox it did not take effect.
    "adresswechsel_verworfen_mitgeteilt": frozenset({Collection.ADRESSWECHSEL}),
    # The replay moves everything the restored address on file holds, as the effect did.
    "adresswechsel_wirksam": frozenset({Collection.ADRESSWECHSEL}),
    # Restored, an ended request would stand to be approved. Refused by a decider and ended by an address change, it told
    # its requester; withdrawn by them, nobody.
    "antrag_abgelehnt": frozenset({Collection.BERECHTIGUNGEN_ANTRAEGE}),
    "antrag_zurueckgezogen": frozenset({Collection.BERECHTIGUNGEN_ANTRAEGE}),
    "antrag_beendet": frozenset({Collection.BERECHTIGUNGEN_ANTRAEGE}),
}

_HASH: Final = re.compile(r"[0-9a-f]{64}")
# A label, a seat or a choice's value: one word, so no value can carry a second token or an address.
_WORT: Final = re.compile(r"[0-9a-z_-]+")


def lost_its_answer(failure: BaseException | None) -> bool:
    """Whether a transaction's failure is a commit whose answer never came: it may have landed."""

    return isinstance(failure, PyMongoError) and failure.has_error_label(UNKNOWN_COMMIT_RESULT)


@dataclass(frozen=True, kw_only=True)
class JournalLine:
    """One act, as its line spells it; refused at construction where the act could not be replayed from it."""

    person_hash: str
    art: JournalArt
    collection: Collection | None = None
    record_id: ObjectId | None = None
    # The instant the act's evidence was stamped with, as `app/core/recording.py :: log_stamp` spells it.
    am: str | None = None
    # A withdrawal's label and the values it set, each withholding.
    text_version: str | None = None
    wahlen: Mapping[FLEinwilligungWahl, Any] = field(default_factory=lambda: MappingProxyType({}))
    # The slots a Widerspruch emptied.
    sitze: tuple[str, ...] = ()
    # An erasure's person as the action log keys them (`app/core/security.py :: akteur_pseudonym`): the
    # one way a replay finds those rows where the restored database holds the address nowhere. Absent on an older line.
    pseudonym: str | None = None
    # An erasure's person as their fixture answers stored them (`app/api/spielbestaetigungen/services.py :: halter_of`), for
    # the pseudonym's reason: a restore brings their reasons back with no address beside them. Absent on an older line.
    halter: str | None = None
    # The address a change taking effect replaced, by its journal hash: where an erasure of the new address follows, the
    # restored database holds the moved records at this one.
    zuvor: str | None = None

    def __post_init__(self) -> None:
        if not _HASH.fullmatch(self.person_hash):
            raise ValueError("a journal line names its person by a journal hash")
        if self.pseudonym is not None and (self.art != "loeschung" or not _HASH.fullmatch(self.pseudonym)):
            raise ValueError("an erasure's line alone names its person's log pseudonym")
        if self.halter is not None and (self.art != "loeschung" or not _HASH.fullmatch(self.halter)):
            raise ValueError("an erasure's line alone names its person's holder digest")
        if (self.art == "adresswechsel_wirksam") != (self.zuvor is not None) or (self.zuvor is not None and not _HASH.fullmatch(self.zuvor)):
            raise ValueError("a change taking effect, and only one, names the address it replaced by a journal hash")

        if self.art == "loeschung":
            if (
                self.collection is not None
                or self.record_id is not None
                or self.am is not None
                or self.text_version
                or self.wahlen
                or self.sitze
            ):
                raise ValueError("an erasure's line names its person alone: the erasure is keyed on the address")
            return

        if self.collection not in DATENSAETZE[self.art] or self.record_id is None:
            raise ValueError(f"a {self.art} line names a record of {sorted(DATENSAETZE[self.art])}")
        if self.am is None or datetime.fromisoformat(self.am).tzinfo is None:
            raise ValueError("a choice's line carries the instant it was made, with its offset")

        withdrawn = (
            self.text_version is not None
            and _WORT.fullmatch(self.text_version) is not None
            and bool(self.wahlen)
            and all(
                wahl in WAHLEN and not ist_erteilt(wahl, wert) and (isinstance(wert, bool) or _WORT.fullmatch(str(wert)) is not None)
                for wahl, wert in self.wahlen.items()
            )
        )
        if (self.art == "widerruf") != withdrawn:
            raise ValueError("a withdrawal's line, and only one, carries its label and the withholding values it set")
        if (self.art == "widerspruch") != (bool(self.sitze) and all(_WORT.fullmatch(sitz) for sitz in self.sitze)):
            raise ValueError("a Widerspruch's line, and only one, names the slots it emptied")

    def text(self) -> str:
        """The line as the stream carries it."""

        keyed = [
            f"{name}={value}"
            for name, value in (("pseudonym", self.pseudonym), ("halter", self.halter), ("zuvor", self.zuvor))
            if value is not None
        ]

        return " ".join([JOURNAL_TOKEN, self.person_hash, self.act(), *keyed])

    def act(self) -> str:
        """The act and its record, as the listing and a replay's log row name a line: neither the token nor anything keyed on its person."""

        tokens: list[str] = [self.art]
        if self.collection is not None:
            tokens.append(f"{self.collection}/{self.record_id}")
        if self.am is not None:
            tokens.append(f"am={self.am}")
        if self.text_version is not None:
            tokens.append(f"text_version={self.text_version}")
        # In `WAHLEN`'s order, so one act is spelled one way.
        tokens.extend(f"{wahl}={_spelled(self.wahlen[wahl])}" for wahl in WAHLEN if wahl in self.wahlen)
        if self.sitze:
            tokens.append(f"sitze={','.join(self.sitze)}")

        return " ".join(tokens)


def _spelled(wert: Any) -> str:
    return str(wert).lower() if isinstance(wert, bool) else str(wert)


def _read_value(wahl: str, spelled: str) -> Any:
    # The media consent is the one boolean choice: its value is spelled as JSON spells one.
    return {"true": True, "false": False}.get(spelled, spelled) if wahl == "medien" else spelled


def parse_line(message: str) -> JournalLine | None:
    """The act a stream message spells, `None` for one opening on another word; `ValueError` for a journal line nothing could replay."""

    tokens = message.split(" ")
    if tokens[0] != JOURNAL_TOKEN:
        return None
    if len(tokens) < 3 or tokens[2] not in get_args(JournalArt):
        raise ValueError("a journal line names its person and its act")

    fields: dict[str, Any] = {"person_hash": tokens[1], "art": tokens[2]}
    rest = tokens[3:]
    if rest and "=" not in rest[0]:
        collection, _, spelled_id = rest.pop(0).partition("/")
        # The one reader of an id (`app/shared/schemas/custom.py :: parse_object_id`): bson's own constructor raises
        # `InvalidId` past the `ValueError` the replay counts as an unreadable line.
        record_id = parse_object_id(spelled_id)
        if record_id is None:
            raise ValueError("a journal line names its record as a collection and an id")
        # `Collection(...)` refuses a name the database does not hold with the `ValueError` this function promises.
        fields |= {"collection": Collection(collection), "record_id": record_id}

    wahlen: dict[str, Any] = {}
    for token in rest:
        key, separator, value = token.partition("=")
        if not separator or not value or key in fields or key in wahlen:
            raise ValueError("a journal line's every later token is one named value")
        if key in WAHLEN:
            wahlen[key] = _read_value(key, value)
        elif key == "sitze":
            fields["sitze"] = tuple(value.split(","))
        elif key in ("am", "text_version", "pseudonym", "halter", "zuvor"):
            fields[key] = value
        else:
            raise ValueError("a journal line names a value no act carries")
    if wahlen:
        fields["wahlen"] = MappingProxyType(wahlen)

    return JournalLine(**fields)


class Journal:
    """Entered around a transaction block, writing what its last attempt noted once the commit lands or loses its answer.

    Outside the block, whose abort a failure meets first; never in the callback.
    """

    def __init__(self) -> None:
        self._noted: list[JournalLine] = []

    def attempted[T, *Arguments](
        self, callback: Callable[[AsyncClientSession, *Arguments], Awaitable[T]]
    ) -> Callable[[AsyncClientSession, *Arguments], Awaitable[T]]:
        """`callback`, noting afresh in each attempt: the driver runs it again on a transient error, and a rolled-back attempt did nothing."""

        async def noting_afresh(session: AsyncClientSession, *arguments: *Arguments) -> T:
            self._noted = []
            return await callback(session, *arguments)

        return noting_afresh

    def note(self, line: JournalLine) -> None:
        self._noted.append(line)

    async def __aenter__(self) -> Journal:
        return self

    async def __aexit__(self, kind: type[BaseException] | None, failure: BaseException | None, traceback: TracebackType | None) -> None:
        # A lost answer journals too: the act may have landed, and replaying what its person asked for wrongs nobody.
        if failure is None or lost_its_answer(failure):
            for line in self._noted:
                journal_logger.info(line.text())
