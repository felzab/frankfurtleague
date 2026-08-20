from fastapi import APIRouter, Depends

from app.api.schiedsrichter.schemas import (
    FLSchiedsrichter,
    FLSchiedsrichterFilterParams,
    FLSchiedsrichterListAdapter,
    FLSchiedsrichterListResponse,
    FLSchiedsrichterSingleResponse,
)
from app.core.config import API_VERSION
from app.core.crud import build_query, build_sort, pull_many_from_db, pull_one_from_db
from app.core.dependencies import SchiedsrichterCollection
from app.core.routing import by_id
from app.core.security import verify_access_base
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/schiedsrichter",
    dependencies=[Depends(verify_access_base)],
)


@router.get("", response_model=FLSchiedsrichterListResponse, summary="List Schiedsrichter")
async def get_schiedsrichter(
    schiedsrichter_collection: SchiedsrichterCollection,
    filters: FLSchiedsrichterFilterParams = Depends(),
) -> FLSchiedsrichterListResponse:
    """List referees; deactivated ones are soft-deleted rather than removed, so historical matches stay resolvable."""

    schiedsrichter_raw = await pull_many_from_db(
        collection=schiedsrichter_collection,
        db_filter=build_query(filters, terms={"default_payment"}, include_inactive=filters.include_inactive),
        limit=filters.limit,
        sort_by=build_sort(sort_by=filters.sort_by, order=filters.order),
    )
    schiedsrichter = FLSchiedsrichterListAdapter.validate_python(schiedsrichter_raw)

    return FLSchiedsrichterListResponse(schiedsrichter=schiedsrichter)


@router.get(by_id("schiedsrichter_id"), response_model=FLSchiedsrichterSingleResponse, summary="One Schiedsrichter")
async def get_schiedsrichter_by_id(
    schiedsrichter_id: CustomRouteObjectId,
    schiedsrichter_collection: SchiedsrichterCollection,
) -> FLSchiedsrichterSingleResponse:
    """Return one referee by their id, deactivated ones included -- a historical match references them by id."""

    schiedsrichter_raw = await pull_one_from_db(collection=schiedsrichter_collection, db_filter={"_id": schiedsrichter_id})

    return FLSchiedsrichterSingleResponse(schiedsrichter=FLSchiedsrichter(**schiedsrichter_raw))
