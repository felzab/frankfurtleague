"""
CORE · exception handlers

Turns every exception into a response. Registered once from `app/main.py`.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • The RESPONSE BODY carries only a trace id. Messages, error codes, validation details and stack
    traces go to the log, never to the client -- the caller correlates by trace id. Adding the detail
    to the body would leak schema internals to anyone who can reach the API.
  • Every handler logs before it returns. A swallowed exception with no log line is invisible.
"""

from bson.errors import InvalidId
from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from pymongo.errors import DuplicateKeyError, PyMongoError

from app.core.exceptions import BaseAPIException
from app.core.logging import fl_logger, trace_id_var

NO_DATA_TEXT = "//- No Data -//"


def get_trace_id() -> str:
    return trace_id_var.get()


async def base_api_exception_handler(request: Request, exc: BaseAPIException):
    # Log the specific code and message to the backend
    fl_logger.warning(f"API Exception ({exc.status_code}): [{getattr(exc, 'error_code', 'API_ERROR')}] {exc.error_detail}")

    return JSONResponse(
        status_code=exc.status_code,
        content={"trace_id": get_trace_id()},
        headers=exc.headers,
    )


async def pydantic_validation_exception_handler(request: Request, exc: ValidationError):
    fl_logger.warning(f"Pydantic validation failed: {exc.errors() or NO_DATA_TEXT}")

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={"trace_id": get_trace_id()},
    )


async def request_validation_exception_handler(request: Request, exc: RequestValidationError):
    fl_logger.warning(f"Payload validation failed: {exc.errors() or NO_DATA_TEXT}")

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={"trace_id": get_trace_id()},
    )


async def duplicate_key_exception_handler(request: Request, exc: DuplicateKeyError):
    """
    A unique index refused the write. 409, not the 500 a bare `PyMongoError` would produce.

    Registered because the write path can hit a unique index on an ordinary, well-formed request: a
    second team claiming a shorthand, or a second squad row for a player in one season. Those are
    states, not malformed payloads, and a 500 would tell the admin the server is broken when the
    server is in fact enforcing the rule (ADR-0027).

    The index NAME is logged rather than returned. It names the rule that was broken -- which is the
    useful thing when reading the log -- and it also names a collection and its fields, which the
    response body's trace-id-only contract exists to keep off the wire.
    """
    # Logged with a code like every other failure, so the 409s are greppable as one class.
    fl_logger.warning(f"API Exception (409): [DB-COMMON-002] Unique index refused a write: {failure_message_of(exc)}")

    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"trace_id": get_trace_id()},
    )


def failure_message_of(exc: DuplicateKeyError) -> str:
    """The server's own `errmsg`, which names the index; `str(exc)` flattens it to a code."""
    return exc.details.get("errmsg", str(exc)) if exc.details else str(exc)


async def motor_db_exception_handler(request: Request, exc: PyMongoError):
    # Log the full database crash
    fl_logger.error(f"Database crash: {str(exc) or NO_DATA_TEXT}", exc_info=True)

    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"trace_id": get_trace_id()},
    )


async def invalid_bson_oid_exception_handler(request: Request, exc: InvalidId):
    fl_logger.warning(f"Invalid ObjectId format received: {str(exc) or NO_DATA_TEXT}")

    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={"trace_id": get_trace_id()},
    )


async def global_catch_all_exception_handler(request: Request, exc: Exception):
    fl_logger.error(f"Unhandled Server Crash: {str(exc) or NO_DATA_TEXT}", exc_info=True)

    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"trace_id": get_trace_id()},
    )


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
