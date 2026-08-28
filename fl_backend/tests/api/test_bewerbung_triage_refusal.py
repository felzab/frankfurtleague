import asyncio
import json
import logging
from typing import Any, Iterator, Mapping, cast

import pytest
from bson import ObjectId

from app.api.bewerbungen.schemas import FLBewerbungSchule
from app.api.bewerbungen.services import (
    BEWERBUNG_ALREADY_DECIDED,
    BEWERBUNG_SCHULE_UNUSABLE,
    BEWERBUNG_SUBJECT_UNRESOLVED,
    compose_new_club,
    find_acceptance_subject_refusal,
    find_new_club_refusal,
    find_triage_refusal,
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
UNUSABLE_URLS = [
    pytest.param("javascript:alert(1)", id="a javascript scheme"),
    pytest.param("", id="an empty string"),
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
