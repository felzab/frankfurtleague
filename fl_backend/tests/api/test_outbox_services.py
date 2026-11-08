from datetime import UTC, datetime, timedelta

from app.api.outbox.schemas import FLBanData
from app.api.outbox.services import DELIVERY_DEADLINE, REPETITION_AFTER, RETENTION, OwedMail, final_update, retry_update, row_of
from app.core import clock

# The last half minute of summer time, so each span below crosses the clock falling back.
BEFORE_THE_CLOCK_FALLS_BACK = datetime(2026, 10, 25, 2, 59, 30, tzinfo=clock.GERMANY)

MAIL = OwedMail(
    key="ban/1",
    to="nora.neu@beispielschule.de",
    data=FLBanData(kind="ban", ban_reason="Falsches Geburtsdatum", barred_until_saison_id="2027"),
    reference=None,
    link=None,
)


def run_for(instant: datetime) -> timedelta:
    """Measured in UTC: two values of one zone subtract as their wall clocks do, which would hide the very hour held here."""

    return instant.astimezone(UTC) - BEFORE_THE_CLOCK_FALLS_BACK.astimezone(UTC)


def test_each_span_runs_its_whole_length_across_a_clock_change():
    """Added to a Berlin value each would be the wall clock's, an hour out: a retried mail waiting sixty-one minutes rather than one."""

    owed = row_of(MAIL, now=BEFORE_THE_CLOCK_FALLS_BACK, secret=None, valid_until=None)
    lapsing = row_of(MAIL, now=BEFORE_THE_CLOCK_FALLS_BACK, secret=None, valid_until=BEFORE_THE_CLOCK_FALLS_BACK)

    assert {
        "deadline": run_for(owed["deadline"]),
        "erased": run_for(owed["erase_at"]),
        "erased past a stated lapse": run_for(lapsing["erase_at"]),
        "settled": run_for(final_update("sent", now=BEFORE_THE_CLOCK_FALLS_BACK)["$min"]["erase_at"]),
        "retried": run_for(retry_update(now=BEFORE_THE_CLOCK_FALLS_BACK)["$set"]["leased_until"]),
    } == {
        "deadline": DELIVERY_DEADLINE,
        "erased": DELIVERY_DEADLINE + RETENTION,
        "erased past a stated lapse": RETENTION,
        "settled": RETENTION,
        "retried": REPETITION_AFTER,
    }
