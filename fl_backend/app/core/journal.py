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
from app.shared.einwilligung_evidence import CHOICES, FLEinwilligungChoice, is_given
from app.shared.schemas.custom import parse_object_id
from app.shared.schemas.einwilligung import FLSchiedsrichterTextVersions, FLSeatTextVersions, FLSpielerTextVersions

# What every line opens with: a token rather than a sentence, so the host's export matches a line by it whatever
# follows (`scripts/ops/export_journal.sh :: JOURNAL_TOKEN`).
JOURNAL_TOKEN: Final = "erasure-journal"

# An erasure, which an administrator runs again on its page, and each act the replay writes again. An end that told
# somebody has an art of its own: the replay tells them again from the art alone.
JournalArt = Literal[
    "erasure",
    "withdrawal",
    "objection",
    "address_change_declined",
    "address_change_stopped",
    "address_change_discarded",
    "address_change_discarded_notified",
    "address_change_effective",
    "approval_request_declined",
    "approval_request_withdrawn",
    "approval_request_ended",
]

# The collections each act is made on: a line naming any other is unreadable rather than replayed there.
RECORDS: Final[Mapping[JournalArt, frozenset[Collection]]] = {
    "erasure": frozenset(),
    "withdrawal": frozenset(
        {Collection.SPIELER, Collection.SCHIEDSRICHTER, Collection.REGISTRIERUNGEN, Collection.SAISON_TEAMS, Collection.BEWERBUNGEN}
    ),
    "objection": frozenset({Collection.SAISON_TEAMS, Collection.BEWERBUNGEN}),
    # Each on the change's own record, whose id names one change: a start never reuses one.
    "address_change_declined": frozenset({Collection.ADDRESS_CHANGES}),
    "address_change_stopped": frozenset({Collection.ADDRESS_CHANGES}),
    # Ended telling nobody: by an administrator, by a start replacing it, or by its own press finding nothing to move.
    "address_change_discarded": frozenset({Collection.ADDRESS_CHANGES}),
    # Ended at its effect by the hourly pass or an approval, which told its new mailbox it did not take effect.
    "address_change_discarded_notified": frozenset({Collection.ADDRESS_CHANGES}),
    # The replay moves everything the restored address on file holds, as the effect did.
    "address_change_effective": frozenset({Collection.ADDRESS_CHANGES}),
    # Restored, an ended request would stand to be approved. Refused by a decider and ended by an address change, it told
    # its requester; withdrawn by them, nobody.
    "approval_request_declined": frozenset({Collection.GRANT_APPROVAL_REQUESTS}),
    "approval_request_withdrawn": frozenset({Collection.GRANT_APPROVAL_REQUESTS}),
    "approval_request_ended": frozenset({Collection.GRANT_APPROVAL_REQUESTS}),
}

_HASH: Final = re.compile(r"[0-9a-f]{64}")
# A label, a seat or a choice's value: one word, so no value can carry a second token or an address.
_WORD: Final = re.compile(r"[0-9a-z_-]+")


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
    # A withdrawal's values, each withholding, and the label each was set under.
    text_versions: Mapping[FLEinwilligungChoice, str] = field(default_factory=lambda: MappingProxyType({}))
    choices: Mapping[FLEinwilligungChoice, Any] = field(default_factory=lambda: MappingProxyType({}))
    # The slots a Widerspruch emptied.
    seats: tuple[str, ...] = ()
    # An erasure's person as the action log keys them (`app/core/security.py :: actor_pseudonym`): the
    # one way a replay finds those rows where the restored database holds the address nowhere. Absent on an older line.
    pseudonym: str | None = None
    # An erasure's person as their fixture answers stored them (`app/api/spielbestaetigungen/services.py :: halter_of`), for
    # the pseudonym's reason: a restore brings their reasons back with no address beside them. Absent on an older line.
    halter: str | None = None
    # The address a change taking effect replaced, by its journal hash: where an erasure of the new address follows, the
    # restored database holds the moved records at this one.
    before: str | None = None

    def __post_init__(self) -> None:
        if not _HASH.fullmatch(self.person_hash):
            raise ValueError("a journal line names its person by a journal hash")
        if self.pseudonym is not None and (self.art != "erasure" or not _HASH.fullmatch(self.pseudonym)):
            raise ValueError("an erasure's line alone names its person's log pseudonym")
        if self.halter is not None and (self.art != "erasure" or not _HASH.fullmatch(self.halter)):
            raise ValueError("an erasure's line alone names its person's holder digest")
        if (self.art == "address_change_effective") != (self.before is not None) or (
            self.before is not None and not _HASH.fullmatch(self.before)
        ):
            raise ValueError("a change taking effect, and only one, names the address it replaced by a journal hash")

        if self.art == "erasure":
            if (
                self.collection is not None
                or self.record_id is not None
                or self.am is not None
                or self.text_versions
                or self.choices
                or self.seats
            ):
                raise ValueError("an erasure's line names its person alone: the erasure is keyed on the address")
            return

        if self.collection not in RECORDS[self.art] or self.record_id is None:
            raise ValueError(f"a {self.art} line names a record of {sorted(RECORDS[self.art])}")
        if self.am is None or datetime.fromisoformat(self.am).tzinfo is None:
            raise ValueError("a choice's line carries the instant it was made, with its offset")

        withdrawn = (
            bool(self.choices)
            and self.text_versions.keys() == self.choices.keys()
            and all(_WORD.fullmatch(label) is not None for label in self.text_versions.values())
            and all(
                choice in CHOICES and not is_given(choice, value) and (isinstance(value, bool) or _WORD.fullmatch(str(value)) is not None)
                for choice, value in self.choices.items()
            )
        )
        if (self.art == "withdrawal") != withdrawn:
            raise ValueError("a withdrawal's line, and only one, carries the withholding values it set and each one's label")
        if (self.art == "objection") != (bool(self.seats) and all(_WORD.fullmatch(seat) for seat in self.seats)):
            raise ValueError("a Widerspruch's line, and only one, names the slots it emptied")

    def text(self) -> str:
        """The line as the stream carries it."""

        keyed = [
            f"{name}={value}"
            for name, value in (("pseudonym", self.pseudonym), ("halter", self.halter), ("before", self.before))
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
        # In `CHOICES`'s order, so one act is spelled one way.
        tokens.extend(f"{_TEXT_VERSION}{choice}={self.text_versions[choice]}" for choice in CHOICES if choice in self.text_versions)
        tokens.extend(f"{choice}={_spelled(self.choices[choice])}" for choice in CHOICES if choice in self.choices)
        if self.seats:
            tokens.append(f"seats={','.join(self.seats)}")

        return " ".join(tokens)


def _spelled(value: Any) -> str:
    return str(value).lower() if isinstance(value, bool) else str(value)


def _read_value(choice: str, spelled: str) -> Any:
    # The media consent is the one boolean choice: its value is spelled as JSON spells one.
    return {"true": True, "false": False}.get(spelled, spelled) if choice == "media" else spelled


# A line's keys as the host's day files spell them, which the export and the replay match, beside the field each fills.
_LINE_KEYS: Final[Mapping[str, str]] = {"seats": "seats", "before": "before"}

# The key a choice's label is spelled under, the choice after it.
_TEXT_VERSION: Final = "text_version."

# The one label a withdrawal line of an older day file names for its whole press, before each choice carried its own.
# Every stored label was re-pointed to its kind's current one, so the replay stamps those, read off the record's kind.
_PRESS_TEXT_VERSION: Final = "text_version"
_KIND_OF: Final[Mapping[Collection, type[FLSeatTextVersions | FLSpielerTextVersions | FLSchiedsrichterTextVersions]]] = {
    Collection.SPIELER: FLSpielerTextVersions,
    Collection.REGISTRIERUNGEN: FLSpielerTextVersions,
    Collection.SCHIEDSRICHTER: FLSchiedsrichterTextVersions,
    Collection.SAISON_TEAMS: FLSeatTextVersions,
    Collection.BEWERBUNGEN: FLSeatTextVersions,
}


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

    choices: dict[str, Any] = {}
    text_versions: dict[str, str] = {}
    press_label = False
    for token in rest:
        key, separator, value = token.partition("=")
        if (
            not separator
            or not value
            or _LINE_KEYS.get(key, key) in fields
            or key in choices
            or (key.startswith(_TEXT_VERSION) and key.removeprefix(_TEXT_VERSION) in text_versions)
        ):
            raise ValueError("a journal line's every later token is one named value")
        if key in CHOICES:
            choices[key] = _read_value(key, value)
        elif key.startswith(_TEXT_VERSION) and key.removeprefix(_TEXT_VERSION) in CHOICES:
            text_versions[key.removeprefix(_TEXT_VERSION)] = value
        elif key == _PRESS_TEXT_VERSION and not press_label and _WORD.fullmatch(value):
            press_label = True
        elif key == "seats":
            fields["seats"] = tuple(value.split(","))
        elif key in ("am", "pseudonym", "halter", "before"):
            fields[_LINE_KEYS.get(key, key)] = value
        else:
            raise ValueError("a journal line names a value no act carries")
    if press_label:
        kind = _KIND_OF.get(fields["collection"]) if "collection" in fields else None
        if text_versions or kind is None:
            raise ValueError("a withdrawal's line names one label for its press, or one per choice of a consent record")
        text_versions = {choice: kind.current[choice] for choice in CHOICES if choice in choices}
    if choices:
        fields["choices"] = MappingProxyType(choices)
    if text_versions:
        fields["text_versions"] = MappingProxyType(text_versions)

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
