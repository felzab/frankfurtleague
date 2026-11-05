from collections.abc import Mapping, Sequence
from typing import Any

from fastapi import APIRouter, Depends

from app.api.berechtigungen.guard import verify_actor_is_admin
from app.api.saisons.crud import pull_active_saison_id
from app.api.spielberichte.crud import (
    pull_bericht_lage,
    pull_genannt,
    pull_zustaende,
)
from app.api.spielberichte.schemas import (
    FLSpielberichtAdminResponse,
    FLSpielberichtBericht,
    FLSpielberichteSaisonResponse,
    FLSpielberichtSpieler,
)
from app.api.spielberichte.services import (
    BerichtLage,
    bericht_zustand_of,
    compose_ansicht,
)
from app.core.config import API_VERSION
from app.core.dependencies import (
    DBClient,
    SaisonsCollection,
    SaisonSpielerCollection,
    SpielberichteCollection,
    SpieleCollection,
    SpielerCollection,
)
from app.core.routing import by_id
from app.core.security import bind_actor, verify_access_admin
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spielberichte",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)


def _admin_ansicht(
    lage: BerichtLage, *, named: Sequence[FLSpielberichtSpieler], dokument: Mapping[str, Any] | None
) -> FLSpielberichtAdminResponse:
    view = compose_ansicht(lage, kader_offen=False, named=named, dokument=dokument)
    bericht = view["bericht"]
    state = None if bericht is None else bericht_zustand_of(FLSpielberichtBericht.model_validate(bericht), lage.spiel)

    return FLSpielberichtAdminResponse.model_validate({**view, "state": state})


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


@router.get(
    f"{by_id('spiel_id')}/verwaltung",
    response_model=FLSpielberichtAdminResponse,
    summary="One fixture's report, whole, for an administrator",
)
async def get_spielbericht_verwaltung(
    spiel_id: CustomRouteObjectId,
    spiele_collection: SpieleCollection,
    saisons_collection: SaisonsCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    spieler_collection: SpielerCollection,
    spielberichte_collection: SpielberichteCollection,
    db: DBClient,
) -> FLSpielberichtAdminResponse:
    """
    One fixture's report as the editor's panel reads it, whole, with the state it reads in.

    Beside it the fixture and the pupils the report names, by name. The panel picks no pupil, so it reads no squad and
    no pupil the report does not name: a fixture holding no report serves none. The report and its state are null where
    no report stands; `document_not_found` only for a fixture that does not exist.
    """

    async with db.start_session(snapshot=True) as session:
        lage = await pull_bericht_lage(
            spiele_collection=spiele_collection,
            saisons_collection=saisons_collection,
            saison_spieler_collection=saison_spieler_collection,
            spiel_id=spiel_id,
            session=session,
        )
        dokument = await spielberichte_collection.find_one({"spiel_id": spiel_id}, session=session)
        named = await pull_genannt(
            spieler_collection=spieler_collection,
            lage=lage,
            kader_offen=False,
            bericht=None if dokument is None else dokument.get("bericht"),
            session=session,
        )

    return _admin_ansicht(lage, named=named, dokument=dokument)
