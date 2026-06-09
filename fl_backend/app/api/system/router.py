from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import JSONResponse
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.config import backend_config
from app.core.db import get_database
from app.core.exceptions import DatabaseUnavailableException
from app.core.security import verify_access_system

router = APIRouter(prefix=f"/api/v{backend_config.api_version}/system", dependencies=[Depends(verify_access_system)])


@router.get("/is_live")
async def check_is_live(request: Request) -> JSONResponse:
    return JSONResponse(content={"acknowledged": 1, "status": "ok"}, status_code=status.HTTP_200_OK)


@router.get("/is_ready")
async def check_is_ready(request: Request, db: Annotated[AsyncIOMotorDatabase, Depends(get_database)]):
    try:
        await db.command("ping")
        return JSONResponse(content={"acknowledged": 1, "status": "ok"}, status_code=status.HTTP_200_OK)
    except Exception:
        raise DatabaseUnavailableException(error_code="DB-CONN-002")


@router.get("/info")
async def system_info(request: Request) -> JSONResponse:

    return JSONResponse(
        content={"acknowledged": 1, "api_version": backend_config.api_version},
        status_code=status.HTTP_200_OK,
    )
