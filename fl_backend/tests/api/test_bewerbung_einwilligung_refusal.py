from typing import Any, Mapping, get_args

import pytest
from pydantic import ValidationError

from app.api.bewerbungen.schemas import (
    FLBewerbungEinwilligungAnsichtPayload,
    FLBewerbungEinwilligungAntwortPayload,
    FLKontaktRolle,
    _whole_years_between,
    refuse_age_outside_the_bounds,
)
from app.api.bewerbungen.services import (
    BEWERBUNG_KONTAKT_ALTER,
    BEWERBUNG_SEAT_ALREADY_ANSWERED,
    BEWERBUNG_TOKEN_EXPIRED,
    BEWERBUNG_TOKEN_UNKNOWN,
    KONTAKT_SEATS,
    TOKEN_HASH_FIELDS,
    WITHOUT_TOKEN_HASHES,
    ausstehende_seats,
    bestaetigungsfrist_from,
    build_token_filter,
    compose_bestaetigungen,
    compose_confirmation_update,
    compose_decline_update,
    compose_erneut_update,
    find_already_answered_refusal,
    find_alter_refusal,
    find_expired_token_refusal,
    find_unknown_token_refusal,
    hash_token,
    mint_token,
    paired_seat,
    seat_holding,
    seat_named,
    zustand_of,
)
from app.api.kontakte.services import KONTAKT_SLOTS
from app.core.constraints import _BEWERBUNG_BESTAETIGUNG
from app.shared.schemas.bounds import BEWERBUNG_BESTAETIGUNG_FRIST_TAGE, BEWERBUNG_TOKEN_MAX_LENGTH

TODAY = "2026-04-01"
YESTERDAY = "2026-03-31"
TOMORROW = "2026-04-02"

# Fixed rather than minted, so a case names the same hash every run; the raw values are never
# needed here, only what the database would hold.
HASHES: Mapping[str, str] = {seat: hash_token(f"raw-{seat}") for seat in KONTAKT_SEATS}
BESTAETIGUNGEN: Mapping[str, Any] = compose_bestaetigungen(hashes=HASHES, today=TODAY)


def person(vorname: str, *, bestaetigt_am: str | None = None) -> dict[str, Any]:
    """One seat as the submission stored it, or as a confirmation left it."""

    return {
        "vorname": vorname,
        "nachname": "Brackenmoor",
        "email": f"{vorname.lower()}@example.com",
        "telefon": "+49 170 1234567",
        "geburtsdatum": None if bestaetigt_am is None else "1984-05-09",
        "einwilligung": {
            "umfang": "kontaktdaten",
            "erteilt_von": "administrativ" if bestaetigt_am is None else "person",
            "text_version": "v3",
            "datum": "2026-03-20",
            "bestaetigt_am": bestaetigt_am,
        },
    }


def kontakte(**overrides: Any) -> dict[str, Any]:
    return {
        "trainer": person("Quillhilde"),
        "ansprechperson": person("Ansgar"),
        "stellvertretung": person("Stellan"),
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
        "bestaetigungen": compose_bestaetigungen(hashes=HASHES, today="2026-03-20"),
        **overrides,
    }


class TestTheSeatSpellings:
    """Three spellings of one set, held equal: the wire's `Literal`, the erasure's derivation and the composer's tuple."""

    def test_the_literal_the_derivation_and_the_tuple_agree(self):
        assert get_args(FLKontaktRolle) == KONTAKT_SLOTS == KONTAKT_SEATS

    @pytest.mark.parametrize("value", [*KONTAKT_SEATS, "trainer_ist_zugleich", "", None, 7])
    def test_only_a_seat_is_named(self, value: Any):
        assert seat_named(value) == (value if value in KONTAKT_SEATS else None)


class TestTheTokenAndItsHash:
    def test_a_mint_yields_a_raw_token_and_the_hash_the_database_holds(self):
        raw, token_hash = mint_token()

        assert raw != token_hash
        assert token_hash == hash_token(raw)

    def test_two_mints_never_agree(self):
        """The floor under every unknown-token case: a mint that repeated itself would let one link open another seat."""

        assert mint_token()[0] != mint_token()[0]

    def test_the_raw_token_fits_the_payload_bound(self):
        assert len(mint_token()[0]) <= BEWERBUNG_TOKEN_MAX_LENGTH

    def test_the_lookup_asks_every_seat_and_no_status(self):
        """Both hash fields per seat, so a reminder's fresh link and the first one it replaced each still open the seat.

        No status term: a reopened link on a decided application shows its state rather than reading as unknown.
        """

        db_filter = build_token_filter(token_hash="abc")

        assert db_filter == {"$or": [{f"bestaetigungen.{seat}.{field}": "abc"} for seat in KONTAKT_SEATS for field in TOKEN_HASH_FIELDS]}

    def test_the_projection_names_every_seats_hash_and_excludes_it(self):
        """Read off the validator rather than off `TOKEN_HASH_FIELDS` alone.

        A third hash field declared there and forgotten in the tuple fails here; `0` per key, so any
        other field added to the block still reaches the read.
        """

        declared = sorted(field for field in _BEWERBUNG_BESTAETIGUNG["properties"] if field.startswith("token_hash"))

        assert declared == sorted(TOKEN_HASH_FIELDS)
        assert WITHOUT_TOKEN_HASHES == {f"bestaetigungen.{seat}.{field}": 0 for seat in KONTAKT_SEATS for field in declared}


class TestTheDeadline:
    def test_it_is_the_bound_counted_from_the_mint(self):
        assert bestaetigungsfrist_from(today="2026-12-25") == "2027-01-08"
        assert BEWERBUNG_BESTAETIGUNG_FRIST_TAGE == 14

    def test_the_block_carries_every_seat_with_its_four_keys(self):
        block = compose_bestaetigungen(hashes=HASHES, today=TODAY)

        assert set(block) == set(KONTAKT_SEATS)
        for seat in KONTAKT_SEATS:
            assert block[seat] == {"token_hash": HASHES[seat], "verschickt_am": TODAY, "erinnert_am": None, "abgelehnt_am": None}


class TestATokenNoSeatHolds:
    """`REQ-BEWERBUNG-009`: the one answer for unknown, replaced and deleted, because nothing tells them from a guess."""

    @pytest.mark.parametrize("seat", KONTAKT_SEATS)
    def test_a_hash_a_seat_holds_names_that_seat(self, seat: str):
        assert seat_holding(bewerbung_raw=application(), token_hash=HASHES[seat]) == seat
        assert find_unknown_token_refusal(seat=seat_named(seat)) is None

    @pytest.mark.parametrize(
        "bewerbung_raw",
        [
            pytest.param(application(), id="a hash no seat holds"),
            pytest.param(application(bestaetigungen=None), id="an application with no block"),
            pytest.param(
                application(bestaetigungen={"trainer": None, "ansprechperson": None, "stellvertretung": None}), id="every seat erased"
            ),
        ],
    )
    def test_a_hash_no_seat_holds_names_none_and_is_refused(self, bewerbung_raw: Mapping[str, Any]):
        seat = seat_holding(bewerbung_raw=bewerbung_raw, token_hash=hash_token("somebody-elses"))
        refusal = find_unknown_token_refusal(seat=seat)

        assert seat is None
        assert refusal is not None
        assert refusal.error_code == BEWERBUNG_TOKEN_UNKNOWN

    def test_the_refusal_names_no_application_and_no_seat(self):
        refusal = find_unknown_token_refusal(seat=None)

        assert refusal is not None
        assert "Zorbanax" not in refusal.message and "trainer" not in refusal.message


class TestALinkWhoseTimeIsOver:
    """`REQ-BEWERBUNG-010`: the deadline, and a decision taken while the seat stood open."""

    @pytest.mark.parametrize(
        ("bestaetigungsfrist", "status", "refused"),
        [
            pytest.param(TOMORROW, "eingereicht", False, id="inside the deadline"),
            pytest.param(TODAY, "eingereicht", False, id="on the deadline's own day"),
            pytest.param(YESTERDAY, "eingereicht", True, id="the day after the deadline"),
            pytest.param(None, "eingereicht", False, id="no deadline recorded"),
            pytest.param(TOMORROW, "angenommen", True, id="accepted meanwhile"),
            pytest.param(TOMORROW, "abgelehnt", True, id="declined by the triage meanwhile"),
        ],
    )
    def test_each_boundary_falls_where_the_rule_says(self, bestaetigungsfrist: str | None, status: str, refused: bool):
        """The deadline's own day still answers: the mail names the day, and a link dying at midnight before it lies."""

        refusal = find_expired_token_refusal(bestaetigungsfrist=bestaetigungsfrist, status=status, today=TODAY)

        assert (refusal is not None) == refused
        assert refusal is None or refusal.error_code == BEWERBUNG_TOKEN_EXPIRED


class TestASeatAlreadyAnswered:
    """`REQ-BEWERBUNG-011`: the single use. The stamps spend a link, never a nulled hash, so a reopened link can show its state."""

    def test_an_open_seat_with_its_bookkeeping_may_be_answered(self):
        """The floor: without it every case below would pass on a guard that refuses everything."""

        stored = application()

        assert find_already_answered_refusal(kontakte=stored["kontakte"], bestaetigungen=stored["bestaetigungen"], seat="trainer") is None

    @pytest.mark.parametrize(
        "stored",
        [
            pytest.param(application(kontakte=kontakte(trainer=person("Quillhilde", bestaetigt_am=YESTERDAY))), id="confirmed"),
            pytest.param(
                application(
                    bestaetigungen={
                        **compose_bestaetigungen(hashes=HASHES, today=TODAY),
                        "trainer": {**compose_bestaetigungen(hashes=HASHES, today=TODAY)["trainer"], "abgelehnt_am": YESTERDAY},
                    }
                ),
                id="declined",
            ),
            pytest.param(application(bestaetigungen=None), id="an application stored before the flow"),
            pytest.param(
                application(bestaetigungen={**compose_bestaetigungen(hashes=HASHES, today=TODAY), "trainer": None}),
                id="a seat an erasure emptied",
            ),
        ],
    )
    def test_a_seat_that_has_spoken_or_has_nothing_to_say_is_refused(self, stored: Mapping[str, Any]):
        refusal = find_already_answered_refusal(kontakte=stored["kontakte"], bestaetigungen=stored["bestaetigungen"], seat="trainer")

        assert refusal is not None
        assert refusal.error_code == BEWERBUNG_SEAT_ALREADY_ANSWERED

    def test_one_seats_answer_does_not_spend_the_others(self):
        stored = application(kontakte=kontakte(trainer=person("Quillhilde", bestaetigt_am=YESTERDAY)))

        assert (
            find_already_answered_refusal(kontakte=stored["kontakte"], bestaetigungen=stored["bestaetigungen"], seat="ansprechperson") is None
        )


class TestWholeYears:
    """The age arithmetic, pinned against a fixed pair of dates so the boundary is provable without a clock."""

    @pytest.mark.parametrize(
        ("born", "today", "years"),
        [
            pytest.param("2010-06-01", "2026-06-01", 16, id="the birthday itself"),
            pytest.param("2010-06-02", "2026-06-01", 15, id="the day before the birthday"),
            pytest.param("2010-05-31", "2026-06-01", 16, id="the day after"),
            pytest.param("2008-02-29", "2026-02-28", 17, id="a leap birthday, the year's 28th"),
            pytest.param("2008-02-29", "2026-03-01", 18, id="a leap birthday, the following day"),
        ],
    )
    def test_a_birthday_not_yet_reached_this_year_has_not_counted(self, born: str, today: str, years: int):
        """Off by one here and every person born in the second half of the year is judged a year older."""

        assert _whole_years_between(born=born, today=today) == years


# Exact ages against a fixed day, so both boundaries are pinned without a clock. Against `TODAY`,
# `2010-04-01` is 16 to the day and `1905-04-02` is the last date that is still 120.
AGE_BOUNDARIES = [
    pytest.param("2010-04-02", True, id="a day short of the floor, at 15"),
    pytest.param("2010-04-01", False, id="the floor, to the day"),
    pytest.param("2010-03-31", False, id="a day inside the floor"),
    pytest.param("1905-04-02", False, id="the ceiling, on its last day at 120"),
    pytest.param("1905-04-01", True, id="a day past the ceiling, at 121"),
]


class TestTheAgeAtConfirmation:
    """`REQ-BEWERBUNG-012`: the bound `refuse_age_outside_the_bounds` holds, reached as a 409 with its own German."""

    @pytest.mark.parametrize(("geburtsdatum", "refused"), AGE_BOUNDARIES)
    def test_each_boundary_falls_where_the_bound_says(self, geburtsdatum: str, refused: bool):
        """Move either comparison by one and a case here goes red; the endpoint cannot show that."""

        if not refused:
            assert refuse_age_outside_the_bounds(geburtsdatum=geburtsdatum, today=TODAY) is None
            return

        with pytest.raises(ValueError):
            refuse_age_outside_the_bounds(geburtsdatum=geburtsdatum, today=TODAY)

    def test_a_leap_birthday_reaches_the_floor_on_the_day_the_calendar_does(self):
        """Someone born on 29 February turns 16 the moment the date arrives, and is 15 the day before."""

        with pytest.raises(ValueError):
            refuse_age_outside_the_bounds(geburtsdatum="2012-02-29", today="2028-02-28")

        assert refuse_age_outside_the_bounds(geburtsdatum="2012-02-29", today="2028-02-29") is None
        assert refuse_age_outside_the_bounds(geburtsdatum="2012-02-29", today="2028-03-01") is None

    @pytest.mark.parametrize(("geburtsdatum", "refused"), AGE_BOUNDARIES)
    def test_the_refusal_carries_the_bound_and_the_code(self, geburtsdatum: str, refused: bool):
        refusal = find_alter_refusal(geburtsdatum=geburtsdatum, today=TODAY)

        assert (refusal is not None) == refused
        assert refusal is None or refusal.error_code == BEWERBUNG_KONTAKT_ALTER

    @pytest.mark.parametrize("bound", ["mindestens", "über"])
    def test_each_refusal_is_German(self, bound: str):
        """It surfaces on the confirmation page, so the message is what the person who typed the date reads."""

        born = "2020-01-01" if bound == "mindestens" else "1800-01-01"
        refusal = find_alter_refusal(geburtsdatum=born, today=TODAY)

        assert refusal is not None
        assert bound in refusal.message


class TestWhatAReopenedLinkShows:
    """`zustand`: a stamp outranks a decline, which outranks the deadline, which outranks nothing."""

    @pytest.mark.parametrize(
        ("stored", "zustand"),
        [
            pytest.param(application(), "gueltig", id="open, inside the deadline"),
            pytest.param(application(kontakte=kontakte(trainer=person("Quillhilde", bestaetigt_am=YESTERDAY))), "bestaetigt", id="confirmed"),
            pytest.param(
                application(
                    kontakte=kontakte(trainer=None),
                    bestaetigungen={
                        **compose_bestaetigungen(hashes=HASHES, today=TODAY),
                        "trainer": {**compose_bestaetigungen(hashes=HASHES, today=TODAY)["trainer"], "abgelehnt_am": YESTERDAY},
                    },
                ),
                "abgelehnt",
                id="declined",
            ),
            pytest.param(application(bestaetigungsfrist=YESTERDAY), "abgelaufen", id="the deadline passed"),
            pytest.param(application(status="abgelehnt"), "abgelaufen", id="decided by the triage while open"),
            pytest.param(
                application(status="angenommen", kontakte=kontakte(trainer=person("Quillhilde", bestaetigt_am=YESTERDAY))),
                "bestaetigt",
                id="confirmed, then accepted",
            ),
        ],
    )
    def test_each_state_reads_as_the_page_expects(self, stored: Mapping[str, Any], zustand: str):
        assert zustand_of(bewerbung_raw=stored, seat="trainer", today=TODAY) == zustand


class TestTheSeatsStillOpen:
    def test_every_seat_is_open_at_submission(self):
        assert ausstehende_seats(kontakte=kontakte()) == list(KONTAKT_SEATS)

    def test_a_confirmed_seat_leaves_the_list_and_the_order_stands(self):
        assert ausstehende_seats(kontakte=kontakte(ansprechperson=person("Ansgar", bestaetigt_am=TODAY))) == ["trainer", "stellvertretung"]

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


class TestWhatAConfirmationWrites:
    """One `$set` per answer, so `docs/backend/spec.md :: I141`'s pairing cannot land in halves."""

    def test_a_consent_writes_the_date_the_stamp_the_source_and_the_wording_together(self):
        update = compose_confirmation_update(seats=("trainer",), geburtsdatum="1984-05-09", today=TODAY, text_version="v4", whatsapp=False)

        assert update == {
            "$set": {
                "kontakte.trainer.geburtsdatum": "1984-05-09",
                "kontakte.trainer.einwilligung.bestaetigt_am": TODAY,
                "kontakte.trainer.einwilligung.erteilt_von": "person",
                "kontakte.trainer.einwilligung.text_version": "v4",
                "kontakte.trainer.einwilligung.umfang": "kontaktdaten",
            }
        }

    def test_the_whatsapp_tick_widens_the_scope_and_nothing_else(self):
        update = compose_confirmation_update(seats=("trainer",), geburtsdatum="1984-05-09", today=TODAY, text_version="v4", whatsapp=True)

        assert update["$set"]["kontakte.trainer.einwilligung.umfang"] == "kontaktdaten_whatsapp"

    def test_a_paired_seat_takes_every_key_the_first_does(self):
        update = compose_confirmation_update(
            seats=("trainer", "ansprechperson"), geburtsdatum="1984-05-09", today=TODAY, text_version="v4", whatsapp=False
        )

        assert {key.split(".")[1] for key in update["$set"]} == {"trainer", "ansprechperson"}
        assert len(update["$set"]) == 10

    def test_a_decline_empties_the_slot_and_marks_the_day_beside_it(self):
        assert compose_decline_update(seats=("trainer",), today=TODAY) == {
            "$set": {"kontakte.trainer": None, "bestaetigungen.trainer.abgelehnt_am": TODAY}
        }

    def test_a_resend_replaces_the_seats_bookkeeping_whole_and_restarts_the_deadline(self):
        update = compose_erneut_update(seat="trainer", token_hash="fresh", today=TODAY, bestaetigungsfrist="2026-04-15")

        assert update == {
            "$set": {
                "bestaetigungen.trainer": {"token_hash": "fresh", "verschickt_am": TODAY, "erinnert_am": None, "abgelehnt_am": None},
                "bestaetigungsfrist": "2026-04-15",
            }
        }


def antwort(**overrides: Any) -> dict[str, Any]:
    return {"token": "raw-trainer", "antwort": "erteilt", "geburtsdatum": "1984-05-09", "whatsapp": False, "text_version": "v4", **overrides}


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

        with pytest.raises(ValidationError, match="Ablehnung"):
            FLBewerbungEinwilligungAntwortPayload.model_validate(antwort(antwort="abgelehnt"))

    def test_a_decline_carrying_a_whatsapp_consent_is_refused(self):
        """Taken, it would echo a scope back to the page that the emptied slot records nowhere."""

        with pytest.raises(ValidationError, match="WhatsApp"):
            FLBewerbungEinwilligungAntwortPayload.model_validate(antwort(antwort="abgelehnt", geburtsdatum=None, whatsapp=True))

    def test_a_decline_refusing_the_switch_is_taken(self):
        """The pair above only means something beside this: a rule refusing both answers refuses the decline outright."""

        payload = FLBewerbungEinwilligungAntwortPayload.model_validate(antwort(antwort="abgelehnt", geburtsdatum=None, whatsapp=False))

        assert (payload.antwort, payload.whatsapp) == ("abgelehnt", False)

    @pytest.mark.parametrize("field", ["geburtsdatum", "whatsapp", "text_version", "antwort"])
    def test_every_field_is_required(self, field: str, assert_rejects):
        body = antwort()
        del body[field]

        assert_rejects(FLBewerbungEinwilligungAntwortPayload, body, field)

    @pytest.mark.parametrize("model", [FLBewerbungEinwilligungAnsichtPayload, FLBewerbungEinwilligungAntwortPayload])
    def test_a_token_past_the_bound_is_refused_and_one_at_it_taken(self, model: type, assert_rejects):
        body = antwort() if model is FLBewerbungEinwilligungAntwortPayload else {"token": ""}

        assert_rejects(model, {**body, "token": "t" * (BEWERBUNG_TOKEN_MAX_LENGTH + 1)}, "token")
        assert model.model_validate({**body, "token": "t" * BEWERBUNG_TOKEN_MAX_LENGTH}).token == "t" * BEWERBUNG_TOKEN_MAX_LENGTH

    def test_an_undeclared_key_is_refused(self):
        with pytest.raises(ValidationError) as failure:
            FLBewerbungEinwilligungAnsichtPayload.model_validate({"token": "raw", "seat": "trainer"})

        assert [entry["type"] for entry in failure.value.errors()] == ["extra_forbidden"]
