from typing import Any

import pytest

from app.api.registrierungen.services import confirmation_erasure_is_due, decline_erasure_is_due
from app.shared.tokens import hash_token
from tests.documents import SPIELER_TEXT_VERSIONS, own_einwilligung_document

TODAY = "2026-04-01"
YESTERDAY = "2026-03-31"
TOMORROW = "2026-04-02"

FIRST_HASH = hash_token("first")


def einwilligung() -> dict[str, Any]:
    return own_einwilligung_document(text_versions=SPIELER_TEXT_VERSIONS, confirmed_at=TODAY)


def confirmation(**overrides: Any) -> dict[str, Any]:
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
        "confirmation": confirmation(),
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
        stored = registrierung(confirmation=confirmation(deadline=deadline))

        assert confirmation_erasure_is_due(registrierung_raw=stored, today=TODAY) == due

    def test_a_confirmed_registration_waits_for_the_seasons_end_instead(self):
        """The clock's whole reach: a row nobody confirmed leaves at its deadline, and a confirmed one leaves with its season."""

        stored = registrierung(confirmation=confirmation(deadline=YESTERDAY), einwilligung=einwilligung())

        assert not confirmation_erasure_is_due(registrierung_raw=stored, today=TODAY)

    def test_a_declined_registration_is_the_decline_clocks(self):
        stored = registrierung(status="declined", confirmation=confirmation(deadline=YESTERDAY))

        assert not confirmation_erasure_is_due(registrierung_raw=stored, today=TODAY)

    def test_a_registration_stored_without_a_block_is_never_taken_by_this_clock(self):
        """A row with no readable deadline is held rather than destroyed: the date this clock counts from is the one thing it needs."""

        assert not confirmation_erasure_is_due(registrierung_raw=registrierung(confirmation=None), today=TODAY)


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

        assert decline_erasure_is_due(registrierung_raw=declined, today=TODAY) == due

    @pytest.mark.parametrize("status", ["submitted", "declined"])
    def test_a_decision_with_no_day_and_a_row_nobody_decided_are_both_left_standing(self, status: str):
        stored = registrierung(status=status, decision=None)

        assert not decline_erasure_is_due(registrierung_raw=stored, today=TODAY)
