from datetime import datetime
from http import HTTPStatus
from typing import Annotated

from fastapi import APIRouter, Body, Depends, Response
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.account.services import find_own_entry_refusal
from app.api.identity.crud import roles_of
from app.api.identity.lookup import SubjectLookup
from app.api.spielberichte.crud import (
    anchor_the_pupils_named,
    anchor_the_season_reported_in,
    pull_bericht_context,
    pull_named,
    write_bericht,
)
from app.api.spielberichte.schemas import (
    FLSpielberichtPayload,
    FLSpielberichtSchiedsrichterResponse,
)
from app.api.spielberichte.services import (
    compose_view,
    find_not_refereed_refusal,
    find_saison_ended_refusal,
    is_concluded,
    judge_bericht,
    kader_is_open,
    newly_named,
)
from app.api.spiele.services import spiel_label
from app.core.config import API_VERSION
from app.core.crud import find_stale_first_save_refusal, refuse
from app.core.dependencies import (
    DBClient,
    SaisonsCollection,
    SaisonSpielerCollection,
    SaisonSpielerReadCollection,
    SaisonsReadCollection,
    SpielberichteCollection,
    SpielberichteReadCollection,
    SpieleCollection,
    SpielerCollection,
    SpieleReadCollection,
    SpielerReadCollection,
    get_germany_now,
)
from app.core.recording import ACT_BY_SCHIEDSRICHTER, record_act
from app.core.routing import by_id
from app.core.security import PersonIdentifier, get_person_identifier, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.schemas.custom import CustomRouteObjectId

# The referee's own router: the person's identifier is bound at router level, and each handler judges their referee
# records in its own session.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spielberichte",
    dependencies=[Depends(verify_access_admin), Depends(get_person_identifier)],
)

BERICHT_PATH = f"{by_id('spiel_id')}/bericht"


@router.get(
    BERICHT_PATH,
    response_model=FLSpielberichtSchiedsrichterResponse,
    summary="One fixture's report as its referee reads it",
)
async def get_spielbericht_bericht(
    spiel_id: CustomRouteObjectId,
    identifier: PersonIdentifier,
    spiele_collection: SpieleReadCollection,
    saisons_collection: SaisonsReadCollection,
    saison_spieler_collection: SaisonSpielerReadCollection,
    spieler_collection: SpielerReadCollection,
    spielberichte_collection: SpielberichteReadCollection,
    records: SubjectLookup,
    db: DBClient,
    now: datetime = Depends(get_germany_now),
) -> FLSpielberichtSchiedsrichterResponse:
    """What the booked referee's report form reads: the fixture, both clubs' live squads, and the stored report or null.

    Where `reportable` is false or `completed` true, both squads are empty and every pupil the report names is in `named`.
    """

    async with db.start_session(snapshot=True) as session:
        subject = await roles_of(identifier, records, session=session)
        refuse(find_own_entry_refusal(held=bool(subject.schiedsrichter)))

        context = await pull_bericht_context(
            spiele_collection=spiele_collection,
            saisons_collection=saisons_collection,
            saison_spieler_collection=saison_spieler_collection,
            spiel_id=spiel_id,
            session=session,
        )
        refuse(
            find_not_refereed_refusal(
                spiel_raw=context.spiel, schiedsrichter_ids=[record.schiedsrichter_id for record in subject.schiedsrichter]
            )
        )

        # After the season, the referee's page is a view of the report: no squad to pick from, no write.
        completed = is_concluded(context)
        kader_open = kader_is_open(context, now=now)
        document = await spielberichte_collection.find_one({"spiel_id": spiel_id}, session=session)
        named = await pull_named(
            spieler_collection=spieler_collection,
            context=context,
            kader_open=kader_open,
            bericht=None if document is None else document["bericht"],
            session=session,
        )

    return FLSpielberichtSchiedsrichterResponse.model_validate(
        {**compose_view(context, kader_open=kader_open, named=named, document=document), "completed": completed, "reportable": kader_open}
    )


@router.put(
    BERICHT_PATH,
    response_model=FLSpielberichtSchiedsrichterResponse,
    summary="Write one fixture's report as its referee",
    responses={
        201: {"model": FLSpielberichtSchiedsrichterResponse, "description": "The report did not stand before, and this write created it"},
    },
)
async def put_spielbericht_bericht(
    spiel_id: CustomRouteObjectId,
    bericht_data: Annotated[FLSpielberichtPayload, Body()],
    response: Response,
    identifier: PersonIdentifier,
    spiele_collection: SpieleCollection,
    saisons_collection: SaisonsCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    spieler_collection: SpielerCollection,
    spielberichte_collection: SpielberichteCollection,
    records: SubjectLookup,
    db: DBClient,
    now: datetime = Depends(get_germany_now),
) -> FLSpielberichtSchiedsrichterResponse:
    """Write the whole report of one fixture as its booked referee, replacing what stood, and never the fixture's result.

    A write changing the report clears its adoption, and `version` is the report document's as the form was served it,
    null where the form showed no report.
    """

    payload = bericht_data.bericht

    async def write_the_report(session: AsyncClientSession) -> tuple[FLSpielberichtSchiedsrichterResponse, bool]:
        """Judge, then write. Everything judged is read in-session, so a retry re-judges it."""

        subject = await roles_of(identifier, records, session=session)
        refuse(find_own_entry_refusal(held=bool(subject.schiedsrichter)))
        own = [record.schiedsrichter_id for record in subject.schiedsrichter]

        context = await pull_bericht_context(
            spiele_collection=spiele_collection,
            saisons_collection=saisons_collection,
            saison_spieler_collection=saison_spieler_collection,
            spiel_id=spiel_id,
            session=session,
        )
        saved = await spielberichte_collection.find_one({"spiel_id": spiel_id}, session=session)
        new = newly_named(payload, None if saved is None else saved["bericht"], context.spiel)
        refuse(find_not_refereed_refusal(spiel_raw=context.spiel, schiedsrichter_ids=own))
        refuse(find_saison_ended_refusal(context))
        refuse(find_stale_first_save_refusal(saved, version=bericht_data.version))
        judge_bericht(context=context, payload=payload, new=new, now=now)

        await anchor_the_pupils_named(spieler_collection=spieler_collection, spieler_ids=set().union(*new.values()), session=session)
        document = await write_bericht(
            spielberichte_collection=spielberichte_collection,
            spiel_raw=context.spiel,
            saved=saved,
            payload=payload,
            now=now,
            version=bericht_data.version,
            session=session,
        )
        # `write_bericht` answers `saved` itself where the block already says what the payload says, which writes nothing.
        if document is not saved:
            await record_act(
                collection=spielberichte_collection,
                action="spielbericht.saved",
                by=ACT_BY_SCHIEDSRICHTER,
                record_id=document["_id"],
                label=spiel_label(context.spiel["saison_id"], context.spiel["spiel_nr"]),
                session=session,
            )
            # On every write, after the report's own, so a rival first write meets it there rather than on the season. The
            # judgement of the season's status, asked again outside the transaction, leaves a gap before the commit that
            # the activation ending the season, which writes its row, then meets here.
            await anchor_the_season_reported_in(saisons_collection=saisons_collection, saison_id=context.spiel["saison_id"], session=session)
        named = await pull_named(
            spieler_collection=spieler_collection, context=context, kader_open=True, bericht=document["bericht"], session=session
        )

        # Nothing judged is written here, so a referee retired or taken off, a fixture re-dated or called off, a pupil
        # ausgetragen or a seat holder renamed conflicts with nothing: judged again outside the transaction.
        async with db.start_session(snapshot=True) as outside:
            subject_now = await roles_of(identifier, records, session=outside)
        refuse(find_own_entry_refusal(held=bool(subject_now.schiedsrichter)))
        current = await pull_bericht_context(
            spiele_collection=spiele_collection,
            saisons_collection=saisons_collection,
            saison_spieler_collection=saison_spieler_collection,
            spiel_id=spiel_id,
            session=None,
        )
        refuse(
            find_not_refereed_refusal(
                spiel_raw=current.spiel, schiedsrichter_ids=[record.schiedsrichter_id for record in subject_now.schiedsrichter]
            )
        )
        refuse(find_saison_ended_refusal(current))
        judge_bericht(context=current, payload=payload, new=new, now=now)

        created = saved is None
        view = {**compose_view(context, kader_open=True, named=named, document=document), "completed": False, "reportable": True}

        return FLSpielberichtSchiedsrichterResponse.model_validate(view), created

    async with transaction_session(db) as session:
        answer, created = await session.with_transaction(write_the_report)

    # RFC 9110's PUT: a write creating the report says so.
    if created:
        response.status_code = HTTPStatus.CREATED

    return answer
