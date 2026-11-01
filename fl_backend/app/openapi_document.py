"""Write `fl_backend/openapi.json`, the published contract, from the application's routes.

`uv run --directory fl_backend --frozen python -m app.openapi_document` from the repository root, or
with a path to write there instead, as the gate's contract check does to compare a fresh document
with the committed one (`scripts/gate/verify.sh :: contract_check`).
"""

import json
import sys
from pathlib import Path
from typing import Any, Final

from fastapi import FastAPI

from app.main import mount_api

DOCUMENT_PATH: Final = Path(__file__).resolve().parents[1] / "openapi.json"


def build_document() -> dict[str, Any]:
    """The document `create_app`'s application serves, built without its configuration, which the routes never read."""

    app = FastAPI()
    mount_api(app)

    return app.openapi()


def serialize(document: dict[str, Any]) -> bytes:
    """The same bytes on every machine: keys sorted, `\\n` line ends and one trailing newline.

    `ensure_ascii=False` keeps the German in the endpoint descriptions readable in a diff.
    """

    return (json.dumps(document, indent=2, ensure_ascii=False, sort_keys=True) + "\n").encode()


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else DOCUMENT_PATH
    target.write_bytes(serialize(build_document()))
