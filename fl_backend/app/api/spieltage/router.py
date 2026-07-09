from fastapi import APIRouter, Depends

from app.api.spieltage.schemas import (
    FLSpieltageFilterParams,
    FLSpieltageListResponse,
    FLSpieltagListAdapter,
)
from app.api.spieltage.services import build_spieltage_filter, build_spieltage_sort
from app.core.config import backend_config
from app.core.crud import pull_many_from_db
from app.core.dependencies import SpieltageCollection
from app.core.security import verify_access_base

router = APIRouter(
    prefix=f"/api/v{backend_config.api_version}/spieltage",
    dependencies=[Depends(verify_access_base)],
)


@router.get("", response_model=FLSpieltageListResponse)
async def get_spieltage(
    spieltage_collection: SpieltageCollection,
    filters: FLSpieltageFilterParams = Depends(),
) -> FLSpieltageListResponse:

    db_filter = build_spieltage_filter(filters=filters)
    db_sort = build_spieltage_sort(sort_by=filters.sort_by, order=filters.order)

    spieltage_raw = await pull_many_from_db(
        collection=spieltage_collection,
        db_filter=db_filter,
        limit=filters.limit,
        sort_by=db_sort,
    )
    spieltage = FLSpieltagListAdapter.validate_python(spieltage_raw)

    return FLSpieltageListResponse(spieltage=spieltage)
