"""
The one place the backend reads the wall clock and names the league's time zone.

Ruff's `banned-api` refuses a read anywhere else. A request reads it through `get_germany_now`, which
a test substitutes.
"""

from datetime import UTC, datetime
from typing import Final
from zoneinfo import ZoneInfo

GERMANY: Final = ZoneInfo("Europe/Berlin")


def now() -> datetime:
    """The current instant, in German time: an aware value, so it compares and stores as the same instant in any zone."""

    return datetime.now(GERMANY)  # noqa: TID251


def german_day(instant: datetime) -> str:
    """The German day `instant` falls on, as every stored and served day is spelled."""

    return instant.astimezone(GERMANY).strftime("%Y-%m-%d")


def german_instant(day: str, wall_time: str) -> datetime:
    """The instant a German day and clock time name, as a fixture stores its kick-off in `date` and `time`.

    Converted to UTC: two values in one zone compare by their clock readings and ignore the offset, so a Berlin-zoned
    kick-off against a Berlin-zoned `now` misorders the hour a clock change repeats or skips.
    """

    return datetime.fromisoformat(f"{day}T{wall_time}").replace(tzinfo=GERMANY).astimezone(UTC)


def utc_stamp(moment: datetime) -> str:
    """The instant a person's evidence is stamped with, spelled one way everywhere.

    UTC with an offset, never German local time: a local-time string carrying no offset sorts October's two identical
    clock hours the wrong way.
    """

    return moment.astimezone(UTC).isoformat(timespec="seconds")
