import json
from copy import deepcopy

import pytest

from app.shared.schemas.addresses import HAUSNUMMER_PATTERN
from tests.openapi_document import DOCUMENT_PATH, DRIFT_REPAIR, REGENERATE, build_document, describe_drift, read_document

# The exact narrowing this failure exists for: every value `fl_backend/tests/shared/test_addresses.py`
# names is decided as it is decided now, and the published pattern still moves.
NARROWED_HAUSNUMMER = r"^([0-9][0-9\-abcABC]*)?$"


def summarize_drift(committed: dict, built: dict) -> str:
    """Composed from `fl_backend/tests/openapi_document.py`'s pieces, so this failure and the `--check` run never become two shapes."""
    return f"{DOCUMENT_PATH.name} has drifted from the models.\n{describe_drift(committed, built)}\n{DRIFT_REPAIR}"


def test_the_committed_document_is_the_one_the_service_publishes():
    """A stale document is worse than no check: the frontend's contract test stays green while the two sides diverge."""
    assert DOCUMENT_PATH.exists(), f"{DOCUMENT_PATH.name} is missing. Create it with:  {REGENERATE}"

    committed = read_document()
    built = build_document()

    assert committed == built, summarize_drift(committed, built)


def test_the_drift_summary_names_the_field_whose_value_moved():
    """The narrowing that reaches no other check: it moves no key, so a set difference reports nothing and only the field's path locates it."""
    committed = read_document()
    narrowed = deepcopy(committed)
    hausnummer = narrowed["components"]["schemas"]["FLAddress"]["properties"]["hausnummer"]
    hausnummer["pattern"] = NARROWED_HAUSNUMMER

    summary = summarize_drift(committed, narrowed)

    assert "components.schemas.FLAddress.properties.hausnummer.pattern" in summary
    # Both patterns as the document spells them, so the reader compares two strings rather than
    # opening the document for the committed one.
    assert json.dumps(HAUSNUMMER_PATTERN) in summary
    assert json.dumps(NARROWED_HAUSNUMMER) in summary
    assert DRIFT_REPAIR in summary


@pytest.mark.parametrize("section", ["paths", "components"])
def test_the_document_carries_the_section_the_contract_check_reads(section: str):
    """A document missing either section would let the frontend's check pass over an empty inventory."""
    document = read_document()

    assert document.get(section), f"{DOCUMENT_PATH.name} has no '{section}'. Regenerate it with:  {REGENERATE}"
