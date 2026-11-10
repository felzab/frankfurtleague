from datetime import datetime
from http import HTTPStatus
from typing import Annotated

from fastapi import APIRouter, Body, Depends, Response

from app.api.aufstellungen.schemas import FLAufstellungPayload, FLAufstellungResponse
from app.api.aufstellungen.screen import AufstellungReads, read_aufstellung_screen, save_aufstellung_screen
from app.api.grants.guard import verify_actor_is_admin
from app.core.config import API_VERSION
from app.core.dependencies import (
    AufstellungenCollection,
    AufstellungenReadCollection,
    DBClient,
    SaisonsCollection,
    SaisonSpielerReadCollection,
    SnapshotSession,
    SpielerCollection,
    SpieleReadCollection,
    SpielerReadCollection,
    get_germany_now,
)
from app.core.routing import by_id
from app.core.security import bind_actor, verify_access_admin
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/aufstellungen",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)

AUFSTELLUNG_PATH = f"{by_id('spiel_id')}{by_id('team_id')}"


@router.get(AUFSTELLUNG_PATH, response_model=FLAufstellungResponse, summary="One club's line-up for one fixture as an administrator reads it")
async def get_aufstellung(
    spiel_id: CustomRouteObjectId,
    team_id: CustomRouteObjectId,
    spiele_collection: SpieleReadCollection,
    saison_spieler_collection: SaisonSpielerReadCollection,
    spieler_collection: SpielerReadCollection,
    aufstellungen_collection: AufstellungenReadCollection,
    session: SnapshotSession,
    now: datetime = Depends(get_germany_now),
) -> FLAufstellungResponse:
    """
    The line-up screen of one club for one fixture, as the club's own seat holders read it.

    With the season's status, so a finished season's line-up opens read-only. `document_not_found` for a fixture that
    does not exist or does not field this club.
    """

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
        now=now,
        session=session,
    )


@router.put(
    AUFSTELLUNG_PATH,
    response_model=FLAufstellungResponse,
    summary="Save one club's line-up for one fixture as an administrator",
    responses={201: {"model": FLAufstellungResponse, "description": "The line-up did not stand before, and this save created it"}},
)
async def put_aufstellung(
    spiel_id: CustomRouteObjectId,
    team_id: CustomRouteObjectId,
    aufstellung_data: Annotated[FLAufstellungPayload, Body()],
    response: Response,
    spiele_collection: SpieleReadCollection,
    saisons_collection: SaisonsCollection,
    saison_spieler_collection: SaisonSpielerReadCollection,
    spieler_collection: SpielerCollection,
    aufstellungen_collection: AufstellungenCollection,
    db: DBClient,
    now: datetime = Depends(get_germany_now),
) -> FLAufstellungResponse:
    """
    Save the whole line-up of one club for one fixture, at any time on a fixture holding a day and an hour.

    The document a seat holder's save writes, on the same payload, so the lock never reaches this save
    (`aufstellung_locked` is the seat's alone) and a save between the two is refused as any stale one is. Recorded as
    `aufstellung.saved`.

    Refuses, in this order, each writing nothing: a fixture that does not exist or does not field this club
    (`document_not_found`); a fixture of a finished season, whose line-up is read-only (`saison_past`); a fixture
    holding no day or no hour (`aufstellung_spiel_undated`); a `version` other than
    the document's now, or than null where none stands (`version_stale`); a pupil newly named whom the club's live
    squad of the season does not hold (`spieler_not_in_kader`, on each such entry's `spieler_id`); and a nominee past
    the shortage (`aufstellung_nominee_without_shortage`). The payload's own rules refuse as they do a seat's save,
    and every refusal but `version_stale` is asked again outside the transaction just before answering.
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
        now=now,
    )

    # RFC 9110's PUT: a save creating the line-up says so.
    if created:
        response.status_code = HTTPStatus.CREATED

    return answer
