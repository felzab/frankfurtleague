from fastapi import APIRouter, Depends

from app.api.saisons.visibility import saison_is_withheld, withheld_saison_ids
from app.api.spieler.schemas import (
    FLSpielerFilterParams,
    FLSpielerListAdapter,
    FLSpielerListResponse,
    FLSpielerSingleResponse,
)
from app.api.spieler.services import build_spieler_pipeline, public_initial
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db, pull_one_from_db
from app.core.dependencies import SaisonsCollection, SpielerCollection
from app.core.routing import by_id
from app.core.security import verify_access_base
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spieler",
    dependencies=[Depends(verify_access_base)],
)


@router.get("", response_model=FLSpielerListResponse, summary="List Spieler")
async def get_spieler(
    spieler_collection: SpielerCollection,
    saisons_collection: SaisonsCollection,
    filters: FLSpielerFilterParams = Depends(),
) -> FLSpielerListResponse:
    """
    List players, normally for one team.

    Omitting `saison_id` does NOT resolve to the current season; callers narrow by `team_id` instead,
    and a season this tier may not read adds no row. BASE TIER: a pupil reads back redacted (`READ-PUPIL-001`).
    """

    # The named case ONLY, because it is the one an id can answer: no row this read serves says
    # which season it came from, so a caller naming none is asking across all of them at once.
    if filters.saison_id is not None:
        # Empty rather than 404, as `GET /spiele` answers it: an id naming no season already lists
        # nothing here, so a refusal would be the one answer confirming a withheld one exists.
        if await saison_is_withheld(saisons_collection=saisons_collection, saison_id=filters.saison_id):
            return FLSpielerListResponse(spieler=[])

    # The other half, and the reason it is a second read: the caller named no season, so the rows
    # have to be narrowed on the whole withheld set. Skipped where one id already answered above.
    withheld = [] if filters.saison_id is not None else await withheld_saison_ids(saisons_collection=saisons_collection)

    pipeline = build_spieler_pipeline(filters=filters, withheld_saison_ids=withheld)
    spieler_raw = await aggregate_many_from_db(collection=spieler_collection, pipeline=pipeline)

    spieler = FLSpielerListAdapter.validate_python(spieler_raw)
    return FLSpielerListResponse(spieler=spieler)


@router.get(by_id("spieler_id"), response_model=FLSpielerSingleResponse, summary="One Spieler")
async def get_spieler_by_id(spieler_id: CustomRouteObjectId, spieler_collection: SpielerCollection) -> FLSpielerSingleResponse:
    """
    Return one player -- an id, a forename and an INITIAL, which is all this surface needs.

    NOT the flattened squad shape the list returns: those are season-scoped, and picking a season
    here would make the answer depend on a default nobody asked for.
    """

    spieler_raw = await pull_one_from_db(collection=spieler_collection, db_filter={"_id": spieler_id})

    # Redacted HERE and whole on the admin echo: the list publishes every pupil's id, so a surname
    # left standing on this path would be one dereference away from public.
    return FLSpielerSingleResponse(
        spieler_id=spieler_raw["_id"],
        vorname=spieler_raw["vorname"],
        nachname=public_initial(spieler_raw.get("nachname")),
    )
