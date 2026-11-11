from http import HTTPStatus

from fastapi import APIRouter, Depends, status
from fastapi.responses import JSONResponse
from pymongo import AsyncMongoClient
from pymongo.errors import PyMongoError

from app.api.system.schemas import CheckIsLiveResponse, CheckIsReadyResponse
from app.core.codes import Code
from app.core.config import API_VERSION
from app.core.db import RETRY_AFTER, get_db_client
from app.core.exceptions import APIError

# The one router without a blanket guard, because its probes must be reachable by the container
# healthcheck and by a monitor outside -- so an endpoint added here is PUBLIC unless it declares otherwise.
router = APIRouter(prefix=f"/api/v{API_VERSION}/system")


@router.get("/is_live", response_model=CheckIsLiveResponse, summary="Liveness probe")
async def check_is_live() -> JSONResponse:
    """
    Liveness: is this process serving requests?

    Unauthenticated, and it does not touch the database: it must not fail for reasons a restart
    cannot fix.
    """
    return JSONResponse(content={"status": "ok"}, status_code=status.HTTP_200_OK)


@router.get("/is_ready", response_model=CheckIsReadyResponse, summary="Readiness probe")
async def check_is_ready(client: AsyncMongoClient = Depends(get_db_client)) -> JSONResponse:
    """
    Readiness: does this process reach its database? 503 where a ping does not come back within the request's deadline.

    Unauthenticated, for a monitor outside.
    """
    try:
        await client.admin.command("ping")
    except PyMongoError:
        # The code a failed read answers, and nothing of the driver's error, which names the hosts
        # it tried: the status is the whole answer a stranger gets.
        raise APIError(HTTPStatus.SERVICE_UNAVAILABLE, Code.DATABASE_FAILED, headers=RETRY_AFTER) from None
    return JSONResponse(content={"status": "ok"}, status_code=status.HTTP_200_OK)
