from fastapi import APIRouter, Depends

from app.api.saisons.visibility import resolve_public_saison
from app.api.spieltage.schemas import FLSpieltag, FLSpieltageSingleResponse
from app.api.spieltage.services import with_expected_matches
from app.core.config import API_VERSION
from app.core.crud import pull_one_from_db
from app.core.dependencies import SaisonsCollection, SpieltageCollection
from app.core.routing import by_id
from app.core.security import verify_access_base
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spieltage",
    dependencies=[Depends(verify_access_base)],
)


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
