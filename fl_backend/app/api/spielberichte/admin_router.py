from fastapi import APIRouter, Depends

from app.api.berechtigungen.guard import verify_actor_is_admin
from app.api.saisons.crud import pull_active_saison_id
from app.api.spielberichte.crud import pull_zustaende
from app.api.spielberichte.schemas import FLSpielberichteSaisonResponse
from app.core.config import API_VERSION
from app.core.dependencies import SaisonsCollection, SpielberichteCollection
from app.core.security import bind_actor, verify_access_admin

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spielberichte",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)


@router.get(
    "",
    response_model=FLSpielberichteSaisonResponse,
    summary="Every report of a season and the state it reads in",
)
async def get_spielberichte(
    spielberichte_collection: SpielberichteCollection,
    saisons_collection: SaisonsCollection,
    saison_id: str | None = None,
) -> FLSpielberichteSaisonResponse:
    """
    Every report of one season holding a block, each with its state against its fixture and what it proposes.

    What the season editor counts before an undraw or a replace, which a submitted report refuses
    (`spielplan_berichte_submitted`). Scoped to `saison_id`, the active season when none is named, which answers 404 while no
    season is active.
    """

    # Resolved as every other admin read resolves an omitted season: the season selector sends none for the running one.
    if saison_id is None:
        saison_id = await pull_active_saison_id(saisons_collection=saisons_collection)

    return FLSpielberichteSaisonResponse(
        spielberichte=await pull_zustaende(spielberichte_collection=spielberichte_collection, saison_id=saison_id)
    )
