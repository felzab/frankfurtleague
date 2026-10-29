"""Write `fl_backend/openapi.json`, the published contract, from the application's routes.

`uv run --project fl_backend --frozen python -m app.openapi_document` from the repository root; CI
runs it and then diffs the file, so a change the committed document does not hold fails there.
"""

import json
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
    DOCUMENT_PATH.write_bytes(serialize(build_document()))
