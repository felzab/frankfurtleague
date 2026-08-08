"""
SAISONS · read endpoints

Writing them is `admin_router.py`, which is a separate module so the two authorization levels never
share a file.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • `/current` is declared BEFORE `/{saison_id}` and must stay there. Route matching is by declaration
    order, so with them swapped the literal path is captured by the id parameter and "current" is
    looked up as a season id -- a 404 on the endpoint most of the site depends on.
  • A season id is exactly 4 characters. `FLSpiel.saison_id` and `FLSpieltag.saison_id` both require
    that of whatever they reference, so a longer id here would validate and then break every match and
    matchday pointing at it.
  • `/current` is what every other router calls to resolve an omitted `saison_id`. It sits on the hot
    path of most page loads.
  • `rules.win_points` / `draw_points` are what `GET /teams` scores its derived league table with
    (ADR-0026). Editing them changes every table for that season on the next read -- there is no
    stored copy to migrate, and equally nothing to warn that the numbers moved.

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
    saisons = FLSaisonsListAdapter.validate_python([with_schedule(raw) for raw in saisons_raw])

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

    saison = FLSaison.model_validate(with_schedule(saison_raw))

    return FLSaisonsSingleResponse(saison=saison)


# Declared after `/current`, and that is not cosmetic: routes match in declaration order, so with these
# swapped "current" is captured as a saison id and the endpoint most of the site depends on 404s. The
# `objectid` convertor that protects the other resources cannot help here -- a season id is a
# four-character string, not an ObjectId, so the parameter genuinely could match "current".
@router.get("/{saison_id}", response_model=FLSaisonsSingleResponse, summary="One Saison")
async def get_saison(saison_id: str, saisons_collection: SaisonsCollection) -> FLSaisonsSingleResponse:
    """
    Return one season by its four-character id.

    404 when no season carries that id, rather than an empty list — which is the reason this exists
    separately from `GET /saisons` rather than as a filter on it.
    """

    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id})

    return FLSaisonsSingleResponse(saison=FLSaison.model_validate(with_schedule(saison_raw)))
