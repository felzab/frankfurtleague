from typing import Any, Final

from pydantic import TypeAdapter, ValidationError
from starlette.convertors import Convertor, register_url_convertor
from starlette.requests import Request

from app.shared.schemas.custom import OBJECT_ID_REGEX

CONVERTOR_NAME = "objectid"

# RFC 9110 section 9.2.1: the methods whose semantics are read-only.
SAFE_METHODS: Final = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})

# An operation writing nothing although it is served over POST, a token or an address travelling in its body rather
# than its URL: "safe" as RFC 9110 section 9.2.1 means it. Stated as an OpenAPI specification extension, through
# FastAPI's `openapi_extra`, so the published operation carries it, and the frontend's generated client sends such a
# call as a read (`fl_frontend/orval.config.ts :: transportOf`). `tests/core/test_safe_operations.py` holds it to
# the handler's writes.
SAFE: Final[dict[str, Any]] = {"x-safe": True}

# An operation writing nothing whenever this boolean query parameter is true, a write's dry run.
SAFE_WHEN: Final[dict[str, Any]] = {"x-safe-when": "dry_run"}

(_SAFE_KEY,) = SAFE
(_SAFE_WHEN_KEY,) = SAFE_WHEN

# The parse FastAPI gives a `bool` query parameter, so a value the route reads as true is one here.
_FLAG: Final = TypeAdapter(bool)


def writes_nothing(request: Request) -> bool:
    """Whether a request cannot have written, as the published contract states it and the frontend reads it.

    A safe method, or an operation its route marks safe. The route is the one the router matched, which Starlette
    records in the request's scope; a request no route matched reached no handler.
    """

    if request.method in SAFE_METHODS:
        return True
    marks = getattr(request.scope.get("route"), "openapi_extra", None) or {}
    if marks.get(_SAFE_KEY) is True:
        return True
    parameter = marks.get(_SAFE_WHEN_KEY)
    if parameter is None or parameter not in request.query_params:
        return False
    try:
        return _FLAG.validate_python(request.query_params[parameter])
    except ValidationError:
        return False


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
