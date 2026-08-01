"""
SPIELE · read endpoint

Serves `GET /spiele`, the most-hit endpoint in the application. Read-only; every Spiel mutation lives in
the admin router.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • Omitting `saison_id` means the CURRENT season, not every season. The resolution must stay in the
    handler: a Pydantic field default is a constant and cannot query the database.
  • `saison_phase="playoffs"` is a query-only alias compiled to `saison_phase != "gruppenphase"`. It is
    never a stored value -- you will not find it on a document.
  • Authorization comes from the router-level `verify_access_base` dependency. A new endpoint added
    here inherits it.

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/backend/spec.md -- section 2, the full parameter contract
"""

from fastapi import APIRouter, Depends

from app.api.saisons.crud import pull_current_saison_id
from app.api.spiele.schemas import (
    FLSpieleFilterParams,
    FLSpieleListResponse,
    FLSpielListAdapter,
)
from app.api.spiele.services import build_spiele_filter, build_spiele_sort
from app.core.config import backend_config
from app.core.crud import pull_many_from_db
from app.core.dependencies import SaisonsCollection, SpieleCollection, get_german_date_str
from app.core.security import verify_access_base

router = APIRouter(
    prefix=f"/api/v{backend_config.api_version}/spiele",
    dependencies=[Depends(verify_access_base)],
)


@router.get("", response_model=FLSpieleListResponse, summary="List Spiele")
async def get_spiele(
    spiele_collection: SpieleCollection,
    saisons_collection: SaisonsCollection,
    filters: FLSpieleFilterParams = Depends(),
    today: str = Depends(get_german_date_str),
) -> FLSpieleListResponse:
    """
    List Spiele matching the given filters.

    Omitting `saison_id` returns the **current** season, not every season.

    `saison_phase` accepts `playoffs` as an alias for "any phase except gruppenphase".
    `spiel_status` is resolved against the current German date: `ausstehend` includes today.
    """

    # Omitting `saison_id` means "the current season", not "every season" (ADR-0002). Resolved here
    # rather than as a field default because a default cannot reach the database.
    if filters.saison_id is None:
        filters.saison_id = await pull_current_saison_id(saisons_collection=saisons_collection)

    db_filter = build_spiele_filter(filters=filters, today=today)
    db_sort = build_spiele_sort(sort_by=filters.sort_by, order=filters.order)

    spiele_raw = await pull_many_from_db(
        collection=spiele_collection,
        db_filter=db_filter,
        limit=filters.limit,
        sort_by=db_sort,
    )
    spiele = FLSpielListAdapter.validate_python(spiele_raw)

    return FLSpieleListResponse(spiele=spiele)
