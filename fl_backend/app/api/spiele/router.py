from fastapi import APIRouter, Depends

from app.api.spiele.schemas import (
    FLSpieleFilterParams,
    FLSpieleListResponse,
    FLSpielListAdapter,
)
from app.api.spiele.services import build_spiele_filter, build_spiele_sort
from app.core.config import backend_config
from app.core.crud import pull_many_from_db
from app.core.dependencies import SpieleCollection, get_german_date_str
from app.core.security import verify_access_base

router = APIRouter(prefix=f"/api/v{backend_config.api_version}/spiele", dependencies=[Depends(verify_access_base)])


@router.get("", response_model=FLSpieleListResponse)
async def get_spiele(
    spiele_collection: SpieleCollection, filters: FLSpieleFilterParams = Depends(), today: str = Depends(get_german_date_str)
) -> FLSpieleListResponse:

    db_filter = build_spiele_filter(filters=filters, today=today)
    db_sort = build_spiele_sort(sort_by=filters.sort_by, order=filters.order)

    spiele_raw = await pull_many_from_db(
        collection=spiele_collection, db_filter=db_filter, limit=filters.limit, sort_by=db_sort
    )
    spiele = FLSpielListAdapter.validate_python(spiele_raw)

    return FLSpieleListResponse(spiele=spiele)
