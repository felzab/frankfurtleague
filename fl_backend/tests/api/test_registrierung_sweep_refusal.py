from collections.abc import Mapping
from typing import Any

import pytest

from app.api.registrierungen.services import (
    bestaetigung_loeschung_is_due,
    build_decline_filter,
    build_unconfirmed_filter,
    build_undecided_filter,
    decline_loeschung_is_due,
)
from app.shared.tokens import hash_token
from tests.documents import SPIELER_TEXT_VERSIONS, own_einwilligung_document

TODAY = "2026-04-01"
YESTERDAY = "2026-03-31"
TOMORROW = "2026-04-02"

FIRST_HASH = hash_token("first")


def einwilligung() -> dict[str, Any]:
    return own_einwilligung_document(text_versions=SPIELER_TEXT_VERSIONS, confirmed_at=TODAY)


def bestaetigung(**overrides: Any) -> dict[str, Any]:
    """One live link inside its deadline, that each case moves one thing of."""

    return {
        "token_hashes": [FIRST_HASH],
        "sent_at": "2026-03-29",
        "deadline": "2026-04-05",
        **overrides,
    }


def registrierung(**overrides: Any) -> dict[str, Any]:
    """One submitted registration nobody has confirmed."""

    return {
        "status": "submitted",
        "saison_id": "2026",
        "first_name": "Quillhilde",
        "email": "quillhilde@example.com",
        "einwilligung": None,
        "confirmation": bestaetigung(),
        "decision": None,
        **overrides,
    }


class TestTheDeadlineClock:
    @pytest.mark.parametrize(
        ("deadline", "due"),
        [
            pytest.param(TOMORROW, False, id="the day before the deadline"),
            pytest.param(TODAY, False, id="the deadline's own day, when the link still answers"),
            pytest.param(YESTERDAY, True, id="the day after"),
            pytest.param(None, False, id="no deadline recorded"),
        ],
    )
    def test_each_boundary_falls_where_the_bound_says(self, deadline: str | None, due: bool):
        stored = registrierung(confirmation=bestaetigung(deadline=deadline))

        assert bestaetigung_loeschung_is_due(registrierung_raw=stored, today=TODAY) == due

    def test_a_confirmed_registration_waits_for_the_seasons_end_instead(self):
        """The clock's whole reach: a row nobody confirmed leaves at its deadline, and a confirmed one leaves with its season."""

        stored = registrierung(confirmation=bestaetigung(deadline=YESTERDAY), einwilligung=einwilligung())

        assert not bestaetigung_loeschung_is_due(registrierung_raw=stored, today=TODAY)

    def test_a_declined_registration_is_the_one_month_clocks(self):
        stored = registrierung(status="declined", confirmation=bestaetigung(deadline=YESTERDAY))

        assert not bestaetigung_loeschung_is_due(registrierung_raw=stored, today=TODAY)

    def test_a_registration_stored_without_a_block_is_never_taken_by_this_clock(self):
        """A row with no readable deadline is held rather than destroyed: the date this clock counts from is the one thing it needs."""

        assert not bestaetigung_loeschung_is_due(registrierung_raw=registrierung(confirmation=None), today=TODAY)


class TestTheDeclineClock:
    @pytest.mark.parametrize(
        ("made_at", "due"),
        [
            pytest.param("2026-03-19", False, id="a day short of the fourteen"),
            pytest.param("2026-03-18", True, id="the fourteenth day"),
            pytest.param("2026-02-15", True, id="past them"),
        ],
    )
    def test_each_boundary_falls_fourteen_days_after_the_decision(self, made_at: str, due: bool):
        declined = registrierung(status="declined", decision={"made_at": made_at, "reason": "kein Platz"})

        assert decline_loeschung_is_due(registrierung_raw=declined, today=TODAY) == due

    @pytest.mark.parametrize("status", ["submitted", "declined"])
    def test_a_decision_with_no_day_and_a_row_nobody_decided_are_both_left_standing(self, status: str):
        stored = registrierung(status=status, decision=None)

        assert not decline_loeschung_is_due(registrierung_raw=stored, today=TODAY)


SAISON_ID = "2026"

CLOCK_FILTERS: Mapping[str, Mapping[str, Any]] = {
    "season's end": build_undecided_filter(saison_id=SAISON_ID),
    "deadline": build_unconfirmed_filter(saison_id=SAISON_ID, today=TODAY),
    "decline": build_decline_filter(saison_id=SAISON_ID, today=TODAY),
}


class TestWhatEachClockReads:
    """One page per clock, so a row the clock can never take holds no slot in it.

    A read taking every submitted row fills its page with rows nothing is owed on, and the rows
    behind them are never judged.
    """

    def test_the_seasons_end_takes_every_submitted_row(self):
        """Nothing narrower is right here: once the season is `past` this clock takes every one of them, confirmed or not."""

        assert CLOCK_FILTERS["season's end"] == {"saison_id": SAISON_ID, "status": "submitted"}

    def test_the_deadline_reads_the_unconfirmed_whose_day_has_passed(self):
        """The consent term matches a null record and a null stamp alike, which is what covers both stored shapes with one key."""

        assert CLOCK_FILTERS["deadline"] == {
            "saison_id": SAISON_ID,
            "status": "submitted",
            "einwilligung.confirmed_at": None,
            "confirmation.deadline": {"$lt": TODAY},
        }

    def test_the_decline_clock_reads_the_decisions_whose_days_are_behind_them(self):
        """Narrowed to the due ones, so a page of decisions still inside their days cannot fill the read ahead of one that is due."""

        assert CLOCK_FILTERS["decline"] == {
            "saison_id": SAISON_ID,
            "status": "declined",
            "decision.made_at": {"$lte": "2026-03-18"},
        }

    @pytest.mark.parametrize("clock", sorted(CLOCK_FILTERS))
    def test_every_clock_reads_one_season(self, clock: str):
        """The reads; the removals are held to the season by `tests/api/test_registrierung_sweep_execution.py :: TestTheDeadlineClock`."""

        assert CLOCK_FILTERS[clock]["saison_id"] == SAISON_ID
