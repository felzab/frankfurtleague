from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, Query
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.berechtigungen.guard import verify_actor_is_admin
from app.api.saisons.crud import pull_active_saison_id
from app.api.spielberichte.crud import (
    anchor_the_pupils_named,
    anchor_the_season_reported_in,
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
    SpielberichteCollection,
    SpieleCollection,
    SpielerCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.routing import by_id
from app.core.security import bind_actor, verify_access_admin, verify_step_up
from app.core.transactions import transaction_session
from app.shared.schemas.actor import FLVonAdmin
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spielberichte",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)


def _admin_ansicht(
    lage: BerichtLage, *, kader_offen: bool, named: Sequence[FLSpielberichtSpieler], dokument: Mapping[str, Any] | None
) -> FLSpielberichtAdminResponse:
    ansicht = compose_ansicht(lage, kader_offen=kader_offen, named=named, dokument=dokument)
    bericht = ansicht["bericht"]
    zustand = None if bericht is None else bericht_zustand_of(FLSpielberichtBericht.model_validate(bericht), lage.spiel)

    return FLSpielberichtAdminResponse.model_validate({**ansicht, "state": zustand})


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
    kader: Annotated[bool, Query(description="Serve both clubs' live squads of the season, for a form picking from them")] = False,
) -> FLSpielberichtAdminResponse:
    """
    One fixture's report as the editor's panel reads it, whole, with the state it reads in.

    Beside it the fixture and the pupils the report names, by name. Both clubs' live squads of the season only with
    `kader`, which the correction's form picks from: the panel reads no pupil the report does not name, so a fixture
    holding no report serves none. The report and its state are null where no report stands; `document_not_found` only for
    a fixture that does not exist.
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
        genannt = await pull_genannt(
            spieler_collection=spieler_collection,
            lage=lage,
            kader_offen=kader,
            bericht=None if dokument is None else dokument.get("bericht"),
            session=session,
        )

    return _admin_ansicht(lage, kader_offen=kader, named=genannt, dokument=dokument)


@router.patch(
    by_id("spiel_id"),
    response_model=FLSpielberichtAdminResponse,
    summary="Write one fixture's report as an administrator",
    # It overwrites the referee's account of the match, and nothing undoes it.
    dependencies=[Depends(verify_step_up)],
)
async def patch_spielbericht(
    spiel_id: CustomRouteObjectId,
    bericht_data: Annotated[FLSpielberichtPayload, Body()],
    spiele_collection: SpieleCollection,
    saisons_collection: SaisonsCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    spieler_collection: SpielerCollection,
    spielberichte_collection: SpielberichteCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    now: datetime = Depends(get_germany_now),
) -> FLSpielberichtAdminResponse:
    """
    Write the whole report of one fixture as an administrator, replacing what stood, as the referee's own write does.

    Every write changing it raises its `version`, so a report adopted before reads `differing` until it is adopted
    again, and a write changing nothing writes nothing. Who first wrote the report stays recorded; a report an
    administrator writes first records an administrator, naming nobody.

    `bericht_stand` is the `version` of the report the page was served, null where none stood, as on the referee's
    write.

    Refuses, in this order, each writing nothing: a fixture that does not exist (`document_not_found`); a `bericht_stand`
    other than the version standing now, or than none where none stands (`bericht_meanwhile_changed`); one undated or whose day is
    still to come (`bericht_not_played`); one called off or struck out (`bericht_abgesagt`); a shoot-out proposed on a
    group-phase fixture (`bericht_elfmeter_in_the_gruppe`); a pupil newly named on a side outside that side's live squad of the season
    (`bericht_not_in_kader`); and a yellow or second yellow card naming no reason, unless the stored report holds that card,
    by side, pupil and colour, stripped of its reason at the end of the season after the match (`bericht_grund_missing`). Each
    but `bericht_meanwhile_changed` is asked again outside the transaction just before answering; a write of the report landing
    mid-press conflicts with this one, whose retry meets `bericht_meanwhile_changed`. Two first writes at once are two pages
    opened on no report: the later is refused.
    """

    payload = bericht_data.bericht

    async def write_the_report(session: AsyncClientSession) -> FLSpielberichtAdminResponse:
        """Judge, then write. Everything judged is read in-session, so a retry re-judges it."""

        lage = await pull_bericht_lage(
            spiele_collection=spiele_collection,
            saisons_collection=saisons_collection,
            saison_spieler_collection=saison_spieler_collection,
            spiel_id=spiel_id,
            session=session,
        )
        gespeichert = await spielberichte_collection.find_one({"spiel_id": spiel_id}, session=session)
        block = None if gespeichert is None else gespeichert.get("bericht")
        neu = neu_genannt(payload, block, lage.spiel)
        refuse(find_bericht_stand_refusal(stand=bericht_data.bericht_stand, gespeichert=block))
        judge_bericht(lage=lage, payload=payload, gespeichert=block, neu=neu, today=today)

        await anchor_the_pupils_named(spieler_collection=spieler_collection, spieler_ids=set().union(*neu.values()), session=session)
        von: FLSpielberichtVon = FLVonAdmin(art="admin")
        dokument = await write_bericht(
            spielberichte_collection=spielberichte_collection,
            spiel_raw=lage.spiel,
            gespeichert=gespeichert,
            payload=payload,
            von=von,
            now=now,
            version=bericht_data.version,
            session=session,
        )
        if gespeichert is None:
            # After the insert, so a rival first write meets it there rather than blocking on the season.
            await anchor_the_season_reported_in(saisons_collection=saisons_collection, saison_id=lage.spiel["saison_id"], session=session)
        genannt = await pull_genannt(
            spieler_collection=spieler_collection, lage=lage, kader_offen=True, bericht=dokument.get("bericht"), session=session
        )

        # For the referee's write's reason.
        jetzt = await pull_bericht_lage(
            spiele_collection=spiele_collection,
            saisons_collection=saisons_collection,
            saison_spieler_collection=saison_spieler_collection,
            spiel_id=spiel_id,
            session=None,
        )
        judge_bericht(lage=jetzt, payload=payload, gespeichert=block, neu=neu, today=today)

        # The report as written, in the shape of the panel's read; no client reads it, the page reading again after the save.
        return _admin_ansicht(lage, kader_offen=True, named=genannt, dokument=dokument)

    async with transaction_session(db) as session:
        return await session.with_transaction(write_the_report)
