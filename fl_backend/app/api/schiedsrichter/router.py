"""
SCHIEDSRICHTER · read endpoint

Referees. Read-only here; create, update and delete are admin-authorized and live in the admin router.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • Deletion is SOFT (`is_inactive`), for the same reason as venues: matches embed a copy of the
    referee, and a hard delete would orphan every match they officiated.
  • `payment` is the fee in whole euros, with no default. It is NOT propagated when a referee is
    renamed -- the fee recorded on a match is what was agreed for that match, and rewriting it would
    rewrite history.
  • The frontend calls this with no arguments, always. The filter parameters exist but are unused in
    practice, which is worth knowing before optimising for them.
"""

from fastapi import APIRouter, Depends

from app.api.schiedsrichter.schemas import (
    FLSchiedsrichter,
    FLSchiedsrichterFilterParams,
    FLSchiedsrichterListAdapter,
    FLSchiedsrichterListResponse,
    FLSchiedsrichterSingleResponse,
)
from app.api.schiedsrichter.services import (
    build_schiedsrichter_filter,
    build_schiedsrichter_sort,
)
from app.core.config import backend_config
from app.core.crud import pull_many_from_db, pull_one_from_db
from app.core.dependencies import SchiedsrichterCollection
from app.core.routing import by_id
from app.core.security import verify_access_base
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{backend_config.api_version}/schiedsrichter",
    dependencies=[Depends(verify_access_base)],
)


@router.get("", response_model=FLSchiedsrichterListResponse, summary="List Schiedsrichter")
async def get_schiedsrichter(
    schiedsrichter_collection: SchiedsrichterCollection,
    filters: FLSchiedsrichterFilterParams = Depends(),
) -> FLSchiedsrichterListResponse:
    """
    List referees.

    Deactivated referees are soft-deleted rather than removed, so they remain retrievable for the
    historical matches that embed them.
    """

    db_filter = build_schiedsrichter_filter(filters=filters)
    db_sort = build_schiedsrichter_sort(sort_by=filters.sort_by, order=filters.order)

    schiedsrichter_raw = await pull_many_from_db(
        collection=schiedsrichter_collection,
        db_filter=db_filter,
        limit=filters.limit,
        sort_by=db_sort,
    )
    schiedsrichter = FLSchiedsrichterListAdapter.validate_python(schiedsrichter_raw)

    return FLSchiedsrichterListResponse(schiedsrichter=schiedsrichter)


@router.get(by_id("schiedsrichter_id"), response_model=FLSchiedsrichterSingleResponse, summary="One Schiedsrichter")
async def get_schiedsrichter_by_id(
    schiedsrichter_id: CustomRouteObjectId,
    schiedsrichter_collection: SchiedsrichterCollection,
) -> FLSchiedsrichterSingleResponse:
    """
    Return one referee by their id, deactivated ones included — a historical match embeds a referee and
    references them by id, which is exactly the case worth answering.
    """

    schiedsrichter_raw = await pull_one_from_db(collection=schiedsrichter_collection, db_filter={"_id": schiedsrichter_id})

    return FLSchiedsrichterSingleResponse(schiedsrichter=FLSchiedsrichter(**schiedsrichter_raw))
