"""
API · what a referee's link serves a caller holding nothing but the token

The token is the whole credential, and a leaked one reaches whoever holds it, so the two base-tier answers and the
reads behind them carry nothing of the entry: a field added to either reaches a stranger with nothing failing.
"""

from collections.abc import Mapping

import pytest
from pydantic import BaseModel

from app.api.schiedsrichter.schemas import (
    FLSchiedsrichterConfirmationResponse,
    FLSchiedsrichterConfirmationViewResponse,
    FLSchiedsrichterMint,
)
from app.api.schiedsrichter.services import (
    CONFIRMATION_ANSWER_FIELDS,
    CONFIRMATION_FIELD,
    CONFIRMATION_VIEW_FIELDS,
)


class TestWhatALeakedLinkLearns:
    """`READ-REFEREE-002`: no name, and no field the admin tier holds."""

    @pytest.mark.parametrize(
        ("projection", "asked_of_the_ban_list"),
        [(CONFIRMATION_VIEW_FIELDS, {"kontakt.email"}), (CONFIRMATION_ANSWER_FIELDS, {"kontakt.email"})],
        ids=["view", "antwort"],
    )
    def test_neither_projection_reaches_a_field_behind_the_contact_rule(self, projection: Mapping[str, int], asked_of_the_ban_list: set[str]):
        """Both read the address for the ban list alone; `test_neither_base_tier_answer_carries_the_mint` keeps it off both answers."""

        withheld = {"name", "schule", "kontakt", "default_payment", "geburtsdatum", "inactive_since"}
        read = {key for key, kept in projection.items() if kept}

        assert asked_of_the_ban_list <= read
        assert not {key.partition(".")[0] for key in read - asked_of_the_ban_list} & withheld

    def test_the_view_declares_exactly_the_four_names_it_may_answer(self):
        """An EQUALITY, not a subset: a field added to this model reaches a caller holding nothing but a token."""

        assert set(FLSchiedsrichterConfirmationViewResponse.model_fields) == {
            "state",
            "minimum_age",
            "media_minimum_age",
            "frist",
        }

    def test_the_answer_declares_exactly_what_the_press_echoes(self):
        """The same equality on the press's answer, which the same token holder reads."""

        assert set(FLSchiedsrichterConfirmationResponse.model_fields) == {"scope", "media", "confirmed_at"}

    @pytest.mark.parametrize("model", [FLSchiedsrichterConfirmationViewResponse, FLSchiedsrichterConfirmationResponse], ids=["view", "antwort"])
    def test_neither_base_tier_answer_carries_the_mint(self, model: type[BaseModel]):
        """The address a link was minted for is an administrator's fact, so neither anonymous reader embeds that model."""

        assert not {name for name, field in model.model_fields.items() if field.annotation is FLSchiedsrichterMint}
        assert "email" not in model.model_fields

    @pytest.mark.parametrize("projection", [CONFIRMATION_VIEW_FIELDS, CONFIRMATION_ANSWER_FIELDS], ids=["view", "antwort"])
    def test_neither_projection_reaches_the_hash_the_filter_matched(self, projection: Mapping[str, int]):
        """A hash read here is one keystroke from an answer that serves it."""

        assert f"{CONFIRMATION_FIELD}.token_hashes" not in projection
