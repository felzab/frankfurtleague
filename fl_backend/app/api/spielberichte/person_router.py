from collections.abc import Mapping
from datetime import datetime
from http import HTTPStatus
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, Response
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.account.services import find_own_entry_refusal
from app.api.identity.crud import roles_of
from app.api.identity.lookup import SubjectLookup
from app.api.saisons.crud import pull_governing_saison_id
from app.api.sperrliste.guard import PERSON_ACTOR_BINDERS, SchiedsrichterIdentifier
from app.api.spielberichte.crud import (
    anchor_the_pupils_named,
    anchor_the_season_reported_in,
    pull_bericht_context,
    pull_ended_saison_ids,
    pull_named,
    write_bericht,
)
from app.api.spielberichte.schemas import (
    FLSpielberichtBySchiedsrichter,
    FLSpielberichteSelfResponse,
    FLSpielberichtPayload,
    FLSpielberichtPersonEarlierEntry,
    FLSpielberichtPersonEntry,
    FLSpielberichtSchiedsrichterResponse,
)
from app.api.spielberichte.services import (
    compose_view,
    find_bericht_stand_refusal,
    find_not_refereed_refusal,
    find_saison_ended_refusal,
    is_concluded,
    judge_bericht,
    kader_is_open,
    newly_named,
)
from app.api.spiele.schemas import SONDEREREIGNIS_WITHOUT_A_RESULT
from app.api.spiele.services import build_named_spiele_pipeline
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db, pull_many_from_db, refuse
from app.core.dependencies import (
    DBClient,
    SaisonsCollection,
    SaisonSpielerCollection,
    SpielberichteCollection,
    SpielberichteReadCollection,
    SpieleCollection,
    SpielerCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.routing import by_id
from app.core.security import verify_access_admin
from app.core.transactions import transaction_session
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from app.shared.schemas.custom import CustomRouteObjectId

# The referee's own router, binding the referee's Funktion at router level.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spielberichte",
    dependencies=[Depends(verify_access_admin), Depends(PERSON_ACTOR_BINDERS["schiedsrichter"])],
)

BERICHT_PATH = f"{by_id('spiel_id')}/bericht"

# What the referee's list shows of a fixture, in the order it lists them; the names through the join.
PERSON_EINTRAG_FIELDS = {"date": 1, "time": 1, "team1.name": 1, "team2.name": 1}
SPIELE_NEUESTE_ZUERST = [("date", -1), ("time", -1), ("_id", 1)]


@router.get("/self", response_model=FLSpielberichteSelfResponse, summary="The fixtures a signed-in referee reports on")
async def get_self(
    identifier: SchiedsrichterIdentifier,
    spiele_collection: SpieleCollection,
    saisons_collection: SaisonsCollection,
    spielberichte_collection: SpielberichteReadCollection,
    records: SubjectLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLSpielberichteSelfResponse:
    """
    The `active` season's fixtures booked to the signed-in referee whose day has come, newest first.

    Booked to any confirmed, live referee record of the address, each with when its report was first sent, null where
    none stands. A fixture called off or struck out is left out, having no report; `spiele` is empty while no season is
    `active`.

    `earlier` holds every fixture of an ended season booked to those records now on which a report stands, newest
    first, one whose date was cleared after its report last with a null `date`: its page shows the report read-only.
    Refused `role_not_held` where the address holds no confirmed, live referee record.
    """

    # A snapshot, so the fixtures served are those of the records judged; never a transaction, which a read writing
    # nothing has no conflict to retry in.
    async with db.start_session(snapshot=True) as session:
        subject = await roles_of(identifier, records, session=session)
        refuse(find_own_entry_refusal(held=bool(subject.schiedsrichter)))
        gebucht = {"schiedsrichter.schiedsrichter_id": {"$in": [record.schiedsrichter_id for record in subject.schiedsrichter]}}

        saison_id = await pull_governing_saison_id(saisons_collection, session=session)
        laufende = (
            []
            if saison_id is None
            else await aggregate_many_from_db(
                collection=spiele_collection,
                pipeline=build_named_spiele_pipeline(
                    {
                        "saison_id": saison_id,
                        **gebucht,
                        "date": {"$lte": today},
                        "sonderereignis": {"$nin": list(SONDEREREIGNIS_WITHOUT_A_RESULT)},
                    },
                    projection=PERSON_EINTRAG_FIELDS,
                    sort_by=SPIELE_NEUESTE_ZUERST,
                    limit=LIST_LIMIT_DEFAULT,
                ),
                session=session,
            )
        )

        beendete = await pull_ended_saison_ids(saisons_collection=saisons_collection, session=session)
        fruehere = (
            []
            if not beendete
            else await aggregate_many_from_db(
                collection=spiele_collection,
                # Undated too: a date cleared after the report leaves the report standing, and an ended season is never dated
                # again. A descending sort puts null last.
                pipeline=build_named_spiele_pipeline(
                    {"saison_id": {"$in": beendete}, **gebucht},
                    projection=PERSON_EINTRAG_FIELDS,
                    sort_by=SPIELE_NEUESTE_ZUERST,
                    limit=LIST_LIMIT_DEFAULT,
                ),
                session=session,
            )
        )

        berichte = await pull_many_from_db(
            collection=spielberichte_collection,
            db_filter={"spiel_id": {"$in": [spiel["_id"] for spiel in (*laufende, *fruehere)]}, "bericht": {"$ne": None}},
            projection=["spiel_id", "bericht.submitted_at"],
            session=session,
        )

    eingereicht = {bericht["spiel_id"]: bericht["bericht"]["submitted_at"] for bericht in berichte}

    def entry(spiel: Mapping[str, Any]) -> dict[str, Any]:
        return {
            "spiel_id": spiel["_id"],
            "date": spiel.get("date"),
            "time": spiel.get("time"),
            "team1_name": (spiel.get("team1") or {}).get("name"),
            "team2_name": (spiel.get("team2") or {}).get("name"),
            "submitted_at": eingereicht.get(spiel["_id"]),
        }

    return FLSpielberichteSelfResponse(
        spiele=[FLSpielberichtPersonEntry.model_validate(entry(spiel)) for spiel in laufende],
        # An ended season's fixture holding no report has nothing for its read-only page to show.
        earlier=[FLSpielberichtPersonEarlierEntry.model_validate(entry(spiel)) for spiel in fruehere if spiel["_id"] in eingereicht],
    )


@router.get(
    BERICHT_PATH,
    response_model=FLSpielberichtSchiedsrichterResponse,
    summary="One fixture's report as its referee reads it",
)
async def get_spielbericht_bericht(
    spiel_id: CustomRouteObjectId,
    identifier: SchiedsrichterIdentifier,
    spiele_collection: SpieleCollection,
    saisons_collection: SaisonsCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    spieler_collection: SpielerCollection,
    spielberichte_collection: SpielberichteReadCollection,
    records: SubjectLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLSpielberichtSchiedsrichterResponse:
    """
    What the booked referee's report form reads.

    The fixture, both clubs' live squads of the season, the pupils the stored report names outside them, and the stored
    report, its remarks and card reasons included, or null.

    Served for a fixture still to come or called off too, whose page says why it takes no report, with both squads
    empty: the pupils the stored report names are then all in `named`. Once the fixture's season has ended,
    `completed` is true and the read is the report alone, both squads empty, which its referee writes no more.
    Refused
    `role_not_held` where the address holds no confirmed, live referee record, and `bericht_not_officiated` where the fixture
    is booked to none of its records; `document_not_found` for a fixture that does not exist.
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
        kader_open = kader_is_open(context, today=today)
        document = await spielberichte_collection.find_one({"spiel_id": spiel_id}, session=session)
        named = await pull_named(
            spieler_collection=spieler_collection,
            context=context,
            kader_open=kader_open,
            bericht=None if document is None else document.get("bericht"),
            session=session,
        )

    return FLSpielberichtSchiedsrichterResponse.model_validate(
        {**compose_view(context, kader_open=kader_open, named=named, document=document), "completed": completed}
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
    identifier: SchiedsrichterIdentifier,
    spiele_collection: SpieleCollection,
    saisons_collection: SaisonsCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    spieler_collection: SpielerCollection,
    spielberichte_collection: SpielberichteCollection,
    records: SubjectLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    now: datetime = Depends(get_germany_now),
) -> FLSpielberichtSchiedsrichterResponse:
    """
    Write the whole report of one fixture as its booked referee, replacing what stood.

    The proposed result, the scorers, the cards and the remarks. The first write creates it and answers 201; every
    write changing it raises its `version`, so a report the administrator adopted reads `differing` again until it
    is adopted anew, and a write changing nothing writes nothing. Every write stamps the clubs the fixture fields now,
    so a report a knockout correction re-fielded a side under reads `teams_changed` until it is written again. Writes
    no fixture: the result is the administrator's to save.

    `bericht_stand` is the `version` of the report the form was served, null where none stood: a write composed on
    another version would replace a report its sender never saw.

    Refuses, in this order, each writing nothing: an address holding no confirmed, live referee record
    (`role_not_held`); a fixture that does not exist (`document_not_found`); one booked to none of its records
    (`bericht_not_officiated`); one whose season has ended, whose report its referee only reads (`saison_past`); a
    `bericht_stand` other than the version standing now, or than none where none stands (`bericht_meanwhile_changed`); one undated
    or whose day is still to come (`bericht_not_played`); one called off or struck out (`bericht_cancelled`); a shoot-out
    proposed on a group-phase fixture (`bericht_elfmeter_in_the_gruppe`); a pupil the write newly names on a side outside that side's
    live squad of the season, a pupil the report already named on that side staying while the side fields the club it
    did (`bericht_not_in_kader`); and a yellow or second yellow card naming no reason (`card_reason_missing`). Every refusal but
    `bericht_meanwhile_changed` is asked again outside the transaction just before answering, the referee's records included, so a
    write landing on what was judged before that second asking refuses the report rather than letting it stand, and one
    landing after it stands beside the report; a write of the report itself landing mid-press conflicts with this one,
    whose retry meets `bericht_meanwhile_changed`. Two first writes at once are two forms opened on no report: the later is
    refused.
    """

    payload = bericht_data.bericht

    async def write_the_report(session: AsyncClientSession) -> tuple[FLSpielberichtSchiedsrichterResponse, bool]:
        """Judge, then write. Everything judged is read in-session, so a retry re-judges it."""

        subject = await roles_of(identifier, records, session=session)
        refuse(find_own_entry_refusal(held=bool(subject.schiedsrichter)))
        eigene = [record.schiedsrichter_id for record in subject.schiedsrichter]

        context = await pull_bericht_context(
            spiele_collection=spiele_collection,
            saisons_collection=saisons_collection,
            saison_spieler_collection=saison_spieler_collection,
            spiel_id=spiel_id,
            session=session,
        )
        saved = await spielberichte_collection.find_one({"spiel_id": spiel_id}, session=session)
        block = None if saved is None else saved.get("bericht")
        new = newly_named(payload, block, context.spiel)
        refuse(find_not_refereed_refusal(spiel_raw=context.spiel, schiedsrichter_ids=eigene))
        refuse(find_saison_ended_refusal(context))
        refuse(find_bericht_stand_refusal(stand=bericht_data.bericht_stand, saved=block))
        judge_bericht(context=context, payload=payload, new=new, today=today)

        await anchor_the_pupils_named(spieler_collection=spieler_collection, spieler_ids=set().union(*new.values()), session=session)
        document = await write_bericht(
            spielberichte_collection=spielberichte_collection,
            spiel_raw=context.spiel,
            saved=saved,
            payload=payload,
            by=FLSpielberichtBySchiedsrichter(kind="schiedsrichter", schiedsrichter_id=context.spiel["schiedsrichter"]["schiedsrichter_id"]),
            now=now,
            version=bericht_data.version,
            session=session,
        )
        if saved is None:
            # After the insert, so a rival first write meets it there rather than blocking on the season.
            await anchor_the_season_reported_in(saisons_collection=saisons_collection, saison_id=context.spiel["saison_id"], session=session)
        named = await pull_named(
            spieler_collection=spieler_collection, context=context, kader_open=True, bericht=document.get("bericht"), session=session
        )

        # Nothing judged is written here, so a referee retired or taken off, a fixture re-dated or called off, a pupil
        # ausgetragen or a seat holder renamed conflicts with nothing: judged again outside the transaction.
        async with db.start_session(snapshot=True) as ausserhalb:
            subjekt_jetzt = await roles_of(identifier, records, session=ausserhalb)
        refuse(find_own_entry_refusal(held=bool(subjekt_jetzt.schiedsrichter)))
        current = await pull_bericht_context(
            spiele_collection=spiele_collection,
            saisons_collection=saisons_collection,
            saison_spieler_collection=saison_spieler_collection,
            spiel_id=spiel_id,
            session=None,
        )
        refuse(
            find_not_refereed_refusal(
                spiel_raw=current.spiel, schiedsrichter_ids=[record.schiedsrichter_id for record in subjekt_jetzt.schiedsrichter]
            )
        )
        refuse(find_saison_ended_refusal(current))
        judge_bericht(context=current, payload=payload, new=new, today=today)

        angelegt = saved is None or saved.get("bericht") is None
        view = {**compose_view(context, kader_open=True, named=named, document=document), "completed": False}

        return FLSpielberichtSchiedsrichterResponse.model_validate(view), angelegt

    async with transaction_session(db) as session:
        answer, angelegt = await session.with_transaction(write_the_report)

    # RFC 9110's PUT: a write creating the report says so.
    if angelegt:
        response.status_code = HTTPStatus.CREATED

    return answer
