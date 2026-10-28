from typing import Any, get_args

import pytest
from pydantic import ValidationError

from app.api.zustellung.schemas import (
    ZIELE_JE_SITZ,
    FLZustellungAbgewiesenPayload,
    FLZustellungAngenommenPayload,
    FLZustellungEreignisPayload,
    FLZustellungZiel,
)

ZIEL_OID = "6890a1b2c3d4e5f607970001"

FIRST_MESSAGE = "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"

LATER = "2026-03-29T11:00:00.000000+00:00"

# The first member of the Literal, so a member added later drives every case below rather than
# leaving them pinned to a target that moved.
ZIEL: FLZustellungZiel = get_args(FLZustellungZiel)[0]


def event_body(**overrides: Any) -> dict[str, Any]:
    return {
        "ziel": ZIEL,
        "ziel_id": ZIEL_OID,
        "rollen": [],
        "nachricht_id": FIRST_MESSAGE,
        "stand": "unzustellbar",
        "grund": "NoEmail",
        "am": LATER,
        **overrides,
    }


def abgewiesen_body(**overrides: Any) -> dict[str, Any]:
    """One refusal the provider gave at submit time: no message was minted, so the body names none."""

    return {"ziel": ZIEL, "ziel_id": ZIEL_OID, "rollen": [], "grund": "validation_error", "am": LATER, **overrides}


class TestThePayloads:
    def test_the_event_body_parses_and_normalises_its_stamp(self):
        parsed = FLZustellungEreignisPayload.model_validate(event_body(am="2026-03-29T11:00:00Z"))

        assert (parsed.ziel, parsed.stand, parsed.grund, parsed.am) == (ZIEL, "unzustellbar", "NoEmail", LATER)

    def test_a_kind_no_register_holds_is_refused(self):
        """A misfiling this endpoint could not otherwise see: the dispatch would raise on a key it has no row for."""

        with pytest.raises(ValidationError) as failure:
            FLZustellungEreignisPayload.model_validate(event_body(ziel="bewerbung"))

        assert [entry["loc"][-1] for entry in failure.value.errors()] == ["ziel"]

    def test_a_report_naming_no_row_is_refused(self):
        """A kind names a population and not a record, so a body without the id would apply the event to whichever row a caller guessed at."""

        with pytest.raises(ValidationError):
            FLZustellungEreignisPayload.model_validate({key: value for key, value in event_body().items() if key != "ziel_id"})

        with pytest.raises(ValidationError):
            FLZustellungEreignisPayload.model_validate(event_body(ziel_id="nicht-hex"))

    @pytest.mark.parametrize(
        ("ziel", "rollen"),
        [
            pytest.param(ZIEL, ["trainer"], id="seats named for a kind with one record per row"),
            pytest.param(next(iter(sorted(ZIELE_JE_SITZ))), [], id="no seat named for a seat kind"),
        ],
    )
    def test_a_report_naming_seats_its_kind_does_not_have_is_refused_on_each(self, ziel: FLZustellungZiel, rollen: list[str]):
        """Either would write nothing anybody meant: a seat a fixed carrier lacks, or no seat of a block holding three people."""

        for payload, body in (
            (FLZustellungEreignisPayload, event_body(ziel=ziel, rollen=rollen)),
            (
                FLZustellungAngenommenPayload,
                {key: value for key, value in event_body(ziel=ziel, rollen=rollen).items() if key not in ("stand", "grund")},
            ),
            (FLZustellungAbgewiesenPayload, abgewiesen_body(ziel=ziel, rollen=rollen)),
        ):
            with pytest.raises(ValidationError):
                payload.model_validate(body)

    def test_a_seat_kind_naming_its_seats_is_taken(self):
        """The control: the refusal above holds for a mismatch alone."""

        ziel = next(iter(sorted(ZIELE_JE_SITZ)))

        assert FLZustellungEreignisPayload.model_validate(event_body(ziel=ziel, rollen=["trainer", "ansprechperson"])).rollen == [
            "trainer",
            "ansprechperson",
        ]

    def test_a_report_omitting_the_seats_is_refused(self):
        """A KEY on every kind, so an omitted one reads as a client that forgot it rather than a report about no seat."""

        with pytest.raises(ValidationError) as failure:
            FLZustellungEreignisPayload.model_validate({key: value for key, value in event_body().items() if key != "rollen"})

        assert [entry["loc"][-1] for entry in failure.value.errors()] == ["rollen"]

    def test_an_undeclared_key_is_refused_on_each(self):
        for payload, body in (
            (FLZustellungEreignisPayload, event_body()),
            (FLZustellungAngenommenPayload, {key: value for key, value in event_body().items() if key not in ("stand", "grund")}),
            (FLZustellungAbgewiesenPayload, abgewiesen_body()),
        ):
            with pytest.raises(ValidationError) as failure:
                payload.model_validate({**body, "erfundenes_feld": "x"})

            assert "extra_forbidden" in {entry["type"] for entry in failure.value.errors()}

    def test_the_accepted_send_declares_no_state_of_its_own(self):
        """`angenommen` is the endpoint's, not the caller's: a body naming a state could record a refusal as an accept."""

        with pytest.raises(ValidationError):
            FLZustellungAngenommenPayload.model_validate(event_body())

    def test_the_refused_send_names_no_message(self):
        """Nothing was minted for a send the provider turned away, so a body carrying an id would name a message no event can be about."""

        with pytest.raises(ValidationError) as failure:
            FLZustellungAbgewiesenPayload.model_validate(abgewiesen_body(nachricht_id=FIRST_MESSAGE))

        assert "extra_forbidden" in {entry["type"] for entry in failure.value.errors()}

    def test_the_refused_send_declares_no_state_of_its_own(self):
        """The refused state is the endpoint's: a body naming one could file a complaint against an address that merely failed to parse."""

        with pytest.raises(ValidationError):
            FLZustellungAbgewiesenPayload.model_validate(abgewiesen_body(stand="beschwerde"))

    def test_the_refused_send_parses_and_normalises_its_stamp(self):
        parsed = FLZustellungAbgewiesenPayload.model_validate(abgewiesen_body(am="2026-03-29T11:00:00Z"))

        assert (parsed.ziel, parsed.grund, parsed.am) == (ZIEL, "validation_error", LATER)

    def test_an_event_may_not_claim_the_accept(self):
        with pytest.raises(ValidationError) as failure:
            FLZustellungEreignisPayload.model_validate(event_body(stand="angenommen"))

        assert [entry["loc"][-1] for entry in failure.value.errors()] == ["stand"]

    @pytest.mark.parametrize(
        "grund",
        [
            pytest.param("MailboxFull\nBcc: someone@example.com", id="a break forging a header line"),
            pytest.param("x" * 129, id="past the ceiling"),
        ],
    )
    def test_the_provider_token_is_single_line_and_bounded(self, grund: str):
        """It arrives from outside and is rendered beside a German sentence; the prose it is taken from names the recipient.

        Both homes of the token, so one screen cannot be widened alone.
        """

        for payload, body in (
            (FLZustellungEreignisPayload, event_body(grund=grund)),
            (FLZustellungAbgewiesenPayload, abgewiesen_body(grund=grund)),
        ):
            with pytest.raises(ValidationError):
                payload.model_validate(body)

    def test_a_state_carrying_no_token_is_a_null_rather_than_an_omitted_key(self):
        for payload, body in ((FLZustellungEreignisPayload, event_body), (FLZustellungAbgewiesenPayload, abgewiesen_body)):
            assert payload.model_validate(body(grund=None)).grund is None

            with pytest.raises(ValidationError) as failure:
                payload.model_validate({key: value for key, value in body().items() if key != "grund"})

            assert [entry["loc"][-1] for entry in failure.value.errors()] == ["grund"]

    def test_a_value_naming_no_instant_is_refused(self):
        """The ordering is the whole of the idempotency, so a stamp naming no moment orders against nothing."""

        with pytest.raises(ValidationError):
            FLZustellungEreignisPayload.model_validate(event_body(am="2026-03-29"))
