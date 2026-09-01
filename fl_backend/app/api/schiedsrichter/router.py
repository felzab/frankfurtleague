from fastapi import APIRouter, Depends

from app.api.schiedsrichter.schemas import (
    FLSchiedsrichter,
    FLSchiedsrichterFilterParams,
    FLSchiedsrichterListAdapter,
    FLSchiedsrichterListResponse,
    FLSchiedsrichterSingleResponse,
)
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
    """

    schiedsrichter_raw = await pull_many_from_db(
        collection=schiedsrichter_collection,
        db_filter=build_query(filters, terms={"default_payment"}, include_inactive=filters.include_inactive),
        limit=filters.limit,
        sort_by=build_sort(sort_by=filters.sort_by, order=filters.order),
        collation=GERMAN_COLLATION,
    )
    schiedsrichter = FLSchiedsrichterListAdapter.validate_python(schiedsrichter_raw)

    return FLSchiedsrichterListResponse(schiedsrichter=schiedsrichter)


@router.get(by_id("schiedsrichter_id"), response_model=FLSchiedsrichterSingleResponse, summary="One Schiedsrichter")
async def get_schiedsrichter_by_id(
    schiedsrichter_id: CustomRouteObjectId,
    schiedsrichter_collection: SchiedsrichterCollection,
) -> FLSchiedsrichterSingleResponse:
    """Admin-tier as the list is, and for the same two rules (`READ-CONTACT-001`, `READ-MONEY-001`).

    Deactivated ones included -- a historical match references them by id.
    """

    schiedsrichter_raw = await pull_one_from_db(collection=schiedsrichter_collection, db_filter={"_id": schiedsrichter_id})

    return FLSchiedsrichterSingleResponse(schiedsrichter=FLSchiedsrichter(**schiedsrichter_raw))
