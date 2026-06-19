from fastapi import APIRouter, Depends

from app.api.schiedsrichter.schemas import (
    FLSchiedsrichterFilterParams,
    FLSchiedsrichterListAdapter,
    FLSchiedsrichterListResponse,
)
from app.api.schiedsrichter.services import build_schiedsrichter_filter, build_schiedsrichter_sort
from app.core.config import backend_config
from app.core.crud import pull_many_from_db
from app.core.dependencies import SchiedsrichterCollection
from app.core.security import verify_access_base

router = APIRouter(prefix=f"/api/v{backend_config.api_version}/schiedsrichter", dependencies=[Depends(verify_access_base)])


@router.get("", response_model=FLSchiedsrichterListResponse)
async def get_schiedsrichter(
    schiedsrichter_collection: SchiedsrichterCollection, filters: FLSchiedsrichterFilterParams = Depends()
) -> FLSchiedsrichterListResponse:

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
