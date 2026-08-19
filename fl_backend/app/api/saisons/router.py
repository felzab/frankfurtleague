from fastapi import APIRouter, Depends

from app.api.saisons.crud import pull_current_saison
from app.api.saisons.schemas import (
    FLSaison,
    FLSaisonsFilterOptions,
    FLSaisonsListAdapter,
    FLSaisonsListResponse,
    FLSaisonsSingleResponse,
)
from app.api.saisons.services import build_saisons_filter, build_saisons_sort, with_schedule
from app.core.config import API_VERSION
from app.core.crud import pull_many_from_db, pull_one_from_db
from app.core.dependencies import SaisonsCollection
from app.core.security import verify_access_base

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/saisons",
    dependencies=[Depends(verify_access_base)],
)


@router.get("", response_model=FLSaisonsListResponse, summary="List Saisons")
async def get_saisons(saisons_collection: SaisonsCollection, filters: FLSaisonsFilterOptions = Depends()) -> FLSaisonsListResponse:
    """
    List seasons, optionally filtered by status (`past`, `active`, `future`).

    Unlike the other resources, this does NOT default to the current season.
    """

    db_filter = build_saisons_filter(filters=filters)
    db_sort = build_saisons_sort(sort_by=filters.sort_by, order=filters.order)

    saisons_raw = await pull_many_from_db(
        collection=saisons_collection,
        db_filter=db_filter,
        limit=filters.limit,
        sort_by=db_sort,
    )
    saisons = FLSaisonsListAdapter.validate_python([with_schedule(raw) for raw in saisons_raw])

    return FLSaisonsListResponse(saisons=saisons)


@router.get("/current", response_model=FLSaisonsSingleResponse, summary="The active Saison")
async def get_current_saison(
    saisons_collection: SaisonsCollection,
) -> FLSaisonsSingleResponse:
    """Return the season currently marked active -- what every other endpoint resolves an omitted `saison_id` against."""

    saison_raw = await pull_current_saison(saisons_collection=saisons_collection)

    saison = FLSaison.model_validate(with_schedule(saison_raw))

    return FLSaisonsSingleResponse(saison=saison)


# Declared after `/current`: routes match in declaration order, and the `objectid` convertor cannot
# help here, a season id being a four-character string (`docs/backend/spec.md :: I37`).
@router.get("/{saison_id}", response_model=FLSaisonsSingleResponse, summary="One Saison")
async def get_saison(saison_id: str, saisons_collection: SaisonsCollection) -> FLSaisonsSingleResponse:
    """Return one season by its four-character id; 404 when none carries it, rather than an empty list."""

    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id})

    return FLSaisonsSingleResponse(saison=FLSaison.model_validate(with_schedule(saison_raw)))
