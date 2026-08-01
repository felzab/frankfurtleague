"""
SPIELTAGE · read endpoint

Matchdays: named blocks of fixtures inside a season, with a date range. Reference data -- read-only
through the API, edited directly in MongoDB.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • Ordering is by `order_val`, NOT by date. That is the default sort and the one the bracket depends
    on; sorting by `beginn` reorders the playoff rounds wrongly when dates overlap.
  • Omitting `saison_id` means the current season, resolved in the handler because a field default
    cannot query the database.
  • A Spieltag is not a Spiel. It groups matches; `anzahl_spiele` records how many it should contain.
"""

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


@router.get("", response_model=FLSpieltageListResponse, summary="List Spieltage")
async def get_spieltage(
    spieltage_collection: SpieltageCollection,
    saisons_collection: SaisonsCollection,
    filters: FLSpieltageFilterParams = Depends(),
) -> FLSpieltageListResponse:
    """
    List matchdays for a season, ordered by `order_val` rather than by date.

    Omitting `saison_id` returns the **current** season. `saison_phase` accepts `playoffs` as an alias
    for "any phase except gruppenphase".
    """

    # Omitting `saison_id` means "the current season", not "every season" (ADR-0002). Resolved here
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
