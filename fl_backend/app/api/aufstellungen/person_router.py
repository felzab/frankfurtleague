from datetime import datetime
from http import HTTPStatus
from typing import Annotated

from fastapi import APIRouter, Body, Depends, Response

from app.api.aufstellungen.schemas import FLAufstellungPayload, FLAufstellungResponse
from app.api.aufstellungen.screen import AufstellungReads, SeatHolder, read_aufstellung_screen, save_aufstellung_screen
from app.api.identity.lookup import SubjectLookup
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
from app.core.security import PersonIdentifier, get_person_identifier, verify_access_admin
from app.shared.schemas.custom import CustomRouteObjectId

# The person lane's identifier, as `app/api/spieler/person_router.py` declares it and for its reason.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/aufstellungen",
    dependencies=[Depends(verify_access_admin), Depends(get_person_identifier)],
)

# `/self`, its own segment: the admin router serves the same fixture and club under the bare path, and one path in
# both routers would be answered by whichever was mounted first.
SELF_PATH = f"{by_id('spiel_id')}{by_id('team_id')}/self"


@router.get(SELF_PATH, response_model=FLAufstellungResponse, summary="One club's line-up for one fixture as its seat holder reads it")
async def get_aufstellung_self(
    spiel_id: CustomRouteObjectId,
    team_id: CustomRouteObjectId,
    identifier: PersonIdentifier,
    spiele_collection: SpieleReadCollection,
    saison_spieler_collection: SaisonSpielerReadCollection,
    spieler_collection: SpielerReadCollection,
    aufstellungen_collection: AufstellungenReadCollection,
    records: SubjectLookup,
    session: SnapshotSession,
    now: datetime = Depends(get_germany_now),
) -> FLAufstellungResponse:
    """
    The line-up screen of one club for one fixture, for a person holding any contact seat on that club in the fixture's season.

    The fixture, the club's live squad of the season in shirt-number order, the stored line-up in the order it was
    saved, every pupil it names outside that squad, the document's `version` and the line-up's marks: whether one is
    stored, the phase the clock puts it in, and the instants it is due and locks at. `marks` is null for a fixture
    holding no day or no hour, which takes no line-up.

    Refused `role_not_held` where the signed-in person holds no seat on this club in the fixture's season, and
    `document_not_found` for a fixture that does not exist or does not field this club.
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
        now=now,
        session=session,
    )


@router.put(
    SELF_PATH,
    response_model=FLAufstellungResponse,
    summary="Save one club's line-up for one fixture as its seat holder",
    responses={201: {"model": FLAufstellungResponse, "description": "The line-up did not stand before, and this save created it"}},
)
async def put_aufstellung_self(
    spiel_id: CustomRouteObjectId,
    team_id: CustomRouteObjectId,
    aufstellung_data: Annotated[FLAufstellungPayload, Body()],
    response: Response,
    identifier: PersonIdentifier,
    spiele_collection: SpieleReadCollection,
    saisons_collection: SaisonsCollection,
    saison_spieler_collection: SaisonSpielerReadCollection,
    spieler_collection: SpielerCollection,
    aufstellungen_collection: AufstellungenCollection,
    records: SubjectLookup,
    db: DBClient,
    now: datetime = Depends(get_germany_now),
) -> FLAufstellungResponse:
    """
    Save the whole line-up of one club for one fixture, as any contact seat of the club may until one hour before kick-off.

    The first save creates the document and answers 201. `version` is the document's as the screen was served it, null
    where the screen showed no line-up. An emptied line-up is saved as an empty list. The save is recorded as
    `aufstellung.saved`.

    Refuses, in this order, each writing nothing: no seat on this club in the fixture's season (`role_not_held`); a
    fixture that does not exist or does not field this club (`document_not_found`); a fixture holding no day or no hour
    (`aufstellung_spiel_undated`); a save from one hour before kick-off (`aufstellung_locked`); a `version` other than
    the document's now, or than null where none stands (`version_stale`); a pupil newly named whom the club's live
    squad of the season does not hold (`spieler_not_in_kader`, on each such entry's `spieler_id`); and a nominee named
    beside eleven regular players, or more nominees than the regular players leave open of eleven
    (`aufstellung_nominee_without_shortage`). A pupil named twice (`spieler_named_twice`) and more than eleven starters
    (`starters_exceed_eleven`) are refused as the payload's own rules. A line-up being due or overdue refuses nothing.
    Every refusal but `version_stale` is asked again outside the transaction just before answering, so a seat ended,
    a fixture re-dated or a pupil ausgetragen between the two refuses the save rather than letting it stand.
    """

    answer, created = await save_aufstellung_screen(
        seat=SeatHolder(identifier=identifier, records=records),
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
