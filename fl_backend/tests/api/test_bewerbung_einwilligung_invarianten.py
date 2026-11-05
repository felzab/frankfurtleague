from collections.abc import Mapping
from typing import Any

import pytest
from pydantic import TypeAdapter, ValidationError

from app.api.bewerbungen.schemas import (
    FLBewerbungEinwilligungAntwortPayload,
    FLBewerbungEinwilligungDeclined,
    FLBewerbungEinwilligungGiven,
)
from app.api.bewerbungen.services import (
    ausstehende_seats,
    compose_decline_update,
    paired_seat,
)
from app.api.kontakte.services import build_clearing_update
from app.shared.schemas.literals import KONTAKT_ROLLEN
from app.shared.tokens import hash_token
from tests.documents import SEAT_TEXT_VERSIONS, kontaktperson_document, minted_confirmations

TODAY = "2026-04-01"


def written(update: Mapping[str, Any]) -> Mapping[str, Any]:
    return update["$set"]


class TestASlotAndItsBookkeepingMoveTogether:
    """A null `kontakte` slot beside a live `confirmations` entry is a seat the confirmation would `$set` under a null parent.

    Nothing else empties a slot, so these two composers are where that state would come from.
    """

    @pytest.mark.parametrize("seats", [("trainer",), ("trainer", "ansprechperson"), KONTAKT_ROLLEN])
    def test_a_decline_stamps_the_entry_of_every_seat_it_empties(self, seats: tuple[str, ...]):
        update = written(compose_decline_update(seats=seats, today=TODAY, angekuendigt=False))

        for seat in seats:
            assert update[f"kontakte.{seat}"] is None
            assert update[f"confirmations.{seat}.declined_at"] == TODAY

    @pytest.mark.parametrize("slots", [("trainer",), ("trainer", "ansprechperson"), KONTAKT_ROLLEN])
    def test_an_loeschung_over_an_application_nulls_the_entry_beside_every_slot(self, slots: tuple[str, ...]):
        update = written(build_clearing_update(slots, confirmations=True))

        for slot in slots:
            assert update[f"kontakte.{slot}"] is None
            assert update[f"confirmations.{slot}"] is None


# Fixed rather than minted, so a case names the same hash every run; the raw values are never
# needed here, only what the database would hold.
HASHES: Mapping[str, str] = {seat: hash_token(f"raw-{seat}") for seat in KONTAKT_ROLLEN}
BESTAETIGUNGEN: Mapping[str, Any] = minted_confirmations(hashes=HASHES, today=TODAY)


def kontakte(**overrides: Any) -> dict[str, Any]:
    return {
        "trainer": kontaktperson_document("Quillhilde"),
        "ansprechperson": kontaktperson_document("Ansgar"),
        "stellvertretung": kontaktperson_document("Stellan"),
        "trainer_is_also": None,
        **overrides,
    }


class TestTheSeatsStillOpen:
    def test_every_seat_is_open_at_submission(self):
        assert ausstehende_seats(kontakte=kontakte()) == list(KONTAKT_ROLLEN)

    def test_a_confirmed_seat_leaves_the_list_and_the_order_stands(self):
        assert ausstehende_seats(kontakte=kontakte(ansprechperson=kontaktperson_document("Ansgar", confirmed_at=TODAY))) == [
            "trainer",
            "stellvertretung",
        ]

    def test_an_emptied_slot_still_counts(self):
        """A decline or an erasure leaves the application unable to complete, which is what this list tells the page."""

        assert "trainer" in ausstehende_seats(kontakte=kontakte(trainer=None))


class TestThePairedSeat:
    """The double-seated Trainer: one click answers for the person, whichever of their two links they opened."""

    def test_no_pairing_where_the_form_named_none(self):
        assert paired_seat(kontakte=kontakte(), confirmations=BESTAETIGUNGEN, seat="trainer") is None

    @pytest.mark.parametrize("zugleich", ["ansprechperson", "stellvertretung"])
    def test_the_pairing_reads_in_both_directions(self, zugleich: str):
        block = kontakte(trainer_is_also=zugleich)

        assert paired_seat(kontakte=block, confirmations=BESTAETIGUNGEN, seat="trainer") == zugleich
        assert paired_seat(kontakte=block, confirmations=BESTAETIGUNGEN, seat=zugleich) == "trainer"

    def test_the_third_seat_is_nobodys_pair(self):
        block = kontakte(trainer_is_also="ansprechperson")

        assert paired_seat(kontakte=block, confirmations=BESTAETIGUNGEN, seat="stellvertretung") is None


def antwort(**overrides: Any) -> dict[str, Any]:
    return {
        "token": "raw-trainer",
        "antwort": "given",
        "geburtsdatum": "1984-05-09",
        "whatsapp": False,
        "media": False,
        "text_versions": dict(SEAT_TEXT_VERSIONS),
        **overrides,
    }


ANTWORT: TypeAdapter[FLBewerbungEinwilligungGiven | FLBewerbungEinwilligungDeclined] = TypeAdapter(FLBewerbungEinwilligungAntwortPayload)


def refusals(body: dict[str, Any]) -> list[tuple[tuple[Any, ...], str]]:
    with pytest.raises(ValidationError) as failure:
        ANTWORT.validate_python(body)

    return [(error["loc"], error["type"]) for error in failure.value.errors()]


class TestWhatTheAnswerPayloadRefuses:
    """The answer's two shapes, told apart by `antwort`: each refusal is 422, at the tag and the field it names."""

    def test_a_consent_without_a_date_is_refused(self):
        body = antwort()
        del body["geburtsdatum"]

        assert refusals(body) == [(("given", "geburtsdatum"), "missing")]

    @pytest.mark.parametrize("field", ["geburtsdatum", "whatsapp", "media", "text_versions", "antwort"])
    def test_every_field_is_required(self, field: str, assert_rejects):
        body = antwort()
        del body[field]

        assert_rejects(FLBewerbungEinwilligungGiven, body, field)
