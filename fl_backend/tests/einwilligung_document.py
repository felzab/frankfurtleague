import argparse
import json
from pathlib import Path
from typing import Any, Final

from app.api.einwilligung.services import served_fassung
from app.shared.einwilligung import FASSUNGEN, LAUFENDE_FASSUNGEN
from tests.openapi_document import describe_drift, serialize

# Beside `fl_backend/openapi.json`, for its reason: the frontend's tests read what the backend
# serves from a committed file of the backend's, never from a copy of their own.
DOCUMENT_PATH: Final = Path(__file__).resolve().parents[1] / "einwilligung.json"

REGENERATE: Final = "cd fl_backend && uv run python -m tests.einwilligung_document --write"

DRIFT_REPAIR: Final = (
    "A served label's words never change: a drift there is repaired in the registry, never here.\n"
    f"Refresh the document for a new label or a moved running label with:  {REGENERATE}"
)


def build_document() -> dict[str, Any]:
    """Every label as the words read serves it, and each page's running label as the pages read serves it."""
    return {
        "fassungen": {label: served_fassung(label, fassung).model_dump(mode="json") for label, fassung in FASSUNGEN.items()},
        "laufende_fassungen": dict(LAUFENDE_FASSUNGEN),
    }


def read_document() -> dict[str, Any]:
    """Parsed, so a formatter's reflow of the file is no drift."""
    return json.loads(DOCUMENT_PATH.read_bytes().decode("utf-8"))


def _main() -> int:
    parser = argparse.ArgumentParser(
        prog=REGENERATE.removesuffix(" --write"),
        description="Write or check fl_backend/einwilligung.json, the consent wordings the backend serves.",
    )
    parser.add_argument("--write", action="store_true", help="rewrite the document from the registry")
    parser.add_argument("--check", action="store_true", help="report whether the committed document is stale; writes nothing")
    arguments = parser.parse_args()

    if arguments.check == arguments.write:
        parser.error("pass exactly one of --write or --check")

    built = build_document()

    if arguments.write:
        # Bytes, so a Windows run writes LF as a Linux run does.
        DOCUMENT_PATH.write_bytes(serialize(built).encode("utf-8"))
        print(f"Wrote {DOCUMENT_PATH.name}: {len(built['fassungen'])} labels, {len(built['laufende_fassungen'])} pages.")
        return 0

    if not DOCUMENT_PATH.exists():
        print(f"{DOCUMENT_PATH.name} does not exist. Create it with:  {REGENERATE}")
        return 1

    committed = read_document()

    if committed == built:
        print(f"{DOCUMENT_PATH.name} matches the registry.")
        return 0

    print(f"{DOCUMENT_PATH.name} is stale.\n{describe_drift(committed, built)}\n{DRIFT_REPAIR}")
    return 1


if __name__ == "__main__":
    raise SystemExit(_main())
