"""
The published OpenAPI document, built and read.

`fl_backend/openapi.json` is committed, and this module is both what writes it and what the freshness
test reads it with. Not a test module — pytest collects `test_*.py`, so nothing here is collected.

**Why the document is committed rather than generated at gate time.** The frontend's contract test
(`fl_frontend/src/core/apiContract.test.ts`) compares the Zod mirror against it, and the frontend gate
scope has no Python. Committing it also closes a hole in the scope mapping: a change confined to
`fl_backend/` selects the backend scope alone, so a schema edit there would never run the frontend
check. The regenerated document is mapped to BOTH scopes (`scripts/ci_scopes.sh`), which is what pulls
the mirror check into the same pull request as the model change that needs it (ADR-0040).

The app is built from `build_test_config()` — the same construction `api/test_admin_guard.py` uses —
so writing the document needs no server, no database and no `.env`. The published surface does not
depend on the settings it was built with.

 USAGE ────────────────────────────────────────────────────────────────────────────────────────────────────

  Run from `fl_backend/`:

    python -m tests.openapi_document --write    rewrite openapi.json from the current models
    python -m tests.openapi_document --check    report whether it is stale; writes nothing

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  tests/api/test_openapi_document.py — the gate's copy of the --check above, in the default tier
  docs/_decisions/0040-the-zod-mirror-is-checked-against-the-published-openapi-document.md
"""

import argparse
import json
from pathlib import Path
from typing import Any

from app.main import create_app
from tests.config import build_test_config

DOCUMENT_PATH = Path(__file__).resolve().parents[1] / "openapi.json"


def build_document() -> dict[str, Any]:
    """The document FastAPI publishes for the current models, routes and response models."""
    return create_app(build_test_config()).openapi()


def read_document() -> dict[str, Any]:
    """The committed document, PARSED — never compared as bytes, because prettier owns its formatting."""
    return json.loads(DOCUMENT_PATH.read_text(encoding="utf-8"))


def serialize(document: dict[str, Any]) -> str:
    """`ensure_ascii=False` so the German prose in the endpoint summaries stays readable in a diff."""
    return json.dumps(document, indent=2, ensure_ascii=False) + "\n"


def _main() -> int:
    parser = argparse.ArgumentParser(
        prog="python -m tests.openapi_document",
        description="Write or check fl_backend/openapi.json, the published API surface (ADR-0040).",
    )
    parser.add_argument("--write", action="store_true", help="rewrite the document from the current models")
    parser.add_argument("--check", action="store_true", help="report whether the committed document is stale; writes nothing")
    arguments = parser.parse_args()

    if arguments.check == arguments.write:
        parser.error("pass exactly one of --write or --check")

    built = build_document()

    if arguments.write:
        # newline="\n" so a Windows run and a Linux run write the same bytes. Without it Python
        # translates to CRLF here and git normalises on the way in, which makes every regeneration on
        # a dev machine report a whitespace change it did not make.
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
