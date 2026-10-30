from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.adresswechsel.crud import (
    Belegung,
    Bestand,
    adresse_belegt,
    end_the_change_in_session,
    ending_line,
    queue_the_approval_notice_in_session,
    read_the_bestand,
    refusal_of,
    start_the_change_in_session,
    take_effect_in_session,
)
from app.api.adresswechsel.schemas import (
    FLAdresswechselGenehmigungResponse,
    FLAdresswechselIdResponse,
    FLAdresswechselVerwaltungAnsichtPayload,
    FLAdresswechselVerwaltungAnsichtResponse,
    FLAdresswechselVerwaltungBestand,
    FLAdresswechselVerwaltungGenehmigung,
    FLAdresswechselVerwaltungMintResponse,
    FLAdresswechselVerwaltungOffen,
    FLAdresswechselVerwaltungPayload,
)
from app.api.adresswechsel.services import (
    als_utc,
    build_address_filter,
    build_live_filter,
    build_resendable_terms,
    compose_genehmigt_update,
    compose_genehmigung,
    compose_link_update,
    compose_record,
    find_abgelaufen_refusal,
    find_beendet_refusal,
    find_belegt_refusal,
    find_genehmigung_verwehrt_refusal,
    find_gesperrt_refusal,
    find_kein_genehmiger_refusal,
    find_keine_genehmigung_offen_refusal,
    find_nichts_refusal,
    find_unveraendert_refusal,
    find_vergeben_refusal,
    genehmigung_offen,
    ist_abgelaufen,
    ist_faellig,
    wartet_auf,
)
from app.api.berechtigungen.crud import read_berechtigungen, read_the_announced
from app.api.berechtigungen.schemas import FLAdresswechselWeg
from app.api.berechtigungen.services import genehmiger_of, genehmigung_verwehrt, holds_an_owners_power, lebendige
from app.api.bewerbungen.services import mint_token
from app.api.identitaet.lookup import SubjektLookup
from app.api.identitaet.services import JEDE_VERWALTUNG, find_eigene_adresse_refusal, find_verwaltung_adresse_refusal
from app.api.sperrliste.lookup import BanList, SperrlisteLookup, adressen_gesperrt, hash_gesperrt, sperrliste_saison
from app.api.spieler.crud import another_pupil_holds
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.crud import patch_one_in_db, refuse
from app.core.dependencies import (
    AdresswechselCollection,
    AdresswechselPostausgangCollection,
    AktionenCollection,
    BerechtigungenAngekuendigtCollection,
    BerechtigungenAntraegeCollection,
    BerechtigungenCollection,
    BerechtigungenPostausgangCollection,
    BewerbungenCollection,
    DBClient,
    EinladungenCollection,
    RegistrierungenCollection,
    SaisonTeamsCollection,
    SchiedsrichterCollection,
    SperrlisteCollection,
    SpielbestaetigungenCollection,
    SpielerCollection,
    get_germany_now,
)
from app.core.exceptions import DocumentNotFoundError
from app.core.journal import Journal
from app.core.recording import log_stamp
from app.core.routing import by_id
from app.core.security import (
    bind_actor,
    get_actor_auth_time,
    get_actor_email,
    verify_access_admin,
    verify_actor_is_admin,
    verify_recent_confirmation,
    verify_step_up,
)
from app.core.transactions import transaction_session
from app.shared.folding import sign_in_identifier
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/adresswechsel",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)


async def _refuse_the_address(
    identifier: str,
    *,
    akteur: str,
    auth_time: int,
    berechtigungen_collection: AsyncCollection,
    berechtigungen_angekuendigt_collection: AsyncCollection,
    session: AsyncClientSession,
) -> tuple[list[Mapping[str, Any]], list[Mapping[str, Any]]]:
    """The erasure tool's two refusals about who asks, judged on the grants read here, which the caller reuses.

    The administrator's own address (`REQ-PURGE-003`), and a grant holder's unless they hold an owner's power (`REQ-PURGE-005`).
    """

    refuse(find_eigene_adresse_refusal(identifier=identifier, akteur=akteur))
    grants = await read_berechtigungen(berechtigungen_collection=berechtigungen_collection, session=session)
    announced = await read_the_announced(berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection, session=session)
    refuse(
        find_verwaltung_adresse_refusal(
            identifier=identifier, akteur=akteur, auth_time=auth_time, grants=grants, announced=announced, geschuetzt=JEDE_VERWALTUNG
        )
    )

    return grants, announced


async def _pull_the_change(
    adresswechsel_collection: AsyncCollection, adresswechsel_id: Any, *, session: AsyncClientSession | None
) -> Mapping[str, Any]:
    """The change an id names, ended or not: 404 where none is kept, `REQ-ADRESSWECHSEL-002` where it ended."""

    record = await adresswechsel_collection.find_one({"_id": adresswechsel_id}, session=session)
    if record is None:
        raise DocumentNotFoundError()
    refuse(find_beendet_refusal(offen=record.get("beendet") is None))

    return record


def _offen(record: Mapping[str, Any], *, now: datetime) -> FLAdresswechselVerwaltungOffen:
    genehmigung = record.get("genehmigung")

    return FLAdresswechselVerwaltungOffen(
        id=record["_id"],
        email=record["email"],
        weg=record["weg"],
        grund=record.get("grund"),
        wartet_auf=wartet_auf(record),
        verschickt_am=record["verschickt_am"],
        gueltig_bis=als_utc(record.get("gueltig_bis")),
        freigegeben_am=als_utc(record.get("freigegeben_am")),
        bestaetigt_am=als_utc(record.get("bestaetigt_am")),
        wirksam_ab=als_utc(record.get("wirksam_ab")),
        zustellung=(record.get("versand") or {}).get("zustellung"),
        abgelaufen=ist_abgelaufen(record, now=now),
        genehmigung=None if not isinstance(genehmigung, Mapping) else FLAdresswechselVerwaltungGenehmigung.model_validate(genehmigung),
    )


def _bestand(bestand: Bestand) -> FLAdresswechselVerwaltungBestand:
    return FLAdresswechselVerwaltungBestand(
        spieler=0 if bestand.spieler is None else 1,
        schiedsrichter=len(bestand.schiedsrichter),
        sitze=sum(len(slots) for _, slots in bestand.sitze),
        bewerbungssitze=sum(len(slots) for _, slots in bestand.bewerbungssitze),
        registrierungen=len(bestand.registrierungen),
        berechtigung=None if bestand.berechtigung is None else bestand.berechtigung["verwaltung"],
    )


@router.post(
    "/ansicht",
    response_model=FLAdresswechselVerwaltungAnsichtResponse,
    summary="Show what an address holds that a change moves, and its live change",
)
async def get_adresswechsel_verwaltung_ansicht(
    ansicht_data: Annotated[FLAdresswechselVerwaltungAnsichtPayload, Body()],
    adresswechsel_collection: AdresswechselCollection,
    records: SubjektLookup,
    berechtigungen_collection: BerechtigungenCollection,
    berechtigungen_angekuendigt_collection: BerechtigungenAngekuendigtCollection,
    db: DBClient,
    operator: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
    germany_now: datetime = Depends(get_germany_now),
) -> FLAdresswechselVerwaltungAnsichtResponse:
    """
    Answer what the typed address holds that a change moves, by kind, and its live change whole, the new address and reason included.

    ADMIN TIER, the address tool's read, keyed by the address the administrator types or by a change a page links to;
    never a hash. `moeglich` where the address holds anything a change moves, a grant included. Stores nothing.

    Refused as the erasure's reveal is: the administrator's own address (`REQ-PURGE-003`), and an address holding a live
    grant unless the administrator holds an owner's power (`REQ-PURGE-005`). A change id answers 404 where no change is
    kept, and `REQ-ADRESSWECHSEL-002` where it ended.
    """

    akteur = sign_in_identifier(operator)

    # A snapshot, so the tool names the records of one moment; never a transaction, a read writing nothing having no
    # conflict to retry for.
    async with db.start_session(snapshot=True) as session:
        if ansicht_data.adresswechsel_id is not None:
            identifier = str((await _pull_the_change(adresswechsel_collection, ansicht_data.adresswechsel_id, session=session))["adresse"])
        else:
            identifier = sign_in_identifier(str(ansicht_data.adresse))
        await _refuse_the_address(
            identifier,
            akteur=akteur,
            auth_time=auth_time,
            berechtigungen_collection=berechtigungen_collection,
            berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
            session=session,
        )
        bestand = await read_the_bestand(identifier, records=records, berechtigungen_collection=berechtigungen_collection, session=session)
        offen = await adresswechsel_collection.find_one(build_address_filter(identifier), session=session)

    return FLAdresswechselVerwaltungAnsichtResponse(
        adresse=identifier,
        bestand=_bestand(bestand),
        moeglich=not bestand.leer,
        offen=None if offen is None else _offen(offen, now=germany_now),
    )


async def _genehmiger(
    bestand: Bestand,
    *,
    akteur: str,
    grants: list[Mapping[str, Any]],
    announced: list[Mapping[str, Any]],
    sperrliste: BanList,
    now: datetime,
    session: AsyncClientSession,
) -> list[str]:
    """Who could approve a change of this address's grant, the start's actor excluded; refused `-011` where nobody could."""

    assert bestand.berechtigung is not None
    gesperrt = await adressen_gesperrt(sperrliste, [str(row["adresse"]) for row in lebendige(grants)], session=session)
    genehmiger = genehmiger_of(
        verwaltung=str(bestand.berechtigung["verwaltung"]),
        ausgenommen={bestand.identifier, akteur},
        grants=grants,
        announced=announced,
        gesperrt=gesperrt,
        vor=now,
    )
    refuse(find_kein_genehmiger_refusal(genehmiger=len(genehmiger)))

    return genehmiger


@router.post(
    "",
    response_model=FLAdresswechselVerwaltungMintResponse,
    summary="Start an address change for a person who says they cannot sign in",
    dependencies=[Depends(verify_step_up)],
)
async def post_adresswechsel_verwaltung(
    adresswechsel_data: Annotated[FLAdresswechselVerwaltungPayload, Body()],
    adresswechsel_collection: AdresswechselCollection,
    records: SubjektLookup,
    spieler_collection: SpielerCollection,
    berechtigungen_collection: BerechtigungenCollection,
    berechtigungen_angekuendigt_collection: BerechtigungenAngekuendigtCollection,
    berechtigungen_postausgang_collection: BerechtigungenPostausgangCollection,
    berechtigungen_antraege_collection: BerechtigungenAntraegeCollection,
    adresswechsel_postausgang_collection: AdresswechselPostausgangCollection,
    sperrliste: SperrlisteLookup,
    aktionen_collection: AktionenCollection,
    db: DBClient,
    operator: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
    germany_now: datetime = Depends(get_germany_now),
) -> FLAdresswechselVerwaltungMintResponse:
    """
    Start a change of the typed address for a person who says they cannot sign in, answering its raw links once, for the caller to mail.

    **Nothing moves here.** Without a `grund` the change asks the address on file first: the caller mails it the request
    with its stop link, and nothing goes to the new mailbox until that address approves on its account page. With a
    `grund`, recording how the administrator established who asks, the caller mails the new mailbox its link and the
    address on file a notice with its stop link; the change then takes effect `ADRESSWECHSEL_WARTEZEIT_TAGE` after the new
    mailbox confirms. Where the address holds a grant, the change also waits on another administrator's approval, never
    this one's: `genehmiger_anzahl` counts who could give it, and the grants' outbox tells them (`POST /berechtigungen/abgleich`).
    The address's live change ends replaced.

    Refused the administrator's own address (`REQ-PURGE-003`), a grant holder's without an owner's power
    (`REQ-PURGE-005`), the address on file typed again (`REQ-ADRESSWECHSEL-007`), a new address the ban list holds
    (`-009`), an address holding nothing a change moves (`-010`), a new address another pupil signs in on where the
    change moves a pupil (`-006`), a new address any entry names, confirmed or not (`-018`), and a grant nobody could
    approve (`-011`).
    """

    identifier, email, grund = sign_in_identifier(str(adresswechsel_data.adresse)), str(adresswechsel_data.email), adresswechsel_data.grund
    akteur = sign_in_identifier(operator)
    weg: FLAdresswechselWeg = "freigabe" if grund is None else "wartezeit"
    raw_token, token_hash = mint_token()
    raw_stopp, stopp_hash = mint_token()
    gehasht = sperrliste.hash_of(email)
    # Outside the transaction (`app/api/sperrliste/crud.py :: address_is_gesperrt`).
    massgebliche_saison_id = await sperrliste_saison(sperrliste)
    journal = Journal()

    @journal.attempted
    async def judge_and_start_the_change(session: AsyncClientSession) -> FLAdresswechselVerwaltungMintResponse:
        grants, announced = await _refuse_the_address(
            identifier,
            akteur=akteur,
            auth_time=auth_time,
            berechtigungen_collection=berechtigungen_collection,
            berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
            session=session,
        )
        refuse(find_unveraendert_refusal(adresse=identifier, folded=sign_in_identifier(email)))
        refuse(
            find_gesperrt_refusal(
                gesperrt=await hash_gesperrt(sperrliste, gehasht, massgebliche_saison_id=massgebliche_saison_id, session=session)
            )
        )

        bestand = await read_the_bestand(identifier, records=records, berechtigungen_collection=berechtigungen_collection, session=session)
        refuse(find_nichts_refusal(leer=bestand.leer))
        vergeben = bestand.spieler is not None and await another_pupil_holds(
            spieler_collection=spieler_collection, identifier=sign_in_identifier(email), spieler_id=bestand.spieler["_id"], session=session
        )
        refuse(find_vergeben_refusal(vergeben=vergeben))
        # Judged here too, its reader trusted: a change its confirmation would refuse goes nowhere.
        refuse(
            find_belegt_refusal(
                belegt=await adresse_belegt(
                    email,
                    records=records,
                    belegung=Belegung(
                        berechtigungen_collection=berechtigungen_collection,
                        berechtigungen_antraege_collection=berechtigungen_antraege_collection,
                        adresswechsel_postausgang_collection=adresswechsel_postausgang_collection,
                        now=germany_now,
                    ),
                    session=session,
                )
            )
        )
        genehmiger = (
            []
            if bestand.berechtigung is None
            else await _genehmiger(
                bestand, akteur=akteur, grants=grants, announced=announced, sperrliste=sperrliste, now=germany_now, session=session
            )
        )

        record = compose_record(
            adresse=identifier,
            email=email,
            weg=weg,
            token_hash=None if weg == "freigabe" else token_hash,
            stopp_hash=stopp_hash,
            grund=grund,
            genehmigung=None
            if bestand.berechtigung is None
            else compose_genehmigung(verwaltung=str(bestand.berechtigung["verwaltung"]), gestartet_von=akteur, now=germany_now),
            now=germany_now,
        )
        adresswechsel_id = await start_the_change_in_session(
            record=record,
            adresswechsel_collection=adresswechsel_collection,
            aktionen_collection=aktionen_collection,
            schluessel=sperrliste.schluessel,
            now=germany_now,
            journal=journal,
            session=session,
        )
        if record["genehmigung"] is not None:
            await queue_the_approval_notice_in_session(
                adresswechsel_id=adresswechsel_id,
                gestartet_von=akteur,
                berechtigungen_postausgang_collection=berechtigungen_postausgang_collection,
                now=germany_now,
                session=session,
            )

        return FLAdresswechselVerwaltungMintResponse(
            id=adresswechsel_id,
            weg=weg,
            token=None if weg == "freigabe" else raw_token,
            stopp_token=raw_stopp,
            gueltig_bis=record["gueltig_bis"],
            email=email,
            bisherige_email=identifier,
            vorname=None if weg == "wartezeit" else bestand.vorname,
            genehmiger_anzahl=len(genehmiger),
        )

    # ONE transaction over the judgement and the write: a record written outside it would stand with a live link an
    # administrator was then told had been refused.
    async with journal:
        async with transaction_session(db) as session:
            return await session.with_transaction(judge_and_start_the_change)


@router.post(
    f"{by_id('adresswechsel_id')}/einladen",
    response_model=FLAdresswechselVerwaltungMintResponse,
    summary="Send a pending address a fresh link",
    dependencies=[Depends(verify_step_up)],
)
async def einladen_adresswechsel(
    adresswechsel_id: CustomRouteObjectId,
    adresswechsel_collection: AdresswechselCollection,
    records: SubjektLookup,
    spieler_collection: SpielerCollection,
    berechtigungen_collection: BerechtigungenCollection,
    berechtigungen_angekuendigt_collection: BerechtigungenAngekuendigtCollection,
    berechtigungen_antraege_collection: BerechtigungenAntraegeCollection,
    adresswechsel_postausgang_collection: AdresswechselPostausgangCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    operator: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
    germany_now: datetime = Depends(get_germany_now),
) -> FLAdresswechselVerwaltungMintResponse:
    """
    Mint the new mailbox a fresh link for the change this id names, answering the raw token once, for the caller to mail.

    The previous link stops working at once and the delivery state of the message it went out in goes with it; the
    deadline restarts now. The stop link stays, so the address on file is mailed nothing again. A lapsed link is no
    refusal while the change stands, which is until the next hourly pass ends it. Acts
    on the change the id names alone, so a page showing a change since replaced re-sends nothing.

    Refused as the start is about who asks (`REQ-PURGE-003`, `REQ-PURGE-005`), where the ban list holds the pending address
    (`REQ-ADRESSWECHSEL-009`), where another pupil has come to sign in on it (`-006`), where an entry has come to name it,
    confirmed or not (`-018`), where a grant's approval week has passed (`-003`), and where the change ended (`-002`). 404 for
    an id naming no change, and unless the change waits on the new mailbox: one awaiting the address on file's approval,
    or confirmed, has no link to re-send.
    """

    akteur = sign_in_identifier(operator)
    raw_token, token_hash = mint_token()
    # Outside the transaction (`app/api/sperrliste/crud.py :: address_is_gesperrt`).
    massgebliche_saison_id = await sperrliste_saison(sperrliste)

    async def judge_and_remint_the_change(session: AsyncClientSession) -> FLAdresswechselVerwaltungMintResponse:
        record = await _pull_the_change(adresswechsel_collection, adresswechsel_id, session=session)
        identifier = str(record["adresse"])
        await _refuse_the_address(
            identifier,
            akteur=akteur,
            auth_time=auth_time,
            berechtigungen_collection=berechtigungen_collection,
            berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
            session=session,
        )
        email = str(record["email"])
        refuse(
            find_gesperrt_refusal(
                gesperrt=await hash_gesperrt(
                    sperrliste, sperrliste.hash_of(email), massgebliche_saison_id=massgebliche_saison_id, session=session
                )
            )
        )
        bestand = await read_the_bestand(identifier, records=records, berechtigungen_collection=berechtigungen_collection, session=session)
        vergeben = bestand.spieler is not None and await another_pupil_holds(
            spieler_collection=spieler_collection, identifier=sign_in_identifier(email), spieler_id=bestand.spieler["_id"], session=session
        )
        refuse(find_vergeben_refusal(vergeben=vergeben))
        refuse(
            find_belegt_refusal(
                belegt=await adresse_belegt(
                    email,
                    records=records,
                    belegung=Belegung(
                        berechtigungen_collection=berechtigungen_collection,
                        berechtigungen_antraege_collection=berechtigungen_antraege_collection,
                        adresswechsel_postausgang_collection=adresswechsel_postausgang_collection,
                        now=germany_now,
                    ),
                    session=session,
                )
            )
        )
        # A grant's approval week that lapsed ends the change at the next pass: a fresh link would be refused on its press.
        genehmigung = record.get("genehmigung")
        bis = als_utc(genehmigung.get("bis")) if isinstance(genehmigung, Mapping) and genehmigung.get("genehmigt_am") is None else None
        refuse(find_abgelaufen_refusal(abgelaufen=bis is not None and bis <= germany_now))

        # The filter is the judgement: a change awaiting its approval or confirmed is the 404 here.
        updated = await patch_one_in_db(
            collection=adresswechsel_collection,
            db_filter=build_live_filter(adresswechsel_id, build_resendable_terms()),
            update=compose_link_update(token_hash=token_hash, now=germany_now, freigabe=False),
            session=session,
            return_document=ReturnDocument.AFTER,
        )
        gueltig_bis = als_utc(updated["gueltig_bis"])
        assert gueltig_bis is not None

        return FLAdresswechselVerwaltungMintResponse(
            id=adresswechsel_id,
            weg=updated["weg"],
            token=raw_token,
            stopp_token=None,
            gueltig_bis=gueltig_bis,
            email=email,
            bisherige_email=identifier,
            vorname=None if updated["weg"] == "wartezeit" else bestand.vorname,
            genehmiger_anzahl=0,
        )

    async with transaction_session(db) as session:
        return await session.with_transaction(judge_and_remint_the_change)


@router.delete(
    by_id("adresswechsel_id"),
    response_model=FLAdresswechselIdResponse,
    summary="Discard a pending address change",
    dependencies=[Depends(verify_step_up)],
)
async def delete_adresswechsel(
    adresswechsel_id: CustomRouteObjectId,
    adresswechsel_collection: AdresswechselCollection,
    berechtigungen_collection: BerechtigungenCollection,
    berechtigungen_angekuendigt_collection: BerechtigungenAngekuendigtCollection,
    aktionen_collection: AktionenCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    operator: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
    germany_now: datetime = Depends(get_germany_now),
) -> FLAdresswechselIdResponse:
    """
    Discard the change this id names: its links open nothing to press, and the address on file stays.

    **Its address goes from the action log too**: every image the log holds of the change
    loses its new address and reason, the rest of each image standing. Journalled as the stop is, so a restore does not
    bring back a change confirmed in its waiting time to take effect. Nothing is mailed. Acts on the change the id names
    alone, so a page showing a change since replaced discards nothing.

    Refused as the start is about who asks (`REQ-PURGE-003`, `REQ-PURGE-005`), and where the change ended
    (`REQ-ADRESSWECHSEL-002`); 404 for an id naming no change.
    """

    akteur = sign_in_identifier(operator)
    stamp = log_stamp(germany_now)
    journal = Journal()

    @journal.attempted
    async def discard_the_change(session: AsyncClientSession) -> FLAdresswechselIdResponse:
        record = await _pull_the_change(adresswechsel_collection, adresswechsel_id, session=session)
        await _refuse_the_address(
            str(record["adresse"]),
            akteur=akteur,
            auth_time=auth_time,
            berechtigungen_collection=berechtigungen_collection,
            berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
            session=session,
        )
        await end_the_change_in_session(
            adresswechsel_collection=adresswechsel_collection,
            aktionen_collection=aktionen_collection,
            db_filter={"_id": adresswechsel_id},
            art="verworfen",
            now=germany_now,
            stamp=stamp,
            session=session,
        )
        journal.note(
            ending_line(
                art="adresswechsel_verworfen",
                neue=str(record["email"]),
                record_id=adresswechsel_id,
                am=stamp,
                schluessel=config.sperrliste_schluessel,
            )
        )

        return FLAdresswechselIdResponse(id=adresswechsel_id)

    # One transaction, so the write, the log row recording it and the redaction land together.
    async with journal:
        async with transaction_session(db) as session:
            return await session.with_transaction(discard_the_change)


@router.post(
    f"{by_id('adresswechsel_id')}/genehmigung",
    response_model=FLAdresswechselGenehmigungResponse,
    summary="Approve the move of an administrator's access with their address change",
    # The enrolment window a grant takes, not the step-up's: the approval hands access to the administration over.
    dependencies=[Depends(verify_recent_confirmation)],
)
async def post_adresswechsel_genehmigung(
    adresswechsel_id: CustomRouteObjectId,
    adresswechsel_collection: AdresswechselCollection,
    records: SubjektLookup,
    spieler_collection: SpielerCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    saison_teams_collection: SaisonTeamsCollection,
    bewerbungen_collection: BewerbungenCollection,
    registrierungen_collection: RegistrierungenCollection,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    berechtigungen_collection: BerechtigungenCollection,
    berechtigungen_angekuendigt_collection: BerechtigungenAngekuendigtCollection,
    berechtigungen_postausgang_collection: BerechtigungenPostausgangCollection,
    berechtigungen_antraege_collection: BerechtigungenAntraegeCollection,
    einladungen_collection: EinladungenCollection,
    sperrliste_collection: SperrlisteCollection,
    adresswechsel_postausgang_collection: AdresswechselPostausgangCollection,
    sperrliste: SperrlisteLookup,
    aktionen_collection: AktionenCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    operator: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
    germany_now: datetime = Depends(get_germany_now),
) -> FLAdresswechselGenehmigungResponse:
    """
    Approve the move of an administrator's grant with the change of their address, the second pair of eyes the change waits on.

    Where the new mailbox has confirmed and no waiting time remains, the change takes effect in this transaction: the grant
    is revoked at the replaced address and granted at the new one under this administrator's name, announced to every
    administrator as a grant and a revoke are, and everything else the address holds moves, its completion notice queued
    in this transaction. Otherwise the approval is recorded and the change takes effect at its confirmation
    or at the end of its waiting time. **An approval refused writes nothing**: the change stands unapproved.

    Refused where the change asks no approval or was given it (`REQ-ADRESSWECHSEL-012`), where its seven days have passed
    (`-003`), to the changed address and to the administrator who started it (`-013`), to anyone but an owner, signed in
    since becoming one, where the grant is an owner's (`-014`), and where the change ended (`-002`); and, where it would
    take effect, as the confirmation is (`-004`, `-005`, `-006`, `-015`, `-016`, `-018`). A change whose address has come to hold
    nothing to move ends discarded, its new address told it did not take effect, answering `-010`. 404 for an id naming no
    change. A sign-in or confirmation older than
    `ENROLMENT_WINDOW_MINUTES` is refused `REQ-AUTH-009`, as a grant's is.
    """

    akteur = sign_in_identifier(operator)
    # Outside the transaction (`app/api/sperrliste/crud.py :: address_is_gesperrt`).
    massgebliche_saison_id = await sperrliste_saison(sperrliste)
    journal = Journal()

    @journal.attempted
    async def approve_the_change(session: AsyncClientSession) -> FLAdresswechselGenehmigungResponse | None:
        record = await _pull_the_change(adresswechsel_collection, adresswechsel_id, session=session)
        refuse(find_keine_genehmigung_offen_refusal(offen=genehmigung_offen(record)))
        refuse(find_abgelaufen_refusal(abgelaufen=ist_abgelaufen(record, now=germany_now)))
        grants = await read_berechtigungen(berechtigungen_collection=berechtigungen_collection, session=session)
        announced = await read_the_announced(berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection, session=session)
        inhaber = holds_an_owners_power(akteur=akteur, auth_time=auth_time, grants=grants, announced=announced)
        verwehrt = genehmigung_verwehrt(
            betroffen=record["adresse"], genehmigung=record["genehmigung"], akteur=akteur, inhaber=inhaber, grants=grants, announced=announced
        )
        refuse(find_genehmigung_verwehrt_refusal(verwehrt=verwehrt))

        # The filter is the judgement: a rival's approval committed since the read is the miss.
        approved = await patch_one_in_db(
            collection=adresswechsel_collection,
            db_filter=build_live_filter(adresswechsel_id, {"genehmigung.genehmigt_am": None}),
            update=compose_genehmigt_update(akteur=akteur, now=germany_now),
            session=session,
            return_document=ReturnDocument.AFTER,
        )
        if not ist_faellig(approved, now=germany_now):
            return FLAdresswechselGenehmigungResponse(id=adresswechsel_id, wirksam=False)

        urteil, wirksam = await take_effect_in_session(
            record=approved,
            records=records,
            sperrliste=sperrliste,
            massgebliche_saison_id=massgebliche_saison_id,
            adresswechsel_collection=adresswechsel_collection,
            spieler_collection=spieler_collection,
            schiedsrichter_collection=schiedsrichter_collection,
            saison_teams_collection=saison_teams_collection,
            bewerbungen_collection=bewerbungen_collection,
            registrierungen_collection=registrierungen_collection,
            spielbestaetigungen_collection=spielbestaetigungen_collection,
            berechtigungen_collection=berechtigungen_collection,
            berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
            berechtigungen_postausgang_collection=berechtigungen_postausgang_collection,
            berechtigungen_antraege_collection=berechtigungen_antraege_collection,
            einladungen_collection=einladungen_collection,
            sperrliste_collection=sperrliste_collection,
            adresswechsel_postausgang_collection=adresswechsel_postausgang_collection,
            aktionen_collection=aktionen_collection,
            schluessel=config.sperrliste_schluessel,
            now=germany_now,
            journal=journal,
            session=session,
            # Its new mailbox confirmed and was told the change waits on this approval.
            mitteilen=True,
        )
        refuse(refusal_of(urteil.ursache))
        if urteil.leer:
            return None

        return FLAdresswechselGenehmigungResponse(id=adresswechsel_id, wirksam=wirksam)

    async with journal:
        async with transaction_session(db) as session:
            approved = await session.with_transaction(approve_the_change)

    # After the commit, the discard standing: this approval found nothing left to move and ended the change.
    refuse(find_nichts_refusal(leer=approved is None))
    assert approved is not None

    return approved
