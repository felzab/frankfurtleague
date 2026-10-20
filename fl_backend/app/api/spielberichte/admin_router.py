from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.saisons.crud import pull_current_saison_id
from app.api.spielberichte.crud import (
    anchor_the_pupils_named,
    pull_bericht_lage,
    pull_genannt,
    pull_zustaende,
    write_bericht,
)
from app.api.spielberichte.schemas import (
    FLSpielberichtAdminResponse,
    FLSpielberichtBericht,
    FLSpielberichteSaisonResponse,
    FLSpielberichtPayload,
    FLSpielberichtSpieler,
    FLSpielberichtVon,
    FLSpielberichtVonAdmin,
)
from app.api.spielberichte.services import (
    BerichtLage,
    bericht_zustand_of,
    compose_ansicht,
    find_bericht_stand_refusal,
    judge_bericht,
    neu_genannt,
)
from app.core.config import API_VERSION
from app.core.crud import refuse
from app.core.dependencies import (
    DBClient,
    SaisonsCollection,
    SaisonSpielerCollection,
    SaisonTeamsCollection,
    SpielberichteCollection,
    SpieleCollection,
    SpielerCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.exception_handlers import DOCUMENT_NOT_FOUND_RESPONSE, DUPLICATE_KEY_RESPONSE
from app.core.routing import by_id
from app.core.security import bind_actor, verify_access_admin, verify_actor_is_admin, verify_step_up
from app.core.transactions import transaction_session
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spielberichte",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)


def _admin_ansicht(
    lage: BerichtLage, *, genannt: Sequence[FLSpielberichtSpieler], dokument: Mapping[str, Any] | None
) -> FLSpielberichtAdminResponse:
    ansicht = compose_ansicht(lage, kader_offen=True, genannt=genannt, dokument=dokument)
    bericht = ansicht["bericht"]
    zustand = None if bericht is None else bericht_zustand_of(FLSpielberichtBericht.model_validate(bericht), lage.spiel)

    return FLSpielberichtAdminResponse.model_validate({**ansicht, "zustand": zustand})


@router.get(
    "",
    response_model=FLSpielberichteSaisonResponse,
    summary="Every report of a season and the state it reads in",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
)
async def get_spielberichte(
    spielberichte_collection: SpielberichteCollection,
    saisons_collection: SaisonsCollection,
    saison_id: str | None = None,
) -> FLSpielberichteSaisonResponse:
    """
    Every report of one season holding a block, each with its state against its fixture and what it proposes.

    For the triage. Scoped to `saison_id`, the active season when none is named, which answers 404 while no season is
    active.
    """

    # Resolved as the triage's own fixture read resolves it, so the two answer about one season.
    if saison_id is None:
        saison_id = await pull_current_saison_id(saisons_collection=saisons_collection)

    return FLSpielberichteSaisonResponse(
        spielberichte=await pull_zustaende(spielberichte_collection=spielberichte_collection, saison_id=saison_id)
    )


@router.get(
    f"{by_id('spiel_id')}/admin",
    response_model=FLSpielberichtAdminResponse,
    summary="One fixture's report, whole, for an administrator",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
)
async def get_spielbericht_admin(
    spiel_id: CustomRouteObjectId,
    spiele_collection: SpieleCollection,
    saisons_collection: SaisonsCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    saison_teams_collection: SaisonTeamsCollection,
    spieler_collection: SpielerCollection,
    spielberichte_collection: SpielberichteCollection,
    db: DBClient,
) -> FLSpielberichtAdminResponse:
    """
    One fixture's report as the editor's panel reads it, whole, with the state it reads in.

    Beside it the fixture, both clubs' live squads of the season and the pupils the report names outside them. The
    report and its state are null where no report stands; `DB-COMMON-001` only for a fixture that does not exist.
    """

    async with db.start_session(snapshot=True) as session:
        lage = await pull_bericht_lage(
            spiele_collection=spiele_collection,
            saisons_collection=saisons_collection,
            saison_spieler_collection=saison_spieler_collection,
            saison_teams_collection=saison_teams_collection,
            spiel_id=spiel_id,
            session=session,
        )
        dokument = await spielberichte_collection.find_one({"spiel_id": spiel_id}, session=session)
        genannt = await pull_genannt(
            spieler_collection=spieler_collection,
            lage=lage,
            kader_offen=True,
            bericht=None if dokument is None else dokument.get("bericht"),
            session=session,
        )

    return _admin_ansicht(lage, genannt=genannt, dokument=dokument)


@router.patch(
    by_id("spiel_id"),
    response_model=FLSpielberichtAdminResponse,
    summary="Write one fixture's report as an administrator",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE, 409: DUPLICATE_KEY_RESPONSE},
    # It overwrites the referee's account of the match, and nothing undoes it.
    dependencies=[Depends(verify_step_up)],
)
async def patch_spielbericht(
    spiel_id: CustomRouteObjectId,
    bericht_data: Annotated[FLSpielberichtPayload, Body()],
    spiele_collection: SpieleCollection,
    saisons_collection: SaisonsCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    saison_teams_collection: SaisonTeamsCollection,
    spieler_collection: SpielerCollection,
    spielberichte_collection: SpielberichteCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    now: datetime = Depends(get_germany_now),
) -> FLSpielberichtAdminResponse:
    """
    Write the whole report of one fixture as an administrator, replacing what stood, as the referee's own write does.

    Every write changing it raises its `version`, so a report adopted before reads `abweichend` until it is adopted
    again, and a write changing nothing writes nothing. Who first wrote the report stays recorded; a report an
    administrator writes first records an administrator, naming nobody.

    `bericht_stand` is the `version` of the report the page was served, null where none stood, as on the referee's
    write.

    Refuses, in this order, each writing nothing: a fixture that does not exist (`DB-COMMON-001`); a `bericht_stand`
    other than the version standing now, or than none where none stands (`REQ-BERICHT-006`); one undated or whose day is
    still to come (`REQ-BERICHT-001`); one called off or struck out (`REQ-BERICHT-004`); a pupil newly named on a side
    outside that side's live squad of the season (`REQ-BERICHT-003`); a yellow or second yellow card naming no reason,
    unless the stored report holds that card, by side, pupil and colour, stripped of its reason at the season's end
    (`REQ-BERICHT-008`); and remarks naming a seat holder of either club, the booked referee or a pupil of either squad
    (`REQ-BERICHT-005`), last. Each but `REQ-BERICHT-006` is asked again outside the transaction just before answering;
    a write of the report landing mid-press conflicts with this one, whose retry meets `REQ-BERICHT-006`. Two first
    writes at once are two pages opened on no report: the later is refused.
    """

    payload = bericht_data.bericht

    async def write_the_report(session: AsyncClientSession) -> FLSpielberichtAdminResponse:
        """Judge, then write. Everything judged is read in-session, so a retry re-judges it."""

        lage = await pull_bericht_lage(
            spiele_collection=spiele_collection,
            saisons_collection=saisons_collection,
            saison_spieler_collection=saison_spieler_collection,
            saison_teams_collection=saison_teams_collection,
            spiel_id=spiel_id,
            session=session,
        )
        gespeichert = await spielberichte_collection.find_one({"spiel_id": spiel_id}, session=session)
        block = None if gespeichert is None else gespeichert.get("bericht")
        neu = neu_genannt(payload, block, lage.spiel)
        refuse(find_bericht_stand_refusal(stand=bericht_data.bericht_stand, gespeichert=block))
        judge_bericht(lage=lage, payload=payload, gespeichert=block, neu=neu, today=today)

        await anchor_the_pupils_named(spieler_collection=spieler_collection, spieler_ids=set().union(*neu.values()), session=session)
        von: FLSpielberichtVon = FLSpielberichtVonAdmin(art="admin")
        dokument = await write_bericht(
            spielberichte_collection=spielberichte_collection,
            spiel_raw=lage.spiel,
            gespeichert=gespeichert,
            payload=payload,
            von=von,
            now=now,
            session=session,
        )
        genannt = await pull_genannt(
            spieler_collection=spieler_collection, lage=lage, kader_offen=True, bericht=dokument.get("bericht"), session=session
        )

        # For the referee's write's reason (`docs/backend/spec.md :: I118`).
        jetzt = await pull_bericht_lage(
            spiele_collection=spiele_collection,
            saisons_collection=saisons_collection,
            saison_spieler_collection=saison_spieler_collection,
            saison_teams_collection=saison_teams_collection,
            spiel_id=spiel_id,
            session=None,
        )
        judge_bericht(lage=jetzt, payload=payload, gespeichert=block, neu=neu, today=today)

        return _admin_ansicht(lage, genannt=genannt, dokument=dokument)

    async with transaction_session(db) as session:
        return await session.with_transaction(write_the_report)
