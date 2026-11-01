from collections.abc import Mapping
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from app.api.schiedsrichter.schemas import (
    FLSchiedsrichterConfirmationPayload,
    FLSchiedsrichterConfirmationResponse,
    FLSchiedsrichterConfirmationViewResponse,
    FLSchiedsrichterMint,
)
from app.api.schiedsrichter.services import (
    BESTAETIGUNG_ANSICHT_FIELDS,
    BESTAETIGUNG_ANTWORT_FIELDS,
    BESTAETIGUNG_FELD,
    EINWILLIGUNG_FELD,
    bestaetigung_frist_from,
    build_token_filter,
    compose_bestaetigung,
    compose_confirmation_update,
    compose_einwilligung,
    find_alter_refusal,
    find_expired_token_refusal,
    vorname_of,
    zustand_of,
)
from app.shared.schemas.bounds import (
    BEWERBUNG_TOKEN_MAX_LENGTH,
)
from app.shared.schemas.confirmation import FLTokenPayload
from app.shared.tokens import hash_token, mint_token

TODAY = "2026-04-01"
# The confirmation's instant on `TODAY`, as `app/core/recording.py :: log_stamp` spells one.
CONFIRMED_AT = "2026-04-01T10:30:00+00:00"
YESTERDAY = "2026-03-31"

RAW_TOKEN = "raw-token-for-one-referee"
TOKEN_HASH = hash_token(RAW_TOKEN)

AN_ADULTS_BIRTHDATE = "1984-05-09"

LIVE_BLOCK: Mapping[str, Any] = {**compose_bestaetigung(today=TODAY), "token_hashes": [TOKEN_HASH]}


def confirmed(*, confirmed_at: str = TODAY) -> dict[str, Any]:
    return {**compose_einwilligung(umfang="intern", medien=False, text_version="v1", today=TODAY), "confirmed_at": confirmed_at}


class TestTheStoredBlock:
    def test_the_deadline_is_the_bound_counted_from_the_mint(self):
        assert bestaetigung_frist_from(today=TODAY) == "2026-04-15"
        assert LIVE_BLOCK["frist"] == bestaetigung_frist_from(today=TODAY)

    def test_a_fresh_mint_chases_nobody_and_carries_no_delivery_state(self):
        assert LIVE_BLOCK["reminded_at"] is None
        assert "delivery" not in LIVE_BLOCK

    def test_the_lookup_is_the_hash_alone(self):
        """No `inactive_since` term: a person retired after the mint still owns the answer they give."""

        assert build_token_filter(token_hash=TOKEN_HASH) == {f"{BESTAETIGUNG_FELD}.token_hashes": TOKEN_HASH}


class TestTheRecordTheConfirmationWrites:
    def test_it_is_one_set_carrying_the_birthdate_and_the_record(self):
        """One write and never two: between them the row would hold a birthdate nobody had yet consented to the league keeping."""

        update = compose_confirmation_update(
            geburtsdatum=AN_ADULTS_BIRTHDATE, umfang="kader_oeffentlich", medien=True, text_version="v1", today=TODAY, am=CONFIRMED_AT
        )

        assert set(update) == {"$set"}
        assert set(update["$set"]) == {"geburtsdatum", EINWILLIGUNG_FELD}

    def test_the_record_is_born_with_each_choice_evidenced_by_the_confirmation(self):
        """Whole and never dotted: a dotted `$set` under the null block a live referee row stores aborts the transaction."""

        update = compose_confirmation_update(
            geburtsdatum=AN_ADULTS_BIRTHDATE, umfang="kader_oeffentlich", medien=True, text_version="v1", today=TODAY, am=CONFIRMED_AT
        )

        assert update["$set"][EINWILLIGUNG_FELD]["nachweis"] == {
            "umfang": {"am": CONFIRMED_AT, "text_version": "v1"},
            "medien": {"am": CONFIRMED_AT, "text_version": "v1"},
        }

    def test_the_record_carries_the_media_answer_even_when_it_is_off(self):
        """An off switch is an answer, so the key is stored rather than omitted for the model's default to supply."""

        assert compose_einwilligung(umfang="intern", medien=False, text_version="v1", today=TODAY)["medien"] is False

    def test_the_record_is_given_and_confirmed_in_one_press(self):
        """Nobody but the referee answers on their own link."""

        record = compose_einwilligung(umfang="intern", medien=False, text_version="v1", today=TODAY)

        assert record["datum"] == record["confirmed_at"] == TODAY


class TestWhatALeakedLinkLearns:
    """`READ-REFEREE-002`: no name, and no field the admin tier holds."""

    @pytest.mark.parametrize(
        ("projection", "asked_of_the_ban_list"),
        [(BESTAETIGUNG_ANSICHT_FIELDS, {"kontakt.email"}), (BESTAETIGUNG_ANTWORT_FIELDS, {"kontakt.email"})],
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
            "medien_minimum_age",
            "frist",
        }

    def test_the_answer_declares_exactly_what_the_press_echoes(self):
        """The same equality on the press's answer, which the same token holder reads."""

        assert set(FLSchiedsrichterConfirmationResponse.model_fields) == {"umfang", "medien", "confirmed_at"}

    @pytest.mark.parametrize("model", [FLSchiedsrichterConfirmationViewResponse, FLSchiedsrichterConfirmationResponse], ids=["view", "antwort"])
    def test_neither_base_tier_answer_carries_the_mint(self, model: type[BaseModel]):
        """The address a link was minted for is an administrator's fact, so neither anonymous reader embeds that model."""

        assert not {name for name, field in model.model_fields.items() if field.annotation is FLSchiedsrichterMint}
        assert "email" not in model.model_fields

    @pytest.mark.parametrize("projection", [BESTAETIGUNG_ANSICHT_FIELDS, BESTAETIGUNG_ANTWORT_FIELDS], ids=["view", "antwort"])
    def test_neither_projection_reaches_the_hash_the_filter_matched(self, projection: Mapping[str, int]):
        assert f"{BESTAETIGUNG_FELD}.token_hashes" not in projection

    def test_the_view_needs_no_key_to_patch_on(self):
        assert BESTAETIGUNG_ANSICHT_FIELDS["_id"] == 0
        assert BESTAETIGUNG_ANTWORT_FIELDS.get("_id", 1) == 1


@pytest.mark.parametrize(
    ("name", "vorname"),
    [("Pierluigi Collina", "Pierluigi"), ("  Quillhilde  ", "Quillhilde"), ("Anna Lena Bramblewick", "Anna"), (None, None), ("", None)],
)
def test_the_account_page_takes_the_first_part_of_the_stored_name(name: Any, vorname: str | None):
    assert vorname_of(name) == vorname


class TestWhatAReopenedLinkShows:
    @pytest.mark.parametrize(
        ("einwilligung", "confirmation", "state"),
        [
            (None, LIVE_BLOCK, "valid"),
            (None, {**LIVE_BLOCK, "frist": YESTERDAY}, "expired"),
            # The deadline's own day still answers: the mail names that day.
            (None, {**LIVE_BLOCK, "frist": TODAY}, "valid"),
            (confirmed(), LIVE_BLOCK, "confirmed"),
            # A stamp outranks the deadline: a person who answered on the last valid day is shown that they did.
            (confirmed(), {**LIVE_BLOCK, "frist": YESTERDAY}, "confirmed"),
        ],
        ids=["live", "over", "on-the-deadlines-day", "answered", "answered-then-over"],
    )
    def test_each_state_reads_as_the_page_expects(self, einwilligung: Any, confirmation: Any, state: str):
        """The ban outranks every one of them: a barred referee's page shows the ban and nothing else."""

        assert zustand_of(einwilligung=einwilligung, confirmation=confirmation, today=TODAY, barred=False) == state
        assert zustand_of(einwilligung=einwilligung, confirmation=confirmation, today=TODAY, barred=True) == "barred"


class TestALinkWhoseTimeIsOver:
    def test_the_deadlines_own_day_still_takes_the_answer(self):
        """The press as the view above reads it: a page offering the answer on that day and a press refusing it would lie."""

        assert find_expired_token_refusal(frist=TODAY, today=TODAY) is None


class TestTheTokenPayloadBound:
    def test_a_minted_token_fits_the_bound_both_endpoints_take(self):
        raw, _ = mint_token()

        assert len(raw) <= BEWERBUNG_TOKEN_MAX_LENGTH
        assert FLTokenPayload(token=raw).token == raw

    def test_a_token_past_the_bound_is_refused_before_a_read(self):
        with pytest.raises(ValidationError):
            FLTokenPayload(token="x" * (BEWERBUNG_TOKEN_MAX_LENGTH + 1))

    def test_the_media_answer_is_required_rather_than_defaulted(self):
        """A page omitting it would store the model's answer in place of the person's."""

        with pytest.raises(ValidationError):
            FLSchiedsrichterConfirmationPayload.model_validate(
                {"token": RAW_TOKEN, "geburtsdatum": AN_ADULTS_BIRTHDATE, "umfang": "intern", "text_version": "v1"}
            )


class TestTheAgeThisConsentAsks:
    def test_a_referee_reaching_the_floor_today_may_confirm(self):
        """The floor to the day: sixteen today is old enough, and refusing it tells the referee their date was wrong."""

        assert find_alter_refusal(geburtsdatum="2010-04-01", today=TODAY) is None


class TestTheDeadlineIsStoredRatherThanDerived:
    def test_the_block_holds_it_so_a_raised_bound_moves_no_link_already_sent(self):
        assert LIVE_BLOCK["frist"] != LIVE_BLOCK["sent_at"]
