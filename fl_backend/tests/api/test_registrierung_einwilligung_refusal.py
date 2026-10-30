from collections.abc import Mapping
from typing import Any

import pytest
from pydantic import ValidationError

from app.api.bewerbungen.services import hash_token
from app.api.registrierungen.schemas import (
    FLRegistrierungBestaetigungPayload,
)
from app.api.registrierungen.services import (
    SEITE_NEU,
    SEITE_WIEDERKEHREND,
    compose_bestaetigung,
    compose_person,
    compose_person_update,
    find_already_confirmed_refusal,
    find_expired_token_refusal,
    persons_named,
    seite_of,
    sole_person,
    zustand_of,
)
from app.shared.einwilligung import LAUFENDE_FASSUNGEN
from app.shared.schemas.bestaetigung import FLTokenPayload
from app.shared.schemas.bounds import EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH
from tests.documents import eigene_einwilligung_document

TODAY = "2026-04-01"
YESTERDAY = "2026-03-31"
TOMORROW = "2026-04-02"

# Fixed rather than minted, so a case names the same hash every run.
RAW = "raw-token-for-this-pupil"
TOKEN_HASH = hash_token(RAW)

A_LABEL = "2026-10-spielerseite-5"


def einwilligung(**overrides: Any) -> dict[str, Any]:
    """One consent record as a pupil's own press leaves it."""

    return {**eigene_einwilligung_document(text_version=A_LABEL, bestaetigt_am=YESTERDAY), **overrides}


def registrierung(**overrides: Any) -> dict[str, Any]:
    """One submitted registration inside its deadline, nobody having answered yet, that each case moves one thing of."""

    return {
        "status": "eingereicht",
        "saison_id": "2026",
        "vorname": "Quillhilde",
        "email": "Quillhilde@Example.com",
        "geburtsdatum": None,
        "einwilligung": None,
        "bestaetigung": compose_bestaetigung(token_hash=TOKEN_HASH, today="2026-03-26", frist=TOMORROW),
        **overrides,
    }


class TestWhatAReopenedLinkShows:
    @pytest.mark.parametrize(
        ("stored", "zustand"),
        [
            pytest.param(registrierung(), "gueltig", id="open, inside the deadline"),
            pytest.param(registrierung(einwilligung=einwilligung()), "bestaetigt", id="confirmed"),
            pytest.param(
                registrierung(bestaetigung=compose_bestaetigung(token_hash=TOKEN_HASH, today="2026-03-26", frist=YESTERDAY)),
                "abgelaufen",
                id="the deadline passed",
            ),
            # The deadline's own day still answers, as the press below takes it: the mail names that day.
            pytest.param(
                registrierung(bestaetigung=compose_bestaetigung(token_hash=TOKEN_HASH, today="2026-03-26", frist=TODAY)),
                "gueltig",
                id="on the deadline's day",
            ),
            pytest.param(registrierung(status="abgelehnt"), "abgelaufen", id="declined while the link stood open"),
            pytest.param(
                registrierung(status="abgelehnt", einwilligung=einwilligung()),
                "bestaetigt",
                id="confirmed, then declined",
            ),
        ],
    )
    def test_each_state_reads_as_the_page_expects(self, stored: Mapping[str, Any], zustand: str):
        """The last case is the ordering: a stamp outranks the deadline, so a pupil who answered is never shown an expired link.

        The ban outranks both: a barred pupil's page shows nothing else.
        """

        assert zustand_of(registrierung_raw=stored, today=TODAY, gesperrt=False) == zustand
        assert zustand_of(registrierung_raw=stored, today=TODAY, gesperrt=True) == "gesperrt"


class TestALinkWhoseTimeIsOver:
    def test_the_deadlines_own_day_still_takes_the_answer(self):
        """The mail names that day, and a link dying at the midnight before it lies."""

        assert find_expired_token_refusal(bestaetigung={"frist": TODAY}, status="eingereicht", today=TODAY) is None


class TestARegistrationAlreadyConfirmed:
    def test_a_record_stamped_with_an_empty_string_is_still_open(self):
        """Every reader of a stamp takes an empty one for none, as the application's seats do: the pupil may still answer."""

        assert find_already_confirmed_refusal(einwilligung={"bestaetigt_am": ""}) is None


class TestWhichPageTheLinkOpens:
    """The returning pupil's page is the confirmed person's at this address and name alone."""

    PERSON = {
        "vorname": "Quillhilde",
        "nachname": "Brackenmoor",
        "geburtsdatum": "2009-05-09",
        "einwilligung": einwilligung(umfang="intern", medien=True),
    }
    SIBLING = {**PERSON, "vorname": "Bramblewick", "geburtsdatum": "2007-02-02"}

    @pytest.mark.parametrize(
        ("person", "seite"),
        [
            pytest.param(None, SEITE_NEU, id="nobody at the address"),
            pytest.param(PERSON, SEITE_WIEDERKEHREND, id="the confirmed person under the registration's name"),
            pytest.param({**PERSON, "inactive_since": "2025-07-01"}, SEITE_WIEDERKEHREND, id="that person retired"),
            pytest.param({**PERSON, "vorname": "Bramblewick"}, SEITE_NEU, id="another name at the address, a sibling"),
            pytest.param({**PERSON, "einwilligung": einwilligung(bestaetigt_am="")}, SEITE_NEU, id="a record stamped with an empty string"),
        ],
    )
    def test_only_the_confirmed_person_of_the_registrations_name_makes_it_returning(self, person: Any, seite: str):
        """The unconfirmed case is the one an address alone would get wrong: that page says choices nobody gave still stand."""

        assert seite_of(registrierung_raw=registrierung(nachname="Brackenmoor"), person_raw=person) == seite

    def test_the_name_is_folded_as_the_narrowing_folds_it(self):
        """The registration's own spelling of a stored name, which the page must not read as a stranger's."""

        assert (
            seite_of(registrierung_raw=registrierung(vorname="  quillhilde ", nachname="BRACKENMOOR"), person_raw=self.PERSON)
            == SEITE_WIEDERKEHREND
        )

    @pytest.mark.parametrize(
        ("spelling", "found"),
        [
            pytest.param("Quillhilde", True, id="the name as stored"),
            pytest.param("quillhilde", True, id="another case of it"),
            pytest.param("  Quillhilde ", True, id="padded, as a form submits it"),
            pytest.param("Bramblewick", False, id="a sibling registering at the same mailbox"),
        ],
    )
    def test_the_address_is_narrowed_by_the_name_before_anybody_is_shown_back(self, spelling: str, found: bool):
        """The defect this narrowing exists for: the league holds ONE person at the mailbox, and a differently-named pupil registers there.

        On the address alone that pupil's press stores the stored person's birthdate as their own.
        """

        named = persons_named([self.PERSON], vorname=spelling, nachname="Brackenmoor")

        assert (sole_person(named) is not None) == found

    def test_a_mailbox_the_narrowing_parts_shows_each_pupil_their_own_record(self):
        """The other half: narrowing to nothing wherever two rows share a mailbox would cost a returning sibling their own answers."""

        at_the_mailbox = [self.PERSON, self.SIBLING]

        for person in at_the_mailbox:
            named = persons_named(at_the_mailbox, vorname=person["vorname"], nachname=person["nachname"])

            assert sole_person(named) == person

    def test_a_surname_that_differs_keeps_the_person_hidden(self):
        """Both fields decide: narrowed on the forename alone, a remarried sibling's row would still be shown back."""

        named = persons_named([self.PERSON], vorname="Quillhilde", nachname="Wraxlington")

        assert named == []

    def test_a_sharp_s_surname_and_its_ss_spelling_are_two_pupils(self):
        """„Weiß“ and „Weiss“ at one mailbox are two pupils, whom `casefold` would show each other's record."""

        stored = {**self.PERSON, "nachname": "Weiß"}

        assert persons_named([stored], vorname="Quillhilde", nachname="WEISS") == []

    def test_a_decomposed_umlaut_is_the_name_it_renders_as(self):
        """The same surname typed on another keyboard, which a fold normalising nothing would hide from its own pupil."""

        # Built from code points: the two spellings render identically.
        stored = {**self.PERSON, "nachname": f"Mu{chr(0x308)}ller"}

        assert persons_named([stored], vorname="Quillhilde", nachname=f"M{chr(0xFC)}ller") == [stored]

    @pytest.mark.parametrize(
        ("vorname", "nachname", "found"),
        [
            pytest.param("Quillhilde", "Brackenmoor", True, id="the control, a name on both sides"),
            pytest.param("", "", False, id="both halves empty"),
            pytest.param("  ", "Brackenmoor", False, id="a forename of spaces"),
            pytest.param("Quillhilde", None, False, id="no surname"),
        ],
    )
    def test_a_blank_name_on_both_sides_names_nobody(self, vorname: Any, nachname: Any, found: bool):
        """Only a hand edit stores one. Compared as two keys, two blanks are one name, and the page shows that person's record back."""

        stored = {**self.PERSON, "vorname": vorname, "nachname": nachname}

        assert (persons_named([stored], vorname=vorname, nachname=nachname) == [stored]) == found

    @pytest.mark.parametrize(
        ("rows", "found"),
        [
            pytest.param([], False, id="an address the league holds nobody at"),
            pytest.param([PERSON], True, id="one person"),
            pytest.param([PERSON, PERSON], False, id="two rows the narrowing could not part"),
        ],
    )
    def test_anything_but_exactly_one_row_shows_nobody_back(self, rows: list[Mapping[str, Any]], found: bool):
        """Two identically-named rows at one address survive the narrowing, and guessing between them is what this refuses."""

        assert (sole_person(rows) is not None) == found


RETURNING_LABEL = LAUFENDE_FASSUNGEN[SEITE_WIEDERKEHREND]


class TestWhatAReturningAdmissionWrites:
    """A registration carrying no choice renews nothing on the person's record."""

    RETURNING = {
        "vorname": "Quillhilde",
        "nachname": "Brackenmoor",
        "geburtsdatum": "2009-05-09",
        "einwilligung": {"bestaetigt_am": TODAY, "text_version": RETURNING_LABEL},
    }

    def test_a_new_person_is_never_born_from_it(self):
        """The guard behind `REQ-REGISTRIERUNG-018`: a person born with no scope is one every read of their record refuses."""

        with pytest.raises(ValueError, match="no choice"):
            compose_person(spieler_id="a-new-id", registrierung_raw=self.RETURNING, adresse="quillhilde@example.com")


class TestAPersonIsNeverWrittenNameless:
    """The `spieler` record admits a null forename and record for the erased pupils' sentinel, so these guards are a person's last ones."""

    NEW = {
        "vorname": "Quillhilde",
        "nachname": "Brackenmoor",
        "geburtsdatum": "2009-05-09",
        "einwilligung": eigene_einwilligung_document(text_version=RETURNING_LABEL, bestaetigt_am=TODAY, umfang="intern"),
    }

    # Whitespace among them: `person_name_key` folds it to the empty key the sentinel's null name also folds to.
    @pytest.mark.parametrize("vorname", [None, "", "   "], ids=("null", "empty", "whitespace"))
    def test_neither_composer_writes_a_person_with_no_forename(self, vorname: Any):
        nameless = {**self.NEW, "vorname": vorname}

        with pytest.raises(ValueError, match="no forename"):
            compose_person(spieler_id="a-new-id", registrierung_raw=nameless, adresse="quillhilde@example.com")
        with pytest.raises(ValueError, match="no forename"):
            compose_person_update(registrierung_raw=nameless, gespeichert=self.NEW["einwilligung"], adresse="quillhilde@example.com")

    @pytest.mark.parametrize("registrierung_raw", [NEW, TestWhatAReturningAdmissionWrites.RETURNING], ids=("new page", "returning page"))
    def test_a_matched_person_holding_no_record_is_admitted_into_by_neither_page(self, registrierung_raw: Mapping[str, Any]):
        """The returning page is the load-bearing case: renewing nothing, it would leave the person standing with no record."""

        with pytest.raises(ValueError, match="no consent record"):
            compose_person_update(registrierung_raw=registrierung_raw, gespeichert=None, adresse="quillhilde@example.com")


def antwort(**overrides: Any) -> dict[str, Any]:
    return {"token": RAW, "geburtsdatum": "2009-05-09", "umfang": "intern", "medien": False, "text_version": A_LABEL, **overrides}


class TestWhatTheAnswerPayloadRefuses:
    def test_the_corpus_this_class_moves_one_field_of_is_valid(self):
        assert FLRegistrierungBestaetigungPayload.model_validate(antwort()).umfang == "intern"

    @pytest.mark.parametrize("field", ["token", "geburtsdatum", "umfang", "medien", "text_version"])
    def test_every_field_is_required(self, field: str, assert_rejects):
        """`medien` above all: defaulted, an off switch would store this model's answer where the person's belongs."""

        body = antwort()
        del body[field]

        assert_rejects(FLRegistrierungBestaetigungPayload, body, field)

    def test_the_returning_pupils_page_states_its_unasked_answers_as_null(self):
        """Which page a body may carry nulls on is the press's to judge (`REQ-REGISTRIERUNG-017`), never the model's."""

        stated = FLRegistrierungBestaetigungPayload.model_validate(
            antwort(geburtsdatum=None, umfang=None, medien=None, text_version=RETURNING_LABEL)
        )

        assert (stated.geburtsdatum, stated.umfang, stated.medien) == (None, None, None)

    def test_a_scope_outside_the_pair_is_refused(self, assert_rejects):
        assert_rejects(FLRegistrierungBestaetigungPayload, antwort(umfang="kontaktdaten"), "umfang")

    def test_a_label_past_the_bound_is_refused_and_one_at_it_taken(self, assert_rejects):
        assert_rejects(
            FLRegistrierungBestaetigungPayload, antwort(text_version="v" * (EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH + 1)), "text_version"
        )

        at_the_bound = "v" * EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH
        assert FLRegistrierungBestaetigungPayload.model_validate(antwort(text_version=at_the_bound)).text_version == at_the_bound

    def test_a_malformed_date_is_refused(self, assert_rejects):
        """`REQ-VAL-001` rather than the age's own code: the shape of the field is the body's business, and the age is the person's."""

        assert_rejects(FLRegistrierungBestaetigungPayload, antwort(geburtsdatum="09.05.2009"), "geburtsdatum")

    @pytest.mark.parametrize("model", [FLTokenPayload, FLRegistrierungBestaetigungPayload])
    def test_an_undeclared_key_is_refused(self, model: type):
        body = antwort() if model is FLRegistrierungBestaetigungPayload else {"token": RAW}

        with pytest.raises(ValidationError) as failure:
            model.model_validate({**body, "nachweis": {}})

        assert [entry["type"] for entry in failure.value.errors()] == ["extra_forbidden"]
