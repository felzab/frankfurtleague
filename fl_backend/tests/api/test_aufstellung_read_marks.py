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
    assert (marks.phase, marks.due_at) == (phase, ANPFIFF - timedelta(hours=24))


@pytest.mark.parametrize(
    ("date", "reminder_from", "due_at", "locks_at"),
    [
        # Summer time ends that Sunday at 03:00: the kick-off is 15:00 UTC, the Friday and the Saturday 14:00 UTC.
        pytest.param(
            "2026-10-25",
            datetime(2026, 10, 23, 14, tzinfo=UTC),
            datetime(2026, 10, 24, 14, tzinfo=UTC),
            datetime(2026, 10, 25, 14, tzinfo=UTC),
            id="the autumn Sunday",
        ),
        # Summer time starts that Sunday at 02:00: the kick-off is 14:00 UTC, the Friday and the Saturday 15:00 UTC.
        pytest.param(
            "2026-03-29",
            datetime(2026, 3, 27, 15, tzinfo=UTC),
            datetime(2026, 3, 28, 15, tzinfo=UTC),
            datetime(2026, 3, 29, 13, tzinfo=UTC),
            id="the spring Sunday",
        ),
    ],
)
def test_a_day_back_across_a_clock_change_keeps_the_kickoffs_clock_time(
    date: str, reminder_from: datetime, due_at: datetime, locks_at: datetime
):
    """A Sunday 16:00 kick-off is due at 16:00 on the Saturday and reminded from 16:00 on the Friday; the lock is one real hour."""

    marks = aufstellung_marks(date=date, time=TIME, stored=False, now=reminder_from)
    # The lock read off the phase it opens, the one place a read serves it.
    around_the_lock = [aufstellung_marks(date=date, time=TIME, stored=False, now=now) for now in (locks_at - TICK, locks_at)]

    assert marks is not None
    assert marks.due_at == due_at
    assert [each.phase if each is not None else None for each in around_the_lock] == ["overdue", "locked"]
    assert [
        aufstellung_reminder_owed(date=date, time=TIME, now=now) for now in (reminder_from - TICK, reminder_from, due_at - TICK, due_at)
    ] == [
        False,
        True,
        True,
        False,
    ]


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
