from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.adresswechsel.crud import end_the_change_in_session, ending_line, read_the_bestand, start_the_change_in_session
from app.api.adresswechsel.schemas import FLAdresswechselGenehmigungStand
from app.api.adresswechsel.services import (
    LIVE_TERMS,
    als_utc,
    build_address_filter,
    build_awaiting_approval_terms,
    compose_genehmigung,
    compose_link_update,
    compose_record,
    find_abgelaufen_refusal,
    find_beendet_refusal,
    find_kein_genehmiger_refusal,
    find_nichts_refusal,
    find_unveraendert_refusal,
    ist_abgelaufen,
    maskierte_adresse,
    wartet_auf,
)
from app.api.berechtigungen.crud import read_berechtigungen, read_the_announced
from app.api.berechtigungen.services import genehmiger_of, lebendige
from app.api.bewerbungen.services import mint_token
from app.api.identitaet.crud import funktionen_aus
from app.api.identitaet.lookup import RecordCollections, SubjektLookup
from app.api.identitaet.services import ist_eigener_schiedsrichter, ist_eigener_spieler, may_grant_on_schiedsrichter, may_grant_on_spieler
from app.api.konto.schemas import (
    FLKontoAdresswechselFreigabePayload,
    FLKontoAdresswechselFreigabeResponse,
    FLKontoAdresswechselMintResponse,
    FLKontoAdresswechselOffen,
    FLKontoAdresswechselPayload,
    FLKontoAdresswechselResponse,
    FLKontoEinwilligungenResponse,
)
from app.api.konto.services import (
    build_angenommene_bewerbungen_pipeline,
    build_kontext_teams_pipeline,
    build_selbst_bewerbung_pipeline,
    build_selbst_registrierung_pipeline,
    build_selbst_seat_pipeline,
    compose_bewerbungssitze_selbst,
    compose_registrierungen_selbst,
    compose_schiedsrichter_konto,
    compose_sitze_selbst,
    compose_spieler_konto,
    kontext_zeile,
)
from app.api.schiedsrichter.services import build_selbst_referee_pipeline
from app.api.sperrliste.lookup import SperrlisteLookup, adressen_gesperrt
from app.api.spieler.services import build_selbst_pupil_pipeline
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.crud import aggregate_many_from_db, patch_one_in_db, refuse
from app.core.dependencies import (
    AdressankerCollection,
    AdresswechselCollection,
    AktionenCollection,
    BerechtigungenAngekuendigtCollection,
    BerechtigungenCollection,
    BewerbungenCollection,
    DBClient,
    RegistrierungenCollection,
    SaisonTeamsCollection,
    SchiedsrichterCollection,
    SpielerCollection,
    TeamsCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.drosselung import adresswechsel_gedrosselt
from app.core.exception_handlers import DOCUMENT_NOT_FOUND_RESPONSE, DUPLICATE_KEY_RESPONSE
from app.core.exceptions import DOCUMENT_NOT_FOUND, DocumentNotFoundException
from app.core.journal import Journal
from app.core.recording import log_stamp
from app.core.security import PERSON_ACTOR_BINDERS, KontaktIdentifier, verify_access_admin, verify_recent_person_confirmation
from app.core.transactions import transaction_session
from app.shared.folding import sign_in_identifier

# Every person binder fixes a Funktion and this page is none's: `kontakt` is bound, its seat control
# having no page of its own. Its one write is the address change, which crosses every record the address holds.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/konto",
    dependencies=[Depends(verify_access_admin), Depends(PERSON_ACTOR_BINDERS["kontakt"])],
)


@router.get("/einwilligungen", response_model=FLKontoEinwilligungenResponse, summary="A signed-in person's own consent records")
async def get_einwilligungen(
    identifier: KontaktIdentifier,
    spieler_collection: SpielerCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    saison_teams_collection: SaisonTeamsCollection,
    teams_collection: TeamsCollection,
    bewerbungen_collection: BewerbungenCollection,
    registrierungen_collection: RegistrierungenCollection,
    records: SubjektLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLKontoEinwilligungenResponse:
    """
    Answer every confirmed consent record the signed-in address holds, its pupil, referee and contact-seat records alike.

    The seats come one entry per team season on which the address holds a confirmed seat, however many of its slots;
    `bewerbungen` one per PENDING application on which it does, whose two choices the account page may only withdraw;
    `registrierungen` one per pending registration its pupil confirmed, withdraw-only alike until the admission; a
    returning pupil's asked no choice, so it serves its stored data with both choices null and offers nothing to press.

    PERSON TIER, for the account page, which every signed-in person reaches: an address holding nothing is answered
    `spieler: null` and four empty lists, never refused. A retired record, a past season's seat and a withdrawn team's
    seat are served too, a withdrawal staying open wherever a consent stands; `kontext` carries what the record's
    confirmation page filled its words with, as those records stand today; `erteilbar` says whether a grant is
    admitted, `medien_angeboten` whether the media consent may be switched on. A record awaiting its person's
    confirmation is not served: there is nothing on it yet to change.
    """

    # A snapshot, so every record is answered as of one moment; never a transaction, which a read
    # writing nothing has no conflict to retry for.
    async with db.start_session(snapshot=True) as session:
        pupils = await aggregate_many_from_db(collection=spieler_collection, pipeline=build_selbst_pupil_pipeline(identifier), session=session)
        referees = await aggregate_many_from_db(
            collection=schiedsrichter_collection, pipeline=build_selbst_referee_pipeline(identifier), session=session
        )
        seat_rows = await aggregate_many_from_db(
            collection=saison_teams_collection, pipeline=build_selbst_seat_pipeline(identifier), session=session
        )
        bewerbung_rows = await aggregate_many_from_db(
            collection=bewerbungen_collection, pipeline=build_selbst_bewerbung_pipeline(identifier), session=session
        )
        registrierung_rows = await aggregate_many_from_db(
            collection=registrierungen_collection, pipeline=build_selbst_registrierung_pipeline(identifier), session=session
        )
        # From the rows read above, which the subject's own selections choose: a second read would answer the same.
        subjekt = await funktionen_aus(
            identifier,
            seat_rows=seat_rows,
            referee_rows=referees,
            pupil_rows=pupils,
            saisons_collection=records.saisons_collection,
            session=session,
        )

        pupil = next((row for row in pupils if ist_eigener_spieler(row)), None)
        zeile = None if pupil is None else kontext_zeile(pupil)
        team_ids = [
            *([] if zeile is None else [zeile["team_id"]]),
            *(row["team_id"] for row in seat_rows),
            # A school applying as a club the league already holds names it by `team_id` alone.
            *(row["team_id"] for row in bewerbung_rows if row.get("team_id") is not None),
            *(row["team_id"] for row in registrierung_rows),
        ]
        teams = {
            team["_id"]: team
            for team in await aggregate_many_from_db(
                collection=teams_collection, pipeline=build_kontext_teams_pipeline(team_ids), session=session
            )
        }
        bewerbungen = {
            (bewerbung["team_id"], bewerbung["saison_id"]): bewerbung
            for bewerbung in await aggregate_many_from_db(
                collection=bewerbungen_collection,
                pipeline=build_angenommene_bewerbungen_pipeline([row["team_id"] for row in seat_rows]),
                session=session,
            )
        }

        return FLKontoEinwilligungenResponse.model_validate(
            {
                "spieler": None
                if pupil is None
                else compose_spieler_konto(
                    pupil,
                    erteilbar=may_grant_on_spieler(subjekt, pupil["_id"]),
                    today=today,
                    team=None if zeile is None else teams.get(zeile["team_id"]),
                ),
                "schiedsrichter": [
                    compose_schiedsrichter_konto(row, erteilbar=may_grant_on_schiedsrichter(subjekt, row["_id"]), today=today)
                    for row in referees
                    if ist_eigener_schiedsrichter(row, identifier)
                ],
                "sitze": compose_sitze_selbst(
                    seat_rows, identifier, sitze_mit_panel=subjekt.sitze, today=today, teams=teams, bewerbungen=bewerbungen
                ),
                "bewerbungen": compose_bewerbungssitze_selbst(bewerbung_rows, identifier, teams=teams),
                "registrierungen": compose_registrierungen_selbst(registrierung_rows, identifier, teams=teams),
            }
        )


# --- The ADDRESS CHANGE the person starts, approves and stops for themselves. Recorded under `kontakt`, as the erasure
# is: the change crosses every Funktion the address holds.


def _offen(record: Mapping[str, Any]) -> FLKontoAdresswechselOffen:
    genehmigung = record.get("genehmigung")
    gestand = None
    if isinstance(genehmigung, Mapping):
        bis = als_utc(genehmigung.get("bis"))
        assert bis is not None
        gestand = FLAdresswechselGenehmigungStand(
            verwaltung=genehmigung["verwaltung"], genehmigt=genehmigung.get("genehmigt_am") is not None, bis=bis
        )

    return FLKontoAdresswechselOffen(
        id=record["_id"],
        # The address the person typed here is theirs to see; one an administrator typed is shown recognisable alone.
        email=record["email"] if record["weg"] == "konto" else maskierte_adresse(str(record["email"])),
        weg=record["weg"],
        wartet_auf=wartet_auf(record),
        gueltig_bis=als_utc(record.get("gueltig_bis")),
        wirksam_ab=als_utc(record.get("wirksam_ab")),
        genehmigung=gestand,
    )


async def _adresswechsel_answer(
    identifier: str,
    *,
    records: RecordCollections,
    adresswechsel_collection: AsyncCollection,
    berechtigungen_collection: AsyncCollection,
    session: AsyncClientSession | None,
) -> FLKontoAdresswechselResponse:
    bestand = await read_the_bestand(identifier, records=records, berechtigungen_collection=berechtigungen_collection, session=session)
    record = await adresswechsel_collection.find_one(build_address_filter(identifier), session=session)

    return FLKontoAdresswechselResponse(moeglich=not bestand.leer, offen=None if record is None else _offen(record))


@router.get("/adresswechsel", response_model=FLKontoAdresswechselResponse, summary="Whether a signed-in person may change their address")
async def get_adresswechsel(
    identifier: KontaktIdentifier,
    records: SubjektLookup,
    adresswechsel_collection: AdresswechselCollection,
    berechtigungen_collection: BerechtigungenCollection,
    db: DBClient,
) -> FLKontoAdresswechselResponse:
    """
    Answer whether the signed-in address holds anything its own change moves, and the change pending on it.

    PERSON TIER. `moeglich` where the address holds a pupil row, a confirmed referee row, a confirmed contact seat, a
    registration or a grant. **The pending address is served masked where an administrator started the change**, whole
    only where the person typed it here: a change an administrator started may be a pretext whose target the holder of
    the address on file must not learn. `genehmigung` is the approval a change moving the person's grant waits on.
    """

    # A snapshot, so the records and the change are answered as of one moment.
    async with db.start_session(snapshot=True) as session:
        return await _adresswechsel_answer(
            identifier,
            records=records,
            adresswechsel_collection=adresswechsel_collection,
            berechtigungen_collection=berechtigungen_collection,
            session=session,
        )


@router.post(
    "/adresswechsel",
    response_model=FLKontoAdresswechselMintResponse,
    summary="Start a change of the signed-in person's address",
    dependencies=[Depends(verify_recent_person_confirmation), Depends(adresswechsel_gedrosselt)],
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE, 409: DUPLICATE_KEY_RESPONSE},
)
async def post_adresswechsel(
    identifier: KontaktIdentifier,
    adresswechsel_data: Annotated[FLKontoAdresswechselPayload, Body()],
    records: SubjektLookup,
    adresswechsel_collection: AdresswechselCollection,
    berechtigungen_collection: BerechtigungenCollection,
    berechtigungen_angekuendigt_collection: BerechtigungenAngekuendigtCollection,
    sperrliste: SperrlisteLookup,
    aktionen_collection: AktionenCollection,
    adressanker_collection: AdressankerCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    germany_now: datetime = Depends(get_germany_now),
) -> FLKontoAdresswechselMintResponse:
    """
    Start a change of the address the person signs in on, answering both raw links once, for the frontend's server to mail.

    The new mailbox is mailed its link, and the address on file a notice with a stop link; **everything the address holds
    as its person's own moves when the new mailbox confirms**, within `ADRESSWECHSEL_GUELTIG_STUNDEN`. Where it holds a
    grant, the change also waits on another administrator's approval, an owner's for an owner's grant, and
    `genehmiger` names whom the frontend's server tells. The address's live change ends replaced, an administrator's too:
    a sign-in at the address on file proves the mailbox is not lost. **Nothing about the new address is judged here** --
    the ban list, another pupil, a grant it holds -- so this start answers alike whatever the new address holds.

    Refused `REQ-AUTH-009` from a sign-in or confirmation, passkey or code, older than `ENROLMENT_WINDOW_MINUTES`;
    `REQ-ADRESSWECHSEL-010` where the address holds nothing a change moves; `-007` where the typed address is the one
    signed in; `-011` where nobody could approve the grant's move, the last owner making another first; and
    `REQ-DROSSELUNG-001` past the day's count of starts and approvals.
    """

    email = adresswechsel_data.email
    raw_token, token_hash = mint_token()
    raw_stopp, stopp_hash = mint_token()
    journal = Journal()

    @journal.attempted
    async def start_the_change(session: AsyncClientSession) -> FLKontoAdresswechselMintResponse:
        bestand = await read_the_bestand(identifier, records=records, berechtigungen_collection=berechtigungen_collection, session=session)
        refuse(find_nichts_refusal(leer=bestand.leer))
        refuse(find_unveraendert_refusal(adresse=identifier, email=email, folded=sign_in_identifier(email)))

        genehmiger: list[str] = []
        genehmigung = None
        if bestand.berechtigung is not None:
            grants = await read_berechtigungen(berechtigungen_collection=berechtigungen_collection, session=session)
            announced = await read_the_announced(berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection, session=session)
            gesperrt = await adressen_gesperrt(sperrliste, [str(row["adresse"]) for row in lebendige(grants)], session=session)
            verwaltung = str(bestand.berechtigung["verwaltung"])
            genehmiger = genehmiger_of(
                verwaltung=verwaltung, ausgenommen={identifier}, grants=grants, announced=announced, gesperrt=gesperrt, vor=germany_now
            )
            refuse(find_kein_genehmiger_refusal(genehmiger=len(genehmiger)))
            genehmigung = compose_genehmigung(verwaltung=verwaltung, gestartet_von=identifier, now=germany_now)

        record = compose_record(
            adresse=identifier,
            email=email,
            weg="konto",
            token_hash=token_hash,
            stopp_hash=stopp_hash,
            grund=None,
            genehmigung=genehmigung,
            now=germany_now,
        )
        adresswechsel_id = await start_the_change_in_session(
            record=record,
            adresswechsel_collection=adresswechsel_collection,
            aktionen_collection=aktionen_collection,
            adressanker_collection=adressanker_collection,
            schluessel=config.sperrliste_schluessel,
            now=germany_now,
            journal=journal,
            session=session,
        )

        return FLKontoAdresswechselMintResponse(
            id=adresswechsel_id,
            token=raw_token,
            stopp_token=raw_stopp,
            gueltig_bis=record["gueltig_bis"],
            email=email,
            bisherige_email=identifier,
            vorname=bestand.vorname,
            genehmiger=genehmiger,
        )

    async with journal:
        async with transaction_session(db) as session:
            return await session.with_transaction(start_the_change)


@router.post(
    "/adresswechsel/freigabe",
    response_model=FLKontoAdresswechselFreigabeResponse,
    summary="Approve the address change an administrator asked of the signed-in person",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
    dependencies=[Depends(verify_recent_person_confirmation), Depends(adresswechsel_gedrosselt)],
)
async def post_adresswechsel_freigabe(
    identifier: KontaktIdentifier,
    freigabe_data: Annotated[FLKontoAdresswechselFreigabePayload, Body()],
    adresswechsel_collection: AdresswechselCollection,
    db: DBClient,
    germany_now: datetime = Depends(get_germany_now),
) -> FLKontoAdresswechselFreigabeResponse:
    """
    Approve the change `id` names, which an administrator started without a reason, minting the new mailbox's link once.

    **Nothing reaches the new mailbox before this press** (`docs/backend/spec.md :: I794`). Nothing about the new address is
    judged here either: the approver is owed no answer about it, and the confirmation judges it. **The press approves the
    change its page showed alone**: an administrator's later start replaces that one, and its id then names an ended change.

    Refused `REQ-AUTH-009` as the start is; `REQ-ADRESSWECHSEL-002` where the change `id` names has ended; 404 where it
    is no change of this address awaiting its approval; `REQ-ADRESSWECHSEL-003` past the approval's deadline; and
    `REQ-DROSSELUNG-001` as the start is.
    """

    raw_token, token_hash = mint_token()
    adresswechsel_id = freigabe_data.id
    db_filter = {"_id": adresswechsel_id, **build_address_filter(identifier), **build_awaiting_approval_terms()}

    async def approve_the_change(session: AsyncClientSession) -> Mapping[str, Any]:
        record = await adresswechsel_collection.find_one(db_filter, session=session)
        if record is None:
            ended = await adresswechsel_collection.find_one(
                {"_id": adresswechsel_id, "beendet": {"$type": "object"}}, {"_id": 1}, session=session
            )
            refuse(find_beendet_refusal(offen=ended is None))
            # The judgement names no address: the exception's filter reaches the log line.
            raise DocumentNotFoundException(filter={"_id": adresswechsel_id, **build_awaiting_approval_terms()}, error_code=DOCUMENT_NOT_FOUND)
        refuse(find_abgelaufen_refusal(abgelaufen=ist_abgelaufen(record, now=germany_now)))

        return await patch_one_in_db(
            collection=adresswechsel_collection,
            db_filter={"_id": record["_id"], **LIVE_TERMS},
            update=compose_link_update(token_hash=token_hash, now=germany_now, freigabe=True),
            session=session,
            return_document=ReturnDocument.AFTER,
        )

    async with transaction_session(db) as session:
        record = await session.with_transaction(approve_the_change)

    gueltig_bis = als_utc(record["gueltig_bis"])
    assert gueltig_bis is not None

    return FLKontoAdresswechselFreigabeResponse(id=record["_id"], token=raw_token, gueltig_bis=gueltig_bis, email=record["email"])


@router.delete(
    "/adresswechsel",
    response_model=FLKontoAdresswechselResponse,
    summary="Stop the address change pending on the signed-in person",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
)
async def delete_adresswechsel(
    identifier: KontaktIdentifier,
    records: SubjektLookup,
    adresswechsel_collection: AdresswechselCollection,
    berechtigungen_collection: BerechtigungenCollection,
    aktionen_collection: AktionenCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    germany_now: datetime = Depends(get_germany_now),
) -> FLKontoAdresswechselResponse:
    """
    Stop the change pending on the signed-in address, the stop link's twin: its new address goes, out of every log image too.

    Asks no fresh confirmation and counts nothing: a stop hands nothing over. 404 where no change is pending on the address.
    """

    stamp = log_stamp(germany_now)
    journal = Journal()

    @journal.attempted
    async def stop_the_change(session: AsyncClientSession) -> FLKontoAdresswechselResponse:
        live = await adresswechsel_collection.find_one(build_address_filter(identifier), {"_id": 1}, session=session)
        if live is None:
            # The judgement names no address: the exception's filter reaches the log line.
            raise DocumentNotFoundException(filter=dict(LIVE_TERMS), error_code=DOCUMENT_NOT_FOUND)

        stored = await end_the_change_in_session(
            adresswechsel_collection=adresswechsel_collection,
            aktionen_collection=aktionen_collection,
            db_filter={"_id": live["_id"]},
            art="gestoppt",
            now=germany_now,
            stamp=stamp,
            session=session,
        )
        journal.note(
            ending_line(
                art="adresswechsel_gestoppt",
                neue=str(stored["email"]),
                record_id=stored["_id"],
                am=stamp,
                schluessel=config.sperrliste_schluessel,
            )
        )

        return await _adresswechsel_answer(
            identifier,
            records=records,
            adresswechsel_collection=adresswechsel_collection,
            berechtigungen_collection=berechtigungen_collection,
            session=session,
        )

    async with journal:
        async with transaction_session(db) as session:
            return await session.with_transaction(stop_the_change)
