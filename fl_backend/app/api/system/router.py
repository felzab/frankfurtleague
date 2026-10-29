from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

from app.api.system.schemas import CheckIsLiveResponse
from app.core.config import API_VERSION

# The one router without a blanket guard, because `/is_live` must be reachable by the container
# healthcheck -- so an endpoint added here is PUBLIC unless it declares otherwise.
router = APIRouter(prefix=f"/api/v{API_VERSION}/system")
# The service's root, outside the versioned prefix.
root_router = APIRouter()


@router.get("/is_live", response_model=CheckIsLiveResponse, summary="Liveness probe")
async def check_is_live() -> JSONResponse:
    """
    Liveness: is this process serving requests?

    Unauthenticated, and it does not touch the database: it must not fail for reasons a restart
    cannot fix.
    """
    return JSONResponse(content={"status": "ok"}, status_code=status.HTTP_200_OK)


# The published prose is the decorator's rather than the docstring's: a docstring cannot
# interpolate, so the version would reach `openapi.json` as the literal `{API_VERSION}`.
@root_router.get(
    "/",
    description=f"Confirm the service is answering. The versioned API is under `/api/v{API_VERSION}`; `/system/is_live` is the probe.",
)
def root():
    """Confirm the service is answering."""
    return "Hello World"
