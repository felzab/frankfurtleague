from fastapi import APIRouter, Depends

from app.api.saisons.schemas import (
    FLSaison,
    FLSaisonsFilterOptions,
    FLSaisonsListAdapter,
    FLSaisonsListResponse,
    FLSaisonsSingleResponse,
)
from app.api.saisons.services import build_saisons_filter, build_saisons_sort
from app.core.config import backend_config
from app.core.crud import pull_many_from_db, pull_one_from_db
from app.core.dependencies import SaisonsCollection
from app.core.security import verify_access_base

router = APIRouter(
    prefix=f"/api/v{backend_config.api_version}/saisons",
    dependencies=[Depends(verify_access_base)],
)


@router.get("", response_model=FLSaisonsListResponse)
async def get_saisons(
    saisons_collection: SaisonsCollection, filters: FLSaisonsFilterOptions = Depends()
) -> FLSaisonsListResponse:

    db_filter = build_saisons_filter(filters=filters)
    db_sort = build_saisons_sort(sort_by=filters.sort_by, order=filters.order)

    saisons_raw = await pull_many_from_db(
        collection=saisons_collection,
        db_filter=db_filter,
        limit=filters.limit,
        sort_by=db_sort,
    )
    saisons = FLSaisonsListAdapter.validate_python(saisons_raw)

    return FLSaisonsListResponse(saisons=saisons)


@router.get("/current", response_model=FLSaisonsSingleResponse)
async def get_current_saison(
    saisons_collection: SaisonsCollection,
) -> FLSaisonsSingleResponse:

    saison_raw = await pull_one_from_db(
        collection=saisons_collection,
        db_filter={"status": "active"},
    )

    saison = FLSaison.model_validate(saison_raw)

    return FLSaisonsSingleResponse(saison=saison)
