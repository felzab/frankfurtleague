from fastapi import APIRouter, Depends

from app.api.saisons.visibility import resolve_public_saison
from app.api.spieltage.schemas import (
    FLSpieltag,
    FLSpieltageFilterParams,
    FLSpieltageListResponse,
    FLSpieltageSingleResponse,
    FLSpieltagListAdapter,
)
from app.api.spieltage.services import build_spieltage_filter, build_spieltage_sort, order_spieltage, with_expected_matches
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


@router.get("", response_model=FLSpieltageListResponse, summary="List Spieltage")
async def get_spieltage(
    spieltage_collection: SpieltageCollection,
    saisons_collection: SaisonsCollection,
    filters: FLSpieltageFilterParams = Depends(),
) -> FLSpieltageListResponse:
    """One season's matchdays, by default in the order they are played: the phases in bracket order, each by `position`.

    An omitted `saison_id` reads the season the site is on; 404 for a season this tier may not read.
    """

    # Resolved here, never as a field default, which cannot reach the database. The `rules` come
    # back in the same query, the derived match count needing them.
    saison = await resolve_public_saison(saisons_collection=saisons_collection, saison_id=filters.saison_id)
    filters.saison_id, rules = saison.id, saison.rules

    db_filter = build_spieltage_filter(filters=filters)
    db_sort = build_spieltage_sort(sort_by=filters.sort_by, order=filters.order)

    spieltage_raw = await pull_many_from_db(
        collection=spieltage_collection,
        db_filter=db_filter,
        limit=filters.limit,
        sort_by=db_sort,
    )
    spieltage = FLSpieltagListAdapter.validate_python([with_expected_matches(raw, rules) for raw in spieltage_raw])

    # After the read: the phase's RANK is on no document, so no Mongo sort can put the phases in the
    # order they are played.
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
    """One matchday by its id, its match count derived from its own season's rules.

    404 for a matchday of a season this tier may not read.
    """

    spieltag_raw = await pull_one_from_db(collection=spieltage_collection, db_filter={"_id": spieltag_id})

    # The matchday's own season, so an id belonging to a season being drawn up misses exactly as an
    # id belonging to no matchday does.
    saison = await resolve_public_saison(saisons_collection=saisons_collection, saison_id=str(spieltag_raw["saison_id"]))

    return FLSpieltageSingleResponse(spieltag=FLSpieltag.model_validate(with_expected_matches(spieltag_raw, saison.rules)))
