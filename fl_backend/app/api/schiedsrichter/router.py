from fastapi import APIRouter, Depends

from app.api.schiedsrichter.schemas import (
    FLSchiedsrichter,
    FLSchiedsrichterFilterParams,
    FLSchiedsrichterListAdapter,
    FLSchiedsrichterListResponse,
    FLSchiedsrichterSingleResponse,
)
from app.api.schiedsrichter.services import build_real_referees_filter, build_referee_filter
from app.core.config import API_VERSION
from app.core.crud import GERMAN_COLLATION, build_query, build_sort, pull_many_from_db, pull_one_from_db
from app.core.dependencies import SchiedsrichterCollection
from app.core.routing import by_id
from app.core.security import verify_access_admin
from app.shared.schemas.custom import CustomRouteObjectId

# Admin-guarded, not base: a referee is a pupil, so their contact details and school are admin-tier
# (`READ-CONTACT-001`), as is the fee (`READ-MONEY-001`).
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/schiedsrichter",
    dependencies=[Depends(verify_access_admin)],
)


@router.get("", response_model=FLSchiedsrichterListResponse, summary="List Schiedsrichter")
async def get_schiedsrichter(
    schiedsrichter_collection: SchiedsrichterCollection,
    filters: FLSchiedsrichterFilterParams = Depends(),
) -> FLSchiedsrichterListResponse:
    """
    An admin-tier read: a referee is a pupil, so their contact and school are private (`READ-CONTACT-001`).

    The fee is admin-tier as money, not as a pupil's detail (`READ-MONEY-001`). Deactivated ones
    stay retrievable for a historical match.

    The ghost is OFF this list whatever the query string asks for: no person stands behind it, so
    there is nothing an administrator could book it for, edit on it or reactivate it into
    (`app/core/sentinels.py :: GHOST_SCHIEDSRICHTER_ID`).
    """

    schiedsrichter_raw = await pull_many_from_db(
        collection=schiedsrichter_collection,
        db_filter=build_query(
            filters,
            terms={"default_payment"},
            include_inactive=filters.include_inactive,
            compiled=build_real_referees_filter(),
        ),
        limit=filters.limit,
        sort_by=build_sort(sort_by=filters.sort_by, order=filters.order),
        collation=GERMAN_COLLATION,
    )

    return FLSchiedsrichterListResponse(schiedsrichter=FLSchiedsrichterListAdapter.validate_python(schiedsrichter_raw))


@router.get(by_id("schiedsrichter_id"), response_model=FLSchiedsrichterSingleResponse, summary="One Schiedsrichter")
async def get_schiedsrichter_by_id(
    schiedsrichter_id: CustomRouteObjectId,
    schiedsrichter_collection: SchiedsrichterCollection,
) -> FLSchiedsrichterSingleResponse:
    """Admin-tier as the list is, and for the same two rules (`READ-CONTACT-001`, `READ-MONEY-001`).

    Deactivated ones included -- a historical match references them by id. The ghost answers 404, as
    does an id whose referee has been erased: the document is gone
    (`app/core/sentinels.py :: GHOST_SCHIEDSRICHTER_ID`).
    """

    schiedsrichter_raw = await pull_one_from_db(collection=schiedsrichter_collection, db_filter=build_referee_filter(schiedsrichter_id))

    return FLSchiedsrichterSingleResponse(schiedsrichter=FLSchiedsrichter(**schiedsrichter_raw))
