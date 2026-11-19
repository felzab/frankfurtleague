"""
API · what a referee's link serves a caller holding nothing but the token

The token is the whole credential, and a leaked one reaches whoever holds it, so the two base-tier answers carry nothing
of the entry: a field added to either reaches a stranger with nothing failing.
"""

from collections.abc import Mapping
from typing import get_args

import pytest
from pydantic import BaseModel

from app.api.schiedsrichter.schemas import (
    FLSchiedsrichterConfirmationViewConfirmed,
    FLSchiedsrichterConfirmationViewResponse,
    FLSchiedsrichterConfirmationViewValid,
)
from app.api.schiedsrichter.services import confirmation_view
from app.shared.schemas.bounds import BIRTH_DATE_MAX_AGE_YEARS, SCHIEDSRICHTER_MIN_AGE_YEARS
from tests.core.app_source import api_routes, application


class TestWhatALeakedLinkLearns:
    """No name, and no field the admin tier holds: a link is a stranger's to forward."""

    def test_each_state_of_the_view_declares_exactly_the_names_it_may_answer(self):
        """An EQUALITY, not a subset, over every member: a field or a member added reaches a caller holding nothing but a token."""

        (members, _) = get_args(FLSchiedsrichterConfirmationViewResponse)

        assert {member.__name__: set(member.model_fields) for member in get_args(members)} == {
            "FLSchiedsrichterConfirmationViewValid": {"state", "minimum_age", "maximum_age", "deadline"},
            "FLSchiedsrichterConfirmationViewConfirmed": {"state", "answered_at"},
            "FLSchiedsrichterConfirmationViewExpired": {"state"},
        }

    @pytest.mark.parametrize(
        ("einwilligung", "shown"),
        [
            (
                {"confirmed_at": "2026-03-02"},
                FLSchiedsrichterConfirmationViewConfirmed(state="confirmed", answered_at="2026-03-02"),
            ),
            (
                None,
                FLSchiedsrichterConfirmationViewValid(
                    state="valid", minimum_age=SCHIEDSRICHTER_MIN_AGE_YEARS, maximum_age=BIRTH_DATE_MAX_AGE_YEARS, deadline="2026-04-15"
                ),
            ),
        ],
        ids=["confirmed", "unanswered"],
    )
    def test_the_view_names_the_day_of_the_answer_its_state_shows(self, einwilligung: Mapping[str, str] | None, shown: BaseModel):
        assert confirmation_view(einwilligung=einwilligung, confirmation={"deadline": "2026-04-15"}, today="2026-04-01") == shown

    def test_the_press_answers_no_body(self):
        """The press's answer, which the same token holder reads, carries nothing: a model added to it is a field leaked."""

        (route,) = [
            route for route in api_routes(application()) if route.path == "/api/schiedsrichter/confirmation" and route.methods == {"POST"}
        ]

        assert (route.status_code, route.response_model) == (204, None)
