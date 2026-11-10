"""
API · a line-up's marks counted from its fixture's kick-off, pinned against fixed instants so each boundary is provable without a clock

Every read serving a line-up's phase and the save's lock judge by `aufstellung_marks`, so an instant off here moves the
lock for every team at once.
"""

from datetime import UTC, datetime, timedelta

import pytest

from app.api.aufstellungen.services import aufstellung_marks, aufstellung_reminder_owed

# Saturday 14 November 2026, 16:00 in Berlin: 15:00 UTC, winter time.
DATE, TIME = "2026-11-14", "16:00:00"
ANPFIFF = datetime(2026, 11, 14, 15, tzinfo=UTC)
TICK = timedelta(microseconds=1)


@pytest.mark.parametrize(
    ("now", "phase"),
    [
        pytest.param(ANPFIFF - timedelta(hours=24) - TICK, "open", id="just before the due mark"),
        pytest.param(ANPFIFF - timedelta(hours=24), "overdue", id="the due mark itself"),
        pytest.param(ANPFIFF - timedelta(hours=1) - TICK, "overdue", id="just before the lock"),
        pytest.param(ANPFIFF - timedelta(hours=1), "locked", id="the lock itself"),
        pytest.param(ANPFIFF + timedelta(days=1), "locked", id="after kick-off"),
    ],
)
def test_each_mark_opens_the_phase_it_names(now: datetime, phase: str):
    """A phase off by one mark lets a team write past its lock, or locks it an hour early."""

    marks = aufstellung_marks(date=DATE, time=TIME, stored=False, now=now)

    assert marks is not None
    assert (marks.phase, marks.due_at, marks.locks_at) == (phase, ANPFIFF - timedelta(hours=24), ANPFIFF - timedelta(hours=1))


def test_a_mark_across_a_clock_change_counts_real_hours():
    """Sunday 25 October 2026, 16:00 in Berlin, the day summer time ends: the due mark is 24 hours earlier, 17:00 on the Saturday."""

    marks = aufstellung_marks(date="2026-10-25", time="16:00:00", stored=True, now=datetime(2026, 10, 1, tzinfo=UTC))

    assert marks is not None
    assert marks.due_at == datetime(2026, 10, 24, 15, tzinfo=UTC)


@pytest.mark.parametrize(
    ("now", "owed"),
    [
        pytest.param(ANPFIFF - timedelta(hours=48) - TICK, False, id="just before its mark"),
        pytest.param(ANPFIFF - timedelta(hours=48), True, id="its mark itself"),
        pytest.param(ANPFIFF - timedelta(hours=24) - TICK, True, id="just before the due mark"),
        pytest.param(ANPFIFF - timedelta(hours=24), False, id="the due mark itself"),
    ],
)
def test_the_reminder_is_owed_from_its_mark_up_to_the_due_mark(now: datetime, owed: bool):
    """A window off by one mark mails a team about a line-up already overdue, or never mails it."""

    assert aufstellung_reminder_owed(date=DATE, time=TIME, now=now) is owed


@pytest.mark.parametrize(("date", "time"), [(None, TIME), (DATE, None)])
def test_a_fixture_without_a_day_or_an_hour_has_no_marks(date: str | None, time: str | None):
    """A fixture holding no kick-off owes no line-up, so a read serves no phase and the pass mails nobody."""

    assert aufstellung_marks(date=date, time=time, stored=False, now=ANPFIFF) is None
    assert aufstellung_reminder_owed(date=date, time=time, now=ANPFIFF) is False
