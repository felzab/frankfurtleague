from fastapi import APIRouter, Depends

from app.api.saisons.visibility import resolve_public_saison
from app.api.spiele.schemas import FLSpieleSingleResponse, FLSpielJoined
from app.api.spiele.services import build_spiele_pipeline
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db
from app.core.dependencies import SaisonsCollection, SpieleCollection
from app.core.exceptions import DocumentNotFoundError
from app.core.routing import by_id
from app.core.security import verify_access_base
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spiele",
    dependencies=[Depends(verify_access_base)],
)


@router.get(by_id("spiel_id"), response_model=FLSpieleSingleResponse, summary="One Spiel")
async def get_spiel(
    spiel_id: CustomRouteObjectId,
    spiele_collection: SpieleCollection,
    saisons_collection: SaisonsCollection,
) -> FLSpieleSingleResponse:
    """Return one match by its id, answering 404 for a match of a season this tier may not read."""

    # The 404 is raised here because an aggregation returning nothing is an empty list, not `None`.
    spiele_raw = await aggregate_many_from_db(
        collection=spiele_collection,
        pipeline=build_spiele_pipeline(db_filter={"_id": spiel_id}),
        limit=1,
    )
    if not spiele_raw:
        raise DocumentNotFoundError()

    # The fixture's OWN season, after the read: a match of a season being drawn up then misses for
    # the same reason an id naming no match does.
    await resolve_public_saison(saisons_collection=saisons_collection, saison_id=str(spiele_raw[0]["saison_id"]))

    return FLSpieleSingleResponse(spiel=FLSpielJoined.model_validate(spiele_raw[0]))
