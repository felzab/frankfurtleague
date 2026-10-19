from fastapi import APIRouter, Depends

from app.core.config import API_VERSION
from app.core.security import bind_system_actor, verify_access_system

# System tier and the system actor, for `app/api/bewerbungen/sweep_router.py`'s reason: the timer
# holds no session, and an invented administrator for a machine is what `SYSTEM_ACTOR` exists to avoid.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spielbestaetigungen/sweep",
    dependencies=[Depends(verify_access_system), Depends(bind_system_actor)],
)
