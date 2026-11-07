"""
CORE · the clock

The one place the backend reads the wall clock and names the league's time zone; Ruff's `banned-api`
refuses a read anywhere else. A request reads it through `app/core/dependencies.py :: get_germany_now`,
which a test substitutes.
"""

from datetime import UTC, datetime
from typing import Final
from zoneinfo import ZoneInfo

GERMANY: Final = ZoneInfo("Europe/Berlin")


def now() -> datetime:
    """The current instant, in German time: an aware value, so it compares and stores as the same instant in any zone."""

    return datetime.now(GERMANY)  # noqa: TID251


def german_day(instant: datetime) -> str:
    """The German day `instant` falls on, as every stored and served day is spelled: a link's send, an act's day."""

    return instant.astimezone(GERMANY).strftime("%Y-%m-%d")


def utc_stamp(moment: datetime) -> str:
    """The instant a person's evidence is stamped with, spelled one way everywhere.

    UTC with an offset, never German local time: a local-time string carrying no offset sorts October's two identical
    clock hours the wrong way.
    """

    return moment.astimezone(UTC).isoformat(timespec="seconds")
