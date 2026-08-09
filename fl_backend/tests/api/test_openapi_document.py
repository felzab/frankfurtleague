"""
API · the committed OpenAPI document is the one this service publishes

`fl_backend/openapi.json` is what the frontend's contract test compares its Zod mirror against
(ADR-0040), so this suite is what keeps it fresh: change a Pydantic model without regenerating,
and the gate fails here naming the component that moved. It runs in the default tier —
`create_app(build_test_config())` needs no server, no database and no `.env`.

Invariants:
- The documents are compared as parsed JSON, never bytes — prettier owns the file's formatting.
- The document is compared whole: `components` alone misses a route added, removed or re-pathed.
"""

import pytest

from tests.openapi_document import DOCUMENT_PATH, build_document, read_document

REGENERATE = "cd fl_backend && python -m tests.openapi_document --write"


def summarize_drift(committed: dict, built: dict) -> str:
    """Name what moved, so the failure is actionable without diffing an 88 KB document by eye."""
    lines: list[str] = []

    for section in ("paths", "components"):
        committed_keys = set(committed.get(section, {}))
        built_keys = set(built.get(section, {}))
        if section == "components":
            committed_keys = set(committed.get(section, {}).get("schemas", {}))
            built_keys = set(built.get(section, {}).get("schemas", {}))
        if added := sorted(built_keys - committed_keys):
            lines.append(f"  Only in the models: {added}")
        if removed := sorted(committed_keys - built_keys):
            lines.append(f"  Only in the committed document: {removed}")

    # Both key sets can match while a field inside one of them changed -- which is the common case, and
    # the one a set difference says nothing about.
    return "\n".join(lines) or "  The same paths and components, so a field inside one of them changed."


def test_the_committed_document_is_the_one_the_service_publishes():
    """
    `openapi.json` is regenerated in the same commit as the models it describes.

    A stale document makes the frontend's contract test compare against a shape the backend no longer
    serves — which is worse than no check at all, because it stays green while the two sides diverge.
    """
    assert DOCUMENT_PATH.exists(), f"{DOCUMENT_PATH.name} is missing. Create it with:  {REGENERATE}"

    committed = read_document()
    built = build_document()

    drift = f"{DOCUMENT_PATH.name} has drifted from the models.\n{summarize_drift(committed, built)}\nRefresh it with:  {REGENERATE}"

    assert committed == built, drift


@pytest.mark.parametrize("section", ["paths", "components"])
def test_the_document_carries_the_section_the_contract_check_reads(section: str):
    """A document missing either section would let the frontend's check pass over an empty inventory."""
    document = read_document()

    assert document.get(section), f"{DOCUMENT_PATH.name} has no '{section}'. Regenerate it with:  {REGENERATE}"
