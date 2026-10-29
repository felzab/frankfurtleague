import re
from collections.abc import Callable, Mapping, Sequence
from http import HTTPStatus
from typing import Any, Final

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import iter_route_contexts
from pydantic import ValidationError
from pymongo.errors import DuplicateKeyError, PyMongoError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.routing import Match

from app.core.codes import Code  # Session 2: the sweep moves every use onto Code and deletes these aliases.
from app.core.crud import a_write_may_stand
from app.core.exceptions import DUPLICATE_KEY, APIError
from app.core.logging import fl_logger, trace_id_var

NO_DATA_TEXT = "//- No Data -//"

PAYLOAD_REFUSED = Code.PAYLOAD_REFUSED
# A body no field could be read from: malformed syntax, RFC 9110's 400, never a refused payload's 422.
BODY_UNREADABLE = Code.BODY_UNREADABLE
STORED_DATA_INVALID = Code.STORED_DATA_INVALID
UNHANDLED_CRASH = Code.UNHANDLED_CRASH
DATABASE_FAILED = Code.DATABASE_FAILED
# FastAPI's error type for a body that is not JSON at all, reported before any field is read.
UNDECODABLE_BODY = "json_invalid"
# A write that may stand: its own code, because a page told "failed" sends the person to repeat a
# write that is already there.
UNKNOWN_OUTCOME = Code.UNKNOWN_OUTCOME

# The routing layer's own refusals, raised before any handler runs.
NO_ROUTE = Code.NO_ROUTE
METHOD_NOT_SERVED = Code.METHOD_NOT_SERVED
# Every status the router and FastAPI's request parsing raise. FastAPI's one 400 is a body it could
# not parse, and a status outside these is a server fault the catch-all answers.
ROUTING_CODES: Final[Mapping[int, Code]] = {
    HTTPStatus.BAD_REQUEST: BODY_UNREADABLE,
    HTTPStatus.NOT_FOUND: NO_ROUTE,
    HTTPStatus.METHOD_NOT_ALLOWED: METHOD_NOT_SERVED,
}


def error_response(
    status_code: int,
    error_code: Code,
    headers: Mapping[str, str] | None = None,
    *,
    fields: list[dict[str, Any]] | None = None,
) -> JSONResponse:
    """The one failure body shape every handler returns: the code, the id to quote, and a refused payload's `fields`."""
    content: dict[str, Any] = {"error_code": error_code, "trace_id": trace_id_var.get()}
    if fields is not None:
        content["fields"] = fields

    return JSONResponse(status_code=status_code, content=content, headers=headers)


async def api_error_handler(request: Request, exc: APIError):
    fl_logger.warning(f"Refusal ({exc.status_code})", extra={"error_code": exc.error_code})
    # A 422 alone publishes `fields`, the refusal's own code as each one's `kind` where a `REQ-VAL-001`
    # carries pydantic's error type.
    fields = (
        [{"in": "body", "path": list(path), "kind": exc.error_code} for path in exc.fields]
        if exc.status_code == HTTPStatus.UNPROCESSABLE_CONTENT
        else None
    )

    return error_response(exc.status_code, exc.error_code, headers=exc.headers, fields=fields)


async def routing_exception_handler(request: Request, exc: StarletteHTTPException):
    """Starlette's refusal in the envelope every other failure answers with, its status and headers kept."""

    error_code = ROUTING_CODES.get(exc.status_code)
    if error_code is None:
        return await global_catch_all_exception_handler(request, exc)

    fl_logger.warning(f"Routing refusal ({exc.status_code}): {exc.detail or NO_DATA_TEXT}", extra={"error_code": error_code})
    headers = exc.headers
    if exc.status_code == HTTPStatus.METHOD_NOT_ALLOWED:
        headers = {**(headers or {}), "Allow": ", ".join(served_methods(request))}

    return error_response(exc.status_code, error_code, headers=headers)


def served_methods(request: Request) -> list[str]:
    """Every method some route serving this path accepts, as RFC 9110 section 15.5.6 asks of `Allow`.

    FastAPI names the first matching route's alone, and a read and a write router split one path.
    """

    return sorted(
        {
            method
            for context in iter_route_contexts(request.app.routes)
            if context.route.matches(request.scope)[0] is Match.PARTIAL
            for method in context.methods or ()
        }
    )


async def pydantic_validation_exception_handler(request: Request, exc: ValidationError):
    # A server-side model failing on server-side data; a request payload raises
    # `RequestValidationError` instead. 500, not 422.
    fl_logger.error(
        f"Model validation failed outside request parsing: {rejected_fields_of(exc.errors()) or NO_DATA_TEXT}",
        extra={"error_code": STORED_DATA_INVALID},
    )

    return error_response(status.HTTP_500_INTERNAL_SERVER_ERROR, STORED_DATA_INVALID)


async def request_validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    if any(error["type"] == UNDECODABLE_BODY for error in errors):
        fl_logger.warning(f"Request body unreadable: {rejected_fields_of(errors) or NO_DATA_TEXT}", extra={"error_code": BODY_UNREADABLE})
        return error_response(status.HTTP_400_BAD_REQUEST, BODY_UNREADABLE)

    fl_logger.warning(
        f"Payload validation failed: {rejected_fields_of(errors) or NO_DATA_TEXT}",
        extra={"error_code": PAYLOAD_REFUSED},
    )

    return error_response(status.HTTP_422_UNPROCESSABLE_CONTENT, PAYLOAD_REFUSED, fields=refused_fields_of(errors))


def refused_fields_of(errors: Sequence[Any]) -> list[dict[str, Any]]:
    """Where each refusal sits and pydantic's machine-readable `type` for it, so a form can mark the field.

    Never `msg`, English no visitor reads, and never `input`: the wire carries no value the log
    itself withholds.
    """

    return [_refused_field(error) for error in errors]


def _refused_field(error: Any) -> dict[str, Any]:
    # FastAPI prefixes every `loc` with where the value arrived; the rest is the path inside it.
    location, *path = error["loc"]

    return {"in": str(location), "path": path, "kind": error["type"]}


def rejected_fields_of(errors: Sequence[Any]) -> list[dict[str, str]]:
    """Where each error sits, what kind it is and what it says -- never `input`, the value submitted for it.

    A person's erasure clears every collection and reaches no log
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
# sentence must never travel.
_INDEX_NAME = re.compile(r"index: (\S+) dup key")


def refused_index_of(exc: DuplicateKeyError) -> str | None:
    """The name of the unique index that refused, and nothing else of the server's report.

    `errmsg` embeds the duplicate key as a document -- the field AND the value that collided -- so
    it is parsed for the one token the line may carry rather than logged.
    """

    match = _INDEX_NAME.search((exc.details or {}).get("errmsg", ""))

    return match.group(1) if match else None


# Every failure status an operation answers; the 405 of a method no operation serves is none of them.
FAILURE_STATUSES: Final = (
    HTTPStatus.BAD_REQUEST,
    HTTPStatus.UNAUTHORIZED,
    HTTPStatus.FORBIDDEN,
    HTTPStatus.NOT_FOUND,
    HTTPStatus.CONFLICT,
    HTTPStatus.GONE,
    HTTPStatus.UNPROCESSABLE_CONTENT,
    HTTPStatus.TOO_MANY_REQUESTS,
    HTTPStatus.INTERNAL_SERVER_ERROR,
    HTTPStatus.SERVICE_UNAVAILABLE,
)
FAILURE_RESPONSE_REF: Final = "#/components/responses/{status}"

# Declared on every operation alike, each a reference to its status's one shared response: the body's
# `error_code` is `Code`, so the document lists every code once rather than per operation.
FAILURE_RESPONSES: Final[dict[int | str, dict[str, Any]]] = {
    int(status): {"$ref": FAILURE_RESPONSE_REF.format(status=int(status))} for status in FAILURE_STATUSES
}

# Session 2: the sweep removes every route's own `responses=` and deletes this.
DUPLICATE_KEY_RESPONSE: Final = FAILURE_RESPONSES[HTTPStatus.CONFLICT]
# Session 2: the sweep removes every route's own `responses=` and deletes this.
DOCUMENT_NOT_FOUND_RESPONSE: Final = FAILURE_RESPONSES[HTTPStatus.NOT_FOUND]


# Session 2: the sweep removes every declaration of these three and deletes them.
def stores_nothing() -> None:
    """Declared by an operation storing nothing whatever its method; nothing reads the declaration."""


# Session 2: the sweep removes every declaration of these three and deletes them.
STORES_NOTHING_WHEN: dict[Callable[..., Any], str] = {}


# Session 2: the sweep removes every declaration of these three and deletes them.
def stores_nothing_when[Dependency: Callable[..., Any]](flag: str) -> Callable[[Dependency], Dependency]:
    def register(dependency: Dependency) -> Dependency:
        STORES_NOTHING_WHEN[dependency] = flag
        return dependency

    return register


async def db_exception_handler(request: Request, exc: PyMongoError):
    # Judged on what the request SENT, never on its method: a write route the deadline cut in its
    # actor check has written nothing, and a write outside a transaction carries no label.
    unknown = exc.has_error_label("UnknownTransactionCommitResult") or (exc.timeout and a_write_may_stand())
    error_code = UNKNOWN_OUTCOME if unknown else DATABASE_FAILED
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


async def global_catch_all_exception_handler(request: Request, exc: Exception):
    fl_logger.error(
        f"Unhandled Server Crash: {str(exc) or NO_DATA_TEXT}",
        exc_info=True,
        extra={"error_code": UNHANDLED_CRASH},
    )

    return error_response(status.HTTP_500_INTERNAL_SERVER_ERROR, UNHANDLED_CRASH)


def register_exception_handlers(app: FastAPI):
    # Through FastAPI's decorator, whose signature takes a handler of any exception type, where
    # Starlette's `add_exception_handler` types every handler as taking `Exception` itself.
    app.exception_handler(APIError)(api_error_handler)
    # Starlette's own, which the router raises before any route runs.
    app.exception_handler(StarletteHTTPException)(routing_exception_handler)
    app.exception_handler(RequestValidationError)(request_validation_exception_handler)
    app.exception_handler(ValidationError)(pydantic_validation_exception_handler)
    # Starlette resolves a handler by walking `type(exc).__mro__`, so this subclass wins over the
    # line below by being more specific, not by being registered first.
    app.exception_handler(DuplicateKeyError)(duplicate_key_exception_handler)
    app.exception_handler(PyMongoError)(db_exception_handler)
    app.exception_handler(Exception)(global_catch_all_exception_handler)
