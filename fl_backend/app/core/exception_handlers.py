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

from app.core.codes import Code
from app.core.crud import a_write_may_stand
from app.core.exceptions import APIError
from app.core.logging import fl_logger, trace_id_var
from app.core.middlewares import record_error_code

NO_DATA_TEXT = "//- No Data -//"

# FastAPI's error type for a body that is not JSON at all, reported before any field is read.
UNDECODABLE_BODY = "json_invalid"

# Every status the router and FastAPI's request parsing raise. FastAPI's one 400 is a body it could
# not parse, and a status outside these is a server fault the catch-all answers.
ROUTING_CODES: Final[Mapping[int, Code]] = {
    HTTPStatus.BAD_REQUEST: Code.BODY_UNREADABLE,
    HTTPStatus.NOT_FOUND: Code.NO_ROUTE,
    HTTPStatus.METHOD_NOT_ALLOWED: Code.METHOD_NOT_SERVED,
}


def error_response(
    status_code: int,
    error_code: Code,
    headers: Mapping[str, str] | None = None,
    *,
    fields: list[dict[str, Any]] | None = None,
) -> JSONResponse:
    """The one failure body shape every handler returns: the code, the id to quote, and a refused payload's `fields`.

    The code reaches the request's access line from here, which is the one log line a refusal writes.
    """
    record_error_code(error_code)
    content: dict[str, Any] = {"error_code": error_code, "trace_id": trace_id_var.get()}
    if fields is not None:
        content["fields"] = fields

    return JSONResponse(status_code=status_code, content=content, headers=headers)


async def api_error_handler(request: Request, exc: APIError):
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
    fl_logger.error("http.stored_data_invalid", extra={"error_code": Code.STORED_DATA_INVALID, "rejected": rejected_fields_of(exc.errors())})

    return error_response(status.HTTP_500_INTERNAL_SERVER_ERROR, Code.STORED_DATA_INVALID)


async def request_validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    if any(error["type"] == UNDECODABLE_BODY for error in errors):
        return error_response(status.HTTP_400_BAD_REQUEST, Code.BODY_UNREADABLE)

    return error_response(status.HTTP_422_UNPROCESSABLE_CONTENT, Code.PAYLOAD_REFUSED, fields=refused_fields_of(errors))


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
    """A unique index refused the write. 409, not a 500, and the index's name is never returned: it names a collection and its fields."""

    return error_response(status.HTTP_409_CONFLICT, Code.DUPLICATE_KEY)


# Session 2: the sweep moves its two tests off this and deletes it with `refused_index_of`.
_INDEX_NAME = re.compile(r"index: (\S+) dup key")


# Session 2: the sweep moves its two tests off this and deletes it with `_INDEX_NAME`.
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
    error_code = Code.UNKNOWN_OUTCOME if unknown else Code.DATABASE_FAILED

    # Never `str(exc)`, which quotes the document the server refused -- `consideredValue` under a
    # validator, the whole `op` under a bulk write -- and a traceback renders it a second time.
    fl_logger.error(
        "http.database_timeout" if exc.timeout else "http.database_failed",
        extra={
            "error_code": error_code,
            "exception": type(exc).__name__,
            "server_code": getattr(exc, "code", None),
            "refused": refused_properties_of(exc),
        },
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
    # The stack is uvicorn's own line, which follows this one; `str(exc)` can quote a value, so only the type travels.
    fl_logger.error("http.unhandled", extra={"error_code": Code.UNHANDLED_CRASH, "exception": type(exc).__name__})

    return error_response(status.HTTP_500_INTERNAL_SERVER_ERROR, Code.UNHANDLED_CRASH)


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
