from fastapi import APIRouter

from app.api.aufstellungen.schemas import FLAufstellungPayload, FLAufstellungResponse
from app.api.aufstellungen.screen import AufstellungReads, SeatHolder, SeatSaver, read_aufstellung_screen, save_aufstellung_screen
from app.api.identity.lookup import SubjectLookup
from app.core.dependencies import (
    AufstellungenCollection,
    AufstellungenReadCollection,
    DBClient,
    GermanyNow,
    SaisonsCollection,
    SaisonSpielerCollection,
    SaisonSpielerReadCollection,
    SaisonTeamsCollection,
    SnapshotSession,
    SpieleCollection,
    SpielerCollection,
    SpieleReadCollection,
    SpielerReadCollection,
)
from app.core.routing import by_id
from app.core.security import PERSON_TIER, PersonIdentifier
from app.shared.schemas.custom import CustomObjectId
from app.shared.schemas.responses import FLVersionResponse

router = APIRouter(
    prefix="/aufstellungen",
    dependencies=PERSON_TIER,
)

SELF_PATH = f"/spiele{by_id('spiel_id')}/teams{by_id('team_id')}"


@router.get(SELF_PATH, summary="One club's line-up for one fixture as its seat holder reads it")
async def get_aufstellung_self(
    spiel_id: CustomObjectId,
    team_id: CustomObjectId,
    identifier: PersonIdentifier,
    spiele_collection: SpieleReadCollection,
    saison_spieler_collection: SaisonSpielerReadCollection,
    spieler_collection: SpielerReadCollection,
    aufstellungen_collection: AufstellungenReadCollection,
    records: SubjectLookup,
    session: SnapshotSession,
    germany_now: GermanyNow,
) -> FLAufstellungResponse:
    """The line-up screen of one club for one fixture, for a person holding any contact seat on that club in the fixture's season.

    A finished season grants no seat, so its line-ups are an administrator's to read.
    """

    return await read_aufstellung_screen(
        seat=SeatHolder(identifier=identifier, records=records),
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
    SELF_PATH,
    summary="Save one club's line-up for one fixture as its seat holder",
)
async def put_aufstellung_self(
    spiel_id: CustomObjectId,
    team_id: CustomObjectId,
    aufstellung_data: FLAufstellungPayload,
    identifier: PersonIdentifier,
    spiele_collection: SpieleCollection,
    saisons_collection: SaisonsCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    spieler_collection: SpielerCollection,
    aufstellungen_collection: AufstellungenCollection,
    saison_teams_collection: SaisonTeamsCollection,
    records: SubjectLookup,
    db: DBClient,
    germany_now: GermanyNow,
) -> FLVersionResponse:
    """Save the whole line-up of one club for one fixture, as any contact seat of the club may until one hour before kick-off.

    A line-up being due or overdue refuses nothing, and `version` is the document's as the screen was served it, null
    where the screen showed no line-up.
    """

    return await save_aufstellung_screen(
        seat=SeatSaver(identifier=identifier, records=records, saison_teams=saison_teams_collection),
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
        spiele_collection=spiele_collection,
        saison_spieler_collection=saison_spieler_collection,
        db=db,
        now=germany_now,
    )
