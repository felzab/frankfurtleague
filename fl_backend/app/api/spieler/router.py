from fastapi import APIRouter, Depends

from app.api.spieler.schemas import FLSpielerFilterParams, FLSpielerListAdapter, FLSpielerListResponse
from app.api.spieler.services import build_spieler_filter, build_spieler_sort
from app.core.config import backend_config
from app.core.crud import pull_many_from_db
from app.core.dependencies import SpielerCollection
from app.core.security import verify_access_base

router = APIRouter(prefix=f"/api/v{backend_config.api_version}/spieler", dependencies=[Depends(verify_access_base)])


@router.get("", response_model=FLSpielerListResponse)
async def get_spieler(
    spieler_collection: SpielerCollection, filters: FLSpielerFilterParams = Depends()
) -> FLSpielerListResponse:

    db_filter = build_spieler_filter(filters=filters)
    db_sort = build_spieler_sort(sort_by=filters.sort_by, order=filters.order)

    spieler_raw = await pull_many_from_db(
        collection=spieler_collection, db_filter=db_filter, limit=filters.limit, sort_by=db_sort
    )

    spieler = FLSpielerListAdapter.validate_python(spieler_raw)
    return FLSpielerListResponse(spieler=spieler)
