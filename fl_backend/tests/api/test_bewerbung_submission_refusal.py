import asyncio
from datetime import date, timedelta
from typing import Any, Mapping, cast, get_args

import pytest
from bson import ObjectId
from pydantic import ValidationError

from app.api.bewerbungen.public_router import get_schulen
from app.api.bewerbungen.schemas import (
    FLBewerbungKader,
    FLBewerbungKontaktePayload,
    FLBewerbungKontaktpersonPayload,
    FLBewerbungSchule,
    FLBewerbungSchulePayload,
    FLBewerbungTrikot,
    FLPostBewerbungPayload,
    _whole_years_between,
    normalise_telefon,
    refuse_age_outside_the_bounds,
)
from app.api.bewerbungen.services import (
    BEWERBUNG_FENSTER_GESCHLOSSEN,
    BEWERBUNG_PICKED_CLUB_ALREADY_ENTERED,
    BEWERBUNG_PICKED_CLUB_UNUSABLE,
    BEWERBUNG_SHORTHAND_TAKEN,
    BEWERBUNG_SUBMISSION_SUBJECT_UNRESOLVED,
    compose_einwilligung,
    compose_kontakte,
    find_already_entered_refusal,
    find_picked_club_refusal,
    find_shorthand_refusal,
    find_submission_subject_refusal,
    find_window_refusal,
    window_is_running,
)
from app.api.teams.schemas import FLKontaktperson, FLPostTeamPayload, FLTeam, FLTeamRecord, FLTrikotFarbe
from app.core.dependencies import get_german_date_str, get_germany_now
from app.shared.schemas.addresses import FLAddressPayload
from app.shared.schemas.bounds import (
    BEWERBUNG_FULL_NAME_MAX_LENGTH,
    BEWERBUNG_KADER_GROESSE_MAX,
    BEWERBUNG_KONTAKT_MAX_AGE_YEARS,
    BEWERBUNG_KONTAKT_MIN_AGE_YEARS,
    BEWERBUNG_KONTAKT_NAME_MAX_LENGTH,
    BEWERBUNG_TEAM_NAME_MAX_LENGTH,
    BEWERBUNG_TRIKOT_SATZ_MAX_LENGTH,
    BEWERBUNG_WEBSITE_URL_MAX_LENGTH,
)

# Fixed rather than generated, so a failure names the same club every run. Its own hex range, as
# every other module in this suite carves one.
PICKED_OID = ObjectId("6890a1b2c3d4e5f607930001")
RETIRED_OID = ObjectId("6890a1b2c3d4e5f607930002")

TODAY = "2026-04-01"

# A window this day sits inside, so each case below moves ONE thing away from a passing state.
OPEN_WINDOW: Mapping[str, Any] = {"offen": True, "von": "2026-03-01", "bis": "2026-04-30"}

SCHULE: Mapping[str, Any] = {"team_name": "Zorbanax", "shorthand": "ZX"}


def _today() -> date:
    """The day the age bound is judged against, read the one way the application reads it."""

    return date.fromisoformat(get_german_date_str(get_germany_now()))


def _aged(years: int) -> str:
    """A birth date comfortably inside `years` -- never on the boundary, which `TestWholeYears` pins clock-free."""

    return (_today() - timedelta(days=round(years * 365.25))).isoformat()


ADDRESS: Mapping[str, Any] = {
    "strasse": "Hanauer Landstraße",
    "hausnummer": "12a",
    "plz": "60314",
    "stadtteil": "Ostend",
    "stadt": "Frankfurt am Main",
}


def person(**overrides: Any) -> dict[str, Any]:
    """One contact person as the public form submits them."""

    return {
        "vorname": "Quillhilde",
        "nachname": "Brackenmoor",
        "email": "quillhilde@example.com",
        "telefon": "+49 170 1234567",
        "geburtsdatum": _aged(40),
        "einwilligung": {"text_version": "v3", "erteilt": True},
        **overrides,
    }


def kontakte(**overrides: Any) -> dict[str, Any]:
    """The three seats, distinct on every field a rule compares, plus the flag that may make two of them one."""

    return {
        "trainer": person(),
        "ansprechperson": person(vorname="Ansgar", email="ansgar@example.com", telefon="+49 170 7654321"),
        "stellvertretung": person(vorname="Stellan", email="stellan@example.com", telefon="0171 5555555"),
        "trainer_ist_zugleich": None,
        **overrides,
    }


def submission(**overrides: Any) -> dict[str, Any]:
    """A whole application, valid, that each case moves one field of."""

    return {
        "saison_id": "2026",
        "team_id": str(PICKED_OID),
        "schule": None,
        "kontakte": kontakte(),
        "trikot": {"vorhandener_satz": "12 rote Trikots", "wunschfarbe": "blau"},
        "kader": {"voraussichtliche_groesse": 14, "gute_spieler": 4},
        **overrides,
    }


# A real scheme and a real host, padded in the PATH -- the half `validate_external_url` never reads,
# so a case built on it is refused by the ceiling and by nothing else.
_URL_STEM = "https://zorbanax.example.de/"


# One club document, in the shape `_TeamWritable` describes, so the three cases naming it move together.
CLUB: dict[str, Any] = {
    "name": "Zorbanax",
    "shorthand": "ZX",
    "description": "",
    "full_name": "Zorbanax-Gymnasium",
    "schulform": "gymnasium_g9",
    "website_url": "https://zorbanax.example.de",
    "address": dict(ADDRESS),
}

# What a club READ adds beyond the writable base, none of it under test here.
CLUB_READ_ONLY: dict[str, Any] = {
    "_id": str(PICKED_OID),
    "gruppe": "A",
    "statistik": {},
    "austritt": None,
    "inactive_since": None,
}


def _url_of_length(length: int) -> str:
    return _URL_STEM + "p" * (length - len(_URL_STEM))


def schule(**overrides: Any) -> dict[str, Any]:
    return {
        "team_name": "Zorbanax",
        "full_name": "Zorbanax-Gymnasium",
        "shorthand": "ZX",
        "schulform": "gymnasium_g9",
        "address": dict(ADDRESS),
        "website_url": "https://zorbanax.example.de",
        **overrides,
    }


def test_the_corpus_this_module_moves_one_field_of_is_valid():
    """The floor under every case below: each moves ONE field, so a corpus already refused would pass them all vacuously."""

    assert FLPostBewerbungPayload.model_validate(submission()).saison_id == "2026"
    assert FLPostBewerbungPayload.model_validate(submission(team_id=None, schule=schule())).schule is not None


# Each row moves ONE thing away from `OPEN_WINDOW` on `TODAY`, so what it proves is that thing.
SHUT_WINDOWS = [
    pytest.param(None, id="no window recorded at all"),
    pytest.param({}, id="a window missing every key"),
    pytest.param({"offen": True, "von": "2026-03-01"}, id="a window missing `bis`"),
    pytest.param({**OPEN_WINDOW, "offen": False}, id="the flag turned off"),
    pytest.param({**OPEN_WINDOW, "von": "2026-04-02"}, id="the span opens tomorrow"),
    pytest.param({**OPEN_WINDOW, "bis": "2026-03-31"}, id="the span closed yesterday"),
    pytest.param({"offen": True, "von": "2026-04-30", "bis": "2026-03-01"}, id="a stored span running backwards"),
]


class TestTheWindowDecidesWhetherAnApplicationMayArrive:
    """`REQ-BEWERBUNG-004`, apart from a database: the deadline is the whole of what makes a form public or shut."""

    def test_a_season_inside_its_open_window_takes_an_application(self):
        """The floor: without it every case below would pass on a check that refuses everything."""

        assert window_is_running(bewerbung=OPEN_WINDOW, today=TODAY) is True
        assert find_window_refusal(bewerbung=OPEN_WINDOW, today=TODAY) is None

    @pytest.mark.parametrize(
        "bewerbung", [pytest.param(OPEN_WINDOW["von"], id="the first day"), pytest.param(OPEN_WINDOW["bis"], id="the last")]
    )
    def test_both_ends_of_the_span_are_inside_it(self, bewerbung: str):
        """Inclusive on both ends, which is what a published deadline means: an applicant reading "bis 30.04." may apply on the 30th."""

        assert window_is_running(bewerbung=OPEN_WINDOW, today=bewerbung) is True

    @pytest.mark.parametrize("bewerbung", SHUT_WINDOWS)
    def test_a_season_not_inside_an_open_window_is_refused(self, bewerbung: Any):
        """ONE code for every way, so the refusal reports no season's administrative state to a visitor."""

        refusal = find_window_refusal(bewerbung=bewerbung, today=TODAY)

        assert refusal is not None
        assert refusal.error_code == BEWERBUNG_FENSTER_GESCHLOSSEN

    @pytest.mark.parametrize("bewerbung", SHUT_WINDOWS)
    def test_the_public_read_and_the_write_agree_on_every_one(self, bewerbung: Any):
        """The judgement is ONE function, so `GET /fenster` cannot show a form the POST then refuses."""

        assert window_is_running(bewerbung=bewerbung, today=TODAY) is False


# The four combinations of (`team_id` set or null) by (`schule` set or null): exactly one of them
# says who is applying, so the mixed rows pass and the matched rows are refused.
SUBJECTS = [
    pytest.param(PICKED_OID, None, False, id="an existing club alone"),
    pytest.param(None, SCHULE, False, id="a new school alone"),
    pytest.param(PICKED_OID, SCHULE, True, id="both"),
    pytest.param(None, None, True, id="neither"),
]


class TestWhoIsApplying:
    """`REQ-BEWERBUNG-005`: the write path branches on which field carries the value, so it judges rather than assumes."""

    @pytest.mark.parametrize(("team_id", "named_schule", "refused"), SUBJECTS)
    def test_exactly_one_of_the_two_names_the_applicant(self, team_id: Any, named_schule: Any, refused: bool):
        refusal = find_submission_subject_refusal(team_id=team_id, schule=named_schule)

        assert (refusal is not None) == refused
        assert refusal is None or refusal.error_code == BEWERBUNG_SUBMISSION_SUBJECT_UNRESOLVED

    def test_the_code_is_not_the_triage_one(self):
        """The whole reason `-005` exists: `-002` asks this of a STORED application, and one code would make the log ambiguous."""

        refusal = find_submission_subject_refusal(team_id=None, schule=None)

        assert refusal is not None
        assert refusal.error_code != "REQ-BEWERBUNG-002"


class TestWhetherThePickedClubMayApply:
    """`REQ-BEWERBUNG-006`: the picker offers neither a club that is gone nor one that has left."""

    def test_a_club_still_in_the_league_may_apply(self):
        """The floor under both cases below."""

        assert find_picked_club_refusal(team_raw={"_id": PICKED_OID, "inactive_since": None}) is None

    @pytest.mark.parametrize(
        "team_raw",
        [
            pytest.param(None, id="no club holds the id"),
            pytest.param({"_id": PICKED_OID, "inactive_since": "2025-08-01"}, id="the club left the league"),
        ],
    )
    def test_a_club_the_list_does_not_offer_is_refused(self, team_raw: Any):
        """ONE code for both: either answer means a client sent an id the picker never gave it."""

        refusal = find_picked_club_refusal(team_raw=team_raw)

        assert refusal is not None
        assert refusal.error_code == BEWERBUNG_PICKED_CLUB_UNUSABLE

    def test_the_refusal_names_no_club(self):
        """`docs/logging/spec.md :: L9`: this message reaches the LOG, so it says the rule and never a stored value."""

        refusal = find_picked_club_refusal(team_raw=None)

        assert refusal is not None
        assert str(PICKED_OID) not in refusal.message

    def test_the_refusal_offers_no_repair_that_would_be_refused_in_turn(self):
        """A retired club KEEPS its Kürzel, so "propose a new school" alone walks into `REQ-BEWERBUNG-008`.

        The advice names the free shorthand it needs, and the log reader is told the likely cause --
        a list the client has not reloaded.
        """

        refusal = find_picked_club_refusal(team_raw={"_id": RETIRED_OID, "inactive_since": "2025-08-01"})

        assert refusal is not None
        assert "reload the list" in refusal.message

        # ABSENCE as well as presence: re-appending the old advice keeps both substrings above and
        # would slip past a test that only asked for them.
        assert "as a new school" not in refusal.message
        assert refusal.message.endswith("or propose a new school under a shorthand no club holds")

    def test_the_refusal_does_not_say_which_of_the_two_it_was(self):
        """`READ-BEWERBUNG-001` neutrality: one wording for both, so the message never discloses that a club has left.

        The two inputs are the only ways here, and one message means a visitor learns nothing about
        any particular club's standing.
        """

        gone = find_picked_club_refusal(team_raw=None)
        retired = find_picked_club_refusal(team_raw={"_id": RETIRED_OID, "inactive_since": "2025-08-01"})

        assert gone is not None and retired is not None
        assert gone.message == retired.message
        for leaked in ("retired", "inactive", "left the league", "2025-08-01", str(RETIRED_OID)):
            assert leaked not in retired.message


class TestAClubAlreadyInTheSeason:
    """`REQ-BEWERBUNG-007`: a club holding the season's junction row is already in it."""

    def test_a_club_holding_no_row_may_apply(self):
        """The floor: without it the case below would pass on a check that refuses everything."""

        assert find_already_entered_refusal(entered=False) is None

    def test_a_club_already_entered_is_refused(self):
        refusal = find_already_entered_refusal(entered=True)

        assert refusal is not None
        assert refusal.error_code == BEWERBUNG_PICKED_CLUB_ALREADY_ENTERED


class TestTheProposedKuerzel:
    """`REQ-BEWERBUNG-008`: `uniq_shorthand` is what finally holds this, and acceptance is where it would fail."""

    def test_a_free_kuerzel_passes(self):
        """The floor: without it the case below would pass on a check that refuses everything."""

        assert find_shorthand_refusal(taken=False) is None

    def test_a_kuerzel_a_club_already_holds_is_refused(self):
        refusal = find_shorthand_refusal(taken=True)

        assert refusal is not None
        assert refusal.error_code == BEWERBUNG_SHORTHAND_TAKEN


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
        """Off by one here and every applicant born in the second half of the year is judged a year older."""

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


class TestTheAgeJudgementAgainstAFixedDay:
    """The bound itself, with `today` passed in. Both boundaries are inclusive, and neither is provable against a wall clock."""

    @pytest.mark.parametrize(("geburtsdatum", "refused"), AGE_BOUNDARIES)
    def test_each_boundary_falls_where_the_bound_says(self, geburtsdatum: str, refused: bool):
        """Move either comparison by one and a case here goes red; the clock-reading wrapper cannot show that."""

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

    @pytest.mark.parametrize("bound", ["mindestens", "über"])
    def test_each_refusal_is_German(self, bound: str):
        """It surfaces as a 422 on a public form, so the message is what the applicant reads."""

        born = "2020-01-01" if bound == "mindestens" else "1800-01-01"

        with pytest.raises(ValueError, match=bound):
            refuse_age_outside_the_bounds(geburtsdatum=born, today=TODAY)


class TestTheAgeBound:
    """The bound the public payload carries and no other date field does. Dates are relative, so the case survives the year turning."""

    def test_an_adult_of_forty_is_accepted(self):
        """The floor: without it every refusal below would pass on a validator that refuses everything."""

        assert FLBewerbungKontaktpersonPayload.model_validate(person()).geburtsdatum == person()["geburtsdatum"]

    @pytest.mark.parametrize(
        "years",
        [
            pytest.param(BEWERBUNG_KONTAKT_MIN_AGE_YEARS - 6, id="a child"),
            pytest.param(BEWERBUNG_KONTAKT_MAX_AGE_YEARS + 10, id="a year mistyped by a century"),
        ],
    )
    def test_an_age_outside_the_bounds_is_refused(self, years: int, assert_rejects):
        failure = assert_rejects(FLBewerbungKontaktpersonPayload, person(geburtsdatum=_aged(years)), "geburtsdatum")

        # German, because it surfaces as a 422 on a public form rather than in an admin tool.
        assert "Jahre" in str(failure)

    def test_a_date_in_the_future_is_refused(self):
        """Not a bound of its own: an unborn contact person is younger than the floor, which is what refuses them."""

        unborn = (_today() + timedelta(days=1)).isoformat()

        with pytest.raises(ValidationError):
            FLBewerbungKontaktpersonPayload.model_validate(person(geburtsdatum=unborn))

    def test_the_junction_payload_carries_no_such_bound(self):
        """The bound is the PUBLIC form's alone: an administrator's own edit answers to nobody's age."""

        from app.api.teams.schemas import FLKontaktpersonPayload

        junction_person = {
            **person(geburtsdatum=_aged(BEWERBUNG_KONTAKT_MIN_AGE_YEARS - 6)),
            "einwilligung": {"umfang": "kontaktdaten", "erteilt_von": "administrativ", "text_version": "v3", "datum": TODAY},
        }

        assert FLKontaktpersonPayload.model_validate(junction_person).geburtsdatum is not None


class TestOneNumberHasOneSpelling:
    """What `normalise_telefon` folds, which is the whole of what makes the distinctness rule work on a free-form field."""

    @pytest.mark.parametrize(
        ("written", "normalised"),
        [
            pytest.param("+49 170 1234567", "01701234567", id="the international form"),
            pytest.param("0049-170-1234567", "01701234567", id="the international form with a zero prefix"),
            pytest.param("0170 1234567", "01701234567", id="the national form"),
            pytest.param("(0170) 123 45 67", "01701234567", id="brackets and spaces"),
            # The commonest German spelling of all: the trunk zero kept in brackets after the
            # country code, which no international-format number really carries.
            pytest.param("+49 (0)170 1234567", "01701234567", id="the bracketed trunk zero"),
            pytest.param("0049 (0)170 1234567", "01701234567", id="the bracketed trunk zero, zero-prefixed"),
            pytest.param("+490170 1234567", "01701234567", id="the trunk zero with no brackets at all"),
            pytest.param("069 1234567", "0691234567", id="a landline, untouched"),
            # The fold must not reach a NATIONAL number whose area code begins 49; the trunk zero in
            # front of it is what keeps the two apart.
            pytest.param("0491 234567", "0491234567", id="a national number whose area code starts 49"),
        ],
    )
    def test_two_spellings_of_one_number_compare_equal(self, written: str, normalised: str):
        assert normalise_telefon(written) == normalised

    def test_two_different_numbers_stay_different(self):
        """The control: a normaliser that returned a constant would satisfy every case above."""

        assert normalise_telefon("+49 170 1234567") != normalise_telefon("+49 170 7654321")

    def test_a_national_number_is_not_folded_onto_an_international_one_of_another_line(self):
        """The other control: an over-eager fold would collapse `0491…` onto `+49 1…`."""

        assert normalise_telefon("0491 234567") != normalise_telefon("+49 1 234567")


# The spellings that must reach the distinctness rule as ONE number. `PHONE_REGEX` admits every one.
ONE_LINE_TWO_WAYS = [
    pytest.param("+49 (0)170 1234567", id="bracketed trunk zero against the national form"),
    pytest.param("0049 (0)170 1234567", id="zero-prefixed and bracketed"),
    pytest.param("+49 170 1234567", id="plain international"),
    pytest.param("(0170) 123 45 67", id="bracketed area code"),
]


# The Trainer's own two details, each put on a seat NOT declared identical to them. Both seats and
# both fields, because a rule holding for one pair and not the other is one nobody can rely on.
SHARED_CONTACT_DETAILS = [
    (seat, field, value)
    for seat in ("ansprechperson", "stellvertretung")
    for field, value in (("email", "quillhilde@example.com"), ("telefon", "+49 170 1234567"))
]


class TestTheThreeSeatsAreThreePeople:
    """The two `model_validator`s. 422s rather than 409s: these are shape rules about the body, judged against no database."""

    def test_three_distinct_people_pass(self):
        """The floor under every refusal below."""

        assert FLBewerbungKontaktePayload.model_validate(kontakte()).trainer_ist_zugleich is None

    @pytest.mark.parametrize("seat", ["ansprechperson", "stellvertretung"])
    def test_a_seat_declared_identical_may_repeat_the_trainer(self, seat: str):
        """The case the flag exists for: one person holding two seats is not two people sharing a number."""

        block = kontakte(**{seat: person(), "trainer_ist_zugleich": seat})

        assert FLBewerbungKontaktePayload.model_validate(block).trainer_ist_zugleich == seat

    @pytest.mark.parametrize("seat", ["ansprechperson", "stellvertretung"])
    def test_a_seat_declared_identical_and_filled_differently_is_refused(self, seat: str):
        """The form fills the second seat from the first, so a mismatch is a client that has drifted."""

        block = kontakte(**{seat: person(vorname="Andere"), "trainer_ist_zugleich": seat})

        with pytest.raises(ValidationError) as failure:
            FLBewerbungKontaktePayload.model_validate(block)

        assert seat in str(failure.value)

    @pytest.mark.parametrize(("seat", "field", "value"), SHARED_CONTACT_DETAILS)
    def test_two_distinct_people_may_share_neither_an_email_nor_a_number(self, seat: str, field: str, value: str):
        with pytest.raises(ValidationError):
            FLBewerbungKontaktePayload.model_validate(kontakte(**{seat: person(vorname="Andere", **{field: value})}))

    def test_an_email_repeated_in_another_case_is_still_one_address(self):
        """A mailbox is addressed the same however the local part is capitalised, so the comparison folds case.

        Its own telephone, or the number rule would fire here and this would prove nothing about case.
        """

        other = person(vorname="Andere", email="QUILLHILDE@Example.com", telefon="+49 170 9999999")

        with pytest.raises(ValidationError):
            FLBewerbungKontaktePayload.model_validate(kontakte(ansprechperson=other))

    @pytest.mark.parametrize("written", ONE_LINE_TWO_WAYS)
    def test_one_number_written_two_ways_is_still_one_number(self, written: str):
        """The whole reason `normalise_telefon` exists: `PHONE_REGEX` admits many spellings of one line.

        The trainer holds `0170 1234567`; each spelling here is that same line, so a second person
        writing one of them is not a second telephone.
        """

        trainer = person(telefon="0170 1234567")
        other = person(vorname="Andere", telefon=written, email="andere@example.com")

        with pytest.raises(ValidationError):
            FLBewerbungKontaktePayload.model_validate(kontakte(trainer=trainer, ansprechperson=other))

    def test_two_people_on_genuinely_different_lines_still_pass(self):
        """The control for the parametrisation above: a rule refusing every pair would satisfy it."""

        trainer = person(telefon="0170 1234567")
        other = person(vorname="Andere", telefon="+49 (0)171 7654321", email="andere@example.com")

        assert FLBewerbungKontaktePayload.model_validate(kontakte(trainer=trainer, ansprechperson=other)) is not None

    def test_the_seat_left_out_of_the_comparison_is_the_declared_one_alone(self):
        """The narrowing is per-seat, not a blanket exemption: the third person is still held distinct from both."""

        block = kontakte(
            ansprechperson=person(),
            stellvertretung=person(vorname="Stellan", email="quillhilde@example.com", telefon="0171 5555555"),
            trainer_ist_zugleich="ansprechperson",
        )

        with pytest.raises(ValidationError):
            FLBewerbungKontaktePayload.model_validate(block)


class TestWhatTheServerComposes:
    """The fields a client is offered none of, so nothing submitted can claim them."""

    def test_a_consent_records_the_person_and_the_day_it_arrived(self):
        composed = compose_einwilligung(text_version="v3", today=TODAY)

        assert composed == {"umfang": "kontaktdaten", "erteilt_von": "person", "text_version": "v3", "datum": TODAY}

    def test_the_composed_block_stores_no_field_the_payload_carried_beside_the_wording(self):
        """`erteilt` is the form's tickbox, not a stored field: the record IS the consent, and `False` is a body this endpoint refuses."""

        composed = compose_kontakte(kontakte=FLBewerbungKontaktePayload.model_validate(kontakte()).model_dump(mode="json"), today=TODAY)

        assert set(composed["trainer"]["einwilligung"]) == {"umfang", "erteilt_von", "text_version", "datum"}

    def test_every_seat_and_the_flag_survive_the_composition(self):
        """The control for the case above: a composer dropping a seat would satisfy it and store two people."""

        block = kontakte(trainer_ist_zugleich="ansprechperson", ansprechperson=person())
        composed = compose_kontakte(kontakte=FLBewerbungKontaktePayload.model_validate(block).model_dump(mode="json"), today=TODAY)

        assert set(composed) == {"trainer", "ansprechperson", "stellvertretung", "trainer_ist_zugleich"}
        assert composed["trainer_ist_zugleich"] == "ansprechperson"
        assert composed["stellvertretung"]["vorname"] == "Stellan"

    def test_a_consent_the_applicant_did_not_give_is_refused_rather_than_stored(self):
        """`erteilt: Literal[True]`: an unticked box is a 422, never a stored record saying somebody declined."""

        with pytest.raises(ValidationError):
            FLBewerbungKontaktpersonPayload.model_validate(person(einwilligung={"text_version": "v3", "erteilt": False}))

    @pytest.mark.parametrize("field", ["umfang", "erteilt_von", "datum"])
    def test_a_client_may_not_name_a_field_the_server_composes(self, field: str):
        """`extra="forbid"`: a body naming one of these could claim an administrative transcription or backdate a consent."""

        with pytest.raises(ValidationError):
            FLBewerbungKontaktpersonPayload.model_validate(person(einwilligung={"text_version": "v3", "erteilt": True, field: "x"}))


class TestWhatTheSubmissionPayloadRefuses:
    """The fields the server owns are on no payload at all, so a submission cannot arrive already decided."""

    @pytest.mark.parametrize(("field", "value"), [("status", "angenommen"), ("eingereicht_am", "2020-01-01"), ("entscheidung", None)])
    def test_a_submission_naming_a_field_the_server_sets_is_refused(self, field: str, value: Any):
        with pytest.raises(ValidationError) as failure:
            FLPostBewerbungPayload.model_validate(submission(**{field: value}))

        assert any(entry["type"] == "extra_forbidden" for entry in failure.value.errors())

    def test_a_school_website_that_is_not_an_http_url_is_refused(self):
        """Constrained on this payload where the read model leaves it bare: acceptance parses the block through `FLPostTeamPayload`."""

        with pytest.raises(ValidationError):
            FLPostBewerbungPayload.model_validate(submission(team_id=None, schule=schule(website_url="javascript:alert(1)")))

    @pytest.mark.parametrize("website_url", ["https://frankfurtleague.de@evil.example", "https://user:pw@evil.example"])
    def test_a_school_website_hiding_its_host_behind_userinfo_is_refused(self, website_url: str):
        """The admin panel renders the string and follows the host, so userinfo makes those two different domains."""

        with pytest.raises(ValidationError):
            FLPostBewerbungPayload.model_validate(submission(team_id=None, schule=schule(website_url=website_url)))

    @pytest.mark.parametrize("website_url", ["https://zorbanax.example.de/a@b", "https://zorbanax.example.de/?q=a@b"])
    def test_an_at_sign_past_the_authority_is_still_accepted(self, website_url: str):
        """The control: an `@` in a path or a query names no host, and refusing it would be a regex reading for a character."""

        parsed = FLPostBewerbungPayload.model_validate(submission(team_id=None, schule=schule(website_url=website_url)))

        assert parsed.schule is not None and parsed.schule.website_url == website_url

    def test_a_squad_of_nobody_is_refused(self):
        with pytest.raises(ValidationError):
            FLPostBewerbungPayload.model_validate(submission(kader={"voraussichtliche_groesse": 0, "gute_spieler": None}))

    def test_a_kit_description_over_the_ceiling_is_refused(self, assert_rejects):
        """An anonymous caller writes it and the record stores it, which is the pair a bound is earned on."""

        over = {"vorhandener_satz": "T" * (BEWERBUNG_TRIKOT_SATZ_MAX_LENGTH + 1), "wunschfarbe": "blau"}

        assert_rejects(FLPostBewerbungPayload, submission(trikot=over), "vorhandener_satz")

    def test_a_kit_description_at_the_ceiling_is_accepted(self):
        """The control: without it the case above would pass on a field that refuses everything."""

        at_the_bound = {"vorhandener_satz": "T" * BEWERBUNG_TRIKOT_SATZ_MAX_LENGTH, "wunschfarbe": "blau"}

        parsed = FLPostBewerbungPayload.model_validate(submission(trikot=at_the_bound))

        assert len(parsed.trikot.vorhandener_satz) == BEWERBUNG_TRIKOT_SATZ_MAX_LENGTH

    def test_a_school_owning_no_kit_still_writes_nothing(self):
        """A ceiling and no FLOOR: the empty string is the honest answer, not a value somebody has to invent."""

        assert FLPostBewerbungPayload.model_validate(submission(trikot={"vorhandener_satz": "", "wunschfarbe": "blau"})).trikot is not None

    def test_the_read_model_takes_a_stored_value_over_the_ceiling(self):
        """The bound is the WRITE side's alone: refusing on read would 500 the triage list over one row (`docs/backend/spec.md :: I36`)."""

        stored = {"vorhandener_satz": "T" * (BEWERBUNG_TRIKOT_SATZ_MAX_LENGTH * 2), "wunschfarbe": None}

        assert FLBewerbungTrikot.model_validate(stored).wunschfarbe is None

    def test_a_padded_kuerzel_is_trimmed_to_fit_rather_than_refused(self):
        """The strip runs before the width is counted, as it does on every payload string carrying a floor."""

        parsed = FLPostBewerbungPayload.model_validate(submission(team_id=None, schule=schule(shorthand=" ZX ")))

        assert parsed.schule is not None
        assert parsed.schule.shorthand == "ZX"


# Every ceiling this branch put on the PUBLIC payload, as (label, the field's path, the bound). One
# row per field rather than per constant, so two fields sharing a constant are still both exercised.
PUBLIC_CEILINGS = [
    pytest.param("schule.team_name", "team_name", BEWERBUNG_TEAM_NAME_MAX_LENGTH, id="the club's short name"),
    pytest.param("schule.full_name", "full_name", BEWERBUNG_FULL_NAME_MAX_LENGTH, id="the school's full name"),
]

NAME_SEATS = [(seat, part) for seat in ("trainer", "ansprechperson", "stellvertretung") for part in ("vorname", "nachname")]


class TestTheCeilingsOnWhatAStrangerMayType:
    """The fields an anonymous caller fills in. Bounded HERE and not on the shared admin payloads.

    `team_name` is the sharpest: acceptance copies it to `teams.name`, which reaches the junction
    row, every fixture side and the public league table.
    """

    @pytest.mark.parametrize(("label", "field", "cap"), PUBLIC_CEILINGS)
    def test_a_school_field_over_its_ceiling_is_refused(self, label: str, field: str, cap: int, assert_rejects):
        over = schule(**{field: "S" * (cap + 1)})

        assert_rejects(FLPostBewerbungPayload, submission(team_id=None, schule=over), field)

    @pytest.mark.parametrize(("label", "field", "cap"), PUBLIC_CEILINGS)
    def test_a_school_field_at_its_ceiling_is_accepted(self, label: str, field: str, cap: int):
        """The control: without it each case above would pass on a field that refuses everything."""

        at_the_bound = schule(**{field: "S" * cap})
        parsed = FLPostBewerbungPayload.model_validate(submission(team_id=None, schule=at_the_bound))

        assert parsed.schule is not None
        assert len(getattr(parsed.schule, field)) == cap

    @pytest.mark.parametrize(("seat", "part"), NAME_SEATS, ids=lambda value: value)
    def test_a_contact_name_over_its_ceiling_is_refused(self, seat: str, part: str):
        """All six, because a ceiling holding for one seat and not the next is one nobody can rely on."""

        long_name = "A" * (BEWERBUNG_KONTAKT_NAME_MAX_LENGTH + 1)

        with pytest.raises(ValidationError):
            FLBewerbungKontaktePayload.model_validate(kontakte(**{seat: person(**{part: long_name})}))

    @pytest.mark.parametrize("part", ["vorname", "nachname"])
    def test_a_contact_name_at_its_ceiling_is_accepted(self, part: str):
        at_the_bound = person(**{part: "A" * BEWERBUNG_KONTAKT_NAME_MAX_LENGTH})

        assert len(getattr(FLBewerbungKontaktpersonPayload.model_validate(at_the_bound), part)) == BEWERBUNG_KONTAKT_NAME_MAX_LENGTH

    @pytest.mark.parametrize("part", ["vorname", "nachname"])
    def test_redeclaring_the_name_kept_its_pattern_and_its_strip(self, part: str):
        """A redeclaration REPLACES the field, so the alphabet and the strip had to be restated with the ceiling."""

        with pytest.raises(ValidationError):
            FLBewerbungKontaktpersonPayload.model_validate(person(**{part: "Quill4"}))

        assert getattr(FLBewerbungKontaktpersonPayload.model_validate(person(**{part: "  Quillhilde  "})), part) == "Quillhilde"


class TestTheCeilingOnTheSchoolWebsite:
    """`validate_external_url` reads the scheme and the host; the path and the query are this bound's alone."""

    def test_a_url_at_the_ceiling_is_accepted(self):
        """The control, and the anchor for the two cases below."""

        at_the_bound = _url_of_length(BEWERBUNG_WEBSITE_URL_MAX_LENGTH)

        assert len(at_the_bound) == BEWERBUNG_WEBSITE_URL_MAX_LENGTH
        assert FLBewerbungSchulePayload.model_validate(schule(website_url=at_the_bound)).website_url == at_the_bound

    def test_a_url_one_character_over_is_refused(self, assert_rejects):
        """Valid in scheme and host, so the LENGTH is the only thing that can be refusing it."""

        assert_rejects(FLBewerbungSchulePayload, schule(website_url=_url_of_length(BEWERBUNG_WEBSITE_URL_MAX_LENGTH + 1)), "website_url")

    def test_an_oversized_value_is_refused_before_the_host_regex_reads_it(self):
        """Why the ceiling is declared BEFORE the validator rather than around it.

        `DOMAIN_REGEX` carries nested quantifiers, so a megabyte of host is work this refuses
        without doing. Wrap `CustomExternalUrl` instead and this becomes `value_error`.
        """

        enormous = "javascript:" + "a" * (BEWERBUNG_WEBSITE_URL_MAX_LENGTH * 40)

        with pytest.raises(ValidationError) as failure:
            FLBewerbungSchulePayload.model_validate(schule(website_url=enormous))

        assert failure.value.errors()[0]["type"] == "string_too_long"

    def test_a_short_url_is_still_judged_on_its_scheme(self):
        """The control for the case above: a ceiling that swallowed the validator would accept this."""

        with pytest.raises(ValidationError) as failure:
            FLBewerbungSchulePayload.model_validate(schule(website_url="javascript:alert(1)"))

        assert failure.value.errors()[0]["type"] == "value_error"


class TestTheSquadEstimateIsBoundedAsASquad:
    """The sharper half: the validator types both `int`, so without a ceiling an anonymous caller reaches a 500 by typing a number."""

    # The squad sits AT the ceiling in every case below, so a `gute_spieler` row cannot be refused by
    # the subset rule instead of by the bound it is about.
    AT_THE_SQUAD_CEILING = {"voraussichtliche_groesse": BEWERBUNG_KADER_GROESSE_MAX, "gute_spieler": 3}

    @pytest.mark.parametrize("field", ["voraussichtliche_groesse", "gute_spieler"])
    def test_a_count_over_the_ceiling_is_refused(self, field: str, assert_rejects):
        over = {**self.AT_THE_SQUAD_CEILING, field: BEWERBUNG_KADER_GROESSE_MAX + 1}

        assert_rejects(FLPostBewerbungPayload, submission(kader=over), field)

    @pytest.mark.parametrize("field", ["voraussichtliche_groesse", "gute_spieler"])
    def test_a_count_at_the_ceiling_is_accepted(self, field: str):
        """The control: without it each case above would pass on a field that refuses everything."""

        at_the_bound = {**self.AT_THE_SQUAD_CEILING, field: BEWERBUNG_KADER_GROESSE_MAX}

        assert getattr(FLPostBewerbungPayload.model_validate(submission(kader=at_the_bound)).kader, field) == BEWERBUNG_KADER_GROESSE_MAX

    @pytest.mark.parametrize("field", ["voraussichtliche_groesse", "gute_spieler"])
    def test_a_value_past_int32_is_a_422_here_rather_than_a_500_at_the_validator(self, field: str, assert_rejects):
        """The defect this bound exists for: `bsonType: "int"` is 32-bit, so an unbounded field answered 500 where this promises 422."""

        past_int32 = {**self.AT_THE_SQUAD_CEILING, field: 2**31}

        assert_rejects(FLPostBewerbungPayload, submission(kader=past_int32), field)


class TestNoCeilingReachesTheReadSide:
    """Every bound above is the WRITE side's alone.

    A read model refusing a stored value answers 500 for a whole list over one row
    (`docs/backend/spec.md :: I36`), and the triage list is what an administrator repairs one from.
    """

    def test_a_stored_school_over_every_string_ceiling_still_reads(self):
        stored = {
            "team_name": "T" * (BEWERBUNG_TEAM_NAME_MAX_LENGTH * 3),
            "full_name": "F" * (BEWERBUNG_FULL_NAME_MAX_LENGTH * 3),
            "shorthand": "ZX",
            "schulform": None,
            "address": dict(ADDRESS),
            "website_url": _url_of_length(BEWERBUNG_WEBSITE_URL_MAX_LENGTH * 3),
        }

        assert len(FLBewerbungSchule.model_validate(stored).team_name) == BEWERBUNG_TEAM_NAME_MAX_LENGTH * 3

    def test_a_stored_contact_over_the_name_ceiling_still_reads(self):
        """Read through the junction's own block, which is what every triage read of an application goes through."""

        long_name = "A" * (BEWERBUNG_KONTAKT_NAME_MAX_LENGTH * 3)
        stored = {
            **person(vorname=long_name, nachname=long_name),
            "einwilligung": {"umfang": "kontaktdaten", "erteilt_von": "person", "text_version": "v3", "datum": TODAY},
        }

        assert len(FLKontaktperson.model_validate(stored).vorname) == BEWERBUNG_KONTAKT_NAME_MAX_LENGTH * 3

    def test_a_stored_squad_over_the_count_ceiling_still_reads(self):
        stored = {"voraussichtliche_groesse": BEWERBUNG_KADER_GROESSE_MAX * 100, "gute_spieler": BEWERBUNG_KADER_GROESSE_MAX * 100}

        assert FLBewerbungKader.model_validate(stored).voraussichtliche_groesse == BEWERBUNG_KADER_GROESSE_MAX * 100


class TestWhatTheApplicantMustChoose:
    """Three fields the public form leaves nobody an "unbeantwortet" answer to.

    Each is tighter here than on the stored shape or on the shared payload, and each case below has
    a read-side twin proving the stored side stayed loose.
    """

    def test_a_submission_naming_a_null_schulform_is_refused(self, assert_rejects):
        """The six real ones and no "keine Angabe": the applicant picks the school they are applying from."""

        assert_rejects(FLPostBewerbungPayload, submission(team_id=None, schule=schule(schulform=None)), "schulform")

    def test_a_submission_omitting_the_schulform_is_refused(self, assert_rejects):
        """Required as well as non-null, so an omitted key is not a quiet null either."""

        without = {key: value for key, value in schule().items() if key != "schulform"}

        assert_rejects(FLPostBewerbungPayload, submission(team_id=None, schule=without), "schulform")

    def test_a_stored_school_with_no_schulform_still_reads(self):
        """Clubs predate the field, so the read model refusing a stored null would 500 the triage list."""

        assert FLBewerbungSchule.model_validate(schule(schulform=None)).schulform is None

    @pytest.mark.parametrize(
        "stadtteil",
        [pytest.param("", id="the empty string"), pytest.param("   ", id="spaces alone, which the strip empties")],
    )
    def test_a_submission_naming_no_stadtteil_is_refused(self, stadtteil: str, assert_rejects):
        """Required on THIS payload alone: a venue can genuinely lack a district and a Frankfurt school cannot."""

        without = schule(address={**ADDRESS, "stadtteil": stadtteil})

        assert_rejects(FLPostBewerbungPayload, submission(team_id=None, schule=without), "stadtteil")

    def test_the_shared_address_payload_still_takes_an_empty_stadtteil(self):
        """`FLAddressPayload` is an admin address too, and this branch must not have narrowed it."""

        assert FLAddressPayload.model_validate({**ADDRESS, "stadtteil": ""}).stadtteil == ""

    @pytest.mark.parametrize(
        "kader",
        [
            pytest.param({"voraussichtliche_groesse": 14, "gute_spieler": None}, id="a null count"),
            pytest.param({"voraussichtliche_groesse": 14}, id="no count at all"),
        ],
    )
    def test_a_submission_naming_no_gute_spieler_is_refused(self, kader: dict[str, Any], assert_rejects):
        """Non-nullable everywhere now, the validator included: none of them is zero rather than absent."""

        assert_rejects(FLPostBewerbungPayload, submission(kader=kader), "gute_spieler")

    def test_a_count_of_zero_is_still_a_count(self):
        """The control: a school expecting no strong players answers zero, which `ge=0` admits and null does not."""

        assert FLPostBewerbungPayload.model_validate(submission(kader={"voraussichtliche_groesse": 14, "gute_spieler": 0})).kader is not None

    def test_the_read_model_refuses_a_null_count_too(self):
        """`gute_spieler` is non-nullable on every side, not the payload alone, so the read moved with the validator."""

        with pytest.raises(ValidationError):
            FLBewerbungKader.model_validate({"voraussichtliche_groesse": 14, "gute_spieler": None})


class TestTheStrongPlayersFitInsideTheSquad:
    """A subset cannot outnumber the whole.

    Both figures are the school's own estimate, so an impossible pair is a typo the form catches
    rather than a judgement about the school.
    """

    @pytest.mark.parametrize(
        ("groesse", "gute"),
        [
            pytest.param(14, 13, id="comfortably inside"),
            pytest.param(14, 14, id="the whole squad, which is the boundary"),
            pytest.param(1, 0, id="the smallest squad and no strong player"),
        ],
    )
    def test_a_count_at_or_below_the_squad_is_accepted(self, groesse: int, gute: int):
        """Equal is accepted: a school may rate every player it expects."""

        kader = {"voraussichtliche_groesse": groesse, "gute_spieler": gute}

        assert FLPostBewerbungPayload.model_validate(submission(kader=kader)).kader.gute_spieler == gute

    @pytest.mark.parametrize(
        ("groesse", "gute"),
        [
            pytest.param(14, 15, id="one over the squad"),
            pytest.param(1, 2, id="one over the smallest squad"),
            pytest.param(14, BEWERBUNG_KADER_GROESSE_MAX, id="inside its own ceiling and still past the squad"),
        ],
    )
    def test_a_count_above_the_squad_is_refused(self, groesse: int, gute: int):
        """The third row matters: both fields clear their own bounds, so only the pair rule can refuse it."""

        kader = {"voraussichtliche_groesse": groesse, "gute_spieler": gute}

        with pytest.raises(ValidationError) as failure:
            FLPostBewerbungPayload.model_validate(submission(kader=kader))

        assert "guten Spieler" in str(failure.value)

    def test_the_refusal_is_German_and_names_both_figures(self):
        """It surfaces as a 422 on a public form, and the Zod mirror carries this exact wording."""

        with pytest.raises(ValidationError, match="Die Anzahl der guten Spieler darf die voraussichtliche Kadergröße nicht überschreiten."):
            FLPostBewerbungPayload.model_validate(submission(kader={"voraussichtliche_groesse": 5, "gute_spieler": 6}))


class TestASchoolWithNoWebsite:
    """`website_url` is optional on the club and on the application both, spelled NULL.

    The empty string coerces to it on the way in, as every other optional value here does: an empty
    `href` is a link to the page it sits on.
    """

    @pytest.mark.parametrize(
        "submitted",
        [pytest.param(None, id="an explicit null"), pytest.param("", id="an empty box"), pytest.param("   ", id="spaces alone")],
    )
    def test_a_submission_naming_no_website_stores_a_null(self, submitted: str | None):
        parsed = FLPostBewerbungPayload.model_validate(submission(team_id=None, schule=schule(website_url=submitted)))

        assert parsed.schule is not None
        assert parsed.schule.website_url is None

    def test_a_real_url_still_survives_intact(self):
        """The control: a field that answered `None` to everything would satisfy every case above."""

        parsed = FLPostBewerbungPayload.model_validate(submission(team_id=None, schule=schule()))

        assert parsed.schule is not None
        assert parsed.schule.website_url == "https://zorbanax.example.de"

    def test_a_bad_url_is_still_refused(self):
        """Optional is not unchecked: a value that IS there is still judged, scheme and all."""

        with pytest.raises(ValidationError):
            FLPostBewerbungPayload.model_validate(submission(team_id=None, schule=schule(website_url="javascript:alert(1)")))

    def test_a_stored_application_naming_no_website_still_reads(self):
        """The direction that ships silently: the triage list parses every stored application through this model."""

        assert FLBewerbungSchule.model_validate(schule(website_url=None)).website_url is None

    def test_the_club_model_takes_a_null_on_both_sides(self):
        """Read and write alike: `_TeamWritable` is the base of both, so the shape moved once."""

        assert FLPostTeamPayload.model_validate({**CLUB, "website_url": None}).website_url is None
        assert FLTeam.model_validate({**CLUB, **CLUB_READ_ONLY, "website_url": None}).website_url is None

    def test_a_club_stored_with_no_website_still_reads(self):
        """The half that ships silently: a read model refusing this would 500 the whole clubs list."""

        assert FLTeamRecord.model_validate({**CLUB, "_id": str(PICKED_OID), "inactive_since": None, "website_url": None}).website_url is None


class TestTheColourTheSchoolWants:
    """Required on the PUBLIC payload and nullable on the stored shape.

    An applicant names the colour they want; the administrator assigning the real one at acceptance
    may leave it open.
    """

    @pytest.mark.parametrize(
        "trikot",
        [
            pytest.param({"vorhandener_satz": "12 rote Trikots", "wunschfarbe": None}, id="an explicit null"),
            pytest.param({"vorhandener_satz": "12 rote Trikots"}, id="no colour at all"),
        ],
    )
    def test_a_submission_naming_no_colour_is_refused(self, trikot: dict[str, Any], assert_rejects):
        """The browser now agrees: nothing picked is genuinely empty, so the server refusing it is the same answer."""

        assert_rejects(FLPostBewerbungPayload, submission(trikot=trikot), "wunschfarbe")

    def test_every_colour_the_league_offers_is_accepted(self):
        """The control, over the whole enum: a field refusing everything would satisfy the cases above."""

        offered = get_args(FLTrikotFarbe)

        assert len(offered) == 16
        for colour in offered:
            trikot = {"vorhandener_satz": "12 rote Trikots", "wunschfarbe": colour}
            assert FLPostBewerbungPayload.model_validate(submission(trikot=trikot)).trikot.wunschfarbe == colour

    def test_a_colour_the_league_does_not_offer_is_refused(self):
        """Required did not become unchecked: the value is still one of the sixteen."""

        with pytest.raises(ValidationError):
            FLPostBewerbungPayload.model_validate(submission(trikot={"vorhandener_satz": "", "wunschfarbe": "zorbanaxgruen"}))

    def test_a_stored_application_naming_no_colour_still_reads(self):
        """The direction that ships silently: the triage list parses every stored application through this model."""

        assert FLBewerbungTrikot.model_validate({"vorhandener_satz": "", "wunschfarbe": None}).wunschfarbe is None


class TestAPastedWebsiteIsTrimmedToFit:
    """`validate_external_url` leaves surrounding whitespace on the value, so the payloads strip first.

    Asymmetric without it: a leading space was stored ON the URL, while a trailing one was refused
    saying the value pointed at no domain.
    """

    @pytest.mark.parametrize(
        "pasted",
        [
            pytest.param(" https://zorbanax.example.de", id="a leading space"),
            pytest.param("https://zorbanax.example.de ", id="a trailing space"),
            pytest.param("  https://zorbanax.example.de  ", id="both ends"),
            pytest.param("\thttps://zorbanax.example.de\n", id="a tab and a newline"),
        ],
    )
    def test_the_stored_value_carries_no_whitespace(self, pasted: str):
        parsed = FLPostBewerbungPayload.model_validate(submission(team_id=None, schule=schule(website_url=pasted)))

        assert parsed.schule is not None
        assert parsed.schule.website_url == "https://zorbanax.example.de"

    def test_the_admin_club_payload_strips_it_too(self):
        """The same field on the same base: acceptance parses a school's block through this model."""

        pasted = {**CLUB, "website_url": " https://zorbanax.example.de "}

        assert FLPostTeamPayload.model_validate(pasted).website_url == "https://zorbanax.example.de"

    def test_whitespace_alone_is_still_no_website_rather_than_a_bad_one(self):
        """The strip and the null coercion in one order: spaces collapse to absence, never to `""`."""

        parsed = FLPostBewerbungPayload.model_validate(submission(team_id=None, schule=schule(website_url="   ")))

        assert parsed.schule is not None
        assert parsed.schule.website_url is None

    # The code POINTS, not the characters: a literal control byte in this file is a syntax error.
    @pytest.mark.parametrize("code_point", [0x00, 0x01, 0x0B, 0x1C, 0x1F])
    def test_a_c0_control_is_stripped_too(self, code_point: int):
        """Pydantic's strip is `White_Space`, which none of these is; `urlsplit` discards them all.

        Without this the value validates on the stripped text and is stored with the control on it.
        """

        pasted = f"{chr(code_point)}https://zorbanax.example.de"
        parsed = FLPostBewerbungPayload.model_validate(submission(team_id=None, schule=schule(website_url=pasted)))

        assert parsed.schule is not None
        assert parsed.schule.website_url == "https://zorbanax.example.de"

    def test_a_url_at_the_ceiling_with_a_leading_space_is_still_accepted(self):
        """The ORDER: the strip runs before `max_length` counts, so a pasted 300-character URL fits.

        Move it after and this is `string_too_long` -- a valid URL refused for a space nobody typed
        on purpose, which no other case here would notice.
        """

        pasted = f" {_url_of_length(BEWERBUNG_WEBSITE_URL_MAX_LENGTH)}"

        assert len(pasted) == BEWERBUNG_WEBSITE_URL_MAX_LENGTH + 1

        parsed = FLPostBewerbungPayload.model_validate(submission(team_id=None, schule=schule(website_url=pasted)))

        assert parsed.schule is not None
        assert len(parsed.schule.website_url or "") == BEWERBUNG_WEBSITE_URL_MAX_LENGTH

    def test_the_read_model_returns_a_stored_value_untouched(self):
        """`docs/backend/spec.md :: I36`: the strip is the WRITE side's, so a read may not transform one.

        Push `strip_whitespace` onto `_TeamWritable` and this fails -- the read would hand back text
        the database does not hold.
        """

        stored = " https://zorbanax.example.de"

        assert FLTeam.model_validate({**CLUB, **CLUB_READ_ONLY, "website_url": stored}).website_url == stored

    def test_a_bad_scheme_wrapped_in_spaces_is_still_refused(self):
        """The control: stripping must not become a way past the check the strip runs before."""

        with pytest.raises(ValidationError):
            FLPostBewerbungPayload.model_validate(submission(team_id=None, schule=schule(website_url="  javascript:alert(1)  ")))


class _RecordingCursor:
    """The three calls `pull_many_from_db` chains onto a find, and nothing else."""

    def __init__(self, documents: list[dict[str, Any]]) -> None:
        self._documents = documents

    def sort(self, *_: Any) -> "_RecordingCursor":
        return self

    def limit(self, *_: Any) -> "_RecordingCursor":
        return self

    async def to_list(self, length: Any = None) -> list[dict[str, Any]]:
        return self._documents


class _RecordingCollection:
    """A collection that answers a find and remembers what it was ASKED for.

    What the endpoint requests of the database is behaviour, not source text, so it can be asserted
    without a container and without reading the router's own code.
    """

    def __init__(self, documents: list[dict[str, Any]]) -> None:
        self._documents = documents
        self.projection: Any = "the read never ran"

    def find(self, *, filter: Any = None, projection: Any = None, session: Any = None) -> _RecordingCursor:
        self.projection = projection

        return _RecordingCursor(self._documents)


class TestTheClubListAsksTheDatabaseForTwoFields:
    """The projection, which the allow-list model would otherwise make unobservable.

    Both layers narrow, and this is the one that keeps a club's address from crossing the wire at
    all rather than being dropped after it arrives.
    """

    def test_the_read_projects_the_name_alone(self):
        stored = [{"_id": PICKED_OID, "name": "Zorbanax", "website_url": "https://zorbanax.example.de", "address": dict(ADDRESS)}]
        collection = _RecordingCollection(stored)

        response = asyncio.run(get_schulen(teams_collection=cast(Any, collection)))

        assert collection.projection == ["name"]
        # Non-vacuous: the read really ran and really served the club, so what is asserted above is
        # what it asked for rather than a request nothing made.
        assert [option.name for option in response.schulen] == ["Zorbanax"]

    def test_the_read_asks_only_for_clubs_still_in_the_league(self):
        """The filter beside the projection: a retired club is not one a school may apply as."""

        collection = _RecordingCollection([])

        asyncio.run(get_schulen(teams_collection=cast(Any, collection)))

        assert collection.projection == ["name"]
