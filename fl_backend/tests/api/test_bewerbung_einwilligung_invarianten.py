from collections.abc import Mapping
from typing import Any

import pytest
from pydantic import ValidationError

from app.api.bewerbungen.schemas import (
    FLBewerbungEinwilligungAntwortPayload,
    refuse_age_outside_the_bounds,
)
from app.api.bewerbungen.services import (
    ausstehende_seats,
    compose_decline_update,
    find_expired_token_refusal,
    hash_token,
    paired_seat,
    saison_kontakt_seite,
    seat_opens_nobody,
    zustand_of,
)
from app.api.kontakte.services import build_clearing_update
from app.core.codes import Code
from app.shared.schemas.bestaetigung import FLTokenPayload
from app.shared.schemas.bounds import (
    BEWERBUNG_TOKEN_MAX_LENGTH,
)
from app.shared.schemas.literals import KONTAKT_ROLLEN
from tests.documents import kontaktperson_document, minted_bestaetigungen

TODAY = "2026-04-01"


def written(update: Mapping[str, Any]) -> Mapping[str, Any]:
    return update["$set"]


class TestASlotAndItsBookkeepingMoveTogether:
    """A null `kontakte` slot beside a live `bestaetigungen` entry is a seat the confirmation would `$set` under a null parent.

    Nothing else empties a slot, so these two composers are where that state would come from.
    """

    @pytest.mark.parametrize("seats", [("trainer",), ("trainer", "ansprechperson"), KONTAKT_ROLLEN])
    def test_a_decline_stamps_the_entry_of_every_seat_it_empties(self, seats: tuple[str, ...]):
        update = written(compose_decline_update(seats=seats, today=TODAY))

        for seat in seats:
            assert update[f"kontakte.{seat}"] is None
            assert update[f"bestaetigungen.{seat}.abgelehnt_am"] == TODAY

    @pytest.mark.parametrize("slots", [("trainer",), ("trainer", "ansprechperson"), KONTAKT_ROLLEN])
    def test_an_erasure_over_an_application_nulls_the_entry_beside_every_slot(self, slots: tuple[str, ...]):
        update = written(build_clearing_update(slots, bestaetigungen=True))

        for slot in slots:
            assert update[f"kontakte.{slot}"] is None
            assert update[f"bestaetigungen.{slot}"] is None

    def test_an_erasure_finding_no_block_moves_no_bookkeeping(self):
        """The flag's other side: a junction row no link was minted for has no entry to null."""

        update = written(build_clearing_update(KONTAKT_ROLLEN))

        assert set(update) == {f"kontakte.{slot}" for slot in KONTAKT_ROLLEN}


YESTERDAY = "2026-03-31"
TOMORROW = "2026-04-02"

# Fixed rather than minted, so a case names the same hash every run; the raw values are never
# needed here, only what the database would hold.
HASHES: Mapping[str, str] = {seat: hash_token(f"raw-{seat}") for seat in KONTAKT_ROLLEN}
BESTAETIGUNGEN: Mapping[str, Any] = minted_bestaetigungen(hashes=HASHES, today=TODAY)


def kontakte(**overrides: Any) -> dict[str, Any]:
    return {
        "trainer": kontaktperson_document("Quillhilde"),
        "ansprechperson": kontaktperson_document("Ansgar"),
        "stellvertretung": kontaktperson_document("Stellan"),
        "trainer_ist_zugleich": None,
        **overrides,
    }


def application(**overrides: Any) -> dict[str, Any]:
    """One stored application inside its deadline, every seat open, that each case moves one thing of."""

    return {
        "status": "eingereicht",
        "saison_id": "2026",
        "schule": {"team_name": "Zorbanax"},
        "team_id": None,
        "kontakte": kontakte(),
        "bestaetigungsfrist": TOMORROW,
        "bestaetigungen": minted_bestaetigungen(hashes=HASHES, today="2026-03-20"),
        **overrides,
    }


class TestWhatAReopenedLinkShows:
    """`zustand`: the ban outranks a stamp, which outranks a decline, which outranks the deadline, which outranks nothing."""

    @pytest.mark.parametrize(
        ("stored", "zustand"),
        [
            pytest.param(application(), "gueltig", id="open, inside the deadline"),
            pytest.param(
                application(kontakte=kontakte(trainer=kontaktperson_document("Quillhilde", bestaetigt_am=YESTERDAY))),
                "bestaetigt",
                id="confirmed",
            ),
            pytest.param(
                application(
                    kontakte=kontakte(trainer=None),
                    bestaetigungen={
                        **minted_bestaetigungen(hashes=HASHES, today=TODAY),
                        "trainer": {**minted_bestaetigungen(hashes=HASHES, today=TODAY)["trainer"], "abgelehnt_am": YESTERDAY},
                    },
                ),
                "abgelehnt",
                id="declined",
            ),
            pytest.param(application(bestaetigungsfrist=YESTERDAY), "abgelaufen", id="the deadline passed"),
            pytest.param(application(status="abgelehnt"), "abgelaufen", id="decided by the triage while open"),
            pytest.param(
                application(status="angenommen", kontakte=kontakte(trainer=kontaktperson_document("Quillhilde", bestaetigt_am=YESTERDAY))),
                "bestaetigt",
                id="confirmed, then accepted",
            ),
        ],
    )
    def test_each_state_reads_as_the_page_expects(self, stored: Mapping[str, Any], zustand: str):
        assert zustand_of(bewerbung_raw=stored, seat="trainer", today=TODAY, gesperrt=False) == zustand
        # Whatever became of the link, a barred person's page shows the ban and nothing else.
        assert zustand_of(bewerbung_raw=stored, seat="trainer", today=TODAY, gesperrt=True) == "gesperrt"


class TestWhatALinkAnswers:
    def test_a_decided_application_past_its_deadline_is_spent_rather_than_owed_a_fresh_link(self):
        """The decision is judged before the deadline, so nobody is told a re-send would reopen what nothing undoes."""

        refusal = find_expired_token_refusal(bestaetigungsfrist=YESTERDAY, status="angenommen", today=TODAY)

        assert refusal is not None
        assert refusal.error_code == Code.LINK_ABGELAUFEN

    def test_a_closed_season_rows_link_to_an_emptied_seat_opens_nobody(self):
        """Told apart, the page would tell a guess that someone once sat there, and offer a press the single use refuses."""

        assert seat_opens_nobody(slot=None, zustand="saison_vorbei") is True

    def test_a_season_row_seat_an_administrator_filled_opens_the_season_rows_page(self):
        """The view and the answer agree on whatever this names, so a wrong page is consented to and stored with no refusal."""

        row = {"kontakte": {"trainer": kontaktperson_document("Quillhilde", eingetragen_von="liga")}}

        assert saison_kontakt_seite(row=row, seat="trainer") == "bestaetigung_kontakt_saison"

    def test_a_person_reaching_the_seats_floor_today_may_confirm(self):
        """The floor to the day: a contact person sixteen today is refused under a sentence saying they must be sixteen."""

        assert refuse_age_outside_the_bounds(geburtsdatum="2010-04-01", today=TODAY, mindestalter=16) is None


class TestTheSeatsStillOpen:
    def test_every_seat_is_open_at_submission(self):
        assert ausstehende_seats(kontakte=kontakte()) == list(KONTAKT_ROLLEN)

    def test_a_confirmed_seat_leaves_the_list_and_the_order_stands(self):
        assert ausstehende_seats(kontakte=kontakte(ansprechperson=kontaktperson_document("Ansgar", bestaetigt_am=TODAY))) == [
            "trainer",
            "stellvertretung",
        ]

    def test_an_emptied_slot_still_counts(self):
        """A decline or an erasure leaves the application unable to complete, which is what this list tells the page."""

        assert "trainer" in ausstehende_seats(kontakte=kontakte(trainer=None))


class TestThePairedSeat:
    """The double-seated Trainer: one click answers for the person, whichever of their two links they opened."""

    def test_no_pairing_where_the_form_named_none(self):
        assert paired_seat(kontakte=kontakte(), bestaetigungen=BESTAETIGUNGEN, seat="trainer") is None

    @pytest.mark.parametrize("zugleich", ["ansprechperson", "stellvertretung"])
    def test_the_pairing_reads_in_both_directions(self, zugleich: str):
        block = kontakte(trainer_ist_zugleich=zugleich)

        assert paired_seat(kontakte=block, bestaetigungen=BESTAETIGUNGEN, seat="trainer") == zugleich
        assert paired_seat(kontakte=block, bestaetigungen=BESTAETIGUNGEN, seat=zugleich) == "trainer"

    def test_the_third_seat_is_nobodys_pair(self):
        block = kontakte(trainer_ist_zugleich="ansprechperson")

        assert paired_seat(kontakte=block, bestaetigungen=BESTAETIGUNGEN, seat="stellvertretung") is None


def antwort(**overrides: Any) -> dict[str, Any]:
    return {
        "token": "raw-trainer",
        "antwort": "erteilt",
        "geburtsdatum": "1984-05-09",
        "whatsapp": False,
        "medien": False,
        "text_version": "v4",
        **overrides,
    }


class TestWhatTheAnswerPayloadRefuses:
    """Shape rules about the body, all 422: the person answered, and a field contradicts the answer."""

    def test_the_corpus_this_class_moves_one_field_of_is_valid(self):
        assert FLBewerbungEinwilligungAntwortPayload.model_validate(antwort()).antwort == "erteilt"
        assert FLBewerbungEinwilligungAntwortPayload.model_validate(antwort(antwort="abgelehnt", geburtsdatum=None)).geburtsdatum is None

    def test_a_consent_without_a_date_is_refused(self):
        with pytest.raises(ValidationError, match="Geburtsdatum"):
            FLBewerbungEinwilligungAntwortPayload.model_validate(antwort(geburtsdatum=None))

    def test_a_decline_carrying_a_date_is_refused(self):
        """A decline stores no person, so a date sent with one would be a value nothing writes and nobody asked for."""

        with pytest.raises(ValidationError, match="Widerspruch"):
            FLBewerbungEinwilligungAntwortPayload.model_validate(antwort(antwort="abgelehnt"))

    def test_a_decline_carrying_a_whatsapp_consent_is_refused(self):
        """Taken, it would echo a scope back to the page that the emptied slot records nowhere."""

        with pytest.raises(ValidationError, match="WhatsApp"):
            FLBewerbungEinwilligungAntwortPayload.model_validate(antwort(antwort="abgelehnt", geburtsdatum=None, whatsapp=True))

    def test_a_decline_refusing_the_switch_is_taken(self):
        """The pair above only means something beside this: a rule refusing both answers refuses the decline outright."""

        payload = FLBewerbungEinwilligungAntwortPayload.model_validate(antwort(antwort="abgelehnt", geburtsdatum=None, whatsapp=False))

        assert (payload.antwort, payload.whatsapp) == ("abgelehnt", False)

    @pytest.mark.parametrize("field", ["geburtsdatum", "whatsapp", "medien", "text_version", "antwort"])
    def test_every_field_is_required(self, field: str, assert_rejects):
        body = antwort()
        del body[field]

        assert_rejects(FLBewerbungEinwilligungAntwortPayload, body, field)

    @pytest.mark.parametrize("model", [FLTokenPayload, FLBewerbungEinwilligungAntwortPayload])
    def test_a_token_past_the_bound_is_refused_and_one_at_it_taken(self, model: type, assert_rejects):
        body = antwort() if model is FLBewerbungEinwilligungAntwortPayload else {"token": ""}

        assert_rejects(model, {**body, "token": "t" * (BEWERBUNG_TOKEN_MAX_LENGTH + 1)}, "token")
        assert model.model_validate({**body, "token": "t" * BEWERBUNG_TOKEN_MAX_LENGTH}).token == "t" * BEWERBUNG_TOKEN_MAX_LENGTH

    def test_an_undeclared_key_is_refused(self):
        with pytest.raises(ValidationError) as failure:
            FLTokenPayload.model_validate({"token": "raw", "seat": "trainer"})

        assert [entry["type"] for entry in failure.value.errors()] == ["extra_forbidden"]
