from fastapi import APIRouter, Depends

from app.core.config import API_VERSION
from app.core.security import bind_public_actor, verify_access_base

# Base tier and the public actor: the token is the whole credential, as a sign-in code is, for
# `app/api/bewerbungen/einwilligung_router.py`'s reason.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spielbestaetigungen",
    dependencies=[Depends(verify_access_base), Depends(bind_public_actor)],
)
