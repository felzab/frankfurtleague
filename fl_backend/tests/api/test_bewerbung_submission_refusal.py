from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import pytest
from bson import ObjectId
from pydantic import ValidationError

from app.api.bewerbungen.schemas import (
    FLBewerbungKontaktePayload,
    FLBewerbungKontaktpersonPayload,
    FLBewerbungSchulePayload,
    FLPostBewerbungPayload,
)
from app.api.bewerbungen.services import (
    assigned_trikot_farben,
    compose_kontakte,
    find_repeated_contact_refusal,
    mailbox_anchor_ids,
    open_links_on,
    owed_at_submission,
    seats_past_the_bound,
)
from app.api.outbox.schemas import FLBewerbungReceivedData
from app.api.teams.schemas import FLKontaktperson, normalise_phone
from app.shared.schemas.bounds import (
    BEWERBUNG_KADER_SIZE_MAX,
    TEAM_WEBSITE_URL_MAX_LENGTH,
)
from tests.documents import ADDRESS, kontaktperson_document

# Fixed rather than generated, so a failure names the same club every run. Its own hex range, as
# every other module in this suite carves one.
PICKED_OID = ObjectId("6890a1b2c3d4e5f607930001")

TODAY = "2026-04-01"


# The two characters a forged line needs, of those `app/shared/schemas/custom.py :: SINGLE_LINE_PATTERN`
# refuses, written as code points: a literal one here would be invisible in this file and in every diff of it.
REFUSED_CHARACTERS = [
    pytest.param(chr(0x0A), id="LF"),
    pytest.param(chr(0x0D), id="CR"),
]


def person(**overrides: Any) -> dict[str, Any]:
    """One contact person as the public form submits them."""

    return {
        "first_name": "Quillhilde",
        "last_name": "Brackenmoor",
        "email": "quillhilde@example.com",
        "phone": "+49 170 1234567",
        **overrides,
    }


def kontakte(**overrides: Any) -> dict[str, Any]:
    """The three seats, distinct on every field a rule compares, plus the flag that may make two of them one."""

    return {
        "trainer": person(),
        "ansprechperson": person(first_name="Ansgar", email="ansgar@example.com", phone="+49 170 7654321"),
        "stellvertretung": person(first_name="Stellan", email="stellan@example.com", phone="0171 5555555"),
        "trainer_is_also": None,
        **overrides,
    }


def submission(**overrides: Any) -> dict[str, Any]:
    """A whole application, valid, that each case moves one field of."""

    return {
        "saison_id": "2026",
        "team_id": str(PICKED_OID),
        "schule": None,
        "kontakte": kontakte(),
        "trikot": {"existing_set": "12 rote Trikots", "wunschfarbe": "blau"},
        "kader": {"expected_size": 14, "good_spieler": 4},
        "stufengroesse": 90,
        **overrides,
    }


def schule(**overrides: Any) -> dict[str, Any]:
    return {
        "team_name": "Zorbanax",
        "full_name": "Zorbanax-Gymnasium",
        "schulform": "gymnasium_g9",
        "address": dict(ADDRESS),
        "website_url": "https://zorbanax.example.de",
        **overrides,
    }


class TestNoBirthdateOnAnyPayload:
    """The date reaches the league from its own person at their confirmation, so no payload spells the key."""

    @pytest.mark.parametrize("seat", ["trainer", "ansprechperson", "stellvertretung"])
    def test_a_submission_naming_a_birthdate_on_any_seat_is_refused_outright(self, seat: str):
        block = kontakte(**{seat: person(birth_date="1984-05-09")})

        with pytest.raises(ValidationError) as failure:
            FLPostBewerbungPayload.model_validate(submission(kontakte=block))

        assert [(entry["type"], entry["loc"][-1]) for entry in failure.value.errors()] == [("extra_forbidden", "birth_date")]

    def test_a_stored_contact_with_no_date_still_reads(self):
        """A seat is stored with a null one until its person confirms, so a non-null field here would 500 the triage over one."""

        record = {**person(), "birth_date": None, "einwilligung": kontaktperson_document("Quillhilde")["einwilligung"]}

        assert FLKontaktperson.model_validate(record).birth_date is None


class TestOneNumberHasOneSpelling:
    """What `normalise_phone` folds, which is the whole of what makes the distinctness rule work on a free-form field."""

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
        assert normalise_phone(written) == normalised

    def test_a_national_number_is_not_folded_onto_an_international_one_of_another_line(self):
        """The other control: an over-eager fold would collapse `0491…` onto `+49 1…`."""

        assert normalise_phone("0491 234567") != normalise_phone("+49 1 234567")


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
    for field, value in (("email", "quillhilde@example.com"), ("phone", "+49 170 1234567"))
]


def repeated_boxes(block: Mapping[str, Any]) -> tuple[Any, ...]:
    """The boxes the submission's rule names over this block, none where it passes."""

    refusal = find_repeated_contact_refusal(kontakte=block)

    return () if refusal is None else refusal.fields


class TestTheThreeSeatsAreThreePeople:
    """The block's one `model_validator`, and `find_repeated_contact_refusal`, which names the boxes a model's rule cannot."""

    @pytest.mark.parametrize("seat", ["ansprechperson", "stellvertretung"])
    def test_a_seat_declared_identical_may_repeat_the_trainer(self, seat: str):
        """The case the flag exists for: one person holding two seats is not two people sharing a number."""

        block = kontakte(**{seat: person(), "trainer_is_also": seat})

        assert FLBewerbungKontaktePayload.model_validate(block).trainer_is_also == seat
        assert repeated_boxes(block) == ()

    @pytest.mark.parametrize("seat", ["ansprechperson", "stellvertretung"])
    def test_a_seat_declared_identical_and_filled_differently_is_refused(self, seat: str):
        """The form fills the second seat from the first, so a mismatch is a client that has drifted."""

        block = kontakte(**{seat: person(first_name="Andere"), "trainer_is_also": seat})

        with pytest.raises(ValidationError) as failure:
            FLBewerbungKontaktePayload.model_validate(block)

        assert seat in str(failure.value)

    @pytest.mark.parametrize(("seat", "field", "value"), SHARED_CONTACT_DETAILS)
    def test_two_distinct_people_may_share_neither_an_email_nor_a_number(self, seat: str, field: str, value: str):
        """Every other detail the seat's own: a seat sharing both, either rule would hide the other's removal."""

        other = {**person(first_name="Andere", email="andere@example.com", phone="+49 170 9999999"), field: value}

        assert repeated_boxes(kontakte(**{seat: other})) == (("kontakte", seat, field),)

    def test_one_refusal_names_every_repeated_box(self):
        """Each box its own press would ask the bot check again for one form."""

        other = person(first_name="Andere", email="QUILLHILDE@example.com", phone="0170 1234567")

        assert repeated_boxes(kontakte(stellvertretung=other)) == (
            ("kontakte", "stellvertretung", "email"),
            ("kontakte", "stellvertretung", "phone"),
        )

    def test_an_email_repeated_in_another_case_is_still_one_address(self):
        """A mailbox is addressed the same however the local part is capitalised, so the comparison folds case.

        Its own telephone, or the number rule would fire here and this would prove nothing about case.
        """

        other = person(first_name="Andere", email="QUILLHILDE@Example.com", phone="+49 170 9999999")

        assert repeated_boxes(kontakte(ansprechperson=other)) == (("kontakte", "ansprechperson", "email"),)

    @pytest.mark.parametrize("written", ONE_LINE_TWO_WAYS)
    def test_one_number_written_two_ways_is_still_one_number(self, written: str):
        """The whole reason `normalise_phone` exists: `PHONE_REGEX` admits many spellings of one line.

        The trainer holds `0170 1234567`; each spelling here is that same line, so a second person
        writing one of them is not a second telephone.
        """

        trainer = person(phone="0170 1234567")
        other = person(first_name="Andere", phone=written, email="andere@example.com")

        assert repeated_boxes(kontakte(trainer=trainer, ansprechperson=other)) == (("kontakte", "ansprechperson", "phone"),)

    def test_the_seat_left_out_of_the_comparison_is_the_declared_one_alone(self):
        """The narrowing is per-seat, not a blanket exemption: the third person is still held distinct from both."""

        block = kontakte(
            ansprechperson=person(),
            stellvertretung=person(first_name="Stellan", email="quillhilde@example.com", phone="0171 5555555"),
            trainer_is_also="ansprechperson",
        )

        assert repeated_boxes(block) == (("kontakte", "stellvertretung", "email"),)


class TestWhatTheServerComposes:
    """The fields a client is offered none of, so nothing submitted can claim them."""

    def test_every_seat_and_the_flag_survive_the_composition(self):
        """The control for the case above: a composer dropping a seat would satisfy it and store two people."""

        block = kontakte(trainer_is_also="ansprechperson", ansprechperson=person())
        composed = compose_kontakte(kontakte=FLBewerbungKontaktePayload.model_validate(block).model_dump(mode="json"), today=TODAY)

        assert set(composed) == {"trainer", "ansprechperson", "stellvertretung", "trainer_is_also"}
        assert composed["trainer_is_also"] == "ansprechperson"
        assert composed["stellvertretung"]["first_name"] == "Stellan"

    def test_the_receipt_names_a_trainer_holding_a_second_seat_once_under_both(self):
        """The Ansprechperson is told who is still to answer: one person, not their two seats as two people."""

        block = kontakte(trainer_is_also="stellvertretung", stellvertretung=person())
        composed = compose_kontakte(kontakte=FLBewerbungKontaktePayload.model_validate(block).model_dump(mode="json"), today=TODAY)

        [receipt] = [
            mail.data
            for mail in owed_at_submission(
                bewerbung_id=PICKED_OID, kontakte=composed, saison_id="2026", schule="Zorbanax", deadline="2026-04-15", unmailed=()
            )
            if isinstance(mail.data, FLBewerbungReceivedData)
        ]

        assert [person.model_dump() for person in receipt.pending] == [{"first_name": "Quillhilde", "rollen": ["stellvertretung", "trainer"]}]

    def test_a_client_may_not_name_a_consent(self):
        """`extra="forbid"`: a body naming one could claim a person's own consent or its seating, or backdate or pre-confirm one."""

        with pytest.raises(ValidationError):
            FLBewerbungKontaktpersonPayload.model_validate(person(einwilligung={"scope": "kontakt_data"}))


class TestWhatTheSubmissionPayloadRefuses:
    """The fields the server owns are on no payload at all, so a submission cannot arrive already decided."""

    @pytest.mark.parametrize(("field", "value"), [("status", "accepted"), ("submitted_at", "2020-01-01"), ("decision", None)])
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

    def test_an_empty_website_box_is_stored_as_null(self):
        """The applicant left it empty, which is no URL to refuse: an empty `href` would link to the page it sits on."""

        parsed = FLPostBewerbungPayload.model_validate(submission(team_id=None, schule=schule(website_url="")))

        assert parsed.schule is not None and parsed.schule.website_url is None

    @pytest.mark.parametrize("refused", REFUSED_CHARACTERS)
    def test_a_school_name_carrying_one_of_them_inside_is_refused(self, refused: str):
        """Both name fields, so a pattern applied to one of the pair fails here rather than shipping half-narrowed."""

        forged = f"Zorbanax{refused}Entscheidung: Absage"

        for field in ("team_name", "full_name"):
            with pytest.raises(ValidationError):
                FLPostBewerbungPayload.model_validate(submission(team_id=None, schule=schule(**{field: forged})))

    def test_a_school_name_padded_with_nul_is_refused_rather_than_trimmed(self):
        """The one refused character `strip_whitespace` does not remove, which is also what the JavaScript mirror's `trim` does."""

        padded = submission(team_id=None, schule=schule(team_name=f"{chr(0x00)}Zorbanax{chr(0x00)}"))

        with pytest.raises(ValidationError):
            FLPostBewerbungPayload.model_validate(padded)


class TestTheCeilingOnTheSchoolWebsite:
    """`validate_external_url` reads the scheme and the host; the path and the query are this bound's alone."""

    def test_an_oversized_value_is_refused_before_the_host_regex_reads_it(self):
        """Why the ceiling is declared BEFORE the validator rather than around it.

        `DOMAIN_REGEX` carries nested quantifiers, so a megabyte of host is work this refuses
        without doing. Wrap `CustomExternalUrl` instead and this becomes `url_not_accepted`.
        """

        enormous = "javascript:" + "a" * (TEAM_WEBSITE_URL_MAX_LENGTH * 40)

        with pytest.raises(ValidationError) as failure:
            FLBewerbungSchulePayload.model_validate(schule(website_url=enormous))

        assert failure.value.errors()[0]["type"] == "string_too_long"


class TestTheStrongPlayersFitInsideTheSquad:
    """A subset cannot outnumber the whole.

    Both figures are the school's own estimate, so an impossible pair is a typo the form catches
    rather than a judgement about the school.
    """

    @pytest.mark.parametrize(
        ("size", "good"),
        [
            pytest.param(14, 15, id="one over the squad"),
            pytest.param(1, 2, id="one over the smallest squad"),
            pytest.param(14, BEWERBUNG_KADER_SIZE_MAX, id="inside its own ceiling and still past the squad"),
        ],
    )
    def test_a_count_above_the_squad_is_refused(self, size: int, good: int):
        """The third row matters: both fields clear their own bounds, so only the pair rule can refuse it."""

        kader = {"expected_size": size, "good_spieler": good}

        with pytest.raises(ValidationError) as failure:
            FLPostBewerbungPayload.model_validate(submission(kader=kader))

        # The ceiling rides as the context the frontend words „Höchstens {max}“ from.
        assert [(error["type"], error.get("ctx")) for error in failure.value.errors()] == [("good_spieler_exceed_kader", {"max": size})]


class TestTheOpponentTheSchoolWants:
    """A free string and never a reference: a school may name an applicant the league has not accepted yet.

    Optional on the payload where the other nullable fields are required-and-null: the key is one a
    form deployed before it does not send.
    """

    @pytest.mark.parametrize(
        "submitted",
        [pytest.param(None, id="an explicit null"), pytest.param("", id="an empty box"), pytest.param("   ", id="spaces alone")],
    )
    def test_an_empty_wish_is_stored_as_a_null_rather_than_a_blank(self, submitted: str | None):
        """One spelling of "no preference": a stored `""` is a second, and the triage would render it as a wish."""

        assert FLPostBewerbungPayload.model_validate(submission(wunschgegner=submitted)).wunschgegner is None

    @pytest.mark.parametrize("refused", REFUSED_CHARACTERS)
    def test_a_wish_carrying_one_of_them_inside_is_refused(self, refused: str):
        """The same class the two school names take, so the fields carrying it cannot drift into separate rules."""

        with pytest.raises(ValidationError):
            FLPostBewerbungPayload.model_validate(submission(wunschgegner=f"Zorbanax{refused}Entscheidung: Absage"))


def tagged_seat(tag: str, *, confirmed_at: str | None = None) -> dict[str, Any]:
    return {"email": f"victim+{tag}@example.com", "einwilligung": {"confirmed_at": confirmed_at}}


class TestOneApplicationsTagsOfOneMailbox:
    """A school may run all three seats on tags of one mailbox, which the bound counts a link each."""

    def test_three_tagged_seats_with_no_other_link_open_are_all_mailed(self):
        """Its third person would otherwise stand unmailed with nothing saying why, and the application go on its day."""

        block = {"trainer": tagged_seat("t"), "ansprechperson": tagged_seat("a"), "stellvertretung": tagged_seat("s"), "trainer_is_also": None}

        assert seats_past_the_bound(kontakte=block, open_links={"victim@example.com": 0}) == []

    def test_only_a_seat_mailed_and_unanswered_holds_a_link(self):
        """An answer frees its link, so a seat beside the open one that counted anyway would leave a real person unmailed early."""

        row = {
            "kontakte": {
                "trainer": tagged_seat("open"),
                "ansprechperson": tagged_seat("answered", confirmed_at=TODAY),
                "stellvertretung": tagged_seat("unmailed"),
                "trainer_is_also": None,
            },
            "confirmations": {"trainer": {"sent_at": TODAY}, "ansprechperson": {"sent_at": TODAY}, "stellvertretung": {"sent_at": None}},
        }

        assert open_links_on(row=row, mailbox="victim@example.com") == 1


class TestOneAnchorDocumentAMailbox:
    def test_a_tag_stays_with_its_mailbox_and_a_second_mailbox_stands_apart(self):
        """One document for every mailbox stalls every school's press behind a stranger's flood of fresh addresses, and no failure names why."""

        assert len(mailbox_anchor_ids(addresses=["victim@example.com", "victim+t@example.com", "other@example.com"])) == 2


class TestTheColoursASeasonHasAlreadyAssigned:
    """What the public form closes in its Wunschfarbe picker, taken from the ASSIGNMENTS and never from another applicant's wish."""

    def test_the_palette_orders_the_answer_rather_than_the_junction(self):
        """Sorted by the league's own vocabulary, so two identical seasons never answer in two orders."""

        assert assigned_trikot_farben(stored=["rot", "weiss", "blau"]) == ["weiss", "rot", "blau"]

    def test_a_row_with_no_colour_assigned_contributes_nothing(self):
        """`trikot_farbe` is nullable and may be missing, so the read's group yields a null for a missing key too."""

        assert assigned_trikot_farben(stored=[None, "rot"]) == ["rot"]

    def test_a_value_outside_the_palette_is_dropped_rather_than_served(self):
        """Filtered THROUGH the palette: a stray value would fail `FLTrikotFarbe` and 500 a public page."""

        assert assigned_trikot_farben(stored=["zorbanaxgruen", "rot"]) == ["rot"]
