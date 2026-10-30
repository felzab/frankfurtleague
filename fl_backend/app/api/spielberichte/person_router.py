from collections.abc import Mapping
from datetime import datetime
from http import HTTPStatus
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, Response
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.identitaet.crud import funktionen_of
from app.api.identitaet.lookup import SubjektLookup
from app.api.konto.services import find_eigener_eintrag_refusal
from app.api.saisons.crud import pull_massgebliche_saison_id
from app.api.sperrliste.guard import PERSON_ACTOR_BINDERS, SchiedsrichterIdentifier
from app.api.spielberichte.crud import (
    anchor_the_pupils_named,
    anchor_the_season_reported_in,
    pull_beendete_saison_ids,
    pull_bericht_lage,
    pull_genannt,
    write_bericht,
)
from app.api.spielberichte.schemas import (
    FLSpielberichtePersonResponse,
    FLSpielberichtPayload,
    FLSpielberichtPersonEintrag,
    FLSpielberichtPersonFruehererEintrag,
    FLSpielberichtSchiedsrichterResponse,
    FLSpielberichtVonSchiedsrichter,
)
from app.api.spielberichte.services import (
    compose_ansicht,
    find_bericht_stand_refusal,
    find_nicht_geleitet_refusal,
    find_saison_beendet_refusal,
    ist_abgeschlossen,
    judge_bericht,
    kader_ist_offen,
    neu_genannt,
)
from app.api.spiele.schemas import SONDEREREIGNIS_WITHOUT_A_RESULT
from app.core.config import API_VERSION
from app.core.crud import pull_many_from_db, refuse
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
from app.core.security import verify_access_admin
from app.core.transactions import transaction_session
from app.shared.schemas.custom import CustomRouteObjectId

# The referee's own router, binding the referee's Funktion at router level.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spielberichte",
    dependencies=[Depends(verify_access_admin), Depends(PERSON_ACTOR_BINDERS["schiedsrichter"])],
)

BERICHT_PATH = f"{by_id('spiel_id')}/bericht"

# What the referee's list shows of a fixture, in the order it lists them.
PERSON_EINTRAG_FIELDS = ["datum", "uhrzeit", "team1.name", "team2.name"]
SPIELE_NEUESTE_ZUERST = [("datum", -1), ("uhrzeit", -1), ("_id", 1)]


@router.get("/self", response_model=FLSpielberichtePersonResponse, summary="The fixtures a signed-in referee reports on")
async def get_self(
    identifier: SchiedsrichterIdentifier,
    spiele_collection: SpieleCollection,
    saisons_collection: SaisonsCollection,
    spielberichte_collection: SpielberichteCollection,
    records: SubjektLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLSpielberichtePersonResponse:
    """
    The `active` season's fixtures booked to the signed-in referee whose day has come, newest first.

    Booked to any confirmed, live referee record of the address, each with when its report was first sent, null where
    none stands. A fixture called off or struck out is left out, having no report; `spiele` is empty while no season is
    `active`.

    `fruehere` holds every fixture of an ended season booked to those records now on which a report stands, newest
    first, one whose date was cleared after its report last with a null `datum`: its page shows the report read-only.
    Refused `funktion_nicht_gehalten` where the address holds no confirmed, live referee record.
    """

    # A snapshot, so the fixtures served are those of the records judged; never a transaction, which a read writing
    # nothing has no conflict to retry in.
    async with db.start_session(snapshot=True) as session:
        subjekt = await funktionen_of(identifier, records, session=session)
        refuse(find_eigener_eintrag_refusal(gehalten=bool(subjekt.schiedsrichter)))
        gebucht = {"schiedsrichter.schiedsrichter_id": {"$in": [record.schiedsrichter_id for record in subjekt.schiedsrichter]}}

        saison_id = await pull_massgebliche_saison_id(saisons_collection, session=session)
        laufende = (
            []
            if saison_id is None
            else await pull_many_from_db(
                collection=spiele_collection,
                db_filter={
                    "saison_id": saison_id,
                    **gebucht,
                    "datum": {"$lte": today},
                    "sonderereignis": {"$nin": list(SONDEREREIGNIS_WITHOUT_A_RESULT)},
                },
                sort_by=SPIELE_NEUESTE_ZUERST,
                projection=PERSON_EINTRAG_FIELDS,
                session=session,
            )
        )

        beendete = await pull_beendete_saison_ids(saisons_collection=saisons_collection, session=session)
        fruehere = (
            []
            if not beendete
            else await pull_many_from_db(
                collection=spiele_collection,
                # Undated too: a date cleared after the report leaves the report standing, and an ended season is never dated
                # again. A descending sort puts null last.
                db_filter={"saison_id": {"$in": beendete}, **gebucht},
                sort_by=SPIELE_NEUESTE_ZUERST,
                projection=PERSON_EINTRAG_FIELDS,
                session=session,
            )
        )

        berichte = await pull_many_from_db(
            collection=spielberichte_collection,
            db_filter={"spiel_id": {"$in": [spiel["_id"] for spiel in (*laufende, *fruehere)]}, "bericht": {"$ne": None}},
            projection=["spiel_id", "bericht.eingereicht_am"],
            session=session,
        )

    eingereicht = {bericht["spiel_id"]: bericht["bericht"]["eingereicht_am"] for bericht in berichte}

    def eintrag(spiel: Mapping[str, Any]) -> dict[str, Any]:
        return {
            "spiel_id": spiel["_id"],
            "datum": spiel.get("datum"),
            "uhrzeit": spiel.get("uhrzeit"),
            "team1_name": (spiel.get("team1") or {}).get("name"),
            "team2_name": (spiel.get("team2") or {}).get("name"),
            "eingereicht_am": eingereicht.get(spiel["_id"]),
        }

    return FLSpielberichtePersonResponse(
        spiele=[FLSpielberichtPersonEintrag.model_validate(eintrag(spiel)) for spiel in laufende],
        # An ended season's fixture holding no report has nothing for its read-only page to show.
        fruehere=[FLSpielberichtPersonFruehererEintrag.model_validate(eintrag(spiel)) for spiel in fruehere if spiel["_id"] in eingereicht],
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
    spielberichte_collection: SpielberichteCollection,
    records: SubjektLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLSpielberichtSchiedsrichterResponse:
    """
    What the booked referee's report form reads.

    The fixture, both clubs' live squads of the season, the pupils the stored report names outside them, and the stored
    report, its remarks and card reasons included, or null.

    Served for a fixture still to come or called off too, whose page says why it takes no report, with both squads
    empty: the pupils the stored report names are then all in `genannt`. Once the fixture's season has ended,
    `abgeschlossen` is true and the read is the report alone, both squads empty, which its referee writes no more.
    Refused
    `funktion_nicht_gehalten` where the address holds no confirmed, live referee record, and `bericht_nicht_geleitet` where the fixture
    is booked to none of its records; `document_not_found` for a fixture that does not exist.
    """

    async with db.start_session(snapshot=True) as session:
        subjekt = await funktionen_of(identifier, records, session=session)
        refuse(find_eigener_eintrag_refusal(gehalten=bool(subjekt.schiedsrichter)))

        lage = await pull_bericht_lage(
            spiele_collection=spiele_collection,
            saisons_collection=saisons_collection,
            saison_spieler_collection=saison_spieler_collection,
            spiel_id=spiel_id,
            session=session,
        )
        refuse(
            find_nicht_geleitet_refusal(
                spiel_raw=lage.spiel, schiedsrichter_ids=[record.schiedsrichter_id for record in subjekt.schiedsrichter]
            )
        )

        # After the season, the referee's page is a view of the report: no squad to pick from, no write.
        abgeschlossen = ist_abgeschlossen(lage)
        kader_offen = kader_ist_offen(lage, today=today)
        dokument = await spielberichte_collection.find_one({"spiel_id": spiel_id}, session=session)
        genannt = await pull_genannt(
            spieler_collection=spieler_collection,
            lage=lage,
            kader_offen=kader_offen,
            bericht=None if dokument is None else dokument.get("bericht"),
            session=session,
        )

    return FLSpielberichtSchiedsrichterResponse.model_validate(
        {**compose_ansicht(lage, kader_offen=kader_offen, genannt=genannt, dokument=dokument), "abgeschlossen": abgeschlossen}
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
    records: SubjektLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    now: datetime = Depends(get_germany_now),
) -> FLSpielberichtSchiedsrichterResponse:
    """
    Write the whole report of one fixture as its booked referee, replacing what stood.

    The proposed result, the scorers, the cards and the remarks. The first write creates it and answers 201; every
    write changing it raises its `version`, so a report the administrator adopted reads `abweichend` again until it
    is adopted anew, and a write changing nothing writes nothing. Every write stamps the clubs the fixture fields now,
    so a report a knockout correction re-fielded a side under reads `teams_geaendert` until it is written again. Writes
    no fixture: the result is the administrator's to save.

    `bericht_stand` is the `version` of the report the form was served, null where none stood: a write composed on
    another version would replace a report its sender never saw.

    Refuses, in this order, each writing nothing: an address holding no confirmed, live referee record
    (`funktion_nicht_gehalten`); a fixture that does not exist (`document_not_found`); one booked to none of its records
    (`bericht_nicht_geleitet`); one whose season has ended, whose report its referee only reads (`saison_past`); a
    `bericht_stand` other than the version standing now, or than none where none stands (`bericht_inzwischen_geaendert`); one undated
    or whose day is still to come (`bericht_nicht_gespielt`); one called off or struck out (`bericht_abgesagt`); a shoot-out
    proposed on a group-phase fixture (`bericht_elfmeter_in_der_gruppe`); a pupil the write newly names on a side outside that side's
    live squad of the season, a pupil the report already named on that side staying while the side fields the club it
    did (`bericht_nicht_im_kader`); and a yellow or second yellow card naming no reason (`bericht_grund_fehlt`). Every refusal but
    `bericht_inzwischen_geaendert` is asked again outside the transaction just before answering, the referee's records included, so a
    write landing on what was judged before that second asking refuses the report rather than letting it stand, and one
    landing after it stands beside the report; a write of the report itself landing mid-press conflicts with this one,
    whose retry meets `bericht_inzwischen_geaendert`. Two first writes at once are two forms opened on no report: the later is
    refused.
    """

    payload = bericht_data.bericht

    async def write_the_report(session: AsyncClientSession) -> tuple[FLSpielberichtSchiedsrichterResponse, bool]:
        """Judge, then write. Everything judged is read in-session, so a retry re-judges it."""

        subjekt = await funktionen_of(identifier, records, session=session)
        refuse(find_eigener_eintrag_refusal(gehalten=bool(subjekt.schiedsrichter)))
        eigene = [record.schiedsrichter_id for record in subjekt.schiedsrichter]

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
        refuse(find_nicht_geleitet_refusal(spiel_raw=lage.spiel, schiedsrichter_ids=eigene))
        refuse(find_saison_beendet_refusal(lage))
        refuse(find_bericht_stand_refusal(stand=bericht_data.bericht_stand, gespeichert=block))
        judge_bericht(lage=lage, payload=payload, gespeichert=block, neu=neu, today=today)

        await anchor_the_pupils_named(spieler_collection=spieler_collection, spieler_ids=set().union(*neu.values()), session=session)
        dokument = await write_bericht(
            spielberichte_collection=spielberichte_collection,
            spiel_raw=lage.spiel,
            gespeichert=gespeichert,
            payload=payload,
            von=FLSpielberichtVonSchiedsrichter(art="schiedsrichter", schiedsrichter_id=lage.spiel["schiedsrichter"]["schiedsrichter_id"]),
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

        # Nothing judged is written here, so a referee retired or taken off, a fixture re-dated or called off, a pupil
        # ausgetragen or a seat holder renamed conflicts with nothing: judged again outside the transaction.
        async with db.start_session(snapshot=True) as ausserhalb:
            subjekt_jetzt = await funktionen_of(identifier, records, session=ausserhalb)
        refuse(find_eigener_eintrag_refusal(gehalten=bool(subjekt_jetzt.schiedsrichter)))
        jetzt = await pull_bericht_lage(
            spiele_collection=spiele_collection,
            saisons_collection=saisons_collection,
            saison_spieler_collection=saison_spieler_collection,
            spiel_id=spiel_id,
            session=None,
        )
        refuse(
            find_nicht_geleitet_refusal(
                spiel_raw=jetzt.spiel, schiedsrichter_ids=[record.schiedsrichter_id for record in subjekt_jetzt.schiedsrichter]
            )
        )
        refuse(find_saison_beendet_refusal(jetzt))
        judge_bericht(lage=jetzt, payload=payload, gespeichert=block, neu=neu, today=today)

        angelegt = gespeichert is None or gespeichert.get("bericht") is None
        ansicht = {**compose_ansicht(lage, kader_offen=True, genannt=genannt, dokument=dokument), "abgeschlossen": False}

        return FLSpielberichtSchiedsrichterResponse.model_validate(ansicht), angelegt

    async with transaction_session(db) as session:
        answer, angelegt = await session.with_transaction(write_the_report)

    # RFC 9110's PUT: a write creating the report says so.
    if angelegt:
        response.status_code = HTTPStatus.CREATED

    return answer
