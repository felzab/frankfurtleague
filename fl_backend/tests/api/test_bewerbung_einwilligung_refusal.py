import inspect
from collections.abc import Mapping
from http import HTTPStatus
from typing import Any, get_args

import pytest
from pydantic import ValidationError

from app.api.bewerbungen.schemas import (
    FLBewerbungEinwilligungAnsichtPayload,
    FLBewerbungEinwilligungAntwortPayload,
    FLKontaktRolle,
    refuse_age_outside_the_bounds,
)
from app.api.bewerbungen.services import (
    BEWERBUNG_KONTAKT_ALTER,
    BEWERBUNG_KONTAKTE_UNCONFIRMED,
    BEWERBUNG_SEAT_ALREADY_ANSWERED,
    BEWERBUNG_TOKEN_DECIDED,
    BEWERBUNG_TOKEN_PAST_DEADLINE,
    BEWERBUNG_TOKEN_UNKNOWN,
    EINWILLIGUNG_ANSICHT_FIELDS,
    EINWILLIGUNG_ANTWORT_FIELDS,
    KONTAKT_SEATS,
    SEAT_MIN_AGE_YEARS,
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
    find_unconfirmed_kontakte_refusal,
    find_unknown_token_refusal,
    hash_token,
    mindestalter_for,
    mint_token,
    paired_seat,
    seat_holding,
    seat_named,
    zustand_of,
)
from app.api.kontakte.services import KONTAKT_SLOTS
from app.core.constraints import _BEWERBUNG_BESTAETIGUNG, _BEWERBUNG_BESTAETIGUNGEN
from app.shared.schemas.bounds import (
    BEWERBUNG_BESTAETIGUNG_FRIST_TAGE,
    BEWERBUNG_KONTAKT_MIN_AGE_YEARS,
    BEWERBUNG_TOKEN_MAX_LENGTH,
    VERTRETUNG_MIN_AGE_YEARS,
)
from tests.documents import kontaktperson_document

TODAY = "2026-04-01"
YESTERDAY = "2026-03-31"
TOMORROW = "2026-04-02"

# Fixed rather than minted, so a case names the same hash every run; the raw values are never
# needed here, only what the database would hold.
HASHES: Mapping[str, str] = {seat: hash_token(f"raw-{seat}") for seat in KONTAKT_SEATS}
BESTAETIGUNGEN: Mapping[str, Any] = compose_bestaetigungen(hashes=HASHES, today=TODAY)


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


PROJECTIONS = [
    pytest.param(EINWILLIGUNG_ANSICHT_FIELDS, id="the view's projection"),
    pytest.param(EINWILLIGUNG_ANTWORT_FIELDS, id="the answer's projection"),
]


def per_seat_paths(projection: Mapping[str, int]) -> list[tuple[str, str, str]]:
    """Each `<block>.<seat>.<leaf>` key parted in three.

    Selected by the key's SHAPE, never by `KONTAKT_SEATS`: a fourth seat drawn from that tuple would
    otherwise drop out of this population and pass.
    """

    parted = [key.split(".", 2) for key in projection if key.startswith(("bestaetigungen.", "kontakte."))]

    return [(key[0], key[1], key[2]) for key in parted if len(key) == 3]


class TestTheAnonymousProjectionsAreDerivedPerSeat:
    """Both projections read off the validator rather than off the tuples they are built from."""

    @pytest.mark.parametrize("projection", PROJECTIONS)
    def test_every_per_seat_path_names_every_seat_the_validator_declares(self, projection: Mapping[str, int]):
        """A seat declared on one side alone fails here, whichever side that is."""

        named: dict[tuple[str, str], set[str]] = {}
        for block, seat, leaf in per_seat_paths(projection):
            named.setdefault((block, leaf), set()).add(seat)
        declared = set(_BEWERBUNG_BESTAETIGUNGEN["properties"])

        assert named, "the projection names no seat at all"
        assert all(seats == declared for seats in named.values())

    @pytest.mark.parametrize("projection", PROJECTIONS)
    def test_every_hash_field_the_validator_declares_is_projected(self, projection: Mapping[str, int]):
        """A field the validator declares and `TOKEN_HASH_FIELDS` forgets leaves the link opening no seat."""

        declared = {field for field in _BEWERBUNG_BESTAETIGUNG["properties"] if field.startswith("token_hash")}
        projected = {leaf for block, _, leaf in per_seat_paths(projection) if block == "bestaetigungen"}

        assert declared
        assert declared <= projected


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
        assert "trainer" not in refusal.message
        # Nothing the refusal is handed can carry an application, so a parameter added to it is the leak.
        assert set(inspect.signature(find_unknown_token_refusal).parameters) == {"seat"}


class TestALinkWhoseTimeIsOver:
    """`REQ-BEWERBUNG-017`: the deadline, which a re-send restarts, so a 409 rather than a spent link."""

    @pytest.mark.parametrize(
        ("bestaetigungsfrist", "refused"),
        [
            pytest.param(TOMORROW, False, id="inside the deadline"),
            pytest.param(TODAY, False, id="on the deadline's own day"),
            pytest.param(YESTERDAY, True, id="the day after the deadline"),
            pytest.param(None, False, id="no deadline recorded"),
        ],
    )
    def test_each_boundary_falls_where_the_rule_says(self, bestaetigungsfrist: str | None, refused: bool):
        """The deadline's own day still answers: the mail names the day, and a link dying at midnight before it lies."""

        refusal = find_expired_token_refusal(bestaetigungsfrist=bestaetigungsfrist, status="eingereicht", today=TODAY)

        assert (refusal is not None) == refused
        assert refusal is None or (refusal.error_code, refusal.status) == (BEWERBUNG_TOKEN_PAST_DEADLINE, HTTPStatus.CONFLICT)


class TestALinkOnADecidedApplication:
    """`REQ-BEWERBUNG-010`: a decision taken while the seat stood open, which nothing undoes, so the link is spent."""

    @pytest.mark.parametrize("status", ["angenommen", "abgelehnt"])
    @pytest.mark.parametrize("bestaetigungsfrist", [TOMORROW, YESTERDAY])
    def test_a_decided_application_answers_no_seat_whatever_its_deadline(self, status: str, bestaetigungsfrist: str):
        """Judged before the deadline, so a decided application past its deadline is not told a re-send would help."""

        refusal = find_expired_token_refusal(bestaetigungsfrist=bestaetigungsfrist, status=status, today=TODAY)

        assert refusal is not None
        assert (refusal.error_code, refusal.status) == (BEWERBUNG_TOKEN_DECIDED, HTTPStatus.GONE)


class TestASeatAlreadyAnswered:
    """`REQ-BEWERBUNG-011`: the single use. The stamps spend a link, never a nulled hash, so a reopened link can show its state."""

    def test_an_open_seat_with_its_bookkeeping_may_be_answered(self):
        """The floor: without it every case below would pass on a guard that refuses everything."""

        stored = application()

        assert find_already_answered_refusal(kontakte=stored["kontakte"], bestaetigungen=stored["bestaetigungen"], seat="trainer") is None

    @pytest.mark.parametrize(
        "stored",
        [
            pytest.param(application(kontakte=kontakte(trainer=kontaktperson_document("Quillhilde", bestaetigt_am=YESTERDAY))), id="confirmed"),
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
        stored = application(kontakte=kontakte(trainer=kontaktperson_document("Quillhilde", bestaetigt_am=YESTERDAY)))

        assert (
            find_already_answered_refusal(kontakte=stored["kontakte"], bestaetigungen=stored["bestaetigungen"], seat="ansprechperson") is None
        )


# Exact ages against a fixed day, so both boundaries are pinned without a clock. Against `TODAY`,
# `2010-04-01` is 16 to the day, `2008-04-01` is 18 to the day, and `1905-04-02` is the last date
# that is still 120.
AGE_BOUNDARIES = [
    pytest.param(16, "2010-04-02", True, id="a day short of the sixteen floor, at 15"),
    pytest.param(16, "2010-04-01", False, id="the sixteen floor, to the day"),
    pytest.param(16, "2010-03-31", False, id="a day inside the sixteen floor"),
    pytest.param(18, "2008-04-02", True, id="a day short of the eighteen floor, at 17 and 364 days"),
    pytest.param(18, "2008-04-01", False, id="the eighteen floor, to the day"),
    pytest.param(18, "2010-04-01", True, id="sixteen to the day, which the eighteen floor refuses"),
    pytest.param(16, "1905-04-02", False, id="the ceiling, on its last day at 120"),
    pytest.param(16, "1905-04-01", True, id="a day past the ceiling, at 121"),
]


class TestWhichFloorAPersonClears:
    """`mindestalter_for`: the floor is the PERSON's, so a seat they also hold can only raise it."""

    def test_every_seat_declares_a_floor_and_no_other_key_does(self):
        """A seat added to the set with no row here is a `KeyError` at the confirmation rather than a silent 16."""

        assert set(SEAT_MIN_AGE_YEARS) == set(KONTAKT_SEATS)

    # The NUMBERS rather than the constants that hold them: read through the constants, every case
    # here passes with both of them set to one value, which is the state this slice exists to end.
    @pytest.mark.parametrize(
        ("seats", "floor"),
        [
            pytest.param(("trainer",), 16, id="the Trainer alone"),
            pytest.param(("ansprechperson",), 18, id="the Ansprechperson alone"),
            pytest.param(("stellvertretung",), 18, id="the Stellvertretung alone"),
            pytest.param(("trainer", "ansprechperson"), 18, id="a Trainer who is also the Ansprechperson"),
            pytest.param(("ansprechperson", "trainer"), 18, id="the same pair, pressed from the other link"),
            pytest.param(("trainer", "stellvertretung"), 18, id="a Trainer who is also the Stellvertretung"),
        ],
    )
    def test_the_pair_takes_the_higher_of_the_two_floors(self, seats: tuple[str, ...], floor: int):
        assert mindestalter_for(seats) == floor

    def test_the_two_constants_are_the_two_numbers_the_cases_above_pin(self):
        """The one place the literals above are tied to the names the rest of the package reads."""

        assert (BEWERBUNG_KONTAKT_MIN_AGE_YEARS, VERTRETUNG_MIN_AGE_YEARS) == (16, 18)


class TestTheAgeAtConfirmation:
    """`REQ-BEWERBUNG-012`: the bound `refuse_age_outside_the_bounds` holds, reached as a 422 with its own code and German."""

    @pytest.mark.parametrize(("mindestalter", "geburtsdatum", "refused"), AGE_BOUNDARIES)
    def test_each_boundary_falls_where_the_bound_says(self, mindestalter: int, geburtsdatum: str, refused: bool):
        """Move either comparison by one and a case here goes red; the endpoint cannot show that."""

        if not refused:
            assert refuse_age_outside_the_bounds(geburtsdatum=geburtsdatum, today=TODAY, mindestalter=mindestalter) is None
            return

        with pytest.raises(ValueError):
            refuse_age_outside_the_bounds(geburtsdatum=geburtsdatum, today=TODAY, mindestalter=mindestalter)

    @pytest.mark.parametrize(
        ("mindestalter", "a_year_short", "the_floor", "the_day_after"),
        [
            pytest.param(16, "2028-02-28", "2028-02-29", "2028-03-01", id="sixteen, in a leap year that has the birthday"),
            pytest.param(18, "2030-02-28", "2030-03-01", "2030-03-02", id="eighteen, in a year that has no 29 February"),
        ],
    )
    def test_a_leap_birthday_reaches_a_floor_on_the_day_the_calendar_does(
        self, mindestalter: int, a_year_short: str, the_floor: str, the_day_after: str
    ):
        """Someone born on 29 February reaches a floor the moment the date arrives; where the year has none, on 1 March."""

        with pytest.raises(ValueError):
            refuse_age_outside_the_bounds(geburtsdatum="2012-02-29", today=a_year_short, mindestalter=mindestalter)

        assert refuse_age_outside_the_bounds(geburtsdatum="2012-02-29", today=the_floor, mindestalter=mindestalter) is None
        assert refuse_age_outside_the_bounds(geburtsdatum="2012-02-29", today=the_day_after, mindestalter=mindestalter) is None

    @pytest.mark.parametrize(("mindestalter", "geburtsdatum", "refused"), AGE_BOUNDARIES)
    def test_the_refusal_carries_the_bound_and_the_code(self, mindestalter: int, geburtsdatum: str, refused: bool):
        refusal = find_alter_refusal(geburtsdatum=geburtsdatum, today=TODAY, mindestalter=mindestalter)

        assert (refusal is not None) == refused
        assert refusal is None or refusal.error_code == BEWERBUNG_KONTAKT_ALTER

    @pytest.mark.parametrize("bound", ["mindestens", "über"])
    def test_each_refusal_is_German(self, bound: str):
        """It surfaces on the confirmation page, so the message is what the person who typed the date reads."""

        born = "2020-01-01" if bound == "mindestens" else "1800-01-01"
        refusal = find_alter_refusal(geburtsdatum=born, today=TODAY, mindestalter=BEWERBUNG_KONTAKT_MIN_AGE_YEARS)

        assert refusal is not None
        assert bound in refusal.message

    @pytest.mark.parametrize("mindestalter", [BEWERBUNG_KONTAKT_MIN_AGE_YEARS, VERTRETUNG_MIN_AGE_YEARS])
    def test_the_floor_refusal_names_the_floor_it_judged_by(self, mindestalter: int):
        """A sentence naming 16 to a seat refused at 18 tells the person their date was accepted."""

        refusal = find_alter_refusal(geburtsdatum="2020-01-01", today=TODAY, mindestalter=mindestalter)

        assert refusal is not None
        assert str(mindestalter) in refusal.message


class TestWhatAReopenedLinkShows:
    """`zustand`: a stamp outranks a decline, which outranks the deadline, which outranks nothing."""

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
                application(status="angenommen", kontakte=kontakte(trainer=kontaktperson_document("Quillhilde", bestaetigt_am=YESTERDAY))),
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
        assert ausstehende_seats(kontakte=kontakte(ansprechperson=kontaktperson_document("Ansgar", bestaetigt_am=TODAY))) == [
            "trainer",
            "stellvertretung",
        ]

    def test_an_emptied_slot_still_counts(self):
        """A decline or an erasure leaves the application unable to complete, which is what this list tells the page."""

        assert "trainer" in ausstehende_seats(kontakte=kontakte(trainer=None))


# Storable by a hand edit, the validator typing the stamp as a string or null, and read as no
# confirmation by `app/shared/einwilligung.py :: is_confirmed` (`docs/backend/spec.md :: I387`).
EMPTY_STAMP = kontakte(trainer=kontaktperson_document("Quillhilde", bestaetigt_am=""))


class TestAnEmptyStampConfirmsNothing:
    """Every reader of a seat's stamp agrees with the other packages: the seat stays open."""

    def test_the_seat_is_still_outstanding(self):
        assert ausstehende_seats(kontakte=EMPTY_STAMP) == list(KONTAKT_SEATS)

    def test_its_link_still_takes_the_answer(self):
        assert find_already_answered_refusal(kontakte=EMPTY_STAMP, bestaetigungen=BESTAETIGUNGEN, seat="trainer") is None

    def test_a_reopened_link_reads_open(self):
        assert zustand_of(bewerbung_raw=application(kontakte=EMPTY_STAMP), seat="trainer", today=TODAY) == "gueltig"

    def test_the_application_is_not_yet_one_the_league_may_accept(self):
        """The acceptance's own refusal, with the two other seats confirmed so the empty stamp is all that holds it."""

        confirmed_but_one = {
            **EMPTY_STAMP,
            "ansprechperson": kontaktperson_document("Ansgar", bestaetigt_am=YESTERDAY),
            "stellvertretung": kontaktperson_document("Stellan", bestaetigt_am=YESTERDAY),
        }
        refusal = find_unconfirmed_kontakte_refusal(kontakte=confirmed_but_one, bestaetigungen=BESTAETIGUNGEN)

        assert refusal is not None
        assert refusal.error_code == BEWERBUNG_KONTAKTE_UNCONFIRMED


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
                "kontakte.trainer.einwilligung.erfasst_von": "person",
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
            "$set": {"kontakte.trainer": None, "bestaetigungen.trainer.abgelehnt_am": TODAY},
            "$unset": {"idempotenz_fingerabdruck": ""},
        }

    @pytest.mark.parametrize("seats", [("trainer",), ("trainer", "ansprechperson")])
    def test_a_resend_replaces_the_bookkeeping_of_every_seat_it_is_given_and_restarts_the_deadline(self, seats: tuple[str, ...]):
        """The pair is the case that matters: one entry left standing would keep the replaced address's link alive on that seat."""

        update = compose_erneut_update(seats=seats, token_hash="fresh", today=TODAY, bestaetigungsfrist="2026-04-15")

        frisch = {"token_hash": "fresh", "verschickt_am": TODAY, "erinnert_am": None, "abgelehnt_am": None}
        assert update == {"$set": {**{f"bestaetigungen.{seat}": frisch for seat in seats}, "bestaetigungsfrist": "2026-04-15"}}


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
