from http import HTTPStatus

from fastapi import APIRouter, Response

from app.api.aufstellungen.schemas import FLAufstellungPayload, FLAufstellungResponse
from app.api.aufstellungen.screen import AufstellungReads, read_aufstellung_screen, save_aufstellung_screen
from app.api.grants.guard import ADMIN_TIER
from app.core.dependencies import (
    AufstellungenCollection,
    AufstellungenReadCollection,
    DBClient,
    GermanyNow,
    SaisonsCollection,
    SaisonSpielerReadCollection,
    SnapshotSession,
    SpielerCollection,
    SpieleReadCollection,
    SpielerReadCollection,
)
from app.core.routing import by_id
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix="/aufstellungen",
    dependencies=ADMIN_TIER,
)

AUFSTELLUNG_PATH = f"{by_id('spiel_id')}{by_id('team_id')}"


@router.get(AUFSTELLUNG_PATH, summary="One club's line-up for one fixture as an administrator reads it")
async def get_aufstellung(
    spiel_id: CustomRouteObjectId,
    team_id: CustomRouteObjectId,
    spiele_collection: SpieleReadCollection,
    saison_spieler_collection: SaisonSpielerReadCollection,
    spieler_collection: SpielerReadCollection,
    aufstellungen_collection: AufstellungenReadCollection,
    session: SnapshotSession,
    germany_now: GermanyNow,
) -> FLAufstellungResponse:
    """The line-up screen of one club for one fixture, as the club's own seat holders read it."""

    return await read_aufstellung_screen(
        seat=None,
        spiel_id=spiel_id,
        team_id=team_id,
        reads=AufstellungReads(
            spiele=spiele_collection,
            saison_spieler=saison_spieler_collection,
            spieler=spieler_collection,
            aufstellungen=aufstellungen_collection,
        ),
        now=germany_now,
        session=session,
    )


@router.put(
    AUFSTELLUNG_PATH,
    summary="Save one club's line-up for one fixture as an administrator",
    responses={201: {"model": FLAufstellungResponse, "description": "The line-up did not stand before, and this save created it"}},
)
async def put_aufstellung(
    spiel_id: CustomRouteObjectId,
    team_id: CustomRouteObjectId,
    aufstellung_data: FLAufstellungPayload,
    response: Response,
    spiele_collection: SpieleReadCollection,
    saisons_collection: SaisonsCollection,
    saison_spieler_collection: SaisonSpielerReadCollection,
    spieler_collection: SpielerCollection,
    aufstellungen_collection: AufstellungenCollection,
    db: DBClient,
    germany_now: GermanyNow,
) -> FLAufstellungResponse:
    """Save the whole line-up of one club for one fixture at any time, the hour before kick-off included.

    An entry naming nobody stands for a pupil erased after the match was played, and a save keeps it by sending it back.
    """

    answer, created = await save_aufstellung_screen(
        seat=None,
        spiel_id=spiel_id,
        team_id=team_id,
        payload=aufstellung_data,
        reads=AufstellungReads(
            spiele=spiele_collection,
            saison_spieler=saison_spieler_collection,
            spieler=spieler_collection,
            aufstellungen=aufstellungen_collection,
        ),
        aufstellungen_collection=aufstellungen_collection,
        saisons_collection=saisons_collection,
        spieler_collection=spieler_collection,
        db=db,
        now=germany_now,
    )

    # RFC 9110's PUT: a save creating the line-up says so.
    if created:
        response.status_code = HTTPStatus.CREATED

    return answer
