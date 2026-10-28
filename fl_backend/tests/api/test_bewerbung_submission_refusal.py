from __future__ import annotations

import asyncio
from collections.abc import Mapping
from typing import Any, cast, get_args

import pytest
from bson import ObjectId
from pydantic import ValidationError

from app.api.bewerbungen.public_router import get_trikotfarben
from app.api.bewerbungen.schemas import (
    FLBewerbung,
    FLBewerbungKontaktePayload,
    FLBewerbungKontaktpersonPayload,
    FLBewerbungSchule,
    FLBewerbungSchulePayload,
    FLBewerbungTrikot,
    FLPostBewerbungPayload,
)
from app.api.bewerbungen.services import (
    assigned_trikot_farben,
    bestaetigungsfrist_from,
    compose_bestaetigungen,
    compose_einwilligung,
    compose_kontakte,
)
from app.api.teams.schemas import (
    KONTAKT_ROLLEN,
    FLKontaktperson,
    FLKontaktpersonPayload,
    FLTrikotFarbe,
    normalise_telefon,
)
from app.core.exceptions import DocumentNotFoundException
from app.shared.schemas.bounds import (
    BEWERBUNG_KADER_GROESSE_MAX,
    BEWERBUNG_STUFENGROESSE_MAX,
    BEWERBUNG_TRIKOT_SATZ_MAX_LENGTH,
    BEWERBUNG_WUNSCHGEGNER_MAX_LENGTH,
    KONTAKT_NAME_MAX_LENGTH,
    TEAM_FULL_NAME_MAX_LENGTH,
    TEAM_NAME_MAX_LENGTH,
    TEAM_WEBSITE_URL_MAX_LENGTH,
)
from tests.documents import ADDRESS, kontaktperson_document

# Fixed rather than generated, so a failure names the same club every run. Its own hex range, as
# every other module in this suite carves one.
PICKED_OID = ObjectId("6890a1b2c3d4e5f607930001")

TODAY = "2026-04-01"


# Every character `app/shared/schemas/custom.py :: SINGLE_LINE_PATTERN` refuses, written as code
# points: a literal one here would be invisible in this file and in every diff of it.
REFUSED_CHARACTERS = [
    pytest.param(chr(0x00), id="NUL"),
    pytest.param(chr(0x0A), id="LF"),
    pytest.param(chr(0x0B), id="VT"),
    pytest.param(chr(0x0C), id="FF"),
    pytest.param(chr(0x0D), id="CR"),
    pytest.param(chr(0x0D) + chr(0x0A), id="CRLF"),
    pytest.param(chr(0x85), id="NEL"),
    pytest.param(chr(0x2028), id="LINE SEPARATOR"),
    pytest.param(chr(0x2029), id="PARAGRAPH SEPARATOR"),
]

# The refused characters Unicode calls white space, so `strip_whitespace` removes them before the
# pattern runs. NUL is the one left out: it is no more whitespace here than it is in the mirror.
TRIMMED_CHARACTERS = [case for case in REFUSED_CHARACTERS if case.id != "NUL"]


def person(**overrides: Any) -> dict[str, Any]:
    """One contact person as the public form submits them."""

    return {
        "vorname": "Quillhilde",
        "nachname": "Brackenmoor",
        "email": "quillhilde@example.com",
        "telefon": "+49 170 1234567",
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
        "stufengroesse": 90,
        **overrides,
    }


# A real scheme and a real host, padded in the PATH -- the half `validate_external_url` never reads,
# so a case built on it is refused by the ceiling and by nothing else.
_URL_STEM = "https://zorbanax.example.de/"


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


# A date no living contact person could carry: born after the bound's floor whatever `today` is.
A_CHILDS_BIRTHDATE = "2018-01-01"

# What the junction's own editor sends for one person's consent: the source and the stamp are on no
# payload.
JUNCTION_EINWILLIGUNG: Mapping[str, Any] = {"umfang": "kontaktdaten", "text_version": "v3", "datum": TODAY}


class TestNoBirthdateOnAnyPayload:
    """The date reaches the league from its own person at their confirmation, so no payload spells the key."""

    @pytest.mark.parametrize("seat", ["trainer", "ansprechperson", "stellvertretung"])
    def test_a_submission_naming_a_birthdate_on_any_seat_is_refused_outright(self, seat: str):
        block = kontakte(**{seat: person(geburtsdatum="1984-05-09")})

        with pytest.raises(ValidationError) as failure:
            FLPostBewerbungPayload.model_validate(submission(kontakte=block))

        assert [(entry["type"], entry["loc"][-1]) for entry in failure.value.errors()] == [("extra_forbidden", "geburtsdatum")]

    def test_a_null_birthdate_is_refused_rather_than_accepted_as_absent(self):
        """The rejected shape: a `geburtsdatum: None` override would take the key as an explicit null, where the form asks nothing."""

        with pytest.raises(ValidationError) as failure:
            FLBewerbungKontaktpersonPayload.model_validate(person(geburtsdatum=None))

        assert [entry["type"] for entry in failure.value.errors()] == ["extra_forbidden"]

    def test_the_junction_payload_refuses_the_key_as_the_public_one_does(self):
        """Refused rather than bounded: an age floor on this payload would still let an administrator name a date only its subject may give."""

        junction_person = {**person(), "geburtsdatum": A_CHILDS_BIRTHDATE, "einwilligung": dict(JUNCTION_EINWILLIGUNG)}

        with pytest.raises(ValidationError) as failure:
            FLKontaktpersonPayload.model_validate(junction_person)

        assert [(entry["type"], entry["loc"][-1]) for entry in failure.value.errors()] == [("extra_forbidden", "geburtsdatum")]

    def test_the_junction_payload_takes_a_whole_person_without_one(self):
        """The floor under the case above: required, every save composed before that seat's person answers would be refused."""

        composed = FLKontaktpersonPayload.model_validate({**person(), "einwilligung": dict(JUNCTION_EINWILLIGUNG)})

        assert "geburtsdatum" not in composed.model_dump(mode="json")

    def test_a_stored_contact_with_no_date_still_reads(self):
        """A seat is stored with a null one until its person confirms, so a non-null field here would 500 the triage over one."""

        record = {**person(), "geburtsdatum": None, "einwilligung": kontaktperson_document("Quillhilde")["einwilligung"]}

        assert FLKontaktperson.model_validate(record).geburtsdatum is None


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
    """The two `model_validator`s, so `REQ-VAL-001` rather than a rule's code: shape rules about the body, which the model judges."""

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
        """Every other detail the seat's own: a seat sharing both, either rule would hide the other's removal."""

        other = {**person(vorname="Andere", email="andere@example.com", telefon="+49 170 9999999"), field: value}

        with pytest.raises(ValidationError):
            FLBewerbungKontaktePayload.model_validate(kontakte(**{seat: other}))

    def test_an_email_repeated_in_another_case_is_still_one_address(self):
        """A mailbox is addressed the same however the local part is capitalised, so the comparison folds case.

        Its own telephone, or the number rule would fire here and this would prove nothing about case.
        """

        other = person(vorname="Andere", email="QUILLHILDE@Example.com", telefon="+49 170 9999999")

        with pytest.raises(ValidationError):
            FLBewerbungKontaktePayload.model_validate(kontakte(ansprechperson=other))

    def test_an_email_repeated_with_a_full_width_letter_in_its_domain_is_still_one_address(self):
        """The domain's conversion makes it ASCII, so a second person here is one sign-in reaching two seats."""

        # Built from its code point: the full-width „e“ renders as the ASCII one the conversion makes it.
        other = person(vorname="Andere", email=f"quillhilde@{chr(0xFF45)}xample.com", telefon="+49 170 9999999")

        with pytest.raises(ValidationError):
            FLBewerbungKontaktePayload.model_validate(kontakte(ansprechperson=other))

    def test_a_domain_spelled_with_ss_where_another_seat_holds_sharp_s_is_another_address(self):
        """IDNA 2008 and the sign-in fold read „straße“ and „strasse“ as two domains, where `casefold` made them one."""

        trainer = person(email="quillhilde@straße.de")
        other = person(vorname="Andere", email="quillhilde@strasse.de", telefon="+49 170 9999999")

        assert FLBewerbungKontaktePayload.model_validate(kontakte(trainer=trainer, ansprechperson=other)) is not None

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

    def test_a_seat_records_the_acknowledgement_on_the_persons_behalf_and_who_seated_them(self):
        """One person ticked for three: who seated each person is recorded, and nobody's answer is."""

        composed = compose_einwilligung(text_version="v3", today=TODAY, eingetragen_von="bewerbung")

        assert composed == {
            "umfang": "kontaktdaten",
            "text_version": "v3",
            "datum": TODAY,
            "bestaetigt_am": None,
            "medien": False,
            "eingetragen_von": "bewerbung",
        }

    def test_the_composed_block_stores_no_field_the_payload_carried_beside_the_wording(self):
        """`erteilt` is the form's tickbox, not a stored field: the record IS the consent, and `False` is a body this endpoint refuses."""

        composed = compose_kontakte(kontakte=FLBewerbungKontaktePayload.model_validate(kontakte()).model_dump(mode="json"), today=TODAY)

        assert set(composed["trainer"]["einwilligung"]) == {
            "umfang",
            "text_version",
            "datum",
            "bestaetigt_am",
            "medien",
            "eingetragen_von",
        }

    @pytest.mark.parametrize("seat", ["trainer", "ansprechperson", "stellvertretung"])
    def test_no_seat_carries_a_confirmation_or_a_birthdate_at_submission(self, seat: str):
        """Both keys are written null rather than left off, as `wunschgegner` is: each marks what the confirmation fills in."""

        composed = compose_kontakte(kontakte=FLBewerbungKontaktePayload.model_validate(kontakte()).model_dump(mode="json"), today=TODAY)

        assert "bestaetigt_am" in composed[seat]["einwilligung"] and composed[seat]["einwilligung"]["bestaetigt_am"] is None
        assert "geburtsdatum" in composed[seat] and composed[seat]["geburtsdatum"] is None

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

    @pytest.mark.parametrize("field", ["umfang", "eingetragen_von", "datum", "bestaetigt_am"])
    def test_a_client_may_not_name_a_field_the_server_composes(self, field: str):
        """`extra="forbid"`: a body naming one of these could claim a person's own consent or its seating, or backdate or pre-confirm one."""

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

    @pytest.mark.parametrize("refused", REFUSED_CHARACTERS)
    def test_a_school_name_carrying_one_of_them_inside_is_refused(self, refused: str):
        """Both name fields, so a pattern applied to one of the pair fails here rather than shipping half-narrowed."""

        forged = f"Zorbanax{refused}Entscheidung: Absage"

        for field in ("team_name", "full_name"):
            with pytest.raises(ValidationError):
                FLPostBewerbungPayload.model_validate(submission(team_id=None, schule=schule(**{field: forged})))

    @pytest.mark.parametrize("trimmed", TRIMMED_CHARACTERS)
    def test_a_school_name_padded_with_one_of_them_is_repaired_rather_than_refused(self, trimmed: str):
        """The control, and the reason this is a pattern rather than a rejection of the character.

        `strip_whitespace` runs BEFORE the pattern, so padding is the paste artefact it usually is;
        only an interior character is refused.
        """

        padded = submission(team_id=None, schule=schule(team_name=f"{trimmed}Zorbanax{trimmed}"))

        parsed = FLPostBewerbungPayload.model_validate(padded)

        assert parsed.schule is not None and parsed.schule.team_name == "Zorbanax"

    def test_a_school_name_padded_with_nul_is_refused_rather_than_trimmed(self):
        """The one refused character `strip_whitespace` does not remove, which is also what the JavaScript mirror's `trim` does."""

        padded = submission(team_id=None, schule=schule(team_name=f"{chr(0x00)}Zorbanax{chr(0x00)}"))

        with pytest.raises(ValidationError):
            FLPostBewerbungPayload.model_validate(padded)

    @pytest.mark.parametrize("refused", REFUSED_CHARACTERS)
    def test_a_stored_name_holding_one_of_them_still_reads(self, refused: str):
        """The narrowing is the PAYLOAD's alone: a read model refusing a stored value would 500 the triage list."""

        stored = FLBewerbungSchule.model_validate(schule(team_name=f"Zorbanax{refused}Alt", full_name=f"Zorbanax{refused}Alt"))

        assert stored.team_name == f"Zorbanax{refused}Alt"

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
        """The bound is the WRITE side's alone: refusing on read would 500 the triage list over one row."""

        stored = {"vorhandener_satz": "T" * (BEWERBUNG_TRIKOT_SATZ_MAX_LENGTH * 2), "wunschfarbe": "blau"}

        assert len(FLBewerbungTrikot.model_validate(stored).vorhandener_satz) == BEWERBUNG_TRIKOT_SATZ_MAX_LENGTH * 2

    def test_a_padded_kuerzel_is_trimmed_to_fit_rather_than_refused(self):
        """The strip runs before the width is counted, as it does on every payload string carrying a floor."""

        parsed = FLPostBewerbungPayload.model_validate(submission(team_id=None, schule=schule(shorthand=" ZX ")))

        assert parsed.schule is not None
        assert parsed.schule.shorthand == "ZX"


# Every ceiling this branch put on the PUBLIC payload, as (label, the field's path, the bound). One
# row per field rather than per constant, so two fields sharing a constant are still both exercised.
PUBLIC_CEILINGS = [
    pytest.param("schule.team_name", "team_name", TEAM_NAME_MAX_LENGTH, id="the club's short name"),
    pytest.param("schule.full_name", "full_name", TEAM_FULL_NAME_MAX_LENGTH, id="the school's full name"),
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

        long_name = "A" * (KONTAKT_NAME_MAX_LENGTH + 1)

        with pytest.raises(ValidationError):
            FLBewerbungKontaktePayload.model_validate(kontakte(**{seat: person(**{part: long_name})}))

    @pytest.mark.parametrize("part", ["vorname", "nachname"])
    def test_a_contact_name_at_its_ceiling_is_accepted(self, part: str):
        at_the_bound = person(**{part: "A" * KONTAKT_NAME_MAX_LENGTH})

        assert len(getattr(FLBewerbungKontaktpersonPayload.model_validate(at_the_bound), part)) == KONTAKT_NAME_MAX_LENGTH

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

        at_the_bound = _url_of_length(TEAM_WEBSITE_URL_MAX_LENGTH)

        assert len(at_the_bound) == TEAM_WEBSITE_URL_MAX_LENGTH
        assert FLBewerbungSchulePayload.model_validate(schule(website_url=at_the_bound)).website_url == at_the_bound

    def test_a_url_one_character_over_is_refused(self, assert_rejects):
        """Valid in scheme and host, so the LENGTH is the only thing that can be refusing it."""

        assert_rejects(FLBewerbungSchulePayload, schule(website_url=_url_of_length(TEAM_WEBSITE_URL_MAX_LENGTH + 1)), "website_url")

    def test_an_oversized_value_is_refused_before_the_host_regex_reads_it(self):
        """Why the ceiling is declared BEFORE the validator rather than around it.

        `DOMAIN_REGEX` carries nested quantifiers, so a megabyte of host is work this refuses
        without doing. Wrap `CustomExternalUrl` instead and this becomes `value_error`.
        """

        enormous = "javascript:" + "a" * (TEAM_WEBSITE_URL_MAX_LENGTH * 40)

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


class TestTheYearGroupIsBoundedAsAYearGroup:
    """Required and floored where `wunschgegner` is neither: a school leaves no "unbeantwortet" answer about its own Abi-Jahrgang."""

    def test_a_size_over_the_ceiling_is_refused(self, assert_rejects):
        """An anonymous caller writes it and `bsonType: "int"` stores it, which is the pair a bound is earned on."""

        assert_rejects(FLPostBewerbungPayload, submission(stufengroesse=BEWERBUNG_STUFENGROESSE_MAX + 1), "stufengroesse")

    def test_a_size_at_the_ceiling_is_accepted(self):
        """The control: without it every case here would pass on a field that refuses everything."""

        at_the_bound = submission(stufengroesse=BEWERBUNG_STUFENGROESSE_MAX)

        assert FLPostBewerbungPayload.model_validate(at_the_bound).stufengroesse == BEWERBUNG_STUFENGROESSE_MAX

    def test_a_year_group_of_nobody_is_refused(self, assert_rejects):
        """The floor `gute_spieler` does not take: zero strong players is an answer and zero pupils is not."""

        assert_rejects(FLPostBewerbungPayload, submission(stufengroesse=0), "stufengroesse")

    def test_an_omitted_size_is_refused_rather_than_read_as_a_null(self, assert_rejects):
        """The whole difference from `wunschgegner`: a form that stopped sending this key is a 422 and never a silent null."""

        without = {key: value for key, value in submission().items() if key != "stufengroesse"}

        assert_rejects(FLPostBewerbungPayload, without, "stufengroesse")


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


def stored_application(**overrides: Any) -> dict[str, Any]:
    """One application in the shape the triage READS it, which is where a narrowed model would fail."""

    return {
        "_id": str(PICKED_OID),
        "saison_id": "2026",
        "eingereicht_am": TODAY,
        "status": "eingereicht",
        "team_id": str(PICKED_OID),
        "schule": None,
        "kontakte": compose_kontakte(kontakte=FLBewerbungKontaktePayload.model_validate(kontakte()).model_dump(mode="json"), today=TODAY),
        "trikot": {"vorhandener_satz": "12 rote Trikots", "wunschfarbe": "blau"},
        "kader": {"voraussichtliche_groesse": 14, "gute_spieler": 4},
        "stufengroesse": 96,
        "wunschgegner": None,
        "entscheidung": None,
        "bestaetigungsfrist": bestaetigungsfrist_from(today=TODAY),
        "bestaetigungen": compose_bestaetigungen(hashes={seat: f"hash-{seat}" for seat in KONTAKT_ROLLEN}, today=TODAY),
        **overrides,
    }


class TestTheOpponentTheSchoolWants:
    """A free string and never a reference: a school may name an applicant the league has not accepted yet.

    Optional on the payload where the other nullable fields are required-and-null: the key is one a
    form deployed before it does not send.
    """

    def test_a_submission_naming_nobody_is_accepted(self):
        """The whole of the rest of this module omits the key, so this is what keeps that honest."""

        assert FLPostBewerbungPayload.model_validate(submission()).wunschgegner is None

    @pytest.mark.parametrize(
        "submitted",
        [pytest.param(None, id="an explicit null"), pytest.param("", id="an empty box"), pytest.param("   ", id="spaces alone")],
    )
    def test_an_empty_wish_is_stored_as_a_null_rather_than_a_blank(self, submitted: str | None):
        """One spelling of "no preference": a stored `""` is a second, and the triage would render it as a wish."""

        assert FLPostBewerbungPayload.model_validate(submission(wunschgegner=submitted)).wunschgegner is None

    def test_a_named_opponent_survives_intact(self):
        """The control: a field answering `None` to everything would satisfy every case above."""

        assert FLPostBewerbungPayload.model_validate(submission(wunschgegner="Zorbanax")).wunschgegner == "Zorbanax"

    def test_a_padded_wish_is_trimmed_rather_than_refused(self):
        assert FLPostBewerbungPayload.model_validate(submission(wunschgegner="  Zorbanax  ")).wunschgegner == "Zorbanax"

    @pytest.mark.parametrize("refused", REFUSED_CHARACTERS)
    def test_a_wish_carrying_one_of_them_inside_is_refused(self, refused: str):
        """The same class the two school names take, so the fields carrying it cannot drift into separate rules."""

        with pytest.raises(ValidationError):
            FLPostBewerbungPayload.model_validate(submission(wunschgegner=f"Zorbanax{refused}Entscheidung: Absage"))

    @pytest.mark.parametrize("trimmed", TRIMMED_CHARACTERS)
    def test_a_wish_padded_with_one_of_them_is_repaired_rather_than_refused(self, trimmed: str):
        """`strip_whitespace` runs BEFORE the pattern, so only an interior character is refused."""

        padded = submission(wunschgegner=f"{trimmed}Zorbanax{trimmed}")

        assert FLPostBewerbungPayload.model_validate(padded).wunschgegner == "Zorbanax"

    @pytest.mark.parametrize("trimmed", TRIMMED_CHARACTERS)
    def test_a_wish_of_nothing_but_padding_is_stored_as_a_null(self, trimmed: str):
        """`parse_empty_string_to_none` runs first and strips the same set, so no such value reaches the pattern."""

        assert FLPostBewerbungPayload.model_validate(submission(wunschgegner=trimmed * 3)).wunschgegner is None

    def test_a_wish_padded_with_nul_is_refused_rather_than_trimmed(self):
        """The one refused character `strip_whitespace` does not remove, which is also what the JavaScript mirror's `trim` does."""

        with pytest.raises(ValidationError):
            FLPostBewerbungPayload.model_validate(submission(wunschgegner=f"{chr(0x00)}Zorbanax{chr(0x00)}"))

    @pytest.mark.parametrize("refused", REFUSED_CHARACTERS)
    def test_a_stored_wish_holding_one_of_them_still_reads(self, refused: str):
        """The narrowing is the PAYLOAD's alone, as it is for the school names: the triage reads whatever is stored."""

        stored = stored_application(wunschgegner=f"Zorbanax{refused}Alt")

        assert FLBewerbung.model_validate(stored).wunschgegner == f"Zorbanax{refused}Alt"

    def test_a_wish_over_the_ceiling_is_refused(self, assert_rejects):
        """An anonymous caller writes it and the record stores it, which is the pair a bound is earned on."""

        assert_rejects(FLPostBewerbungPayload, submission(wunschgegner="Z" * (BEWERBUNG_WUNSCHGEGNER_MAX_LENGTH + 1)), "wunschgegner")

    def test_a_wish_at_the_ceiling_is_accepted(self):
        """The control: without it the case above would pass on a field that refuses everything."""

        at_the_bound = submission(wunschgegner="Z" * BEWERBUNG_WUNSCHGEGNER_MAX_LENGTH)

        assert len(cast(str, FLPostBewerbungPayload.model_validate(at_the_bound).wunschgegner)) == BEWERBUNG_WUNSCHGEGNER_MAX_LENGTH

    def test_the_read_model_takes_a_stored_value_over_the_ceiling(self):
        """The bound is the WRITE side's alone: refusing on read would 500 the triage list over one row."""

        over = stored_application(wunschgegner="Z" * (BEWERBUNG_WUNSCHGEGNER_MAX_LENGTH * 2))

        assert FLBewerbung.model_validate(over).wunschgegner is not None


class _RecordingCursor:
    """The three calls `pull_many_from_db` chains onto a find, and nothing else."""

    def __init__(self, documents: list[dict[str, Any]]) -> None:
        self._documents = documents

    def sort(self, *_: Any) -> _RecordingCursor:
        return self

    def limit(self, *_: Any) -> _RecordingCursor:
        return self

    async def to_list(self, length: Any = None) -> list[dict[str, Any]]:
        return self._documents


class _DistinctCollection:
    """A junction that answers `distinct` and remembers the field and the filter it was asked for.

    It answers no `find` at all, so an endpoint reading documents here fails rather than passing on
    a narrowing that never ran.
    """

    def __init__(self, values: list[Any]) -> None:
        self._values = values
        self.key: Any = "the read never ran"
        self.db_filter: Any = "the read never ran"

    async def distinct(self, key: str, filter: Any = None) -> list[Any]:
        self.key = key
        self.db_filter = filter

        return list(self._values)


class _WindowCollection:
    """A seasons collection answering one season's `bewerbung` block and status, whatever id is asked for.

    The colour read is gated on whether the season takes applications, so a junction fake alone
    reaches nothing.
    """

    def __init__(self, bewerbung: Any, status: str) -> None:
        self._bewerbung = bewerbung
        self._status = status

    async def find_one(self, filter: Any = None, projection: Any = None, session: Any = None) -> Any:
        return {"_id": filter["_id"], "bewerbung": self._bewerbung, "status": self._status}


# The day the window below is judged against, sitting inside its span.
COLOUR_READ_TODAY = "2026-04-01"
COLOUR_READ_WINDOW: Mapping[str, Any] = {"offen": True, "von": "2026-03-01", "bis": "2026-04-30"}


def _colours_for(junction: _DistinctCollection, *, bewerbung: Any, status: str = "future") -> Any:
    """The colour read against two fakes, so every case below states only the window it varies."""

    return get_trikotfarben(
        saison_id="2026",
        saisons_collection=cast(Any, _WindowCollection(bewerbung, status)),
        saison_teams_collection=cast(Any, junction),
        today=COLOUR_READ_TODAY,
    )


class TestTheColoursASeasonHasAlreadyAssigned:
    """What the public form excludes from its Wunschfarbe picker, taken from the ASSIGNMENTS and never from another applicant's wish."""

    def test_the_palette_orders_the_answer_rather_than_the_junction(self):
        """Sorted by the league's own vocabulary, so two identical seasons never answer in two orders."""

        assert assigned_trikot_farben(stored=["rot", "weiss", "blau"]) == ["weiss", "rot", "blau"]

    def test_a_row_with_no_colour_assigned_contributes_nothing(self):
        """`trikot_farbe` is nullable and outside the validator's `required`, so `distinct` yields a null and a missing key alike."""

        assert assigned_trikot_farben(stored=[None, "rot"]) == ["rot"]

    def test_a_value_outside_the_palette_is_dropped_rather_than_served(self):
        """Filtered THROUGH the palette: a stray value would fail `FLTrikotFarbe` and 500 a public page."""

        assert assigned_trikot_farben(stored=["zorbanaxgruen", "rot"]) == ["rot"]

    def test_a_season_holding_no_assignment_answers_the_empty_set(self):
        assert assigned_trikot_farben(stored=[]) == []

    def test_the_whole_palette_survives_the_filter(self):
        """The control, over the whole enum: a filter dropping everything would satisfy the cases above."""

        offered = list(get_args(FLTrikotFarbe))

        assert assigned_trikot_farben(stored=list(reversed(offered))) == offered

    def test_the_read_asks_the_junction_for_one_field_of_one_season(self):
        """`distinct`, so what leaves the database is the values -- no document carrying the club beside its colour."""

        collection = _DistinctCollection(["rot", None])

        response = asyncio.run(_colours_for(collection, bewerbung=dict(COLOUR_READ_WINDOW)))

        assert collection.key == "trikot_farbe"
        assert collection.db_filter == {"saison_id": "2026"}
        # Non-vacuous: the read really ran and really served the colour, so what is asserted above is
        # what it asked for rather than a request nothing made.
        assert response.vergeben == ["rot"]

    def test_the_body_carries_the_season_and_the_colours_and_nothing_else(self):
        """The allow-list, asserted as an exact membership: a subset relation would survive a field added to it."""

        collection = _DistinctCollection([])

        response = asyncio.run(_colours_for(collection, bewerbung=dict(COLOUR_READ_WINDOW)))

        assert set(response.model_dump()) == {"acknowledged", "saison_id", "vergeben"}

    @pytest.mark.parametrize(
        "bewerbung",
        [
            pytest.param(None, id="a season carrying no window"),
            pytest.param({"offen": False, "von": "2026-03-01", "bis": "2026-04-30"}, id="a span holding today with the flag off"),
            pytest.param({"offen": True, "von": "2026-05-01", "bis": "2026-06-30"}, id="the flag on and a span not yet begun"),
            pytest.param({"offen": True, "von": "2026-01-01", "bis": "2026-02-28"}, id="the flag on and a span already over"),
        ],
    )
    def test_a_season_not_taking_applications_never_reaches_the_junction(self, bewerbung: Any):
        """Judged BEFORE the junction read, so a refused season leaves no query behind to have leaked anything."""

        collection = _DistinctCollection(["rot"])

        with pytest.raises(DocumentNotFoundException):
            asyncio.run(_colours_for(collection, bewerbung=bewerbung))

        assert collection.key == "the read never ran"

    def test_a_season_that_has_ended_never_reaches_the_junction_while_its_window_still_runs(self):
        collection = _DistinctCollection(["rot"])

        with pytest.raises(DocumentNotFoundException):
            asyncio.run(_colours_for(collection, bewerbung=dict(COLOUR_READ_WINDOW), status="past"))

        assert collection.key == "the read never ran"
