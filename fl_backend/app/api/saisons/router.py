"""
SAISONS · read endpoints

Seasons are reference data: read-only through the API, edited directly in MongoDB.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • A season id is exactly 4 characters. `FLSpiel.saison_id` and `FLSpieltag.saison_id` both require
    that of whatever they reference, so a longer id here would validate and then break every match and
    matchday pointing at it.
  • `/current` is what every other router calls to resolve an omitted `saison_id`. It sits on the hot
    path of most page loads.
  • `rules.win_points` / `draw_points` are stored per season but NOT read by the statistics
    calculation, which hardcodes 3/1/0. The two agree today; they are not wired together.

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/frontend/spec.md -- section 5, how a direct edit here is propagated to the frontend cache
"""

from fastapi import APIRouter, Depends

from app.api.saisons.crud import pull_current_saison
from app.api.saisons.schemas import (
    FLSaison,
    FLSaisonsFilterOptions,
    FLSaisonsListAdapter,
    FLSaisonsListResponse,
    FLSaisonsSingleResponse,
)
from app.api.saisons.services import build_saisons_filter, build_saisons_sort
from app.core.config import backend_config
from app.core.crud import pull_many_from_db
from app.core.dependencies import SaisonsCollection
from app.core.security import verify_access_base

router = APIRouter(
    prefix=f"/api/v{backend_config.api_version}/saisons",
    dependencies=[Depends(verify_access_base)],
)


@router.get("", response_model=FLSaisonsListResponse, summary="List Saisons")
async def get_saisons(saisons_collection: SaisonsCollection, filters: FLSaisonsFilterOptions = Depends()) -> FLSaisonsListResponse:
    """
    List seasons, optionally filtered by status (`past`, `active`, `future`).

    Unlike the other resources, this does NOT default to the current season -- listing seasons is the
    one case where "all of them" is the sensible default.
    """

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


@router.get("/current", response_model=FLSaisonsSingleResponse, summary="The active Saison")
async def get_current_saison(
    saisons_collection: SaisonsCollection,
) -> FLSaisonsSingleResponse:
    """
    Return the season currently marked active.

    This is what every other endpoint resolves an omitted `saison_id` against, so it sits on the hot
    path of most page loads. Exactly one season is expected to have `status: "active"`.
    """

    saison_raw = await pull_current_saison(saisons_collection=saisons_collection)

    saison = FLSaison.model_validate(saison_raw)

    return FLSaisonsSingleResponse(saison=saison)
