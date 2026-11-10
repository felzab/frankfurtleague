"""
API · where a line-up stands against its fixture's kick-off, and what its screen and its save judge

The one place a line-up's marks are counted from a fixture's `date` and `time`: the line-up's own read and its lock,
the team's reads and the reminder's window all ask here, so no two of them can disagree on an instant.
"""

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
from http import HTTPStatus
from typing import Any, Final

from bson import ObjectId

from app.api.aufstellungen.schemas import FLAufstellungEntry, FLAufstellungMarks, FLAufstellungPhase
from app.core import clock
from app.core.codes import Code
from app.core.collections import Collection
from app.core.crud import refuse
from app.core.exceptions import WriteRefusal
from app.shared.schemas.bounds import AUFSTELLUNG_DUE_HOURS, AUFSTELLUNG_LOCK_HOURS, AUFSTELLUNG_REMINDER_HOURS, AUFSTELLUNG_STARTERS_MAX

_REMINDER_BEFORE: Final = timedelta(hours=AUFSTELLUNG_REMINDER_HOURS)
_DUE_BEFORE: Final = timedelta(hours=AUFSTELLUNG_DUE_HOURS)
_LOCK_BEFORE: Final = timedelta(hours=AUFSTELLUNG_LOCK_HOURS)


def _anpfiff(date: str | None, time: str | None) -> datetime | None:
    """The fixture's kick-off as a UTC instant, from its day and its Berlin wall time; none where either is unset."""

    if date is None or time is None:
        return None

    # In UTC before any mark is counted back: an aware value in a `ZoneInfo` subtracts in wall time, so a mark across a
    # clock change would land an hour off the hours it names.
    return datetime.fromisoformat(f"{date}T{time}").replace(tzinfo=clock.GERMANY).astimezone(UTC)


def aufstellung_marks(*, date: str | None, time: str | None, stored: bool, now: datetime) -> FLAufstellungMarks | None:
    """Whether a line-up is stored, the phase the clock puts it in at `now`, and the instants it is due and locks at.

    None for a fixture holding no day or no hour, which owes no line-up and takes none. `open` runs up to the due mark,
    `overdue` from it up to the lock, `locked` from the lock on: each mark belongs to the phase it opens.
    """

    anpfiff = _anpfiff(date, time)
    if anpfiff is None:
        return None

    due_at, locks_at = anpfiff - _DUE_BEFORE, anpfiff - _LOCK_BEFORE
    phase: FLAufstellungPhase = "open" if now < due_at else "overdue" if now < locks_at else "locked"

    return FLAufstellungMarks(stored=stored, phase=phase, due_at=due_at, locks_at=locks_at)


def aufstellung_reminder_owed(*, date: str | None, time: str | None, now: datetime) -> bool:
    """Whether `now` lies in the window a team holding no line-up is owed its one reminder: from its mark up to the due mark.

    Never for a fixture holding no day or no hour, which owes no line-up.
    """

    anpfiff = _anpfiff(date, time)

    return anpfiff is not None and anpfiff - _REMINDER_BEFORE <= now < anpfiff - _DUE_BEFORE


# --- What a save judges, each refusal writing nothing.


def find_undated_refusal(marks: FLAufstellungMarks | None) -> WriteRefusal | None:
    """`aufstellung_spiel_undated`: a fixture holding no day or no hour owes no line-up and takes none, from anybody."""

    if marks is not None:
        return None

    return WriteRefusal(error_code=Code.AUFSTELLUNG_SPIEL_UNDATED, status=HTTPStatus.CONFLICT)


def find_locked_refusal(marks: FLAufstellungMarks | None) -> WriteRefusal | None:
    """`aufstellung_locked`: from the lock the line-up is the administration's. A seat's alone, and never for being due or overdue."""

    if marks is None or marks.phase != "locked":
        return None

    return WriteRefusal(error_code=Code.AUFSTELLUNG_LOCKED, status=HTTPStatus.CONFLICT)


def judge_the_kickoff(marks: FLAufstellungMarks | None, *, locks: bool) -> None:
    """The fixture's clock, as a save asks it inside its transaction and again outside it: `locks` for a seat's save alone."""

    refuse(find_undated_refusal(marks))
    if locks:
        refuse(find_locked_refusal(marks))


def newly_named(entries: Sequence[FLAufstellungEntry], saved: Mapping[str, Any] | None) -> set[ObjectId]:
    """The pupils this save names that the stored line-up did not, the only ones judged against the squad.

    So a line-up keeps a pupil ausgetragen or erased since it named them.
    """

    stored = set() if saved is None else {entry["spieler_id"] for entry in saved["spieler"]}

    return {entry.spieler_id for entry in entries} - stored


def find_not_in_kader_refusal(
    *, entries: Sequence[FLAufstellungEntry], new: set[ObjectId], kader: Sequence[Mapping[str, Any]]
) -> WriteRefusal | None:
    """`spieler_not_in_kader`: a pupil newly named is in the club's live squad of the season.

    On each entry it refuses, by its path, so the screen marks the row it names.
    """

    live = {row["spieler_id"] for row in kader if row["inactive_since"] is None}
    outside = tuple(("spieler", index, "spieler_id") for index, entry in enumerate(entries) if entry.spieler_id in new - live)
    if not outside:
        return None

    return WriteRefusal(error_code=Code.SPIELER_NOT_IN_KADER, status=HTTPStatus.CONFLICT, fields=outside)


def find_nominee_refusal(*, entries: Sequence[FLAufstellungEntry], kader: Sequence[Mapping[str, Any]]) -> WriteRefusal | None:
    """`aufstellung_nominee_without_shortage`: a line-up names nominees only into the gap its regular players leave below eleven.

    A pupil holding no squad row of the club, an erased one among them, counts as a regular player: only a row says
    who was nominated late.
    """

    nominees = {row["spieler_id"] for row in kader if row["is_nachnominiert"]}
    named_nominees = sum(entry.spieler_id in nominees for entry in entries)
    regular = len(entries) - named_nominees
    if named_nominees <= max(0, AUFSTELLUNG_STARTERS_MAX - regular):
        return None

    return WriteRefusal(error_code=Code.AUFSTELLUNG_NOMINEE_WITHOUT_SHORTAGE, status=HTTPStatus.CONFLICT)


def judge_the_names(*, entries: Sequence[FLAufstellungEntry], new: set[ObjectId], kader: Sequence[Mapping[str, Any]]) -> None:
    """Whom the line-up names, against the club's squad, as a save asks it inside its transaction and again outside it."""

    refuse(find_not_in_kader_refusal(entries=entries, new=new, kader=kader))
    refuse(find_nominee_refusal(entries=entries, kader=kader))


# --- The squad a line-up picks from.

_NUMMER_ORDER = "nummer_order"
_UNNUMBERED = "unnumbered"


def build_aufstellung_kader_pipeline(*, saison_id: str, team_id: ObjectId) -> list[Mapping[str, Any]]:
    """Every squad row of one club in one season, live and ausgetragen alike, with its pupil's two names, in shirt-number order.

    The line-up's own rather than the report's (`app/api/spielberichte/services.py :: build_bericht_kader_pipeline`):
    its screen shows each row's position and captaincy, judges its nominees, and lists the squad by number.
    """

    return [
        {"$match": {"saison_id": saison_id, "team_id": team_id}},
        {
            "$lookup": {
                "from": Collection.SPIELER,
                "localField": "spieler_id",
                "foreignField": "_id",
                # An allow-list inside the join: the person row holds an address.
                "pipeline": [{"$project": {"_id": 0, "first_name": 1, "last_name": 1}}],
                "as": "person",
            }
        },
        # Strict, as the squad's own read is: the erasure removes a person's squad rows before the person.
        {"$unwind": "$person"},
        {
            "$project": {
                "_id": 0,
                "spieler_id": 1,
                "team_id": 1,
                "first_name": "$person.first_name",
                "last_name": "$person.last_name",
                "nummer": 1,
                "position": 1,
                "rolle": 1,
                "is_nachnominiert": 1,
                "inactive_since": 1,
                # The number as the shirt reads it, so `7` comes before `10`; null for a row holding none.
                _NUMMER_ORDER: {"$convert": {"input": "$nummer", "to": "int", "onError": None, "onNull": None}},
            }
        },
        # A null sorts ahead of every number, so the rows holding none are put after the numbered ones.
        {"$set": {_UNNUMBERED: {"$eq": [f"${_NUMMER_ORDER}", None]}}},
        {"$sort": {_UNNUMBERED: 1, _NUMMER_ORDER: 1, "last_name": 1, "first_name": 1, "spieler_id": 1}},
        {"$unset": [_NUMMER_ORDER, _UNNUMBERED]},
    ]
