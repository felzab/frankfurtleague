"""
API · what a referee's link serves a caller holding nothing but the token

The token is the whole credential, and a leaked one reaches whoever holds it, so the two base-tier answers carry nothing
of the entry: a field added to either reaches a stranger with nothing failing.
"""

from collections.abc import Mapping

import pytest

from app.api.schiedsrichter.schemas import FLSchiedsrichterConfirmationViewResponse
from app.api.schiedsrichter.services import answered_at_of, state_of
from tests.core.app_source import api_routes, application


class TestWhatALeakedLinkLearns:
    """No name, and no field the admin tier holds: a link is a stranger's to forward."""

    def test_the_view_declares_exactly_the_five_names_it_may_answer(self):
        """An EQUALITY, not a subset: a field added to this model reaches a caller holding nothing but a token."""

        assert set(FLSchiedsrichterConfirmationViewResponse.model_fields) == {
            "state",
            "minimum_age",
            "maximum_age",
            "deadline",
            "answered_at",
        }

    @pytest.mark.parametrize(
        ("einwilligung", "answered_at"),
        [({"confirmed_at": "2026-03-02"}, "2026-03-02"), (None, None)],
        ids=["confirmed", "unanswered"],
    )
    def test_the_view_names_the_day_of_the_answer_its_state_shows_and_no_other(
        self, einwilligung: Mapping[str, str] | None, answered_at: str | None
    ):
        state = state_of(einwilligung=einwilligung, confirmation={"deadline": "2026-04-15"}, today="2026-04-01")

        assert answered_at_of(state=state, einwilligung=einwilligung) == answered_at

    def test_the_press_answers_no_body(self):
        """The press's answer, which the same token holder reads, carries nothing: a model added to it is a field leaked."""

        (route,) = [
            route for route in api_routes(application()) if route.path == "/api/schiedsrichter/confirmation" and route.methods == {"POST"}
        ]

        assert (route.status_code, route.response_model) == (204, None)
