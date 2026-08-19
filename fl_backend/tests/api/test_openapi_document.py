import pytest

from tests.openapi_document import DOCUMENT_PATH, build_document, read_document

REGENERATE = "cd fl_backend && python -m tests.openapi_document --write"


def summarize_drift(committed: dict, built: dict) -> str:
    """Name what moved, so the failure is actionable without diffing the whole document by eye."""
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

    # Both key sets can match while a field inside one changed, which a set difference cannot say.
    return "\n".join(lines) or "  The same paths and components, so a field inside one of them changed."


def test_the_committed_document_is_the_one_the_service_publishes():
    """A stale document is worse than no check: the frontend's contract test stays green while the two sides diverge."""
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
