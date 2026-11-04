from collections.abc import Mapping
from typing import Any

import pytest

from app.api.registrierungen.schemas import (
    FLRegistrierungConfirmationPayload,
)
from app.api.registrierungen.services import (
    SEITE_NEU,
    SEITE_WIEDERKEHREND,
    compose_bestaetigung,
    compose_person,
    compose_person_update,
    person_named,
    seite_of,
)
from app.shared.tokens import hash_token
from tests.documents import SPIELER_TEXT_VERSIONS, own_einwilligung_document

TODAY = "2026-04-01"
YESTERDAY = "2026-03-31"
TOMORROW = "2026-04-02"

# Fixed rather than minted, so a case names the same hash every run.
RAW = "raw-token-for-this-pupil"
TOKEN_HASH = hash_token(RAW)


def einwilligung(**overrides: Any) -> dict[str, Any]:
    """One consent record as a pupil's own press leaves it."""

    return {**own_einwilligung_document(text_versions=SPIELER_TEXT_VERSIONS, confirmed_at=YESTERDAY), **overrides}


def registrierung(**overrides: Any) -> dict[str, Any]:
    """One submitted registration inside its deadline, nobody having answered yet, that each case moves one thing of."""

    return {
        "status": "submitted",
        "saison_id": "2026",
        "vorname": "Quillhilde",
        "email": "Quillhilde@Example.com",
        "geburtsdatum": None,
        "einwilligung": None,
        "confirmation": {**compose_bestaetigung(today="2026-03-26", frist=TOMORROW), "token_hashes": [TOKEN_HASH]},
        **overrides,
    }


class TestWhichPageTheLinkOpens:
    """The returning pupil's page is the confirmed person's at this address and name alone."""

    PERSON = {
        "vorname": "Quillhilde",
        "nachname": "Brackenmoor",
        "geburtsdatum": "2009-05-09",
        "einwilligung": einwilligung(umfang="intern", medien=True),
    }

    @pytest.mark.parametrize(
        ("person", "seite"),
        [
            pytest.param(None, SEITE_NEU, id="nobody at the address"),
            pytest.param(PERSON, SEITE_WIEDERKEHREND, id="the confirmed person under the registration's name"),
            pytest.param({**PERSON, "inactive_since": "2025-07-01"}, SEITE_WIEDERKEHREND, id="that person retired"),
            pytest.param({**PERSON, "vorname": "Bramblewick"}, SEITE_NEU, id="another name at the address, a sibling"),
            pytest.param({**PERSON, "einwilligung": None}, SEITE_NEU, id="a person who never confirmed"),
        ],
    )
    def test_only_the_confirmed_person_of_the_registrations_name_makes_it_returning(self, person: Any, seite: str):
        """The unconfirmed case is the one an address alone would get wrong: that page says choices nobody gave still stand."""

        assert seite_of(registrierung_raw=registrierung(nachname="Brackenmoor"), person_raw=person) == seite

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

        assert (person_named(self.PERSON, vorname=spelling, nachname="Brackenmoor") is not None) == found

    def test_a_surname_that_differs_keeps_the_person_hidden(self):
        """Both fields decide: narrowed on the forename alone, a remarried sibling's row would still be shown back."""

        assert person_named(self.PERSON, vorname="Quillhilde", nachname="Wraxlington") is None

    def test_a_sharp_s_surname_and_its_ss_spelling_are_two_pupils(self):
        """„Weiß“ and „Weiss“ at one mailbox are two pupils, whom `casefold` would show each other's record."""

        stored = {**self.PERSON, "nachname": "Weiß"}

        assert person_named(stored, vorname="Quillhilde", nachname="WEISS") is None

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

        assert (person_named(stored, vorname=vorname, nachname=nachname) is stored) == found


class TestAPersonIsNeverWrittenNameless:
    """The `spieler` record admits a null forename and record for the erased pupils' sentinel, so these guards are a person's last ones."""

    NEW = {
        "vorname": "Quillhilde",
        "nachname": "Brackenmoor",
        "geburtsdatum": "2009-05-09",
        "einwilligung": own_einwilligung_document(text_versions=SPIELER_TEXT_VERSIONS, confirmed_at=TODAY, umfang="intern"),
    }
    # A registration carrying no choice, which renews nothing on the person's record.
    RETURNING = {
        "vorname": "Quillhilde",
        "nachname": "Brackenmoor",
        "geburtsdatum": "2009-05-09",
        "einwilligung": {"confirmed_at": TODAY},
    }

    # Whitespace among them: `person_name_key` folds it to the empty key the sentinel's null name also folds to.
    @pytest.mark.parametrize("vorname", [None, "", "   "], ids=("null", "empty", "whitespace"))
    def test_neither_composer_writes_a_person_with_no_forename(self, vorname: Any):
        nameless = {**self.NEW, "vorname": vorname}

        with pytest.raises(ValueError, match="no forename"):
            compose_person(spieler_id="a-new-id", registrierung_raw=nameless, adresse="quillhilde@example.com")
        with pytest.raises(ValueError, match="no forename"):
            compose_person_update(registrierung_raw=nameless, gespeichert=self.NEW["einwilligung"], adresse="quillhilde@example.com")

    @pytest.mark.parametrize("registrierung_raw", [NEW, RETURNING], ids=("new page", "returning page"))
    def test_a_matched_person_holding_no_record_is_admitted_into_by_neither_page(self, registrierung_raw: Mapping[str, Any]):
        """The returning page is the load-bearing case: renewing nothing, it would leave the person standing with no record."""

        with pytest.raises(ValueError, match="no consent record"):
            compose_person_update(registrierung_raw=registrierung_raw, gespeichert=None, adresse="quillhilde@example.com")


def antwort(**overrides: Any) -> dict[str, Any]:
    return {
        "token": RAW,
        "geburtsdatum": "2009-05-09",
        "umfang": "intern",
        "medien": False,
        "text_versions": dict(SPIELER_TEXT_VERSIONS),
        **overrides,
    }


class TestWhatTheAnswerPayloadRefuses:
    @pytest.mark.parametrize("field", ["token", "geburtsdatum", "umfang", "medien", "text_versions"])
    def test_every_field_is_required(self, field: str, assert_rejects):
        """`medien` above all: defaulted, an off switch would store this model's answer where the person's belongs."""

        body = antwort()
        del body[field]

        assert_rejects(FLRegistrierungConfirmationPayload, body, field)
