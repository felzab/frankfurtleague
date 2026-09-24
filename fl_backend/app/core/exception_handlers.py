import re
from collections.abc import Callable, Iterable, Mapping, Sequence
from typing import Any, Final

from bson.errors import InvalidId
from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from pymongo.errors import DuplicateKeyError, PyMongoError

from app.core.exceptions import DUPLICATE_KEY, BaseAPIException
from app.core.logging import fl_logger, trace_id_var
from app.core.security import SAFE_METHODS
from app.shared.schemas.responses import FLFailureBody

NO_DATA_TEXT = "//- No Data -//"

# A write that may stand: its own code, because a page told "failed" sends the person to repeat a
# write that is already there.
UNKNOWN_OUTCOME = "DB-FAIL-002"


def error_response(
    status_code: int,
    error_code: str,
    headers: Mapping[str, str] | None = None,
    *,
    fields: list[dict[str, Any]] | None = None,
) -> JSONResponse:
    """The one failure body shape every handler returns: the code, the id to quote, and a refused payload's `fields`."""
    content: dict[str, Any] = {"error_code": error_code, "trace_id": trace_id_var.get()}
    if fields is not None:
        content["fields"] = fields

    return JSONResponse(status_code=status_code, content=content, headers=headers)


async def base_api_exception_handler(request: Request, exc: BaseAPIException):
    fl_logger.warning(
        f"API Exception ({exc.status_code}): {exc.error_detail['message']}",
        extra={"error_code": exc.error_code},
    )

    return error_response(exc.status_code, exc.error_code, headers=exc.headers)


async def pydantic_validation_exception_handler(request: Request, exc: ValidationError):
    # A server-side model failing on server-side data; a request payload raises
    # `RequestValidationError` instead. 500, not 422.
    fl_logger.error(
        f"Model validation failed outside request parsing: {rejected_fields_of(exc.errors()) or NO_DATA_TEXT}",
        extra={"error_code": "SRV-VAL-001"},
    )

    return error_response(status.HTTP_500_INTERNAL_SERVER_ERROR, "SRV-VAL-001")


async def request_validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    fl_logger.warning(
        f"Payload validation failed: {rejected_fields_of(errors) or NO_DATA_TEXT}",
        extra={"error_code": "REQ-VAL-001"},
    )

    return error_response(status.HTTP_422_UNPROCESSABLE_CONTENT, "REQ-VAL-001", fields=refused_fields_of(errors))


def refused_fields_of(errors: Sequence[Any]) -> list[dict[str, Any]]:
    """Where each refusal sits and pydantic's machine-readable `type` for it, so a form can mark the field.

    Never `msg`, English no visitor reads, and never `input`: the wire carries no value the log
    itself withholds (`docs/logging/spec.md :: L4`, `:: L9`).
    """

    return [_refused_field(error) for error in errors]


def _refused_field(error: Any) -> dict[str, Any]:
    # FastAPI prefixes every `loc` with where the value arrived; the rest is the path inside it.
    location, *path = error["loc"]
    # FastAPI's undecodable body reports the character offset parsing stopped at, which a caller
    # would read as a list index.
    if error["type"] == "json_invalid":
        path = []

    return {"in": str(location), "path": path, "kind": error["type"]}


def rejected_fields_of(errors: Sequence[Any]) -> list[dict[str, str]]:
    """Where each error sits, what kind it is and what it says -- never `input`, the value submitted for it.

    `docs/logging/spec.md :: L9`. A person's erasure clears every collection and reaches no log
    sink, so a value written here outlives them.
    """

    return [{"loc": ".".join(str(part) for part in error["loc"]), "type": error["type"], "msg": error["msg"]} for error in errors]


async def duplicate_key_exception_handler(request: Request, exc: DuplicateKeyError):
    """A unique index refused the write. 409, not a 500.

    The index NAME is logged rather than returned: it names a collection and its fields.
    """
    fl_logger.warning(
        f"Unique index refused a write: {refused_index_of(exc) or NO_DATA_TEXT}",
        extra={"error_code": DUPLICATE_KEY},
    )

    return error_response(status.HTTP_409_CONFLICT, DUPLICATE_KEY)


# The server's own spelling in `errmsg`; `keyValue` sits right beside it, which is why the whole
# sentence must never travel (`docs/logging/spec.md :: L9`).
_INDEX_NAME = re.compile(r"index: (\S+) dup key")


def refused_index_of(exc: DuplicateKeyError) -> str | None:
    """The name of the unique index that refused, and nothing else of the server's report.

    `errmsg` embeds the duplicate key as a document -- the field AND the value that collided -- so
    it is parsed for the one token the line may carry rather than logged.
    """

    match = _INDEX_NAME.search((exc.details or {}).get("errmsg", ""))

    return match.group(1) if match else None


COMPONENT_REF = "#/components/schemas/{model}"
REFUSAL_DESCRIPTION = "The current state refuses the write"
JSON_MEDIA_TYPE = "application/json"


def refusal_response(codes: Iterable[str]) -> dict[str, Any]:
    """A 409 as an OpenAPI Response Object: the failure body, its `error_code` narrowed to `codes`."""

    # The component narrowed rather than restated, so the failure body keeps one published shape.
    narrowed = {"properties": {"error_code": {"enum": sorted(codes)}}}
    schema = {"allOf": [{"$ref": COMPONENT_REF.format(model=FLFailureBody.__name__)}, narrowed]}

    return {"description": REFUSAL_DESCRIPTION, "content": {JSON_MEDIA_TYPE: {"schema": schema}}}


def refused_codes(response: Mapping[str, Any]) -> set[str]:
    """The codes a `refusal_response` narrows to, and none for a response of any other shape."""

    schema = response.get("content", {}).get(JSON_MEDIA_TYPE, {}).get("schema", {})

    return {code for part in schema.get("allOf", [])[1:] for code in part.get("properties", {}).get("error_code", {}).get("enum", [])}


# A Response Object and never a status-keyed dict: two such dicts unpacked into one `responses` keep
# the second 409 alone, so a second reason joins this code in one `refusal_response`
# (`docs/backend/spec.md :: I358`).
DUPLICATE_KEY_RESPONSE: Final = refusal_response({DUPLICATE_KEY})


def stores_nothing(request: Request) -> None:
    """Declared by an operation storing nothing whatever its method.

    A deadline cutting it then answers a failed read rather than a write that may stand.
    """
    request.state.stores_nothing = True


# Each dependency that calls `stores_nothing` itself once its boolean query flag is true, keyed to
# that flag, so the condition is published (`app/main.py :: publish_stores_nothing`) rather than kept.
STORES_NOTHING_WHEN: dict[Callable[..., Any], str] = {}


def stores_nothing_when[Dependency: Callable[..., Any]](flag: str) -> Callable[[Dependency], Dependency]:
    def register(dependency: Dependency) -> Dependency:
        STORES_NOTHING_WHEN[dependency] = flag
        return dependency

    return register


def _may_have_written(request: Request) -> bool:
    return request.method not in SAFE_METHODS and not getattr(request.state, "stores_nothing", False)


async def db_exception_handler(request: Request, exc: PyMongoError):
    # Unknown where a write may stand: a commit the driver labels so, or any write request the
    # deadline cut, a write outside a transaction carrying no label (`docs/backend/spec.md :: I321`).
    unknown = exc.has_error_label("UnknownTransactionCommitResult") or (exc.timeout and _may_have_written(request))
    error_code = UNKNOWN_OUTCOME if unknown else "DB-FAIL-001"
    what = "Database deadline passed" if exc.timeout else "Database crash"

    # `str(exc)` quotes the document the server refused -- `consideredValue` under a validator, the
    # whole `op` under a bulk write -- and a traceback renders it a second time in its last line.
    fl_logger.error(
        f"{what} ({type(exc).__name__}, code {getattr(exc, 'code', None)}): {refused_properties_of(exc) or NO_DATA_TEXT}",
        extra={"error_code": error_code},
    )

    return error_response(status.HTTP_500_INTERNAL_SERVER_ERROR, error_code)


# Walked by NAME and never over every key: a refused value sits under `consideredValue` and can
# itself be an array of documents, which a walk over every key would descend into. An unlisted key
# costs a field name in the line, never a value.
_REFUSAL_BRANCHES = ("schemaRulesNotSatisfied", "propertiesNotSatisfied", "details")


def refused_properties_of(exc: PyMongoError) -> list[dict[str, str]]:
    """Which property a document validator refused, which keyword refused it and why.

    Never `consideredValue`: `rejected_fields_of` withholds one for the same reason, and the
    validators cover every field of every collection, a person's names included.
    """

    details: Mapping[str, Any] = getattr(exc, "details", None) or {}
    # A bulk write reports one entry per refused document; every other write reports at the top.
    refusals = details.get("writeErrors") or [details]

    return [entry for refusal in refusals for entry in _refused_under((refusal.get("errInfo") or {}).get("details") or {}, path="")]


def _refused_under(rule: Any, *, path: str) -> list[dict[str, str]]:
    """Every property refused under `rule`, keyed by its dotted path.

    Total over whatever the driver hands it: a handler that raises while handling leaves the caller
    with no answer, and only the server decides a refusal report's shape.
    """

    if not isinstance(rule, Mapping):
        return []

    name = rule.get("propertyName")
    here = _dotted(path, name) if name else path
    entries = [
        {"loc": _dotted(here, missing), "type": "required", "msg": "property is missing"} for missing in rule.get("missingProperties", ())
    ]

    if "reason" in rule:
        entries.append({"loc": here or NO_DATA_TEXT, "type": str(rule.get("operatorName", "")), "msg": str(rule["reason"])})

    return entries + [entry for branch in _REFUSAL_BRANCHES for child in rule.get(branch, ()) for entry in _refused_under(child, path=here)]


def _dotted(path: str, name: Any) -> str:
    return f"{path}.{name}" if path else str(name)


async def invalid_bson_oid_exception_handler(request: Request, exc: InvalidId):
    fl_logger.warning(
        f"Invalid ObjectId format received: {str(exc) or NO_DATA_TEXT}",
        extra={"error_code": "REQ-OID-001"},
    )

    return error_response(status.HTTP_400_BAD_REQUEST, "REQ-OID-001")


async def global_catch_all_exception_handler(request: Request, exc: Exception):
    fl_logger.error(
        f"Unhandled Server Crash: {str(exc) or NO_DATA_TEXT}",
        exc_info=True,
        extra={"error_code": "SRV-FAIL-001"},
    )

    return error_response(status.HTTP_500_INTERNAL_SERVER_ERROR, "SRV-FAIL-001")


def register_exception_handlers(app: FastAPI):
    app.add_exception_handler(BaseAPIException, base_api_exception_handler)  # type: ignore
    app.add_exception_handler(RequestValidationError, request_validation_exception_handler)  # type: ignore
    app.add_exception_handler(ValidationError, pydantic_validation_exception_handler)  # type: ignore
    # Starlette resolves a handler by walking `type(exc).__mro__`, so this subclass wins over the
    # line below by being more specific, not by being registered first.
    app.add_exception_handler(DuplicateKeyError, duplicate_key_exception_handler)  # type: ignore
    app.add_exception_handler(PyMongoError, db_exception_handler)  # type: ignore
    app.add_exception_handler(InvalidId, invalid_bson_oid_exception_handler)  # type: ignore
    app.add_exception_handler(Exception, global_catch_all_exception_handler)
