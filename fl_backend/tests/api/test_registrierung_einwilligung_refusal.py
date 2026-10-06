import inspect
from collections.abc import Mapping
from typing import Any

import pytest
from pydantic import ValidationError

from app.api.bewerbungen.services import hash_token
from app.api.registrierungen.schemas import (
    FLRegistrierungBestaetigungAnsichtPayload,
    FLRegistrierungBestaetigungAnsichtResponse,
    FLRegistrierungBestaetigungPayload,
    FLRegistrierungBestaetigungResponse,
)
from app.api.registrierungen.services import (
    BESTAETIGUNG_ANSICHT_FIELDS,
    BESTAETIGUNG_ANTWORT_FIELDS,
    REGISTRIERUNG_ALREADY_CONFIRMED,
    REGISTRIERUNG_ALTER,
    REGISTRIERUNG_MEDIEN_ALTER,
    REGISTRIERUNG_TOKEN_EXPIRED,
    REGISTRIERUNG_TOKEN_UNKNOWN,
    REGISTRIERUNG_WAHLEN_UNPASSEND,
    SEITE_NEU,
    SEITE_WIEDERKEHREND,
    TOKEN_HASH_FIELDS,
    build_bestaetigung_filter,
    compose_bestaetigung,
    compose_confirmation_update,
    compose_person,
    find_already_confirmed_refusal,
    find_alter_refusal,
    find_expired_token_refusal,
    find_medien_refusal,
    find_unknown_token_refusal,
    find_wahlen_refusal,
    persons_named,
    seite_of,
    sole_person,
    zustand_of,
)
from app.core.collections import Collection
from app.core.constraints import (
    _EINWILLIGUNG,
    _EINWILLIGUNG_UMFANG,
    _REGISTRIERUNG_BESTAETIGUNG,
    _REGISTRIERUNG_EINWILLIGUNG,
    SUPPORT_INDEXES,
)
from app.shared.einwilligung import LAUFENDE_FASSUNGEN
from app.shared.schemas.bounds import (
    BEWERBUNG_KONTAKT_MAX_AGE_YEARS,
    EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH,
    MEDIEN_MIN_AGE_YEARS,
    REGISTRIERUNG_MIN_ALTER_JAHRE,
)

TODAY = "2026-04-01"
YESTERDAY = "2026-03-31"
TOMORROW = "2026-04-02"

# Fixed rather than minted, so a case names the same hash every run.
RAW = "raw-token-for-this-pupil"
TOKEN_HASH = hash_token(RAW)

A_LABEL = "2026-09-spielerseite"
AM = "2026-04-01T08:00:00+00:00"


def einwilligung(**overrides: Any) -> dict[str, Any]:
    """One consent record as a pupil's own press leaves it."""

    return {
        "umfang": "kader_oeffentlich",
        "datum": YESTERDAY,
        "bestaetigt_am": YESTERDAY,
        "text_version": A_LABEL,
        "medien": False,
        **overrides,
    }


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


class TestTheLookupAndItsProjections:
    def test_the_filter_asks_both_hash_fields_and_no_status(self):
        """Both fields, because a reminded pupil holds two live links.

        No status term: a link reopened on a decided registration shows its state rather than
        reading as a token nothing knows.
        """

        assert build_bestaetigung_filter(token_hash="abc") == {
            "$or": [{"bestaetigung.token_hash": "abc"}, {"bestaetigung.token_hash_zuvor": "abc"}]
        }

    def test_every_hash_field_the_validator_declares_is_asked_for(self):
        """A third hash field declared on the block and forgotten here leaves that link opening nothing."""

        declared = sorted(field for field in _REGISTRIERUNG_BESTAETIGUNG["properties"] if field.startswith("token_hash"))

        assert declared == sorted(TOKEN_HASH_FIELDS)

    def test_every_clause_of_the_or_has_a_support_index_of_its_own(self):
        """One unindexed clause makes MongoDB scan the whole collection for an `$or`, and strangers drive this read."""

        asked = {field for clause in build_bestaetigung_filter(token_hash="abc")["$or"] for field in clause}
        indexed = {
            support.keys[0][0] for support in SUPPORT_INDEXES if support.collection == Collection.REGISTRIERUNGEN and len(support.keys) == 1
        }

        assert asked == indexed

    @pytest.mark.parametrize("projection", [BESTAETIGUNG_ANSICHT_FIELDS, BESTAETIGUNG_ANTWORT_FIELDS])
    def test_neither_read_loads_what_a_squad_sheet_holds(self, projection: Mapping[str, int]):
        """The shirt number, the position and the Stufe reach no base-tier read at all.

        The surname and the address ARE read, to narrow the join; the field-set equalities below
        are what hold them off the wire.
        """

        assert not {"nummer", "position", "stufe"} & set(projection)

    @pytest.mark.parametrize("projection", [BESTAETIGUNG_ANSICHT_FIELDS, BESTAETIGUNG_ANTWORT_FIELDS])
    def test_neither_read_projects_a_hash_no_handler_opens(self, projection: Mapping[str, int]):
        """The filter matches on the hashes; a projected one is a live credential carried through a base-tier request for nothing."""

        assert not any(key.startswith("bestaetigung.token_hash") for key in projection)

    def test_the_view_declares_exactly_the_eleven_names_it_may_answer(self):
        """An EQUALITY, not a subset.

        This is the widest of the link reads, so a field added to the model reaches a caller
        holding nothing but a token, and every other case here would still pass.
        """

        assert set(FLRegistrierungBestaetigungAnsichtResponse.model_fields) == {
            "acknowledged",
            "zustand",
            "team",
            "schule",
            "saison_id",
            "vorname",
            "seite",
            "mindestalter",
            "medien_mindestalter",
            "geburtsdatum",
            "umfang",
            "medien",
        }

    def test_the_answer_declares_exactly_what_the_press_echoes(self):
        """The same equality on the write's answer: it states back what was posted, so a field here is one the page never sent."""

        assert set(FLRegistrierungBestaetigungResponse.model_fields) == {
            "acknowledged",
            "ergebnis",
            "geburtsdatum",
            "umfang",
            "medien",
        }

    def test_the_answers_read_holds_what_the_press_judges_and_no_team(self):
        """Widened to the view's, the read would name the team.

        The address is read for the ban and the name for the page, and the answer's model above keeps
        all three off the response.
        """

        assert set(BESTAETIGUNG_ANTWORT_FIELDS) == {
            "bestaetigung.frist",
            "status",
            "einwilligung.bestaetigt_am",
            "email",
            "vorname",
            "nachname",
        }

    def test_the_views_read_takes_the_stamp_and_none_of_the_registrations_answers(self):
        """What the pupil answered is shown back from the person alone, so a confirmed row's own answers reach no base-tier read."""

        assert "geburtsdatum" not in BESTAETIGUNG_ANSICHT_FIELDS
        assert [key for key in BESTAETIGUNG_ANSICHT_FIELDS if key.startswith("einwilligung")] == ["einwilligung.bestaetigt_am"]


class TestATokenNoRegistrationHolds:
    """`REQ-REGISTRIERUNG-004`: one answer for unknown, replaced and swept, because nothing tells them from a guess."""

    def test_a_row_found_is_not_refused(self):
        assert find_unknown_token_refusal(found=True) is None

    def test_a_miss_is_refused_and_names_neither_team_nor_pupil(self):
        refusal = find_unknown_token_refusal(found=False)

        assert refusal is not None
        assert refusal.error_code == REGISTRIERUNG_TOKEN_UNKNOWN
        # Nothing the refusal is handed can carry a team or a pupil, so a parameter added to it is the leak.
        assert set(inspect.signature(find_unknown_token_refusal).parameters) == {"found"}


class TestALinkWhoseTimeIsOver:
    """`REQ-REGISTRIERUNG-005`: the deadline, and a decision taken while the link stood open."""

    @pytest.mark.parametrize(
        ("frist", "status", "refused"),
        [
            pytest.param(TOMORROW, "eingereicht", False, id="inside the deadline"),
            pytest.param(TODAY, "eingereicht", False, id="on the deadline's own day"),
            pytest.param(YESTERDAY, "eingereicht", True, id="the day after the deadline"),
            pytest.param(None, "eingereicht", True, id="a block carrying no readable deadline"),
            pytest.param(TOMORROW, "abgelehnt", True, id="declined meanwhile"),
        ],
    )
    def test_each_boundary_falls_where_the_rule_says(self, frist: str | None, status: str, refused: bool):
        """The deadline's own day still answers: the mail names that day, and a link dying at the midnight before it lies."""

        refusal = find_expired_token_refusal(bestaetigung={"frist": frist}, status=status, today=TODAY)

        assert (refusal is not None) == refused
        assert refusal is None or refusal.error_code == REGISTRIERUNG_TOKEN_EXPIRED

    def test_a_registration_carrying_no_block_at_all_is_over(self):
        """A row stored outside this flow has no link to answer, and a missing block must not read as a running one."""

        assert find_expired_token_refusal(bestaetigung=None, status="eingereicht", today=TODAY) is not None


class TestARegistrationAlreadyConfirmed:
    """`REQ-REGISTRIERUNG-006`: the single use. The stamp spends the link, never a nulled hash."""

    @pytest.mark.parametrize(
        ("record", "refused"),
        [
            pytest.param(None, False, id="nobody has answered"),
            pytest.param({"bestaetigt_am": None}, False, id="a record without its stamp"),
            pytest.param({"bestaetigt_am": ""}, False, id="a record stamped with an empty string"),
            pytest.param(einwilligung(), True, id="confirmed"),
        ],
    )
    def test_only_a_stamped_record_refuses(self, record: Any, refused: bool):
        refusal = find_already_confirmed_refusal(einwilligung=record)

        assert (refusal is not None) == refused
        assert refusal is None or refusal.error_code == REGISTRIERUNG_ALREADY_CONFIRMED


# Exact ages against a fixed day, so both boundaries are pinned without a clock. Against `TODAY`,
# `2010-04-01` is 16 to the day and `1905-04-02` is the last date that is still 120.
AGE_BOUNDARIES = [
    pytest.param("2010-04-02", True, id="a day short of the floor, at 15 years and 364 days"),
    pytest.param("2010-04-01", False, id="the floor, to the day"),
    pytest.param("2010-03-31", False, id="a day inside the floor"),
    pytest.param("1905-04-02", False, id="the ceiling, on its last day"),
    pytest.param("1905-04-01", True, id="a day past the ceiling"),
]


class TestTheAgeAtConfirmation:
    """`REQ-REGISTRIERUNG-007`, judged before any write."""

    @pytest.mark.parametrize(("geburtsdatum", "refused"), AGE_BOUNDARIES)
    def test_each_boundary_falls_where_the_floor_says(self, geburtsdatum: str, refused: bool):
        """Move either comparison by one and a case here goes red; the endpoint cannot show that."""

        refusal = find_alter_refusal(geburtsdatum=geburtsdatum, today=TODAY)

        assert (refusal is not None) == refused
        assert refusal is None or refusal.error_code == REGISTRIERUNG_ALTER

    def test_a_leap_birthday_reaches_the_floor_on_the_day_the_calendar_does(self):
        """Someone born on 29 February reaches the floor the moment the date arrives, and on 1 March in a year that has none."""

        assert find_alter_refusal(geburtsdatum="2012-02-29", today="2028-02-28") is not None
        assert find_alter_refusal(geburtsdatum="2012-02-29", today="2028-02-29") is None
        assert find_alter_refusal(geburtsdatum="2012-02-29", today="2028-03-01") is None

    def test_the_floor_is_the_pupils_own_constant_and_the_refusal_names_it(self):
        """A sentence naming another flow's number would tell a pupil their date was judged by a rule it was not."""

        refusal = find_alter_refusal(geburtsdatum="2020-01-01", today=TODAY)

        # The LITERAL, never the constant the message is interpolated from: read through the
        # constant the case passes at any floor at all, which is the state it exists to refuse.
        assert REGISTRIERUNG_MIN_ALTER_JAHRE == 16
        assert refusal is not None
        assert "16" in refusal.message

    def test_the_ceiling_refusal_names_the_ceiling(self):
        """The literal for the reason the floor's twin gives: the constant is what composed the sentence being read."""

        refusal = find_alter_refusal(geburtsdatum="1800-01-01", today=TODAY)

        assert BEWERBUNG_KONTAKT_MAX_AGE_YEARS == 120
        assert refusal is not None
        assert "120" in refusal.message


# Against `TODAY`, `2008-04-01` is 18 to the day and `2008-04-02` is 17 years and 364 days.
MEDIA_BOUNDARIES = [
    pytest.param("2008-04-02", True, True, id="a day short of 18, saying yes"),
    pytest.param("2008-04-01", True, False, id="18 to the day, saying yes"),
    pytest.param("2010-04-01", False, False, id="16, saying no"),
    pytest.param("2008-04-02", False, False, id="a day short of 18, saying no"),
]


class TestTheMediaAge:
    """`REQ-REGISTRIERUNG-010`: a media consent is an adult's alone, and a `False` is every admitted age's answer."""

    @pytest.mark.parametrize(("geburtsdatum", "medien", "refused"), MEDIA_BOUNDARIES)
    def test_each_boundary_falls_where_the_media_age_says(self, geburtsdatum: str, medien: bool, refused: bool):
        refusal = find_medien_refusal(geburtsdatum=geburtsdatum, medien=medien, today=TODAY)

        assert (refusal is not None) == refused
        assert refusal is None or refusal.error_code == REGISTRIERUNG_MEDIEN_ALTER

    def test_the_age_is_the_rulings_eighteen_and_the_refusal_names_it(self):
        """The literal for the reason the floor's case gives: the constant is what composed the sentence being read."""

        refusal = find_medien_refusal(geburtsdatum="2010-04-01", medien=True, today=TODAY)

        assert MEDIEN_MIN_AGE_YEARS == 18
        assert refusal is not None
        assert "18" in refusal.message


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


class TestWhichPageTheLinkOpens:
    """`docs/backend/spec.md :: I287`: the returning pupil's page is the confirmed person's at this address and name alone."""

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
            pytest.param({**PERSON, "geburtsdatum": None}, SEITE_WIEDERKEHREND, id="that person with no stored birthdate"),
            pytest.param({**PERSON, "vorname": "Bramblewick"}, SEITE_NEU, id="another name at the address, a sibling"),
            pytest.param({**PERSON, "einwilligung": einwilligung(bestaetigt_am=None)}, SEITE_NEU, id="a record nobody confirmed"),
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

        On the address alone that pupil is shown, and then stores, the stored person's birthdate.
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


class TestWhatAConfirmationWrites:
    """One `$set`, so `docs/backend/spec.md :: I141`'s pairing cannot land in halves."""

    def test_the_date_and_the_whole_record_land_in_one_set(self):
        update = compose_confirmation_update(geburtsdatum="2009-05-09", umfang="intern", medien=True, text_version=A_LABEL, today=TODAY, am=AM)

        assert update == {
            "$set": {
                "geburtsdatum": "2009-05-09",
                "einwilligung": {
                    # No speaker: no write names who answered any longer.
                    "umfang": "intern",
                    "datum": TODAY,
                    "bestaetigt_am": TODAY,
                    "text_version": A_LABEL,
                    "medien": True,
                    # Born with each choice's evidence: no record stood on the registration before this press.
                    "nachweis": {"umfang": {"am": AM, "text_version": A_LABEL}, "medien": {"am": AM, "text_version": A_LABEL}},
                },
            }
        }

    def test_the_record_it_writes_carries_every_key_the_validator_requires(self):
        """A record short of one is refused by mongod at the write rather than by anything here, which is a 500 on the page."""

        update = compose_confirmation_update(geburtsdatum="2009-05-09", umfang="intern", medien=True, text_version=A_LABEL, today=TODAY, am=AM)

        assert set(_EINWILLIGUNG["required"]) <= set(update["$set"]["einwilligung"])

    def test_both_answers_the_person_gave_are_stored_as_given(self):
        """Publication and media are two consents under one record, so neither may be derived from the other."""

        narrow = compose_confirmation_update(geburtsdatum="2009-05-09", umfang="intern", medien=False, text_version=A_LABEL, today=TODAY, am=AM)
        wide = compose_confirmation_update(
            geburtsdatum="2009-05-09", umfang="kader_oeffentlich", medien=True, text_version=A_LABEL, today=TODAY, am=AM
        )

        assert (narrow["$set"]["einwilligung"]["umfang"], narrow["$set"]["einwilligung"]["medien"]) == ("intern", False)
        assert (wide["$set"]["einwilligung"]["umfang"], wide["$set"]["einwilligung"]["medien"]) == ("kader_oeffentlich", True)


RETURNING_LABEL = LAUFENDE_FASSUNGEN[SEITE_WIEDERKEHREND]


class TestWhatAReturningPupilsConfirmationWrites:
    """`docs/backend/spec.md :: I_NEW_KONTO-B3_1`: the page asked no choice, so the record holds none."""

    def test_the_registrations_validator_takes_it_and_a_persons_would_not(self):
        """Why the registration has a sub-schema of its own: `_EINWILLIGUNG` requires a scope this record does not carry."""

        record = compose_confirmation_update(
            geburtsdatum="2009-05-09", umfang=None, medien=None, text_version=RETURNING_LABEL, today=TODAY, am=AM
        )["$set"]["einwilligung"]

        assert set(_REGISTRIERUNG_EINWILLIGUNG["required"]) <= set(record)
        assert not set(_EINWILLIGUNG["required"]) <= set(record)

    @pytest.mark.parametrize(("umfang", "medien"), [("intern", None), (None, False)], ids=("a scope alone", "a media answer alone"))
    def test_half_a_pair_is_never_composed(self, umfang: Any, medien: Any):
        """A record holding one choice is neither page's, and stored it would be published from as if both were answered."""

        with pytest.raises(ValueError, match="both choices or neither"):
            compose_confirmation_update(geburtsdatum="2009-05-09", umfang=umfang, medien=medien, text_version=A_LABEL, today=TODAY, am=AM)


class TestTheChoicesThePageAsks:
    """`REQ-REGISTRIERUNG-017`: both choices on the new pupil's page, neither on the returning pupil's."""

    @pytest.mark.parametrize(
        ("seite", "umfang", "medien", "refused"),
        [
            pytest.param(SEITE_NEU, "intern", False, False, id="new page, both answered"),
            pytest.param(SEITE_NEU, None, None, True, id="new page, neither answered"),
            pytest.param(SEITE_NEU, "intern", None, True, id="new page, the media answer missing"),
            pytest.param(SEITE_NEU, None, False, True, id="new page, the scope missing"),
            pytest.param(SEITE_WIEDERKEHREND, None, None, False, id="returning page, neither answered"),
            pytest.param(SEITE_WIEDERKEHREND, "kader_oeffentlich", True, True, id="returning page, both answered"),
            pytest.param(SEITE_WIEDERKEHREND, None, True, True, id="returning page, a media grant alone"),
            pytest.param(SEITE_WIEDERKEHREND, None, False, True, id="returning page, an off switch alone"),
        ],
    )
    def test_each_body_is_judged_against_its_page(self, seite: Any, umfang: Any, medien: Any, refused: bool):
        """The last case is the load-bearing one: an off switch is an answer, and the returning page asked none."""

        refusal = find_wahlen_refusal(seite=seite, umfang=umfang, medien=medien)

        assert (refusal is not None) == refused
        assert refusal is None or (refusal.error_code, refusal.status) == (REGISTRIERUNG_WAHLEN_UNPASSEND, 422)


class TestWhatAReturningAdmissionWrites:
    """`docs/backend/spec.md :: I867`: a registration carrying no choice renews nothing on the person's record."""

    RETURNING = {
        "vorname": "Quillhilde",
        "nachname": "Brackenmoor",
        "geburtsdatum": "2009-05-09",
        "einwilligung": {"bestaetigt_am": TODAY, "text_version": RETURNING_LABEL},
    }

    def test_a_new_person_is_never_born_from_it(self):
        """The guard behind `REQ-REGISTRIERUNG-018`: a person born with no scope is one the validator refuses mid-transaction."""

        with pytest.raises(ValueError, match="no choice"):
            compose_person(spieler_id="a-new-id", registrierung_raw=self.RETURNING, adresse="quillhilde@example.com")


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

    def test_the_returning_pupils_page_states_both_choices_as_null(self):
        """Which page a body may carry nulls on is the press's to judge (`REQ-REGISTRIERUNG-017`), never the model's."""

        stated = FLRegistrierungBestaetigungPayload.model_validate(antwort(umfang=None, medien=None, text_version=RETURNING_LABEL))

        assert (stated.umfang, stated.medien) == (None, None)

    def test_the_two_scopes_are_the_pair_the_validator_declares(self):
        """A third member offered here and refused by mongod is a 500 on a page that has already taken the consent."""

        assert sorted(_EINWILLIGUNG_UMFANG) == ["intern", "kader_oeffentlich"]
        assert FLRegistrierungBestaetigungPayload.model_validate(antwort(umfang="kader_oeffentlich")).umfang == "kader_oeffentlich"

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

    @pytest.mark.parametrize("model", [FLRegistrierungBestaetigungAnsichtPayload, FLRegistrierungBestaetigungPayload])
    def test_an_undeclared_key_is_refused(self, model: type):
        body = antwort() if model is FLRegistrierungBestaetigungPayload else {"token": RAW}

        with pytest.raises(ValidationError) as failure:
            model.model_validate({**body, "erteilt_von": "erziehungsberechtigt"})

        assert [entry["type"] for entry in failure.value.errors()] == ["extra_forbidden"]
