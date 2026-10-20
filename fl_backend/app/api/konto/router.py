from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.berechtigungen.crud import live_unbarred_grant_since
from app.api.bewerbungen.services import mint_token
from app.api.identitaet.crud import funktionen_aus
from app.api.identitaet.lookup import SubjektLookup
from app.api.identitaet.services import ist_eigener_schiedsrichter, ist_eigener_spieler, may_grant_on_schiedsrichter, may_grant_on_spieler
from app.api.konto.adresswechsel import (
    Bestand,
    Zeile,
    discard_the_change_in_session,
    ending_line,
    read_the_bestand,
    start_the_change_in_session,
)
from app.api.konto.schemas import (
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
    find_eigener_eintrag_refusal,
    kontext_zeile,
)
from app.api.schiedsrichter.services import (
    build_selbst_referee_pipeline,
    find_adresswechsel_expired_refusal,
    find_schiedsrichter_adresse_unveraendert_refusal,
)
from app.api.sperrliste.lookup import BanList, SperrlisteLookup
from app.api.spieler.services import build_selbst_pupil_pipeline, find_adresse_unveraendert_refusal, find_spieler_token_expired_refusal
from app.core.collections import Collection
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.crud import aggregate_many_from_db, patch_one_in_db, refuse
from app.core.dependencies import (
    AdressankerCollection,
    AktionenCollection,
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
from app.core.exception_handlers import DOCUMENT_NOT_FOUND_RESPONSE
from app.core.exceptions import DOCUMENT_NOT_FOUND, DocumentNotFoundException
from app.core.journal import Journal
from app.core.recording import log_stamp
from app.core.security import PERSON_ACTOR_BINDERS, KontaktIdentifier, verify_access_admin, verify_recent_person_confirmation
from app.core.transactions import transaction_session
from app.shared.adresswechsel import (
    ADRESSWECHSEL_FELD,
    als_utc,
    build_awaiting_approval_terms,
    build_pending_terms,
    compose_block,
    compose_link_update,
    wartet_auf,
)

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


def _adresswechsel_answer(bestand: Bestand, *, verwaltung: bool) -> FLKontoAdresswechselResponse:
    zeile = bestand.offen
    block = None if zeile is None else zeile.block

    return FLKontoAdresswechselResponse(
        moeglich=bestand.traeger is not None,
        bleibt_verwaltung=verwaltung,
        offen=None
        if block is None
        else FLKontoAdresswechselOffen(
            weg=block["weg"],
            wartet_auf=wartet_auf(block),
            gueltig_bis=als_utc(block.get("gueltig_bis")),
            wirksam_ab=als_utc(block.get("wirksam_ab")),
        ),
    )


async def _holds_a_grant(identifier: str, *, berechtigungen_collection: AsyncCollection, sperrliste: BanList) -> bool:
    return await live_unbarred_grant_since(identifier, berechtigungen_collection=berechtigungen_collection, sperrliste=sperrliste) is not None


@router.get("/adresswechsel", response_model=FLKontoAdresswechselResponse, summary="Whether a signed-in person may change their address")
async def get_adresswechsel(
    identifier: KontaktIdentifier,
    records: SubjektLookup,
    berechtigungen_collection: BerechtigungenCollection,
    sperrliste: SperrlisteLookup,
) -> FLKontoAdresswechselResponse:
    """
    Answer whether the signed-in address holds a record its own change moves, and the change pending on it.

    PERSON TIER. `moeglich` where the address holds a pupil row or a confirmed referee row; `bleibt_verwaltung` where it also
    holds an administrator's grant, which no change moves. **The pending address is never served**, here or to anyone on
    the side of the address on file: a change an administrator started may be a pretext whose target its holder must not
    learn either.
    """

    bestand = await read_the_bestand(identifier, records=records, session=None)

    return _adresswechsel_answer(
        bestand, verwaltung=await _holds_a_grant(identifier, berechtigungen_collection=berechtigungen_collection, sperrliste=sperrliste)
    )


@router.post(
    "/adresswechsel",
    response_model=FLKontoAdresswechselMintResponse,
    summary="Start a change of the signed-in person's address",
    dependencies=[Depends(verify_recent_person_confirmation), Depends(adresswechsel_gedrosselt)],
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
)
async def post_adresswechsel(
    identifier: KontaktIdentifier,
    adresswechsel_data: Annotated[FLKontoAdresswechselPayload, Body()],
    records: SubjektLookup,
    spieler_collection: SpielerCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    aktionen_collection: AktionenCollection,
    adressanker_collection: AdressankerCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    germany_now: datetime = Depends(get_germany_now),
) -> FLKontoAdresswechselMintResponse:
    """
    Start a change of the address the person signs in on, answering both raw links once, for the frontend's server to mail.

    The new mailbox is mailed its link, and the address on file a notice with a stop link; **every record the address holds
    as its person's own moves when the new mailbox confirms**, within `ADRESSWECHSEL_GUELTIG_STUNDEN`. A change already
    pending on any of those records is ended, an administrator's too: a sign-in at the address on file proves the mailbox is
    not lost. **Nothing about the new address is judged here** -- the ban list, another pupil and every record it holds are
    the confirmation's to judge -- so this start answers alike whatever the new address holds.

    Refused `REQ-AUTH-009` from a sign-in or confirmation, passkey or code, older than `ENROLMENT_WINDOW_MINUTES`;
    `REQ-FUNKTION-001` where the address holds no pupil row and no confirmed referee row; `REQ-SPIELER-007`, or
    `REQ-SCHIEDSRICHTER-012` where a referee row carries the change, where the typed address is the one signed in; and
    `REQ-DROSSELUNG-001` past the day's count of starts and approvals.
    """

    email = adresswechsel_data.email
    raw_token, token_hash = mint_token()
    raw_stopp, stopp_hash = mint_token()
    journal = Journal()

    @journal.attempted
    async def start_the_change(session: AsyncClientSession) -> tuple[Zeile, datetime]:
        bestand = await read_the_bestand(identifier, records=records, session=session)
        traeger = bestand.traeger
        refuse(find_eigener_eintrag_refusal(gehalten=traeger is not None))
        assert traeger is not None
        if traeger.collection == Collection.SPIELER:
            refuse(find_adresse_unveraendert_refusal(stored=identifier, email=email))
        else:
            refuse(find_schiedsrichter_adresse_unveraendert_refusal(stored=identifier, email=email))

        block = compose_block(email=email, weg="konto", token_hash=token_hash, stopp_hash=stopp_hash, grund=None, now=germany_now)
        await start_the_change_in_session(
            bestand=bestand,
            traeger=traeger,
            block=block,
            spieler_collection=spieler_collection,
            schiedsrichter_collection=schiedsrichter_collection,
            aktionen_collection=aktionen_collection,
            adressanker_collection=adressanker_collection,
            schluessel=config.sperrliste_schluessel,
            stamp=log_stamp(germany_now),
            journal=journal,
            session=session,
        )

        return traeger, block["gueltig_bis"]

    async with journal:
        async with transaction_session(db) as session:
            traeger, gueltig_bis = await session.with_transaction(start_the_change)

    return FLKontoAdresswechselMintResponse(
        art=traeger.art,
        id=traeger.row["_id"],
        token=raw_token,
        stopp_token=raw_stopp,
        gueltig_bis=gueltig_bis,
        email=email,
        bisherige_email=traeger.adresse,
        vorname=traeger.vorname,
    )


@router.post(
    "/adresswechsel/freigabe",
    response_model=FLKontoAdresswechselFreigabeResponse,
    summary="Approve the address change an administrator asked of the signed-in person",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
    dependencies=[Depends(verify_recent_person_confirmation), Depends(adresswechsel_gedrosselt)],
)
async def post_adresswechsel_freigabe(
    identifier: KontaktIdentifier,
    records: SubjektLookup,
    spieler_collection: SpielerCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    db: DBClient,
    germany_now: datetime = Depends(get_germany_now),
) -> FLKontoAdresswechselFreigabeResponse:
    """
    Approve a change an administrator started without a reason, minting the new mailbox's link once, for the frontend's server to mail.

    **Nothing reaches the new mailbox before this press** (`docs/backend/spec.md :: I794`). Nothing about the new address is
    judged here either: the approver is owed no answer about it, and the confirmation judges it.

    Refused `REQ-AUTH-009` as the start is; 404 where no such change awaits the address's approval; `REQ-SPIELER-002`, or
    `REQ-SCHIEDSRICHTER-003` where a referee row carries the change, past the approval's deadline; and `REQ-DROSSELUNG-001` as
    the start is.
    """

    raw_token, token_hash = mint_token()

    async def approve_the_change(session: AsyncClientSession) -> tuple[Zeile, Mapping[str, Any]]:
        bestand = await read_the_bestand(identifier, records=records, session=session)
        zeile = next((zeile for zeile in bestand.zeilen if zeile.block is not None and wartet_auf(zeile.block) == "freigabe"), None)
        if zeile is None:
            # The judgement names no address: the exception's filter reaches the log line.
            raise DocumentNotFoundException(filter=build_awaiting_approval_terms(), error_code=DOCUMENT_NOT_FOUND)
        if zeile.collection == Collection.SPIELER:
            refuse(find_spieler_token_expired_refusal(block=zeile.block, now=germany_now))
        else:
            refuse(find_adresswechsel_expired_refusal(block=zeile.block, now=germany_now))

        db_filter = {"_id": zeile.row["_id"], **build_awaiting_approval_terms()}
        update = compose_link_update(token_hash=token_hash, now=germany_now, freigabe=True)
        if zeile.collection == Collection.SPIELER:
            updated = await patch_one_in_db(
                collection=spieler_collection, db_filter=db_filter, update=update, session=session, return_document=ReturnDocument.AFTER
            )
        else:
            updated = await patch_one_in_db(
                collection=schiedsrichter_collection, db_filter=db_filter, update=update, session=session, return_document=ReturnDocument.AFTER
            )

        return zeile, updated[ADRESSWECHSEL_FELD]

    async with transaction_session(db) as session:
        zeile, wechsel = await session.with_transaction(approve_the_change)

    gueltig_bis = als_utc(wechsel["gueltig_bis"])
    assert gueltig_bis is not None

    return FLKontoAdresswechselFreigabeResponse(
        art=zeile.art, id=zeile.row["_id"], token=raw_token, gueltig_bis=gueltig_bis, email=wechsel["email"]
    )


@router.delete(
    "/adresswechsel",
    response_model=FLKontoAdresswechselResponse,
    summary="Stop the address change pending on the signed-in person",
    responses={404: DOCUMENT_NOT_FOUND_RESPONSE},
)
async def delete_adresswechsel(
    identifier: KontaktIdentifier,
    records: SubjektLookup,
    spieler_collection: SpielerCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    aktionen_collection: AktionenCollection,
    berechtigungen_collection: BerechtigungenCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    germany_now: datetime = Depends(get_germany_now),
) -> FLKontoAdresswechselResponse:
    """
    Stop the change pending on the signed-in address, the stop link's twin: its new address goes, out of every log image too.

    Asks no fresh confirmation and counts nothing: a stop hands nothing over. 404 where no change is pending on the address.
    """

    journal = Journal()

    @journal.attempted
    async def stop_the_change(session: AsyncClientSession) -> Bestand:
        bestand = await read_the_bestand(identifier, records=records, session=session)
        zeile = bestand.offen
        if zeile is None or zeile.block is None:
            raise DocumentNotFoundException(filter=build_pending_terms(), error_code=DOCUMENT_NOT_FOUND)

        await discard_the_change_in_session(
            collection=zeile.collection,
            spieler_collection=spieler_collection,
            schiedsrichter_collection=schiedsrichter_collection,
            aktionen_collection=aktionen_collection,
            db_filter={"_id": zeile.row["_id"], **build_pending_terms()},
            stamp=log_stamp(germany_now),
            session=session,
        )
        journal.note(
            ending_line(
                art="adresswechsel_gestoppt",
                neue=str(zeile.block["email"]),
                collection=zeile.collection,
                record_id=zeile.row["_id"],
                am=log_stamp(germany_now),
                schluessel=config.sperrliste_schluessel,
            )
        )

        return await read_the_bestand(identifier, records=records, session=session)

    async with journal:
        async with transaction_session(db) as session:
            bestand = await session.with_transaction(stop_the_change)

    return _adresswechsel_answer(
        bestand, verwaltung=await _holds_a_grant(identifier, berechtigungen_collection=berechtigungen_collection, sperrliste=sperrliste)
    )
