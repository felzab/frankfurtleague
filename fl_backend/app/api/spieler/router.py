from fastapi import APIRouter, Depends

from app.api.spieler.schemas import (
    FLSpielerFilterParams,
    FLSpielerListAdapter,
    FLSpielerListResponse,
    FLSpielerSingleResponse,
)
from app.api.spieler.services import build_spieler_pipeline
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db, pull_one_from_db
from app.core.dependencies import SpielerCollection
from app.core.routing import by_id
from app.core.security import verify_access_base
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spieler",
    dependencies=[Depends(verify_access_base)],
)


@router.get("", response_model=FLSpielerListResponse, summary="List Spieler")
async def get_spieler(spieler_collection: SpielerCollection, filters: FLSpielerFilterParams = Depends()) -> FLSpielerListResponse:
    """
    List players, normally for one team.

    Unlike the other resources, omitting `saison_id` does NOT resolve to the current season here --
    callers narrow by `team_id` instead. Only `vorname` is guaranteed present on a player.
    """

    pipeline = build_spieler_pipeline(filters=filters)
    spieler_raw = await aggregate_many_from_db(collection=spieler_collection, pipeline=pipeline)

    spieler = FLSpielerListAdapter.validate_python(spieler_raw)
    return FLSpielerListResponse(spieler=spieler)


@router.get(by_id("spieler_id"), response_model=FLSpielerSingleResponse, summary="One Spieler")
async def get_spieler_by_id(spieler_id: CustomRouteObjectId, spieler_collection: SpielerCollection) -> FLSpielerSingleResponse:
    """
    Return one player -- the person only.

    NOT the flattened squad shape the list returns: those fields are season-scoped, and picking a
    season here would make the answer depend on a default the caller never asked for.
    """

    spieler_raw = await pull_one_from_db(collection=spieler_collection, db_filter={"_id": spieler_id})

    return FLSpielerSingleResponse(
        spieler_id=spieler_raw["_id"],
        vorname=spieler_raw["vorname"],
        nachname=spieler_raw.get("nachname"),
        inactive_since=spieler_raw.get("inactive_since"),
    )
