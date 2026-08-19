import argparse
import json
from pathlib import Path
from typing import Any

from app.main import create_app
from tests.config import build_test_config

DOCUMENT_PATH = Path(__file__).resolve().parents[1] / "openapi.json"


def build_document() -> dict[str, Any]:
    return create_app(build_test_config()).openapi()


def read_document() -> dict[str, Any]:
    """Parsed, never compared as bytes: prettier owns this file's formatting."""
    return json.loads(DOCUMENT_PATH.read_text(encoding="utf-8"))


def serialize(document: dict[str, Any]) -> str:
    """`ensure_ascii=False` so the German prose in the endpoint summaries stays readable in a diff."""
    return json.dumps(document, indent=2, ensure_ascii=False) + "\n"


def _main() -> int:
    parser = argparse.ArgumentParser(
        prog="python -m tests.openapi_document",
        description="Write or check fl_backend/openapi.json, the published API surface.",
    )
    parser.add_argument("--write", action="store_true", help="rewrite the document from the current models")
    parser.add_argument("--check", action="store_true", help="report whether the committed document is stale; writes nothing")
    arguments = parser.parse_args()

    if arguments.check == arguments.write:
        parser.error("pass exactly one of --write or --check")

    built = build_document()

    if arguments.write:
        # newline="\n" so a Windows run and a Linux run write the same bytes: without it Python
        # translates to CRLF and git normalises on the way in, reporting a whitespace change nobody made.
        DOCUMENT_PATH.write_text(serialize(built), encoding="utf-8", newline="\n")
        paths = len(built["paths"])
        schemas = len(built.get("components", {}).get("schemas", {}))
        print(f"Wrote {DOCUMENT_PATH.name}: {paths} paths, {schemas} component schemas.")
        return 0

    if not DOCUMENT_PATH.exists():
        print(f"{DOCUMENT_PATH.name} does not exist. Create it with: python -m tests.openapi_document --write")
        return 1

    if read_document() == built:
        print(f"{DOCUMENT_PATH.name} matches the current models.")
        return 0

    print(f"{DOCUMENT_PATH.name} is stale. Refresh it with: python -m tests.openapi_document --write")
    return 1


if __name__ == "__main__":
    raise SystemExit(_main())
