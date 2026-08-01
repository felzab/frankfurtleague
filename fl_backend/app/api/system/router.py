"""
SYSTEM · liveness, readiness and diagnostics

The one router without a blanket guard, because `/is_live` must be reachable by the container
healthcheck.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • `/is_live` stays UNGUARDED and must never touch the database. It answers "is this process up",
    and a healthcheck that needs a secret or a working database fails for the wrong reasons and
    triggers restarts that cannot help.
  • `/is_ready` and `/info` carry their guards INDIVIDUALLY, because the router has none. Any endpoint
    added here is public unless it declares otherwise -- the opposite of every other router in the
    service, and the reason this note exists.
  • `/is_ready` is the one that pings the database. That is the liveness/readiness distinction, and it
    is why they are two endpoints rather than one.

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/ops/spec.md -- section 1, where the healthcheck path is pinned
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import JSONResponse
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.system.schemas import CheckIsLiveResponse, CheckIsReadyResponse, SystemInfoResponse
from app.core.config import backend_config
from app.core.db import get_database
from app.core.exceptions import DatabaseUnavailableException
from app.core.security import verify_access_system

# Router is unprotected by default, to allow for ping endpoint to be publically accesible
router = APIRouter(prefix=f"/api/v{backend_config.api_version}/system")


@router.get("/is_live", response_model=CheckIsLiveResponse, summary="Liveness probe")
async def check_is_live(request: Request) -> JSONResponse:
    """
    Liveness: is this process serving requests?

    Deliberately unauthenticated and deliberately does not touch the database -- this is what the
    container healthcheck calls, and it must not fail for reasons a restart cannot fix.
    """
    return JSONResponse(content={"acknowledged": 1, "status": "ok"}, status_code=status.HTTP_200_OK)


@router.get("/is_ready", dependencies=[Depends(verify_access_system)], response_model=CheckIsReadyResponse, summary="Readiness probe")
async def check_is_ready(request: Request, db: Annotated[AsyncIOMotorDatabase, Depends(get_database)]):
    """
    Readiness: can this process reach its database?

    Pings MongoDB and returns 503 with `DB-CONN-002` if it cannot. Requires the system key.
    """
    try:
        await db.command("ping")
        return JSONResponse(content={"acknowledged": 1, "status": "ok"}, status_code=status.HTTP_200_OK)
    except Exception as unknown_error:
        raise DatabaseUnavailableException(error_code="DB-CONN-002") from unknown_error


@router.get("/info", dependencies=[Depends(verify_access_system)], response_model=SystemInfoResponse, summary="Service metadata")
async def system_info(request: Request) -> JSONResponse:
    """Report the running API version. Requires the system key; not intended for public consumption."""

    return JSONResponse(
        content={"acknowledged": 1, "api_version": backend_config.api_version},
        status_code=status.HTTP_200_OK,
    )
