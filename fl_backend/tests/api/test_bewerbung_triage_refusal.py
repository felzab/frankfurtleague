import asyncio
import json
import logging
from collections.abc import Iterator, Mapping
from typing import Any, cast

import pytest
from bson import ObjectId

from app.api.bewerbungen.schemas import FLBewerbungSchule
from app.api.bewerbungen.services import (
    BEWERBUNG_ALREADY_DECIDED,
    BEWERBUNG_KONTAKT_EMAIL_TAKEN,
    BEWERBUNG_KONTAKTE_UNCONFIRMED,
    BEWERBUNG_SCHULE_UNUSABLE,
    BEWERBUNG_SEAT_ALREADY_ANSWERED,
    BEWERBUNG_SUBJECT_UNRESOLVED,
    claimed_pair_seat,
    compose_bestaetigungen,
    compose_kontakt_email_update,
    compose_kontakt_seat_update,
    compose_new_club,
    find_acceptance_subject_refusal,
    find_kontakt_email_refusal,
    find_new_club_refusal,
    find_reseat_refusal,
    find_triage_refusal,
    find_unconfirmed_kontakte_refusal,
    hash_token,
    paired_seat,
    seat_awaits_a_replacement,
)
from app.core.exception_handlers import base_api_exception_handler
from app.core.exceptions import DocumentConflictException
from app.core.logging import FL_LOGGER_NAME, JSONFormatter

# Fixed rather than generated, so a failure names the same club every run.
PICKED_OID = ObjectId("6890a1b2c3d4e5f607900001")

# Two keys, not the whole block: the refusal reads neither of them, and a fuller document here would
# suggest it did. What it judges is whether the field carries a value at all.
SCHULE: Mapping[str, Any] = {"team_name": "Zorbanax", "shorthand": "ZX"}

# The two states a decision leaves behind. `eingereicht` is the third and the only one a decision may
# be taken from, which is what makes this list the whole of the refused set.
DECIDED = ["angenommen", "abgelehnt"]


class TestADecisionIsTakenOnce:
    """`REQ-BEWERBUNG-001`, apart from a database: acceptance is irreversible, so the second press is what this stops."""

    def test_a_submitted_application_may_still_be_decided(self):
        """The floor: without it every case below would pass on a guard that refuses everything."""

        assert find_triage_refusal(status="eingereicht") is None

    @pytest.mark.parametrize("status", DECIDED)
    def test_an_application_already_decided_is_refused(self, status: str):
        """Both endpoints ask this one question, so both states are refused by the one code."""

        refusal = find_triage_refusal(status=status)

        assert refusal is not None
        assert refusal.error_code == BEWERBUNG_ALREADY_DECIDED

    @pytest.mark.parametrize("status", DECIDED)
    def test_the_refusal_names_the_decision_that_already_stands(self, status: str):
        """The message is what an administrator acts on: which way it went decides whether anything is left to do."""

        refusal = find_triage_refusal(status=status)

        assert refusal is not None
        assert status in refusal.message


# The four combinations of (`team_id` set or null) by (`schule` set or null). Exactly one of the two
# says what acceptance would enter, so the mixed rows pass and the matched rows are refused.
SUBJECTS = [
    pytest.param(PICKED_OID, None, False, id="an existing club alone"),
    pytest.param(None, SCHULE, False, id="a new school alone"),
    pytest.param(PICKED_OID, SCHULE, True, id="both"),
    pytest.param(None, None, True, id="neither"),
]


class TestWhatAcceptanceWouldEnter:
    """`REQ-BEWERBUNG-002`: the write path branches on which field carries the value, so it judges rather than assumes."""

    @pytest.mark.parametrize(("team_id", "schule", "refused"), SUBJECTS)
    def test_exactly_one_of_the_two_resolves_a_club_to_enter(self, team_id: Any, schule: Mapping[str, Any] | None, refused: bool):
        refusal = find_acceptance_subject_refusal(team_id=team_id, schule=schule)

        assert (refusal is not None) == refused
        assert refusal is None or refusal.error_code == BEWERBUNG_SUBJECT_UNRESOLVED

    def test_naming_both_and_naming_neither_read_differently(self):
        """One message for the two would send an administrator to the wrong field: the fix for each is the other's opposite."""

        both = find_acceptance_subject_refusal(team_id=PICKED_OID, schule=SCHULE)
        neither = find_acceptance_subject_refusal(team_id=None, schule=None)

        assert both is not None and neither is not None
        assert "both an existing club and a new school" in both.message
        assert "neither an existing club nor a new school" in neither.message
        assert both.message != neither.message


def seat(vorname: str, *, bestaetigt_am: str | None) -> dict[str, Any]:
    """One contact seat, confirmed or not: the refusal reads the stamp and nothing else about the person."""

    return {
        "vorname": vorname,
        "nachname": "Brackenmoor",
        "email": f"{vorname.lower()}@example.com",
        "telefon": "+49 170 1234567",
        "geburtsdatum": None if bestaetigt_am is None else "1984-05-09",
        "einwilligung": {
            "umfang": "kontaktdaten",
            "erfasst_von": "administrativ",
            "text_version": "v3",
            "datum": "2026-03-20",
            "bestaetigt_am": bestaetigt_am,
        },
    }


def seats(**stamps: str | None) -> dict[str, Any]:
    return {
        "trainer": seat("Quillhilde", bestaetigt_am=stamps.get("trainer")),
        "ansprechperson": seat("Ansgar", bestaetigt_am=stamps.get("ansprechperson")),
        "stellvertretung": seat("Stellan", bestaetigt_am=stamps.get("stellvertretung")),
        "trainer_ist_zugleich": None,
    }


BESTAETIGUNGEN = compose_bestaetigungen(
    hashes={name: hash_token(name) for name in ("trainer", "ansprechperson", "stellvertretung")}, today="2026-03-20"
)


class TestEverySeatIsConfirmedBeforeAcceptance:
    """`REQ-BEWERBUNG-013`: the block copied into the junction row must carry every person's own date and stamp."""

    def test_an_application_stored_before_the_flow_is_not_held_to_it(self):
        """The carve-out: without it every application in the queue becomes unacceptable in the deploy that ships this."""

        assert find_unconfirmed_kontakte_refusal(kontakte=seats(), bestaetigungen=None) is None

    def test_every_seat_confirmed_passes(self):
        stamped = seats(trainer="2026-03-21", ansprechperson="2026-03-22", stellvertretung="2026-03-23")

        assert find_unconfirmed_kontakte_refusal(kontakte=stamped, bestaetigungen=BESTAETIGUNGEN) is None

    @pytest.mark.parametrize(
        ("kontakte", "outstanding"),
        [
            pytest.param(seats(), "trainer, ansprechperson, stellvertretung", id="nobody has confirmed"),
            pytest.param(seats(trainer="2026-03-21", stellvertretung="2026-03-23"), "ansprechperson", id="one seat open"),
            pytest.param(
                {**seats(trainer="2026-03-21", ansprechperson="2026-03-22"), "stellvertretung": None},
                "stellvertretung",
                id="a seat emptied by a decline or an erasure",
            ),
        ],
    )
    def test_a_seat_without_its_persons_stamp_refuses_and_is_named(self, kontakte: Mapping[str, Any], outstanding: str):
        """Named, so the administrator knows whom to wait for or re-send to."""

        refusal = find_unconfirmed_kontakte_refusal(kontakte=kontakte, bestaetigungen=BESTAETIGUNGEN)

        assert refusal is not None
        assert refusal.error_code == BEWERBUNG_KONTAKTE_UNCONFIRMED
        assert refusal.message.endswith(outstanding)


class TestCorrectingOneContactAddress:
    """The one field of a submitted application an administrator may rewrite, held to the rule the submission was accepted under."""

    def test_an_address_no_other_seat_holds_is_written(self):
        assert find_kontakt_email_refusal(kontakte=seats(), seats=("ansprechperson",), email="neu@example.com") is None

    def test_the_address_another_person_is_reached_at_is_refused(self):
        """Storing it would leave two people on one mailbox, which the submission itself refuses and the erasure could not tell apart."""

        refusal = find_kontakt_email_refusal(kontakte=seats(), seats=("ansprechperson",), email="stellan@example.com")

        assert refusal is not None and refusal.error_code == BEWERBUNG_KONTAKT_EMAIL_TAKEN

    @pytest.mark.parametrize("email", ["STELLAN@example.com", "stellan@EXAMPLE.com"])
    def test_another_spelling_of_that_address_is_the_same_mailbox(self, email: str):
        """Case-insensitively over the WHOLE address, as `FLBewerbungKontaktePayload` compares it: a third rule parts the two tiers."""

        assert find_kontakt_email_refusal(kontakte=seats(), seats=("ansprechperson",), email=email) is not None

    def test_the_seats_this_correction_writes_do_not_collide_with_themselves(self):
        """One person on two seats moves to one new address, and comparing them against each other would refuse every such correction."""

        mirrored = {**seats(), "trainer": seat("Ansgar", bestaetigt_am=None), "trainer_ist_zugleich": "ansprechperson"}

        assert find_kontakt_email_refusal(kontakte=mirrored, seats=("trainer", "ansprechperson"), email="neu@example.com") is None
        assert find_kontakt_email_refusal(kontakte=mirrored, seats=("trainer", "ansprechperson"), email="ansgar@example.com") is None

    def test_an_emptied_seat_holds_no_address_to_collide_with(self):
        emptied = {**seats(), "stellvertretung": None}

        assert find_kontakt_email_refusal(kontakte=emptied, seats=("trainer",), email="stellan@example.com") is None

    def test_the_write_is_one_set_carrying_the_address_and_the_fresh_entry(self):
        """Two writes would leave the corrected address beside the link the old one was mailed, which is a live credential."""

        update = compose_kontakt_email_update(
            seats=("trainer", "ansprechperson"),
            email="neu@example.com",
            token_hash="frisch",
            today="2026-03-20",
            bestaetigungsfrist="2026-04-03",
        )

        assert set(update) == {"$set"}
        assert update["$set"]["kontakte.trainer.email"] == "neu@example.com"
        assert update["$set"]["kontakte.ansprechperson.email"] == "neu@example.com"
        assert update["$set"]["bestaetigungsfrist"] == "2026-04-03"

    @pytest.mark.parametrize("seat_name", ["trainer", "ansprechperson"])
    def test_the_whole_entry_is_replaced_so_the_old_delivery_state_goes_with_it(self, seat_name: str):
        """A refusal recorded against the address just replaced would hold the application for ever."""

        update = compose_kontakt_email_update(
            seats=("trainer", "ansprechperson"),
            email="neu@example.com",
            token_hash="frisch",
            today="2026-03-20",
            bestaetigungsfrist="2026-04-03",
        )

        assert update["$set"][f"bestaetigungen.{seat_name}"] == {
            "token_hash": "frisch",
            "verschickt_am": "2026-03-20",
            "erinnert_am": None,
            "abgelehnt_am": None,
        }


WIDERSPRUCH_AM = "2026-03-25"

NEW_PERSON: Mapping[str, Any] = {
    "vorname": "Wilburga",
    "nachname": "Dringenhoff",
    "email": "wilburga@example.com",
    "telefon": "+49 170 7654321",
}


def declined_entries(seat: str) -> dict[str, Any]:
    """The bookkeeping a Widerspruch leaves: the entry stands beside the emptied slot, carrying the day."""

    return {**BESTAETIGUNGEN, seat: {**BESTAETIGUNGEN[seat], "abgelehnt_am": WIDERSPRUCH_AM}}


def erased_entries(seat: str) -> dict[str, Any]:
    """What an erasure leaves, which is the entry nulled (`app/api/kontakte/services.py :: build_clearing_update`)."""

    return {**BESTAETIGUNGEN, seat: None}


# Every seat state the reseat refuses, as a stored block. A CONFIRMED seat is not among them because
# the stamp sits in the slot rather than in the entry this predicate reads
# (`fl_backend/tests/api/test_bewerbung_triage_execution.py :: TestSeatingAnotherPersonInAnEmptiedSeat`).
NOT_STEPPED_OUT = [
    pytest.param(BESTAETIGUNGEN, id="a seat still waiting on its own answer"),
    pytest.param(erased_entries("ansprechperson"), id="a seat erased at its person's request"),
    pytest.param(None, id="an application stored before the confirmation flow"),
]


class TestSeatingAnotherPersonWhereOneSteppedOut:
    """`REQ-BEWERBUNG-011` from the other side: the one seat state this write runs on is the state every neighbour refuses."""

    def test_a_seat_its_person_stepped_out_of_takes_another(self):
        """The floor: without it every case below would pass on a guard that refuses everything."""

        assert find_reseat_refusal(bestaetigungen=declined_entries("ansprechperson"), seats=("ansprechperson",)) is None

    @pytest.mark.parametrize("bestaetigungen", NOT_STEPPED_OUT)
    def test_no_other_seat_state_is_seated_again(self, bestaetigungen: Any):
        refusal = find_reseat_refusal(bestaetigungen=bestaetigungen, seats=("ansprechperson",))

        assert refusal is not None
        assert refusal.error_code == BEWERBUNG_SEAT_ALREADY_ANSWERED

    def test_the_refusal_names_the_seat_it_is_about(self):
        """Three seats stand on the page, and a refusal naming none of them is one an administrator cannot place."""

        refusal = find_reseat_refusal(bestaetigungen=BESTAETIGUNGEN, seats=("stellvertretung",))

        assert refusal is not None and "stellvertretung" in refusal.message

    def test_a_widerspruch_and_an_erasure_are_parted_by_the_day_the_decline_left(self):
        """Both leave an empty slot, and only one is repaired: the erasure took the entry the decline writes into."""

        assert seat_awaits_a_replacement(bestaetigungen=declined_entries("trainer"), seat="trainer") is True
        assert seat_awaits_a_replacement(bestaetigungen=erased_entries("trainer"), seat="trainer") is False

    def test_the_claimed_pair_survives_the_emptying_that_hides_it_from_paired_seat(self):
        """A pair read through `paired_seat` answers `None` here, and one seat would be left holding the other's link."""

        emptied = {**seats(), "trainer": None, "ansprechperson": None, "trainer_ist_zugleich": "ansprechperson"}
        # BOTH seats declined, which is the only shape the write runs on: one person answered once.
        bestaetigungen = {**declined_entries("ansprechperson"), "trainer": {**BESTAETIGUNGEN["trainer"], "abgelehnt_am": WIDERSPRUCH_AM}}

        assert claimed_pair_seat(kontakte=emptied, seat="ansprechperson") == "trainer"
        assert claimed_pair_seat(kontakte=emptied, seat="trainer") == "ansprechperson"
        assert paired_seat(kontakte=emptied, bestaetigungen=bestaetigungen, seat="ansprechperson") is None
        assert find_reseat_refusal(bestaetigungen=bestaetigungen, seats=("ansprechperson", "trainer")) is None

    @pytest.mark.parametrize(
        "mirror",
        [
            pytest.param(BESTAETIGUNGEN["trainer"], id="a mirror still waiting on its own answer"),
            pytest.param(None, id="a mirror erased at its person's request"),
        ],
    )
    def test_a_claimed_mirror_in_any_other_state_refuses_the_press(self, mirror: Any):
        """The mirror is written unasked, so judging the pressed seat alone would seat somebody over a person who never stepped out."""

        bestaetigungen = {**declined_entries("ansprechperson"), "trainer": mirror}
        refusal = find_reseat_refusal(bestaetigungen=bestaetigungen, seats=("ansprechperson", "trainer"))

        assert refusal is not None and "trainer" in refusal.message
        assert refusal.error_code == BEWERBUNG_SEAT_ALREADY_ANSWERED

    def test_a_seat_nobody_claims_as_the_trainers_is_seated_alone(self):
        assert claimed_pair_seat(kontakte={**seats(), "trainer_ist_zugleich": None}, seat="ansprechperson") is None
        assert claimed_pair_seat(kontakte={**seats(), "trainer_ist_zugleich": "stellvertretung"}, seat="ansprechperson") is None


class TestWhatSeatingAnotherPersonWrites:
    """One `$set`, so the new person never stands in the seat beside the link its last holder was sent."""

    def test_the_slot_is_written_whole_rather_than_field_by_field(self):
        """A decline nulled the slot, and a dotted `$set` under a null is `PathNotViable`, which aborts the transaction."""

        update = compose_kontakt_seat_update(
            seats=("ansprechperson",),
            person=dict(NEW_PERSON),
            text_version="2026-09-bestaetigung-4",
            token_hash="frisch",
            today="2026-03-26",
            bestaetigungsfrist="2026-04-09",
        )

        assert set(update) == {"$set"}
        assert set(update["$set"]) == {"kontakte.ansprechperson", "bestaetigungen.ansprechperson", "bestaetigungsfrist"}

    def test_the_seated_person_carries_an_administrative_record_and_no_birthdate(self):
        """Nobody has answered for this seat yet: the date and the stamp are the new person's own to enter at their link."""

        update = compose_kontakt_seat_update(
            seats=("ansprechperson",),
            person=dict(NEW_PERSON),
            text_version="2026-09-bestaetigung-4",
            token_hash="frisch",
            today="2026-03-26",
            bestaetigungsfrist="2026-04-09",
        )
        slot = update["$set"]["kontakte.ansprechperson"]

        assert {field: slot[field] for field in NEW_PERSON} == dict(NEW_PERSON)
        assert slot["geburtsdatum"] is None
        assert slot["einwilligung"] == {
            "umfang": "kontaktdaten",
            "erfasst_von": "administrativ",
            "text_version": "2026-09-bestaetigung-4",
            "datum": "2026-03-26",
            "bestaetigt_am": None,
        }

    def test_the_day_the_last_holder_stepped_out_goes_with_the_entry(self):
        """Kept, it would hold the new person's seat as answered and refuse the very link this write minted."""

        update = compose_kontakt_seat_update(
            seats=("trainer", "ansprechperson"),
            person=dict(NEW_PERSON),
            text_version="2026-09-bestaetigung-4",
            token_hash="frisch",
            today="2026-03-26",
            bestaetigungsfrist="2026-04-09",
        )

        for seat_name in ("trainer", "ansprechperson"):
            assert update["$set"][f"bestaetigungen.{seat_name}"] == {
                "token_hash": "frisch",
                "verschickt_am": "2026-03-26",
                "erinnert_am": None,
                "abgelehnt_am": None,
            }
            assert update["$set"][f"kontakte.{seat_name}"] == update["$set"]["kontakte.trainer"]

    def test_one_press_moves_the_deadline_for_the_whole_application(self):
        """The new person is given the fourteen days the seat's last holder had, and the other two seats ride with it."""

        update = compose_kontakt_seat_update(
            seats=("ansprechperson",),
            person=dict(NEW_PERSON),
            text_version="2026-09-bestaetigung-4",
            token_hash="frisch",
            today="2026-03-26",
            bestaetigungsfrist="2026-04-09",
        )

        assert update["$set"]["bestaetigungsfrist"] == "2026-04-09"


ADDRESS: Mapping[str, Any] = {
    "strasse": "Hanauer Landstraße",
    "hausnummer": "12a",
    "plz": "60314",
    "stadtteil": "Ostend",
    "stadt": "Frankfurt am Main",
}


def schule_block(**overrides: Any) -> dict[str, Any]:
    """One school's own details, as `bewerbungen` stores them. Valid, so a case below fails on the key it replaces."""

    return {
        "team_name": "Zorbanax",
        "full_name": "Zorbanax-Gesamtschule",
        "shorthand": "ZX",
        "schulform": "gesamtschule",
        "address": dict(ADDRESS),
        "website_url": "https://zorbanax.example.de",
        **overrides,
    }


def composed_club(**overrides: Any) -> dict[str, Any]:
    """The club document `annehmen_bewerbung` composes, which is what the refusal judges.

    The router's OWN composer, never a hand-written copy: a copy is what the router drifts from
    silently, and a coercion before the guard is exactly what it hides.
    """

    return compose_new_club(schule=schule_block(**overrides))


def composed_club_without(field: str) -> dict[str, Any]:
    """The same composition with one of the school's six keys absent, which `bewerbungen` requires."""

    return compose_new_club(schule={key: value for key, value in schule_block().items() if key != field})


def submitted_values(schule: Mapping[str, Any]) -> list[str]:
    """Every string one school submitted, the address's five included: L9 governs each of them."""

    flat: list[Any] = []
    for value in schule.values():
        flat.extend(value.values() if isinstance(value, Mapping) else [value])

    return [value for value in flat if isinstance(value, str)]


# Every one of these is stored happily and refused by `FLTeam`, which reads the clubs list. The
# first is an XSS sink the moment React renders it into an href.

# NOT the empty string, which is a school naming no site rather than naming a bad one: the club
# model takes it as null, and `TestASchoolWithNoWebsite` below is where that is pinned.
UNUSABLE_URLS = [
    pytest.param("javascript:alert(1)", id="a javascript scheme"),
    pytest.param("zorbanax.example.de", id="no scheme at all"),
]


class TestWhetherTheSchoolMakesAClub:
    """`REQ-BEWERBUNG-003`, the last point that can still answer 409.

    `bewerbungen`'s validator asserts types, required fields and enums alone
    (`docs/backend/spec.md :: I16`), so a school's stored details reach acceptance unchecked.
    """

    def test_a_school_a_club_can_be_created_from_is_let_through(self):
        """The floor: without it every case below would pass on a guard that refuses everything."""

        assert find_new_club_refusal(club_document=composed_club()) is None

    @pytest.mark.parametrize("website_url", UNUSABLE_URLS)
    def test_the_application_stores_a_url_the_club_model_refuses(self, website_url: str):
        """The asymmetry the rule exists for. Both sides here, so neither can drift into agreeing without this failing."""

        assert FLBewerbungSchule.model_validate(schule_block(website_url=website_url)).website_url == website_url
        assert find_new_club_refusal(club_document=composed_club(website_url=website_url)) is not None

    @pytest.mark.parametrize("website_url", UNUSABLE_URLS)
    def test_such_a_url_is_refused_under_the_code_and_names_its_field(self, website_url: str):
        """Accepting it would create a club that 500s `GET /teams` and `GET /teams/{team_id}` both, with no undo."""

        refusal = find_new_club_refusal(club_document=composed_club(website_url=website_url))

        assert refusal is not None
        assert refusal.error_code == BEWERBUNG_SCHULE_UNUSABLE
        assert "website_url" in refusal.message

    def test_a_school_naming_no_website_makes_a_club_all_the_same(self):
        """The inverse of the rows above, and the reason the empty string left them.

        A school without a site is not a school whose details make no club, so acceptance must
        create one rather than answer `REQ-BEWERBUNG-003`.
        """

        assert find_new_club_refusal(club_document=composed_club(website_url=None)) is None
        assert find_new_club_refusal(club_document=composed_club(website_url="")) is None

    def test_a_fault_beside_the_url_is_refused_too(self):
        """The whole composed document is judged rather than the one field: `shorthand` is two letters and is indexed unique."""

        refusal = find_new_club_refusal(club_document=composed_club(shorthand="ZORB"))

        assert refusal is not None
        assert (refusal.error_code, "shorthand" in refusal.message) == (BEWERBUNG_SCHULE_UNUSABLE, True)

    def test_a_fault_inside_the_address_is_named_by_its_path(self):
        """A refusal naming `address` alone would send an administrator to the wrong one of five fields."""

        refusal = find_new_club_refusal(club_document=composed_club(address={**ADDRESS, "plz": "6031"}))

        assert refusal is not None
        assert "address.plz" in refusal.message


# Neither a string nor absent, and every one of them a value `str()` turns into a club name nobody
# typed. LATENT: no stored application carries one, its validator typing each of the school's six.
UNCOERCIBLE_VALUES = [
    pytest.param(None, id="a null"),
    pytest.param(0, id="a number"),
    pytest.param({}, id="an object"),
    pytest.param([], id="an array"),
]

# The three ways a stored block reaches the composition as something other than an object.
NON_MAPPING_BLOCKS = [pytest.param("Zorbanax", id="a string"), pytest.param([], id="an array"), pytest.param(7, id="a number")]


class TestTheSchoolReachesTheGuardAsItIsStored:
    """What defeats `REQ-BEWERBUNG-003` is never the guard but whatever the composition does in front of it.

    Acceptance is irreversible, so a club composed out of a value the guard would have refused is one
    only an `austritt` gets rid of.
    """

    @pytest.mark.parametrize("value", UNCOERCIBLE_VALUES)
    def test_a_team_name_that_is_no_string_is_refused(self, value: Any):
        refusal = find_new_club_refusal(club_document=composed_club(team_name=value))

        assert refusal is not None
        assert (refusal.error_code, "this school's name" in refusal.message) == (BEWERBUNG_SCHULE_UNUSABLE, True)

    @pytest.mark.parametrize("value", UNCOERCIBLE_VALUES)
    def test_such_a_value_is_carried_to_the_guard_rather_than_coerced(self, value: Any):
        """`str(None)` is `'None'`, which `CustomNonEmptyString` accepts: the guard above would never see it."""

        assert composed_club(team_name=value)["name"] == value

    @pytest.mark.parametrize("field", sorted(schule_block()))
    def test_a_missing_field_is_this_rules_refusal_and_not_a_key_error(self, field: str):
        """A subscript in front of the guard answers 500 `SRV-FAIL-001` where the rule promises 409."""

        refusal = find_new_club_refusal(club_document=composed_club_without(field))

        assert refusal is not None
        assert (refusal.error_code, "Field required" in refusal.message) == (BEWERBUNG_SCHULE_UNUSABLE, True)

    @pytest.mark.parametrize("schule", NON_MAPPING_BLOCKS)
    def test_a_block_that_is_no_object_is_refused_rather_than_raising(self, schule: Any):
        """Subscripting a non-object raises `TypeError`, which is a 500 and not this rule's 409."""

        refusal = find_new_club_refusal(club_document=compose_new_club(schule=schule))

        assert refusal is not None
        assert refusal.error_code == BEWERBUNG_SCHULE_UNUSABLE


# A value no message and no log line may carry. Shaped like the thing L9 protects -- a school's own
# address line -- and distinctive enough that its absence is evidence rather than coincidence.
LEAKED = "Zorbanax-Geheimstraße 7"

# (what the school submitted, the field path the refusal has to name instead). Each value is refused
# by the club payload, so the message is composed while the value is in the validator's hand.
LEAKING_FAULTS = [
    pytest.param({"website_url": f"javascript:{LEAKED}"}, "website_url", id="a website"),
    pytest.param({"shorthand": LEAKED}, "shorthand", id="a shorthand"),
    pytest.param({"address": {**ADDRESS, "hausnummer": LEAKED}}, "address.hausnummer", id="a house number"),
]


class TestTheRefusalWithholdsWhatTheSchoolSubmitted:
    """`docs/logging/spec.md :: L9`, on a refusal built from a real school's block.

    The message IS the line -- `app/core/exception_handlers.py :: base_api_exception_handler` logs
    it verbatim -- so a value in it reaches the sink.
    """

    @pytest.mark.parametrize(("fault", "field"), LEAKING_FAULTS)
    def test_the_message_names_the_field_and_withholds_the_value(self, fault: Mapping[str, Any], field: str):
        refusal = find_new_club_refusal(club_document=composed_club(**fault))

        assert refusal is not None
        assert field in refusal.message, "an administrator cannot act on a refusal naming no field"
        assert LEAKED not in refusal.message

    def test_a_missing_field_carries_none_of_the_values_beside_it(self):
        """Pydantic's `input` for a missing key is the WHOLE document, so one appended here empties the block into the line."""

        refusal = find_new_club_refusal(club_document=composed_club_without("full_name"))

        assert refusal is not None
        assert "full_name" in refusal.message
        for submitted in submitted_values(schule_block()):
            assert submitted not in refusal.message, f"the message carries {submitted!r}"

    def test_the_line_the_handler_writes_carries_no_more_than_the_message(self, caplog):
        """Asserted on the LOG, never the wire: the body is the code and the id, so a wire test passes whatever is written."""

        refusal = find_new_club_refusal(club_document=composed_club(website_url=f"javascript:{LEAKED}"))
        assert refusal is not None

        with caplog.at_level(logging.WARNING, logger=FL_LOGGER_NAME):
            asyncio.run(base_api_exception_handler(cast(Any, None), DocumentConflictException.from_refusal(refusal)))

        records = [record for record in caplog.records if getattr(record, "error_code", None) is not None]
        assert len(records) == 1, records

        # The line as the sink receives it -- message and extras both, so nothing hides in a field.
        document = JSONFormatter().format(records[0])
        assert BEWERBUNG_SCHULE_UNUSABLE in document and "website_url" in document
        # Re-serialised with the escapes undone: the formatter emits a non-ASCII value escaped,
        # so a substring check on the raw line reads straight past the leak it is looking for.
        assert LEAKED not in json.dumps(json.loads(document), ensure_ascii=False)


class ZorbanaxBoom(RuntimeError):
    """Not a `ValidationError`, so it is not the school's fault and may not be answered as one."""


class ExplodingSchule(Mapping[str, Any]):
    """A block whose every read raises, provoking a non-validation failure inside the guard.

    Pydantic reads a mapping to validate it, so what the `except` catches decides whether a fault in
    this code reads to an administrator as the school's fault.
    """

    def __getitem__(self, key: str) -> Any:
        raise ZorbanaxBoom("the block blew up")

    def __iter__(self) -> Iterator[str]:
        raise ZorbanaxBoom("the block blew up")

    def __len__(self) -> int:
        raise ZorbanaxBoom("the block blew up")


class TestOnlyTheSchoolsOwnFaultIsRefused:
    """A widened `except` files every bug on this path under `REQ-BEWERBUNG-003`."""

    def test_a_failure_that_is_no_validation_error_is_left_to_the_500(self):
        """The repair that refusal offers -- decline it and type the club in by hand -- is then the wrong one."""

        with pytest.raises(ZorbanaxBoom):
            find_new_club_refusal(club_document=ExplodingSchule())
