from datetime import UTC, datetime
from typing import Any

import pytest
from pydantic import ValidationError

from app.api.bewerbungen.schemas import (
    FLBewerbungZustellungAngenommenPayload,
    FLBewerbungZustellungEreignisPayload,
    normalise_zustellzeitpunkt,
)

BEWERBUNG_ID = "6890a1b2c3d4e5f607970001"


STAMP = "2026-03-29T10:00:00.000000+00:00"
LATER = "2026-03-29T11:00:00.000000+00:00"

FIRST_MESSAGE = "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"


def event_body(**overrides: Any) -> dict[str, Any]:
    return {
        "bewerbung_id": BEWERBUNG_ID,
        "rollen": ["trainer"],
        "nachricht_id": FIRST_MESSAGE,
        "stand": "unzustellbar",
        "grund": "NoEmail",
        "am": LATER,
        **overrides,
    }


class TestTheStampIsOneSpelling:
    @pytest.mark.parametrize(
        "spelled",
        [
            pytest.param("2026-03-29T10:00:00Z", id="the Z the provider writes"),
            pytest.param("2026-03-29T10:00:00+00:00", id="an explicit zero offset"),
            pytest.param("2026-03-29 10:00:00.000000+00:00", id="a space between the halves"),
            pytest.param("2026-03-29T12:00:00+02:00", id="another offset naming the same moment"),
        ],
    )
    def test_every_spelling_of_one_moment_normalises_to_one_string(self, spelled: str):
        """The write condition is a string comparison, so two spellings of one instant would order as two."""

        assert normalise_zustellzeitpunkt(spelled) == STAMP

    def test_the_width_is_fixed_so_a_string_comparison_is_an_instant_comparison(self):
        """Sub-second precision at a VARYING width sorts `10:00:01` before `10:00:00.5`, which is the wrong way round."""

        whole = normalise_zustellzeitpunkt("2026-03-29T10:00:00Z")
        fraction = normalise_zustellzeitpunkt("2026-03-29T10:00:00.5Z")
        next_second = normalise_zustellzeitpunkt("2026-03-29T10:00:01Z")

        assert len(whole) == len(fraction) == len(next_second)
        assert whole < fraction < next_second

    @pytest.mark.parametrize(
        "spelled",
        [
            pytest.param("2026-03-29T10:00:00", id="no offset, so no instant"),
            pytest.param("2026-03-29", id="a date alone"),
            pytest.param("gestern Abend", id="not a timestamp at all"),
        ],
    )
    def test_a_value_naming_no_instant_is_refused(self, spelled: str):
        with pytest.raises(ValueError):
            normalise_zustellzeitpunkt(spelled)

    def test_the_stored_spelling_is_the_one_the_log_rows_carry(self):
        """One clock across the database: an operator reading a delivery state beside an action row compares two strings."""

        moment = datetime(2026, 3, 29, 12, 0, tzinfo=UTC)

        assert normalise_zustellzeitpunkt(moment.isoformat()) == moment.isoformat(timespec="microseconds")


class TestTheTwoPayloads:
    def test_the_event_body_parses_and_normalises_its_stamp(self):
        parsed = FLBewerbungZustellungEreignisPayload.model_validate(event_body(am="2026-03-29T11:00:00Z"))

        assert (parsed.stand, parsed.grund, parsed.am) == ("unzustellbar", "NoEmail", LATER)

    def test_an_undeclared_key_is_refused_on_both(self):
        for payload, body in (
            (FLBewerbungZustellungEreignisPayload, event_body()),
            (FLBewerbungZustellungAngenommenPayload, {key: value for key, value in event_body().items() if key not in ("stand", "grund")}),
        ):
            with pytest.raises(ValidationError) as failure:
                payload.model_validate({**body, "erfundenes_feld": "x"})

            assert "extra_forbidden" in {entry["type"] for entry in failure.value.errors()}

    def test_the_accepted_send_declares_no_state_of_its_own(self):
        """`angenommen` is the endpoint's, not the caller's: a body naming a state could record a refusal as an accept."""

        with pytest.raises(ValidationError):
            FLBewerbungZustellungAngenommenPayload.model_validate(event_body())

    def test_an_event_may_not_claim_the_accept(self):
        with pytest.raises(ValidationError) as failure:
            FLBewerbungZustellungEreignisPayload.model_validate(event_body(stand="angenommen"))

        assert [entry["loc"][-1] for entry in failure.value.errors()] == ["stand"]

    @pytest.mark.parametrize(
        "grund",
        [
            pytest.param("MailboxFull\nBcc: someone@example.com", id="a break forging a header line"),
            pytest.param("x" * 129, id="past the ceiling"),
        ],
    )
    def test_the_provider_token_is_single_line_and_bounded(self, grund: str):
        """It is rendered beside a German sentence, and it arrives from outside; the prose it is taken from names the recipient."""

        with pytest.raises(ValidationError):
            FLBewerbungZustellungEreignisPayload.model_validate(event_body(grund=grund))

    def test_a_state_carrying_no_token_is_a_null_rather_than_an_omitted_key(self):
        assert FLBewerbungZustellungEreignisPayload.model_validate(event_body(grund=None)).grund is None

        with pytest.raises(ValidationError) as failure:
            FLBewerbungZustellungEreignisPayload.model_validate({key: value for key, value in event_body().items() if key != "grund"})

        assert [entry["loc"][-1] for entry in failure.value.errors()] == ["grund"]

    def test_a_seat_no_application_has_is_refused_rather_than_stored(self):
        with pytest.raises(ValidationError) as failure:
            FLBewerbungZustellungEreignisPayload.model_validate(event_body(rollen=["hausmeister"]))

        assert [entry["loc"][0] for entry in failure.value.errors()] == ["rollen"]

    def test_an_event_naming_no_seat_parses_and_reaches_none(self):
        """The frontend route drops an untagged event before this endpoint; an empty list here writes nothing all the same."""

        assert FLBewerbungZustellungEreignisPayload.model_validate(event_body(rollen=[])).rollen == []
