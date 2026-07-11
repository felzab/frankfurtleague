from fastapi import APIRouter, Depends

from app.api.spieler.schemas import (
    FLSpielerFilterParams,
    FLSpielerListAdapter,
    FLSpielerListResponse,
)
from app.api.spieler.services import build_spieler_pipeline
from app.core.config import backend_config
from app.core.crud import aggregate_many_from_db
from app.core.dependencies import SpielerCollection
from app.core.security import verify_access_base

router = APIRouter(
    prefix=f"/api/v{backend_config.api_version}/spieler",
    dependencies=[Depends(verify_access_base)],
)


@router.get("", response_model=FLSpielerListResponse)
async def get_spieler(spieler_collection: SpielerCollection, filters: FLSpielerFilterParams = Depends()) -> FLSpielerListResponse:

    pipeline = build_spieler_pipeline(filters=filters)
    spieler_raw = await aggregate_many_from_db(collection=spieler_collection, pipeline=pipeline)

    spieler = FLSpielerListAdapter.validate_python(spieler_raw)
    return FLSpielerListResponse(spieler=spieler)
