from bson.errors import InvalidId
from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from pymongo.errors import PyMongoError

from app.core.exceptions import BaseAPIException


async def base_api_exception_handler(request: Request, exc: Exception):

    if not isinstance(exc, BaseAPIException):
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"acknowledged": 0, "message": "Unknown internal server error in base_api_exception_handler"},
        )

    return JSONResponse(
        status_code=exc.status_code,
        content={"acknowledged": 0, **exc.error_detail},
        headers=exc.headers,
    )


async def pydantic_validation_exception_handler(request: Request, exc: Exception):

    if not isinstance(exc, ValidationError):
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"acknowledged": 0, "message": "Unknown internal server error in pydantic_validation_exception_handler"},
        )

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"acknowledged": 0, "message": "Internal data validation failed", "details": exc.errors()},
    )


async def motor_db_exception_handler(request: Request, exc: Exception):

    if not isinstance(exc, PyMongoError):
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"acknowledged": 0, "message": "Unknown internal server error in motor_db_exception_handler"},
        )

    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"acknowledged": 0, "message": "An unexpected database error occured"},
    )


async def invalid_bson_oid_exception_handler(request: Request, exc: Exception):

    if not isinstance(exc, InvalidId):
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"acknowledged": 0, "message": "Unknown internal server error in invalid_bson_oid_exception_handler"},
        )

    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"acknowledged": 0, "message": "An invalid str was passed as oid"},
    )


def register_exception_handlers(app: FastAPI):
    app.add_exception_handler(BaseAPIException, base_api_exception_handler)
    app.add_exception_handler(ValidationError, pydantic_validation_exception_handler)
    app.add_exception_handler(PyMongoError, motor_db_exception_handler)
    app.add_exception_handler(InvalidId, invalid_bson_oid_exception_handler)
