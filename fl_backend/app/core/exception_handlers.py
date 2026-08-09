"""
CORE · exception handlers

Turns every exception into a response. Registered once from `app/main.py`.

Invariants:
- The body carries only the error code and correlation id; detail goes to the log, never the client.
- Every handler logs before it returns, with the error code as a structured field.

See:
- docs/logging.md — the error codes
"""

from typing import Mapping

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
    # Log the specific code and message to the backend
    fl_logger.warning(
        f"API Exception ({exc.status_code}): {exc.error_detail['message']}",
        extra={"error_code": exc.error_code},
    )

    return error_response(exc.status_code, exc.error_code, headers=exc.headers)


async def pydantic_validation_exception_handler(request: Request, exc: ValidationError):
    # A ValidationError that escapes a handler is a SERVER-side model failing on server-side data --
    # request payloads raise RequestValidationError instead (handled above this one by type). 500,
    # not 422: telling the caller their payload is wrong would point the diagnosis at the wrong side.
    fl_logger.error(
        f"Model validation failed outside request parsing: {exc.errors() or NO_DATA_TEXT}",
        extra={"error_code": "SRV-VAL-001"},
    )

    return error_response(status.HTTP_500_INTERNAL_SERVER_ERROR, "SRV-VAL-001")


async def request_validation_exception_handler(request: Request, exc: RequestValidationError):
    fl_logger.warning(
        f"Payload validation failed: {exc.errors() or NO_DATA_TEXT}",
        extra={"error_code": "REQ-VAL-001"},
    )

    return error_response(status.HTTP_422_UNPROCESSABLE_CONTENT, "REQ-VAL-001")


async def duplicate_key_exception_handler(request: Request, exc: DuplicateKeyError):
    """
    A unique index refused the write. 409, not the 500 a bare `PyMongoError` would produce.

    Registered because the write path can hit a unique index on an ordinary, well-formed request: a
    second team claiming a shorthand, or a second squad row for a player in one season. Those are
    states, not malformed payloads, and a 500 would tell the admin the server is broken when the
    server is in fact enforcing the rule (ADR-0027).

    The index NAME is logged rather than returned. It names the rule that was broken -- which is the
    useful thing when reading the log -- and it also names a collection and its fields, which the
    minimal failure-body contract exists to keep off the wire.
    """
    fl_logger.warning(
        f"Unique index refused a write: {failure_message_of(exc)}",
        extra={"error_code": "DB-COMMON-002"},
    )

    return error_response(status.HTTP_409_CONFLICT, "DB-COMMON-002")


def failure_message_of(exc: DuplicateKeyError) -> str:
    """The server's own `errmsg`, which names the index; `str(exc)` flattens it to a code."""
    return exc.details.get("errmsg", str(exc)) if exc.details else str(exc)


async def motor_db_exception_handler(request: Request, exc: PyMongoError):
    # Log the full database crash
    fl_logger.error(
        f"Database crash: {str(exc) or NO_DATA_TEXT}",
        exc_info=True,
        extra={"error_code": "DB-FAIL-001"},
    )

    return error_response(status.HTTP_500_INTERNAL_SERVER_ERROR, "DB-FAIL-001")


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
    # DuplicateKeyError is a PyMongoError subclass, and Starlette resolves a handler by walking
    # `type(exc).__mro__` for the first class it has one for -- so this wins over the line below by
    # being more specific, not by being registered first. Without it, a refused unique index is
    # reported to the admin as a 500 database crash.
    app.add_exception_handler(DuplicateKeyError, duplicate_key_exception_handler)  # type: ignore
    app.add_exception_handler(PyMongoError, motor_db_exception_handler)  # type: ignore
    app.add_exception_handler(InvalidId, invalid_bson_oid_exception_handler)  # type: ignore
    app.add_exception_handler(Exception, global_catch_all_exception_handler)
