"""
CORE · the clock

The one place the backend reads the wall clock and names the league's time zone; Ruff's `banned-api`
refuses a read anywhere else. A request reads it through `app/core/dependencies.py :: get_germany_now`,
which a test substitutes.
"""

from datetime import datetime
from typing import Final
from zoneinfo import ZoneInfo

GERMANY: Final = ZoneInfo("Europe/Berlin")


def now() -> datetime:
    """The current instant, in German time: an aware value, so it compares and stores as the same instant in any zone."""

    return datetime.now(GERMANY)  # noqa: TID251
