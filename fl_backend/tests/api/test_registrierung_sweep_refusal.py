from collections.abc import Mapping
from datetime import date, timedelta
from typing import Any

import pytest

from app.api.bewerbungen.services import hash_token, latest_decision_due
from app.api.registrierungen import sweep_router
from app.api.registrierungen.services import (
    bestaetigung_erasure_is_due,
    build_decline_filter,
    build_erinnerung_filter,
    build_unconfirmed_filter,
    build_undecided_filter,
    decline_erasure_is_due,
    erinnerung_is_due,
)
from app.core.middlewares import REQUEST_DEADLINE_S
from app.shared.schemas.bounds import REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE, REGISTRIERUNG_ERINNERUNG_TAGE
from tests.documents import eigene_einwilligung_document

TODAY = "2026-04-01"
YESTERDAY = "2026-03-31"
TOMORROW = "2026-04-02"

# Three days before `TODAY` to the day: the reminder's own mark, pinned so both sides of it are cases.
MAILED_ON_THE_MARK = "2026-03-29"
MAILED_A_DAY_SHORT = "2026-03-30"
MAILED_A_DAY_PAST = "2026-03-28"

FIRST_HASH = hash_token("first")


def einwilligung() -> dict[str, Any]:
    return eigene_einwilligung_document(text_version="2026-10-spielerseite-5", bestaetigt_am=TODAY)


def bestaetigung(**overrides: Any) -> dict[str, Any]:
    """One live link mailed at its reminder mark, inside its deadline, that each case moves one thing of."""

    return {
        "token_hashes": [FIRST_HASH],
        "verschickt_am": MAILED_ON_THE_MARK,
        "erinnert_am": None,
        "frist": "2026-04-05",
        **overrides,
    }


def registrierung(**overrides: Any) -> dict[str, Any]:
    """One submitted registration nobody has confirmed, its link due a reminder today."""

    return {
        "status": "eingereicht",
        "saison_id": "2026",
        "vorname": "Quillhilde",
        "email": "quillhilde@example.com",
        "einwilligung": None,
        "bestaetigung": bestaetigung(),
        "entscheidung": None,
        **overrides,
    }


class TestTheReminderMark:
    """The three-day mark, on the one link a registration has: the day before, the day, the day after.

    The bound is `fl_backend/app/shared/schemas/bounds.py :: REGISTRIERUNG_ERINNERUNG_TAGE`.
    """

    @pytest.mark.parametrize(
        ("verschickt_am", "due"),
        [
            pytest.param(MAILED_A_DAY_SHORT, False, id="two days ago"),
            pytest.param(MAILED_ON_THE_MARK, True, id="three days ago, to the day"),
            pytest.param(MAILED_A_DAY_PAST, True, id="four days ago"),
        ],
    )
    def test_each_boundary_falls_where_the_bound_says(self, verschickt_am: str, due: bool):
        stored = registrierung(bestaetigung=bestaetigung(verschickt_am=verschickt_am))

        assert erinnerung_is_due(registrierung_raw=stored, today=TODAY) == due
        assert (REGISTRIERUNG_ERINNERUNG_TAGE, REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE) == (3, 7)

    @pytest.mark.parametrize(
        ("stored", "why"),
        [
            pytest.param(registrierung(einwilligung=einwilligung()), "confirmed", id="confirmed"),
            pytest.param(registrierung(bestaetigung=bestaetigung(erinnert_am=YESTERDAY)), "reminded once", id="reminded once"),
            pytest.param(registrierung(status="abgelehnt"), "declined", id="declined"),
            pytest.param(registrierung(bestaetigung=None), "no bookkeeping", id="no bookkeeping"),
            pytest.param(registrierung(bestaetigung=bestaetigung(verschickt_am=None)), "no send recorded", id="no send recorded"),
        ],
    )
    def test_a_registration_that_has_answered_been_chased_or_lost_its_link_is_not_reminded(self, stored: Mapping[str, Any], why: str):
        assert not erinnerung_is_due(registrierung_raw=stored, today=TODAY), why

    @pytest.mark.parametrize(
        ("frist", "due"),
        [
            pytest.param(TOMORROW, True, id="the day before the deadline"),
            pytest.param(TODAY, True, id="the deadline's own day, when the link still answers"),
            pytest.param(YESTERDAY, False, id="the day after, when the erasure clock has it"),
        ],
    )
    def test_nothing_past_its_deadline_is_chased(self, frist: str, due: bool):
        """A link minted on the way out is one nobody can spend: the erasure below takes the row the same day."""

        stored = registrierung(bestaetigung=bestaetigung(frist=frist))

        assert erinnerung_is_due(registrierung_raw=stored, today=TODAY) == due


class TestTheDeadlineClock:
    @pytest.mark.parametrize(
        ("frist", "due"),
        [
            pytest.param(TOMORROW, False, id="the day before the deadline"),
            pytest.param(TODAY, False, id="the deadline's own day, when the link still answers"),
            pytest.param(YESTERDAY, True, id="the day after"),
            pytest.param(None, False, id="no deadline recorded"),
        ],
    )
    def test_each_boundary_falls_where_the_bound_says(self, frist: str | None, due: bool):
        stored = registrierung(bestaetigung=bestaetigung(frist=frist))

        assert bestaetigung_erasure_is_due(registrierung_raw=stored, today=TODAY) == due

    def test_a_confirmed_registration_waits_for_the_seasons_end_instead(self):
        """The clock's whole reach: a row nobody confirmed leaves at its deadline, and a confirmed one leaves with its season."""

        stored = registrierung(bestaetigung=bestaetigung(frist=YESTERDAY), einwilligung=einwilligung())

        assert not bestaetigung_erasure_is_due(registrierung_raw=stored, today=TODAY)

    def test_a_declined_registration_is_the_one_month_clocks(self):
        stored = registrierung(status="abgelehnt", bestaetigung=bestaetigung(frist=YESTERDAY))

        assert not bestaetigung_erasure_is_due(registrierung_raw=stored, today=TODAY)

    def test_a_registration_stored_without_a_block_is_never_taken_by_this_clock(self):
        """A row with no readable deadline is held rather than destroyed: the date this clock counts from is the one thing it needs."""

        assert not bestaetigung_erasure_is_due(registrierung_raw=registrierung(bestaetigung=None), today=TODAY)


class TestTheOneMonthClock:
    @pytest.mark.parametrize(
        ("getroffen_am", "due"),
        [
            pytest.param("2026-03-02", False, id="a day short of the month"),
            pytest.param("2026-03-01", True, id="the month, to the day"),
            pytest.param("2026-02-15", True, id="past the month"),
            pytest.param("2026-01-31", True, id="clamped to February, and past it"),
        ],
    )
    def test_each_boundary_falls_a_calendar_month_after_the_decision(self, getroffen_am: str, due: bool):
        declined = registrierung(status="abgelehnt", entscheidung={"getroffen_am": getroffen_am, "von": "admin", "grund": "kein Platz"})

        assert decline_erasure_is_due(registrierung_raw=declined, today=TODAY) == due

    @pytest.mark.parametrize("status", ["eingereicht", "abgelehnt"])
    def test_a_decision_with_no_day_and_a_row_nobody_decided_are_both_left_standing(self, status: str):
        stored = registrierung(status=status, entscheidung=None)

        assert not decline_erasure_is_due(registrierung_raw=stored, today=TODAY)


SAISON_ID = "2026"

# Three days before `TODAY`, which is the mark the reminder's filter counts BACKWARDS to where the
# predicate counts forwards from the send.
THE_MARK = MAILED_ON_THE_MARK

CLOCK_FILTERS: Mapping[str, Mapping[str, Any]] = {
    "season's end": build_undecided_filter(saison_id=SAISON_ID),
    "deadline": build_unconfirmed_filter(saison_id=SAISON_ID, today=TODAY),
    "reminder": build_erinnerung_filter(saison_id=SAISON_ID, today=TODAY),
    "decline": build_decline_filter(saison_id=SAISON_ID, today=TODAY),
}


class TestWhatEachClockReads:
    """One page per clock, so a row the clock can never take holds no slot in it.

    A read taking every submitted row fills its page with rows nothing is owed on, and the rows
    behind them are never judged.
    """

    def test_the_seasons_end_takes_every_submitted_row(self):
        """Nothing narrower is right here: once the season is `past` this clock takes every one of them, confirmed or not."""

        assert CLOCK_FILTERS["season's end"] == {"saison_id": SAISON_ID, "status": "eingereicht"}

    def test_the_deadline_reads_the_unconfirmed_whose_day_has_passed(self):
        """The consent term matches a null record and a null stamp alike, which is what covers both stored shapes with one key."""

        assert CLOCK_FILTERS["deadline"] == {
            "saison_id": SAISON_ID,
            "status": "eingereicht",
            "einwilligung.bestaetigt_am": None,
            "bestaetigung.frist": {"$lt": TODAY},
        }

    def test_the_reminder_reads_the_unchased_at_their_mark(self):
        assert CLOCK_FILTERS["reminder"] == {
            "saison_id": SAISON_ID,
            "status": "eingereicht",
            "einwilligung.bestaetigt_am": None,
            "bestaetigung.erinnert_am": None,
            "bestaetigung.frist": {"$gte": TODAY},
            "bestaetigung.verschickt_am": {"$lte": THE_MARK},
        }

    def test_the_decline_clock_reads_the_decisions_whose_month_is_behind_them(self):
        """Narrowed to the due ones, so a page of decisions still inside their month cannot fill the read ahead of one that is due."""

        assert CLOCK_FILTERS["decline"] == {
            "saison_id": SAISON_ID,
            "status": "abgelehnt",
            "entscheidung.getroffen_am": {"$lte": "2026-03-01"},
        }

    @pytest.mark.parametrize(
        ("today", "latest"),
        [
            pytest.param("2026-04-01", "2026-03-01", id="a plain month"),
            # The clamp a month counted back from today gets wrong: the 29th to the 31st of January are
            # due on the 28th of February, which counting back lands on the 28th of January.
            pytest.param("2026-02-28", "2026-01-31", id="the end of a short month"),
            pytest.param("2028-02-29", "2028-01-31", id="the end of a leap February"),
            pytest.param("2026-03-30", "2026-02-28", id="past a short month's end"),
        ],
    )
    def test_the_last_decision_due_agrees_with_the_clock_at_every_month_end(self, today: str, latest: str):
        """Both sides of the cutoff, judged by the clock's own predicate: the query and the predicate must take the same rows."""

        def due(getroffen_am: str) -> bool:
            declined = {"status": "abgelehnt", "entscheidung": {"getroffen_am": getroffen_am}}
            return decline_erasure_is_due(registrierung_raw=declined, today=today)

        day_after = (date.fromisoformat(latest) + timedelta(days=1)).isoformat()

        assert latest_decision_due(today=today) == latest
        assert (due(latest), due(day_after)) == (True, False)

    @pytest.mark.parametrize("clock", sorted(CLOCK_FILTERS))
    def test_every_clock_reads_one_season(self, clock: str):
        """The reads; the removals are held to the season by `tests/api/test_registrierung_sweep_execution.py :: TestTheDeadlineClock`."""

        assert CLOCK_FILTERS[clock]["saison_id"] == SAISON_ID


# The reminder's commands a row -- the stamp's update, its read-back and its log row, then the Postausgang's key
# lookup and its insert -- pinned on the wire by
# `fl_backend/tests/api/test_registrierung_sweep_execution.py :: TestTheReminderClockTakesAShareEachCall`.
ROUND_TRIPS_A_ROW = 5

# The other commands of the worst call erasing one page per clock, counted on the wire by
# `fl_backend/tests/api/test_registrierung_sweep_execution.py :: TestTheWorstCallSendsTheCommandsItsBudgetCounts`.
OTHER_COMMANDS = 14

# The per-command cost, the widest of fifteen whole passes at a full share timed locally, 2026-10-20.
PER_COMMAND_S = 0.00127

# The round trip `sweep_router.REMINDERS_PER_PASS`'s comment sizes the share for.
ROUND_TRIP_S = 0.037


def test_a_full_share_finishes_inside_the_deadline_at_the_round_trip_its_comment_names():
    """A share raised past its budget passes every case that counts its own rows, and times out a whole pass in production."""

    assert (sweep_router.REMINDERS_PER_PASS * ROUND_TRIPS_A_ROW + OTHER_COMMANDS) * (ROUND_TRIP_S + PER_COMMAND_S) < REQUEST_DEADLINE_S
