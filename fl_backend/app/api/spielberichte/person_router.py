from datetime import datetime
from http import HTTPStatus
from typing import Annotated

from fastapi import APIRouter, Body, Depends, Response
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.identitaet.crud import funktionen_of
from app.api.identitaet.lookup import SubjektLookup
from app.api.konto.services import find_eigener_eintrag_refusal
from app.api.saisons.crud import pull_massgebliche_saison_id
from app.api.spielberichte.crud import (
    anchor_the_pupils_named,
    pull_bericht_lage,
    pull_genannt,
    write_bericht,
)
from app.api.spielberichte.schemas import (
    FLSpielberichtePersonResponse,
    FLSpielberichtPayload,
    FLSpielberichtPersonEintrag,
    FLSpielberichtSchiedsrichterResponse,
    FLSpielberichtVonSchiedsrichter,
)
from app.api.spielberichte.services import compose_ansicht, find_nicht_geleitet_refusal, judge_bericht, neu_genannt, nimmt_einen_bericht
from app.api.spiele.schemas import SONDEREREIGNIS_WITHOUT_A_RESULT
from app.core.config import API_VERSION
from app.core.crud import pull_many_from_db, refuse
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
from app.core.drosselung import gedrosselt
from app.core.exception_handlers import DOCUMENT_NOT_FOUND_RESPONSE, DUPLICATE_KEY_RESPONSE
from app.core.routing import by_id
from app.core.security import PERSON_ACTOR_BINDERS, SchiedsrichterIdentifier, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.schemas.custom import CustomRouteObjectId

# The referee's own router, binding the referee's Funktion at router level (`docs/backend/spec.md :: I41`).
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spielberichte",
    dependencies=[Depends(verify_access_admin), Depends(PERSON_ACTOR_BINDERS["schiedsrichter"])],
)

BERICHT_PATH = f"{by_id('spiel_id')}/bericht"


@router.get("/person", response_model=FLSpielberichtePersonResponse, summary="The fixtures a signed-in referee reports on")
async def get_spielberichte_person(
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
    none stands.

    A fixture called off or struck out is left out, having no report. Empty while no season is `active`. Refused
    `REQ-FUNKTION-001` where the address holds no confirmed, live referee record.
    """

    # A snapshot, so the fixtures served are those of the records judged; never a transaction, which a read writing
    # nothing has no conflict to retry in.
    async with db.start_session(snapshot=True) as session:
        subjekt = await funktionen_of(identifier, records, session=session)
        refuse(find_eigener_eintrag_refusal(gehalten=bool(subjekt.schiedsrichter)))

        saison_id = await pull_massgebliche_saison_id(saisons_collection, session=session)
        if saison_id is None:
            return FLSpielberichtePersonResponse(spiele=[])

        spiele = await pull_many_from_db(
            collection=spiele_collection,
            db_filter={
                "saison_id": saison_id,
                "schiedsrichter.schiedsrichter_id": {"$in": [record.schiedsrichter_id for record in subjekt.schiedsrichter]},
                "datum": {"$lte": today},
                "sonderereignis": {"$nin": list(SONDEREREIGNIS_WITHOUT_A_RESULT)},
            },
            sort_by=[("datum", -1), ("uhrzeit", -1), ("_id", 1)],
            projection=["datum", "uhrzeit", "team1.name", "team2.name"],
            session=session,
        )
        berichte = await pull_many_from_db(
            collection=spielberichte_collection,
            db_filter={"spiel_id": {"$in": [spiel["_id"] for spiel in spiele]}, "bericht": {"$ne": None}},
            projection=["spiel_id", "bericht.eingereicht_am"],
            session=session,
        )

    eingereicht = {bericht["spiel_id"]: bericht["bericht"]["eingereicht_am"] for bericht in berichte}

    return FLSpielberichtePersonResponse(
        spiele=[
            FLSpielberichtPersonEintrag(
                spiel_id=spiel["_id"],
                datum=spiel["datum"],
                uhrzeit=spiel.get("uhrzeit"),
                team1_name=(spiel.get("team1") or {}).get("name"),
                team2_name=(spiel.get("team2") or {}).get("name"),
                eingereicht_am=eingereicht.get(spiel["_id"]),
            )
            for spiel in spiele
        ]
    )


@router.get(
    BERICHT_PATH,
    response_model=FLSpielberichtSchiedsrichterResponse,
    summary="One fixture's report as its referee reads it",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
)
async def get_spielbericht_bericht(
    spiel_id: CustomRouteObjectId,
    identifier: SchiedsrichterIdentifier,
    spiele_collection: SpieleCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    saison_teams_collection: SaisonTeamsCollection,
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
    empty: the pupils the stored report names are then all in `genannt`. Refused
    `REQ-FUNKTION-001` where the address holds no confirmed, live referee record, and `REQ-BERICHT-002` where the fixture
    is booked to none of its records; `DB-COMMON-001` for a fixture that does not exist.
    """

    async with db.start_session(snapshot=True) as session:
        subjekt = await funktionen_of(identifier, records, session=session)
        refuse(find_eigener_eintrag_refusal(gehalten=bool(subjekt.schiedsrichter)))

        lage = await pull_bericht_lage(
            spiele_collection=spiele_collection,
            saison_spieler_collection=saison_spieler_collection,
            saison_teams_collection=saison_teams_collection,
            spiel_id=spiel_id,
            session=session,
        )
        refuse(
            find_nicht_geleitet_refusal(
                spiel_raw=lage.spiel, schiedsrichter_ids=[record.schiedsrichter_id for record in subjekt.schiedsrichter]
            )
        )

        kader_offen = nimmt_einen_bericht(lage.spiel, today=today)
        dokument = await spielberichte_collection.find_one({"spiel_id": spiel_id}, session=session)
        genannt = await pull_genannt(
            spieler_collection=spieler_collection,
            lage=lage,
            kader_offen=kader_offen,
            bericht=None if dokument is None else dokument.get("bericht"),
            session=session,
        )

    return FLSpielberichtSchiedsrichterResponse.model_validate(
        compose_ansicht(lage, kader_offen=kader_offen, genannt=genannt, dokument=dokument)
    )


@router.put(
    BERICHT_PATH,
    response_model=FLSpielberichtSchiedsrichterResponse,
    summary="Write one fixture's report as its referee",
    responses={
        201: {"model": FLSpielberichtSchiedsrichterResponse, "description": "The report did not stand before, and this write created it"},
        404: DOCUMENT_NOT_FOUND_RESPONSE,
        409: DUPLICATE_KEY_RESPONSE,
    },
    dependencies=[Depends(gedrosselt)],
)
async def put_spielbericht_bericht(
    spiel_id: CustomRouteObjectId,
    bericht_data: Annotated[FLSpielberichtPayload, Body()],
    response: Response,
    identifier: SchiedsrichterIdentifier,
    spiele_collection: SpieleCollection,
    saison_spieler_collection: SaisonSpielerCollection,
    saison_teams_collection: SaisonTeamsCollection,
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
    is adopted anew, and a write changing nothing writes nothing. Writes no fixture: the result is the administrator's
    to save.

    Refuses, in this order, each writing nothing: an address holding no confirmed, live referee record
    (`REQ-FUNKTION-001`); a fixture that does not exist (`DB-COMMON-001`); one booked to none of its records
    (`REQ-BERICHT-002`); one undated or whose day is still to come (`REQ-BERICHT-001`); one called off or struck out
    (`REQ-BERICHT-004`); a pupil the write newly names on a side outside that side's live squad of the season, a pupil
    the report already named on that side staying (`REQ-BERICHT-003`); and remarks naming a seat holder of either club,
    the booked referee or a pupil of either squad (`REQ-BERICHT-005`), last. Every refusal after the first is asked
    again outside the transaction just before answering, the referee's records included, so a write landing mid-press
    on what was judged refuses the report rather than letting it stand. Two first writes at once are one report: the
    later is written over the earlier, as a correction is.
    """

    payload = bericht_data.bericht

    async def write_the_report(session: AsyncClientSession) -> tuple[FLSpielberichtSchiedsrichterResponse, bool]:
        """Judge, then write. Everything judged is read in-session, so a retry re-judges it."""

        subjekt = await funktionen_of(identifier, records, session=session)
        refuse(find_eigener_eintrag_refusal(gehalten=bool(subjekt.schiedsrichter)))
        eigene = [record.schiedsrichter_id for record in subjekt.schiedsrichter]

        lage = await pull_bericht_lage(
            spiele_collection=spiele_collection,
            saison_spieler_collection=saison_spieler_collection,
            saison_teams_collection=saison_teams_collection,
            spiel_id=spiel_id,
            session=session,
        )
        gespeichert = await spielberichte_collection.find_one({"spiel_id": spiel_id}, session=session)
        neu = neu_genannt(payload, None if gespeichert is None else gespeichert.get("bericht"))
        refuse(find_nicht_geleitet_refusal(spiel_raw=lage.spiel, schiedsrichter_ids=eigene))
        judge_bericht(lage=lage, payload=payload, neu=neu, today=today)

        await anchor_the_pupils_named(spieler_collection=spieler_collection, spieler_ids=set().union(*neu.values()), session=session)
        dokument = await write_bericht(
            spielberichte_collection=spielberichte_collection,
            spiel_raw=lage.spiel,
            gespeichert=gespeichert,
            payload=payload,
            von=FLSpielberichtVonSchiedsrichter(art="schiedsrichter", schiedsrichter_id=lage.spiel["schiedsrichter"]["schiedsrichter_id"]),
            now=now,
            session=session,
        )
        genannt = await pull_genannt(
            spieler_collection=spieler_collection, lage=lage, kader_offen=True, bericht=dokument.get("bericht"), session=session
        )

        # Nothing judged is written here, so a referee retired or taken off, a fixture re-dated or called off, a pupil
        # ausgetragen or a seat holder renamed conflicts with nothing: judged again outside the transaction
        # (`docs/backend/spec.md :: I118`).
        async with db.start_session(snapshot=True) as ausserhalb:
            subjekt_jetzt = await funktionen_of(identifier, records, session=ausserhalb)
        refuse(find_eigener_eintrag_refusal(gehalten=bool(subjekt_jetzt.schiedsrichter)))
        jetzt = await pull_bericht_lage(
            spiele_collection=spiele_collection,
            saison_spieler_collection=saison_spieler_collection,
            saison_teams_collection=saison_teams_collection,
            spiel_id=spiel_id,
            session=None,
        )
        refuse(
            find_nicht_geleitet_refusal(
                spiel_raw=jetzt.spiel, schiedsrichter_ids=[record.schiedsrichter_id for record in subjekt_jetzt.schiedsrichter]
            )
        )
        judge_bericht(lage=jetzt, payload=payload, neu=neu, today=today)

        angelegt = gespeichert is None or gespeichert.get("bericht") is None
        ansicht = compose_ansicht(lage, kader_offen=True, genannt=genannt, dokument=dokument)

        return FLSpielberichtSchiedsrichterResponse.model_validate(ansicht), angelegt

    async with transaction_session(db) as session:
        answer, angelegt = await session.with_transaction(write_the_report)

    # RFC 9110's PUT: a write creating the report says so.
    if angelegt:
        response.status_code = HTTPStatus.CREATED

    return answer
