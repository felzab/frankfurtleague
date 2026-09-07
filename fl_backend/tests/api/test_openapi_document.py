import json
from copy import deepcopy
from typing import Any, Final

import pytest

from tests.openapi_document import (
    DIFFERENCE_CAP,
    DOCUMENT_PATH,
    DRIFT_REPAIR,
    REGENERATE,
    VALUE_CHARS,
    build_document,
    describe_drift,
    read_document,
)

HAUSNUMMER: Final = ("components", "schemas", "FLAddress", "properties", "hausnummer")

ADDED_ENDPOINT: Final = "/api/v0/planted-by-this-suite"

TAIL: Final = " Ein Satz, den allein dieser Fall anhaengt."


def summarize_drift(committed: dict, built: dict) -> str:
    """Composed from `fl_backend/tests/openapi_document.py`'s pieces, so this failure and the `--check` run never become two shapes."""
    return f"{DOCUMENT_PATH.name} has drifted from the models.\n{describe_drift(committed, built)}\n{DRIFT_REPAIR}"


def walk_to(document: dict[str, Any], *keys: str) -> Any:
    """One nested value, every step asserted: a blind index raises a `KeyError` naming the key and nothing about where the walk stopped."""
    here: Any = document
    walked: list[str] = []
    for key in keys:
        assert isinstance(here, dict), f"{DOCUMENT_PATH.name}'s {'.'.join(walked)} is not an object"
        assert key in here, f"{DOCUMENT_PATH.name} has no {key} under {'.'.join(walked) or 'its root'}"
        walked.append(key)
        here = here[key]
    return here


def a_value_that_differs(published: str) -> str:
    """The published string with one character appended.

    Derived rather than spelled out: a literal narrowing here equals the published value the day the
    models adopt it, and the case then fails on an empty summary.
    """
    return f"{published}?"


def a_long_description(document: dict[str, Any]) -> tuple[tuple[str, ...], str]:
    """The longest description the document publishes, with the key path to it: a value inside the window is never trimmed at all."""
    found: tuple[tuple[str, ...], str] = ((), "")
    for endpoint, operations in walk_to(document, "paths").items():
        assert isinstance(operations, dict), f"{DOCUMENT_PATH.name} carries no operation object under {endpoint}"
        for method, operation in operations.items():
            description = operation.get("description", "") if isinstance(operation, dict) else ""
            if len(description) > len(found[1]):
                found = (("paths", endpoint, method, "description"), description)

    assert len(found[1]) > VALUE_CHARS, f"no published description outruns {VALUE_CHARS} characters, so nothing here is windowed"
    return found


def test_the_committed_document_is_the_one_the_service_publishes():
    """A stale document is worse than no check: the frontend's contract test stays green while the two sides diverge."""
    assert DOCUMENT_PATH.exists(), f"{DOCUMENT_PATH.name} is missing. Create it with:  {REGENERATE}"

    committed = read_document()
    built = build_document()

    assert committed == built, summarize_drift(committed, built)


def test_the_drift_summary_names_the_field_whose_value_moved():
    """The narrowing that reaches no other check: it moves no key, so a set difference reports nothing and only the field's path locates it."""
    committed = read_document()
    published = walk_to(committed, *HAUSNUMMER, "pattern")
    narrowed = deepcopy(committed)
    walk_to(narrowed, *HAUSNUMMER)["pattern"] = a_value_that_differs(published)

    summary = summarize_drift(committed, narrowed)

    assert "components.schemas.FLAddress.properties.hausnummer.pattern" in summary
    # Both patterns as the document spells them, so the reader compares two strings rather than
    # opening the document for the committed one.
    assert json.dumps(published, ensure_ascii=False) in summary
    assert json.dumps(a_value_that_differs(published), ensure_ascii=False) in summary
    assert DRIFT_REPAIR in summary


def test_the_summary_shows_the_place_two_long_values_part():
    """A description outrunning the window: printed from its front, both halves are the same characters under a heading saying they differ."""
    committed = read_document()
    keys, published = a_long_description(committed)
    reworded = deepcopy(committed)
    walk_to(reworded, *keys[:-1])[keys[-1]] = published + TAIL

    summary = summarize_drift(committed, reworded)

    printed = [line.split(":", 1)[1].strip() for line in summary.splitlines() if line.startswith(("    committed:", "    built:"))]

    assert keys[1] in summary, "the endpoint whose description moved is not named"
    assert len(printed) == 2, f"one value moved and {len(printed)} value lines were printed"
    assert TAIL in printed[1], "the divergence sits outside the printed window"
    for value in printed:
        assert value.startswith("..."), f"the common prefix was printed whole: {value[:60]}"
    assert printed[0] != printed[1], "the two printed values are identical under a heading saying they differ"


def test_the_summary_names_every_field_that_moved_and_names_each_once():
    """Two causes in one drift: naming the first alone sends the reader back for the second after a whole regeneration round."""
    committed = read_document()
    both = deepcopy(committed)
    walk_to(both, *HAUSNUMMER)["pattern"] = a_value_that_differs(walk_to(committed, *HAUSNUMMER, "pattern"))
    walk_to(both, "paths")[ADDED_ENDPOINT] = {"get": {"summary": "Planted by this suite."}}

    summary = summarize_drift(committed, both)

    assert "components.schemas.FLAddress.properties.hausnummer.pattern" in summary
    named = summary.count(ADDED_ENDPOINT)
    assert named == 1, f"the added endpoint is named {named} times, so one fact reads as two findings"


def test_the_summary_caps_what_it_prints_and_says_how_much_it_left_out():
    """A wholesale regeneration moves thousands of leaves, and printing every one of them buries the repair line under the report."""
    committed = read_document()
    extra = 2
    many = deepcopy(committed)
    schemas = walk_to(many, "components", "schemas")
    for number in range(DIFFERENCE_CAP + extra):
        schemas[f"FLPlanted{number}"] = {"type": "object"}

    summary = summarize_drift(committed, many)

    assert summary.count("is only in the models") == DIFFERENCE_CAP, "the cap no longer bounds what is printed"
    assert f"... and {extra} more differences" in summary
    assert DRIFT_REPAIR in summary


def test_the_summary_counts_one_left_out_difference_in_the_singular():
    """The cap's own boundary, where a plural spelled unconditionally makes the report read as a defect of itself."""
    committed = read_document()
    many = deepcopy(committed)
    schemas = walk_to(many, "components", "schemas")
    for number in range(DIFFERENCE_CAP + 1):
        schemas[f"FLPlanted{number}"] = {"type": "object"}

    summary = summarize_drift(committed, many)

    assert "... and 1 more difference" in summary
    assert "more differences" not in summary


@pytest.mark.parametrize("section", ["paths", "components"])
def test_the_document_carries_the_section_the_contract_check_reads(section: str):
    """A document missing either section would let the frontend's check pass over an empty inventory."""
    document = read_document()

    assert document.get(section), f"{DOCUMENT_PATH.name} has no '{section}'. Regenerate it with:  {REGENERATE}"
