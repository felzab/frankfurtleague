import re
from typing import Any, Mapping, Sequence

from bson.errors import InvalidId
from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from pymongo.errors import DuplicateKeyError, PyMongoError

from app.core.exceptions import BaseAPIException
from app.core.logging import correlation_id_var, fl_logger

NO_DATA_TEXT = "//- No Data -//"


def error_response(status_code: int, error_code: str, headers: Mapping[str, str] | None = None) -> JSONResponse:
    """The one failure body shape every handler returns: the code, and the id to quote."""
    return JSONResponse(
        status_code=status_code,
        content={"error_code": error_code, "correlation_id": correlation_id_var.get()},
        headers=headers,
    )


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
    fl_logger.warning(
        f"Payload validation failed: {rejected_fields_of(exc.errors()) or NO_DATA_TEXT}",
        extra={"error_code": "REQ-VAL-001"},
    )

    return error_response(status.HTTP_422_UNPROCESSABLE_CONTENT, "REQ-VAL-001")


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
        extra={"error_code": "DB-COMMON-002"},
    )

    return error_response(status.HTTP_409_CONFLICT, "DB-COMMON-002")


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


async def db_exception_handler(request: Request, exc: PyMongoError):
    # `str(exc)` quotes the document the server refused -- `consideredValue` under a validator, the
    # whole `op` under a bulk write -- and a traceback renders it a second time in its last line.
    fl_logger.error(
        f"Database crash ({type(exc).__name__}, code {getattr(exc, 'code', None)}): {refused_properties_of(exc) or NO_DATA_TEXT}",
        extra={"error_code": "DB-FAIL-001"},
    )

    return error_response(status.HTTP_500_INTERNAL_SERVER_ERROR, "DB-FAIL-001")


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
