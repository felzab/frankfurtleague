from typing import Any, Final

from starlette.convertors import Convertor, register_url_convertor

from app.shared.schemas.custom import OBJECT_ID_REGEX

CONVERTOR_NAME = "objectid"

# An operation writing nothing although it is served over POST, a token or an address travelling in its body rather
# than its URL: "safe" as RFC 9110 section 9.2.1 means it. Stated as an OpenAPI specification extension, through
# FastAPI's `openapi_extra`, so the published operation carries it, and the frontend's generated client sends such a
# call as a read (`fl_frontend/orval.config.ts :: transportOf`). `tests/core/test_safe_operations.py` holds it to
# the handler's writes.
SAFE: Final[dict[str, Any]] = {"x-safe": True}

# An operation writing nothing whenever this boolean query parameter is true, a write's dry run.
SAFE_WHEN: Final[dict[str, Any]] = {"x-safe-when": "dry_run"}


class ObjectIdConvertor(Convertor[str]):
    # Constraining the parameter keeps a static path out of an id route whatever order the routers
    # load, and makes a malformed id a 404.
    regex = OBJECT_ID_REGEX

    def convert(self, value: str) -> str:
        return value

    def to_string(self, value: str) -> str:
        return value


# An import side effect -- `by_id()` is what keeps this module's import real.
register_url_convertor(CONVERTOR_NAME, ObjectIdConvertor())


def by_id(parameter: str) -> str:
    """The sub-path addressing one document by its ObjectId — `/{spiel_id:objectid}`.

    FastAPI strips the convertor when it builds the OpenAPI document, so the published path reads
    `/spiele/{spiel_id}`.
    """
    return f"/{{{parameter}:{CONVERTOR_NAME}}}"
