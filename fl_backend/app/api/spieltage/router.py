from fastapi import APIRouter, Depends

from app.api.saisons.crud import pull_current_saison_id
from app.api.spieltage.schemas import (
    FLSpieltageFilterParams,
    FLSpieltageListResponse,
    FLSpieltagListAdapter,
)
from app.api.spieltage.services import build_spieltage_filter, build_spieltage_sort
from app.core.config import backend_config
from app.core.crud import pull_many_from_db
from app.core.dependencies import SaisonsCollection, SpieltageCollection
from app.core.security import verify_access_base

router = APIRouter(
    prefix=f"/api/v{backend_config.api_version}/spieltage",
    dependencies=[Depends(verify_access_base)],
)


@router.get("", response_model=FLSpieltageListResponse)
async def get_spieltage(
    spieltage_collection: SpieltageCollection,
    saisons_collection: SaisonsCollection,
    filters: FLSpieltageFilterParams = Depends(),
) -> FLSpieltageListResponse:

    # Omitting `saison_id` means "the current season", not "every season" (BE-1). Resolved here
    # rather than as a field default because a default cannot reach the database.
    if filters.saison_id is None:
        filters.saison_id = await pull_current_saison_id(saisons_collection=saisons_collection)

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
