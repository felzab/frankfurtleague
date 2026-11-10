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
from app.api.spielberichte.crud import (
    anchor_the_pupils_named,
    anchor_the_season_reported_in,
    pull_bericht_context,
    pull_ended_saison_ids,
    pull_named,
    write_bericht,
)
from app.api.spielberichte.schemas import (
    FLSpielberichteSelfResponse,
    FLSpielberichtPayload,
    FLSpielberichtPersonEarlierEntry,
    FLSpielberichtPersonEntry,
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
from app.api.spiele.schemas import SONDEREREIGNIS_WITHOUT_A_RESULT
from app.api.spiele.services import build_named_spiele_pipeline, spiel_label
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db, find_stale_first_save_refusal, pull_many_from_db, refuse
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
from app.core.recording import ACT_BY_SCHIEDSRICHTER, record_act
from app.core.routing import by_id
from app.core.security import PersonIdentifier, get_person_identifier, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from app.shared.schemas.custom import CustomRouteObjectId

# The referee's own router, binding the referee's Funktion at router level.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spielberichte",
    dependencies=[Depends(verify_access_admin), Depends(get_person_identifier)],
)

BERICHT_PATH = f"{by_id('spiel_id')}/bericht"

# What the referee's list shows of a fixture, in the order it lists them; the names through the join.
PERSON_EINTRAG_FIELDS = {"date": 1, "time": 1, "team1.name": 1, "team2.name": 1}
SPIELE_NEUESTE_ZUERST = [("date", -1), ("time", -1), ("_id", 1)]


@router.get("/self", response_model=FLSpielberichteSelfResponse, summary="The fixtures a signed-in referee reports on")
async def get_self(
    identifier: PersonIdentifier,
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
            db_filter={"spiel_id": {"$in": [spiel["_id"] for spiel in (*laufende, *fruehere)]}},
            projection=["spiel_id", "bericht.submitted_at"],
            session=session,
        )

    submitted = {bericht["spiel_id"]: bericht["bericht"]["submitted_at"] for bericht in berichte}

    def entry(spiel: Mapping[str, Any]) -> dict[str, Any]:
        return {
            "spiel_id": spiel["_id"],
            "date": spiel.get("date"),
            "time": spiel.get("time"),
            "team1_name": (spiel.get("team1") or {}).get("name"),
            "team2_name": (spiel.get("team2") or {}).get("name"),
            "submitted_at": submitted.get(spiel["_id"]),
        }

    return FLSpielberichteSelfResponse(
        spiele=[FLSpielberichtPersonEntry.model_validate(entry(spiel)) for spiel in laufende],
        # An ended season's fixture holding no report has nothing for its read-only page to show.
        earlier=[FLSpielberichtPersonEarlierEntry.model_validate(entry(spiel)) for spiel in fruehere if spiel["_id"] in submitted],
    )


@router.get(
    BERICHT_PATH,
    response_model=FLSpielberichtSchiedsrichterResponse,
    summary="One fixture's report as its referee reads it",
)
async def get_spielbericht_bericht(
    spiel_id: CustomRouteObjectId,
    identifier: PersonIdentifier,
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
    report, its remarks included, or null.

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
            bericht=None if document is None else document["bericht"],
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
    identifier: PersonIdentifier,
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

    The shoot-out or the event proposed, the scorers, the cards and the remarks; the two goal counts of the proposal are
    the entries credited to each side, an own goal crediting the other one, and no form sends them. The first write
    creates it and answers 201; every write changing it clears its adoption in the same update, so a report the
    administrator adopted reads `differing` again until it is adopted anew, and a write changing nothing writes
    nothing. Every write stamps the clubs the fixture fields now, so a report a knockout correction re-fielded a side
    under reads `sides_changed` until it is written again. Writes no fixture: the result is the administrator's to save.

    `version` is the report document's as the form was served it, null where the form showed no report: a write composed
    on another state would replace a report its sender never saw. The administrator's adoption raises it too, so a form
    read before an adoption saves stale once.

    Refuses, in this order, each writing nothing: an address holding no confirmed, live referee record
    (`role_not_held`); a fixture that does not exist (`document_not_found`); one booked to none of its records
    (`bericht_not_officiated`); one whose season has ended, whose report its referee only reads (`saison_past`); a
    `version` other than the document's now, or than null where none stands (`version_stale`); one undated
    or whose day is still to come (`bericht_not_played`); one called off or struck out (`bericht_cancelled`); a shoot-out
    proposed on a group-phase fixture (`bericht_elfmeter_in_the_gruppe`); and a pupil the write newly names on a side
    outside that side's live squad of the season, a pupil the report already named on that side staying while the side
    fields the club it did (`spieler_not_in_kader`). Every refusal but `version_stale` is asked again outside the
    transaction just before answering, the referee's records included, so a write landing on what was judged before
    that second asking refuses the report rather than letting it stand, and one landing after it stands beside the
    report; a write of the report itself landing mid-press conflicts with this one, whose retry meets `version_stale`.
    Two first writes at once are two forms opened on no report: the later is refused.
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
        judge_bericht(context=context, payload=payload, new=new, today=today)

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
        if saved is None:
            # After the insert, so a rival first write meets it there rather than blocking on the season.
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
        judge_bericht(context=current, payload=payload, new=new, today=today)

        created = saved is None
        view = {**compose_view(context, kader_open=True, named=named, document=document), "completed": False}

        return FLSpielberichtSchiedsrichterResponse.model_validate(view), created

    async with transaction_session(db) as session:
        answer, created = await session.with_transaction(write_the_report)

    # RFC 9110's PUT: a write creating the report says so.
    if created:
        response.status_code = HTTPStatus.CREATED

    return answer
