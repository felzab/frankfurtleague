"""
SPIELTAGE · read endpoints

Matchdays: named blocks of fixtures inside a season, with a date range. Written through
`admin_router.py` in this slice and read here.

Invariants:
- Ordering is derived and no field holds it — `order_spieltage` is its only expression (ADR-0051).
- Omitting `saison_id` means the current season, resolved in the handler (ADR-0002).
- `anzahl_spiele` is derived per read (ADR-0052), so both reads resolve the season document.
"""

from typing import Any, Mapping

from fastapi import APIRouter, Depends

from app.api.saisons.crud import pull_saison_id_and_rules
from app.api.saisons.schedule import expected_matches
from app.api.saisons.schemas import FLSaisonRules
from app.api.spieltage.schemas import (
    FLSpieltag,
    FLSpieltageFilterParams,
    FLSpieltageListResponse,
    FLSpieltageSingleResponse,
    FLSpieltagListAdapter,
)
from app.api.spieltage.services import build_spieltage_filter, build_spieltage_sort, order_spieltage
from app.core.config import API_VERSION
from app.core.crud import pull_many_from_db, pull_one_from_db
from app.core.dependencies import SaisonsCollection, SpieltageCollection
from app.core.routing import by_id
from app.core.security import verify_access_base
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spieltage",
    dependencies=[Depends(verify_access_base)],
)


def _with_expected_matches(spieltage_raw: list[Mapping[str, Any]], rules: FLSaisonRules) -> list[dict[str, Any]]:
    """
    Attaches each matchday's derived `anzahl_spiele` before validation.

    Injected into the raw document rather than set on the model afterwards, because the field is REQUIRED
    on `FLSpieltag` -- so a document reaching validation without it is a 500, and doing it here means the
    model's own bound (`ge=0`) still judges the derived value.
    """

    return [{**raw, "anzahl_spiele": expected_matches(rules, raw["saison_phase"])} for raw in spieltage_raw]


@router.get("", response_model=FLSpieltageListResponse, summary="List Spieltage")
async def get_spieltage(
    spieltage_collection: SpieltageCollection,
    saisons_collection: SaisonsCollection,
    filters: FLSpieltageFilterParams = Depends(),
) -> FLSpieltageListResponse:
    """
    List matchdays for a season, in the order they are played.

    That order is derived rather than stored: the phase in bracket order, then `beginn`, then `name`. It
    is what `sort_by=natural` means and it is the default; the other two sort options are dates, and
    neither is what a bracket reads.

    Omitting `saison_id` returns the **current** season. `saison_phase` accepts `playoffs` as an alias
    for "any phase except gruppenphase".
    """

    # Omitting `saison_id` means the current season, not every season (ADR-0002): a field default
    # cannot reach the database. The season's `rules` come back in the same query, because the derived
    # match count needs them.
    filters.saison_id, rules = await pull_saison_id_and_rules(saisons_collection=saisons_collection, saison_id=filters.saison_id)

    db_filter = build_spieltage_filter(filters=filters)
    db_sort = build_spieltage_sort(sort_by=filters.sort_by, order=filters.order)

    spieltage_raw = await pull_many_from_db(
        collection=spieltage_collection,
        db_filter=db_filter,
        limit=filters.limit,
        sort_by=db_sort,
    )
    spieltage = FLSpieltagListAdapter.validate_python(_with_expected_matches(spieltage_raw, rules))

    # The exact order, applied after the read: the phases sort lexically in Mongo and that is not the
    # order they are played in (ADR-0051). Only the natural order is refined here — a caller who asked
    # for a date or a size ordering asked for exactly that.
    if filters.sort_by == "natural":
        spieltage = order_spieltage(spieltage)
        if filters.order == "desc":
            spieltage.reverse()

    return FLSpieltageListResponse(spieltage=spieltage)


@router.get(by_id("spieltag_id"), response_model=FLSpieltageSingleResponse, summary="One Spieltag")
async def get_spieltag(
    spieltag_id: CustomRouteObjectId,
    spieltage_collection: SpieltageCollection,
    saisons_collection: SaisonsCollection,
) -> FLSpieltageSingleResponse:
    """
    Return one matchday by its id.

    Addressed directly, so no season is chosen by this endpoint and a retired matchday is returned rather
    than hidden — a caller holding an id was given it by something. The matchday's OWN `saison_id` is
    still resolved, because the derived match count needs that season's rules (ADR-0052).
    """

    spieltag_raw = await pull_one_from_db(collection=spieltage_collection, db_filter={"_id": spieltag_id})
    _, rules = await pull_saison_id_and_rules(saisons_collection=saisons_collection, saison_id=str(spieltag_raw["saison_id"]))

    return FLSpieltageSingleResponse(spieltag=FLSpieltag.model_validate(_with_expected_matches([spieltag_raw], rules)[0]))
