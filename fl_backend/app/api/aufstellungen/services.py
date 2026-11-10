"""
API · where a line-up stands against its fixture's kick-off

The one place a line-up's marks are counted from a fixture's `date` and `time`: the line-up's own read and its lock,
the team's reads and the reminder's window all ask here, so no two of them can disagree on an instant.
"""

from datetime import UTC, datetime, timedelta
from typing import Final

from app.api.aufstellungen.schemas import FLAufstellungMarks, FLAufstellungPhase
from app.core import clock
from app.shared.schemas.bounds import AUFSTELLUNG_DUE_HOURS, AUFSTELLUNG_LOCK_HOURS, AUFSTELLUNG_REMINDER_HOURS

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
