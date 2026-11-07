"""
API · what a referee's link serves a caller holding nothing but the token

The token is the whole credential, and a leaked one reaches whoever holds it, so the two base-tier answers carry nothing
of the entry: a field added to either reaches a stranger with nothing failing.
"""

from collections.abc import Mapping

import pytest

from app.api.schiedsrichter.schemas import FLSchiedsrichterConfirmationResponse, FLSchiedsrichterConfirmationViewResponse
from app.api.schiedsrichter.services import answered_at_of, state_of


class TestWhatALeakedLinkLearns:
    """`READ-REFEREE-002`: no name, and no field the admin tier holds."""

    def test_the_view_declares_exactly_the_six_names_it_may_answer(self):
        """An EQUALITY, not a subset: a field added to this model reaches a caller holding nothing but a token."""

        assert set(FLSchiedsrichterConfirmationViewResponse.model_fields) == {
            "state",
            "minimum_age",
            "maximum_age",
            "media_minimum_age",
            "deadline",
            "answered_at",
        }

    @pytest.mark.parametrize(
        ("einwilligung", "declined_at", "answered_at"),
        [
            ({"confirmed_at": "2026-03-02"}, None, "2026-03-02"),
            (None, "2026-03-03", "2026-03-03"),
            (None, None, None),
        ],
        ids=["confirmed", "declined", "unanswered"],
    )
    def test_the_view_names_the_day_of_the_answer_its_state_shows_and_no_other(
        self, einwilligung: Mapping[str, str] | None, declined_at: str | None, answered_at: str | None
    ):
        confirmation = {"deadline": "2026-04-15", "declined_at": declined_at}
        state = state_of(einwilligung=einwilligung, confirmation=confirmation, today="2026-04-01")

        assert answered_at_of(state=state, einwilligung=einwilligung, confirmation=confirmation) == answered_at

    def test_the_answer_declares_exactly_what_the_press_echoes(self):
        """The same equality on the press's answer, which the same token holder reads."""

        assert set(FLSchiedsrichterConfirmationResponse.model_fields) == {"scope", "media", "confirmed_at"}
