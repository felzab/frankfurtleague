from bson.errors import InvalidId
from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from pymongo.errors import PyMongoError

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
    app.add_exception_handler(PyMongoError, motor_db_exception_handler)  # type: ignore
    app.add_exception_handler(InvalidId, invalid_bson_oid_exception_handler)  # type: ignore
    app.add_exception_handler(Exception, global_catch_all_exception_handler)
