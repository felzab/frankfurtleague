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
    lage_of_the_link,
    owe_the_hinweis_in_session,
    owe_the_link_in_session,
    read_the_bestand,
    refusal_of,
    start_the_change_in_session,
    take_effect_in_session,
)
from app.api.adresswechsel.schemas import (
    FLAddressChangeApprovalResponse,
    FLAddressChangeIdResponse,
    FLAddressChangeVerwaltungApproval,
    FLAddressChangeVerwaltungHoldings,
    FLAddressChangeVerwaltungMintResponse,
    FLAddressChangeVerwaltungOpen,
    FLAddressChangeVerwaltungPayload,
    FLAddressChangeVerwaltungViewPayload,
    FLAddressChangeVerwaltungViewResponse,
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
from app.api.berechtigungen.guard import verify_actor_is_admin
from app.api.berechtigungen.services import genehmiger_of, genehmigung_verwehrt, holds_an_owners_power
from app.api.identitaet.lookup import SubjektLookup
from app.api.identitaet.services import JEDE_VERWALTUNG, find_eigene_adresse_refusal, find_verwaltung_adresse_refusal
from app.api.outbox.schemas import FLOutboxState
from app.api.sperrliste.lookup import BanList, SperrlisteLookup, adressen_gesperrt, hash_gesperrt, sperrliste_saison
from app.api.spieler.crud import another_pupil_holds
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.crud import patch_one_in_db, refuse
from app.core.dependencies import (
    ActionLogCollection,
    AddressChangeCollection,
    BewerbungenCollection,
    DBClient,
    GrantsAnnouncedCollection,
    GrantsApprovalRequestsCollection,
    GrantsCollection,
    InvitationsCollection,
    OutboxCollection,
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
from app.core.security import bind_actor, get_actor_auth_time, get_actor_email, verify_access_admin, verify_recent_confirmation, verify_step_up
from app.core.transactions import transaction_session
from app.shared.folding import sign_in_identifier
from app.shared.schemas.custom import CustomRouteObjectId
from app.shared.schemas.literals import FLAddressChangeWay

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/address_change",
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

    The administrator's own address (`own_adresse`), and a grant holder's unless they hold an owner's power (`verwaltung_adresse`).
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
    adresswechsel_collection: AsyncCollection, address_change_id: Any, *, session: AsyncClientSession | None
) -> Mapping[str, Any]:
    """The change an id names, ended or not: 404 where none is kept, `address_change_ended` where it ended."""

    record = await adresswechsel_collection.find_one({"_id": address_change_id}, session=session)
    if record is None:
        raise DocumentNotFoundError()
    refuse(find_beendet_refusal(offen=record.get("ended") is None))

    return record


def _offen(record: Mapping[str, Any], *, delivery: FLOutboxState | None, now: datetime) -> FLAddressChangeVerwaltungOpen:
    genehmigung = record.get("approval")

    return FLAddressChangeVerwaltungOpen(
        id=record["_id"],
        email=record["email"],
        way=record["way"],
        grund=record.get("grund"),
        waits_on=wartet_auf(record),
        sent_at=record["sent_at"],
        valid_until=als_utc(record.get("valid_until")),
        released_at=als_utc(record.get("released_at")),
        confirmed_at=als_utc(record.get("confirmed_at")),
        effective_from=als_utc(record.get("effective_from")),
        delivery=delivery,
        expired=ist_abgelaufen(record, now=now),
        approval=None if not isinstance(genehmigung, Mapping) else FLAddressChangeVerwaltungApproval.model_validate(genehmigung),
    )


def _bestand(holdings: Bestand) -> FLAddressChangeVerwaltungHoldings:
    return FLAddressChangeVerwaltungHoldings(
        spieler=0 if holdings.spieler is None else 1,
        schiedsrichter=len(holdings.schiedsrichter),
        seats=sum(len(slots) for _, slots in holdings.sitze),
        bewerbung_seats=sum(len(slots) for _, slots in holdings.bewerbung_seats),
        registrierungen=len(holdings.registrierungen),
        grant=None if holdings.grant is None else holdings.grant["verwaltung"],
    )


@router.post(
    "/view",
    response_model=FLAddressChangeVerwaltungViewResponse,
    summary="Show what an address holds that a change moves, and its live change",
)
async def get_address_change_verwaltung_view(
    ansicht_data: Annotated[FLAddressChangeVerwaltungViewPayload, Body()],
    adresswechsel_collection: AddressChangeCollection,
    outbox_collection: OutboxCollection,
    records: SubjektLookup,
    berechtigungen_collection: GrantsCollection,
    berechtigungen_angekuendigt_collection: GrantsAnnouncedCollection,
    db: DBClient,
    operator: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
    germany_now: datetime = Depends(get_germany_now),
) -> FLAddressChangeVerwaltungViewResponse:
    """
    Answer what the typed address holds that a change moves, by kind, and its live change whole, the new address and reason included.

    ADMIN TIER, the address tool's read, keyed by the address the administrator types or by a change a page links to;
    never a hash. `possible` where the address holds anything a change moves, a grant included. Stores nothing.

    Refused as the erasure's reveal is: the administrator's own address (`own_adresse`), and an address holding a live
    grant unless the administrator holds an owner's power (`verwaltung_adresse`). A change id answers 404 where no change is
    kept, and `address_change_ended` where it ended.
    """

    akteur = sign_in_identifier(operator)

    # A snapshot, so the tool names the records of one moment; never a transaction, a read writing nothing having no
    # conflict to retry for.
    async with db.start_session(snapshot=True) as session:
        if ansicht_data.address_change_id is not None:
            identifier = str((await _pull_the_change(adresswechsel_collection, ansicht_data.address_change_id, session=session))["adresse"])
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
        zustellung = (
            None
            if offen is None
            else await lage_of_the_link(outbox_collection=outbox_collection, address_change_id=offen["_id"], session=session)
        )

    return FLAddressChangeVerwaltungViewResponse(
        adresse=identifier,
        holdings=_bestand(bestand),
        possible=not bestand.leer,
        open=None if offen is None else _offen(offen, delivery=zustellung, now=germany_now),
    )


async def _refuse_without_genehmiger(
    holdings: Bestand,
    *,
    akteur: str,
    grants: list[Mapping[str, Any]],
    announced: list[Mapping[str, Any]],
    sperrliste: BanList,
    now: datetime,
    session: AsyncClientSession,
) -> None:
    """Refused `address_change_no_approver` where nobody but the start's actor could approve a change of this address's grant."""

    assert holdings.grant is not None
    gesperrt = await adressen_gesperrt(sperrliste, [str(row["adresse"]) for row in grants], session=session)
    genehmiger = genehmiger_of(
        verwaltung=str(holdings.grant["verwaltung"]),
        ausgenommen={holdings.identifier, akteur},
        grants=grants,
        announced=announced,
        barred=gesperrt,
        vor=now,
    )
    refuse(find_kein_genehmiger_refusal(genehmiger=len(genehmiger)))


@router.post(
    "",
    response_model=FLAddressChangeVerwaltungMintResponse,
    summary="Start an address change for a person who says they cannot sign in",
    dependencies=[Depends(verify_step_up)],
)
async def post_address_change_verwaltung(
    adresswechsel_data: Annotated[FLAddressChangeVerwaltungPayload, Body()],
    adresswechsel_collection: AddressChangeCollection,
    records: SubjektLookup,
    spieler_collection: SpielerCollection,
    berechtigungen_collection: GrantsCollection,
    berechtigungen_angekuendigt_collection: GrantsAnnouncedCollection,
    outbox_collection: OutboxCollection,
    berechtigungen_antraege_collection: GrantsApprovalRequestsCollection,
    sperrliste: SperrlisteLookup,
    aktionen_collection: ActionLogCollection,
    db: DBClient,
    operator: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
    germany_now: datetime = Depends(get_germany_now),
) -> FLAddressChangeVerwaltungMintResponse:
    """
    Start a change of the typed address for a person who says they cannot sign in, its mails owed in the same transaction.

    **Nothing moves here.** Without a `grund` the change asks the address on file first: it is owed the request with its
    stop link, and nothing goes to the new mailbox until that address approves on its account page. With a `grund`,
    recording how the administrator established who asks, the new mailbox is owed its link and the address on file a
    notice with its stop link; the change then takes effect `ADDRESS_CHANGE_WAITING_PERIOD_DAYS` after the new mailbox
    confirms. Where the address holds a grant, the change also waits on another administrator's approval, never this
    one's. No link is answered. The address's live change ends replaced.

    Refused the administrator's own address (`own_adresse`), a grant holder's without an owner's power
    (`verwaltung_adresse`), the address on file typed again (`address_change_unchanged`), a new address the ban list holds
    (`address_change_barred`), an address holding nothing a change moves (`address_change_nothing`), a new address another pupil signs in on
    where the change moves a pupil (`address_change_taken`), a new address any entry names, confirmed or not (`address_change_occupied`), and a
    grant nobody could approve (`address_change_no_approver`).
    """

    identifier, email, grund = sign_in_identifier(str(adresswechsel_data.adresse)), str(adresswechsel_data.email), adresswechsel_data.grund
    akteur = sign_in_identifier(operator)
    weg: FLAddressChangeWay = "release" if grund is None else "waiting_period"
    gehasht = sperrliste.hash_of(email)
    # Outside the transaction (`app/api/sperrliste/crud.py :: address_is_gesperrt`).
    massgebliche_saison_id = await sperrliste_saison(sperrliste)
    journal = Journal()

    @journal.attempted
    async def judge_and_start_the_change(session: AsyncClientSession) -> FLAddressChangeVerwaltungMintResponse:
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
                barred=await hash_gesperrt(sperrliste, gehasht, massgebliche_saison_id=massgebliche_saison_id, session=session)
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
                        adresswechsel_collection=adresswechsel_collection,
                        now=germany_now,
                    ),
                    session=session,
                )
            )
        )
        if bestand.grant is not None:
            await _refuse_without_genehmiger(
                bestand, akteur=akteur, grants=grants, announced=announced, sperrliste=sperrliste, now=germany_now, session=session
            )

        record = compose_record(
            adresse=identifier,
            email=email,
            way=weg,
            grund=grund,
            approval=None
            if bestand.grant is None
            else compose_genehmigung(verwaltung=str(bestand.grant["verwaltung"]), started_by=akteur, now=germany_now),
            now=germany_now,
        )
        address_change_id = await start_the_change_in_session(
            record=record,
            adresswechsel_collection=adresswechsel_collection,
            aktionen_collection=aktionen_collection,
            key=sperrliste.key,
            now=germany_now,
            journal=journal,
            session=session,
        )
        # The notice first and the link after, as the address on file is told before the new mailbox can answer.
        await owe_the_hinweis_in_session(
            address_change_id=address_change_id,
            adresse=identifier,
            way=weg,
            valid_until=record["valid_until"],
            # Greeting nobody on the lost-mailbox way: the address on file may have passed to a stranger.
            vorname=None if weg == "waiting_period" else bestand.vorname,
            outbox_collection=outbox_collection,
            now=germany_now,
            session=session,
        )
        if weg != "release":
            await owe_the_link_in_session(
                address_change_id=address_change_id,
                email=email,
                way=weg,
                valid_until=record["valid_until"],
                outbox_collection=outbox_collection,
                now=germany_now,
                session=session,
            )

        return FLAddressChangeVerwaltungMintResponse(id=address_change_id, way=weg, valid_until=record["valid_until"], email=email)

    # ONE transaction over the judgement and the write: a record written outside it would stand with a live link an
    # administrator was then told had been refused.
    async with journal:
        async with transaction_session(db) as session:
            return await session.with_transaction(judge_and_start_the_change)


@router.post(
    f"{by_id('address_change_id')}/invite",
    response_model=FLAddressChangeVerwaltungMintResponse,
    summary="Send a pending address a fresh link",
    dependencies=[Depends(verify_step_up)],
)
async def invite_address_change(
    address_change_id: CustomRouteObjectId,
    adresswechsel_collection: AddressChangeCollection,
    outbox_collection: OutboxCollection,
    records: SubjektLookup,
    spieler_collection: SpielerCollection,
    berechtigungen_collection: GrantsCollection,
    berechtigungen_angekuendigt_collection: GrantsAnnouncedCollection,
    berechtigungen_antraege_collection: GrantsApprovalRequestsCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    operator: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
    germany_now: datetime = Depends(get_germany_now),
) -> FLAddressChangeVerwaltungMintResponse:
    """
    Owe the new mailbox a fresh link for the change this id names, in the same transaction.

    The previous link stops working once the fresh one is handed out; the deadline restarts now. The stop link stays, so
    the address on file is mailed nothing again. A lapsed link is no refusal while the change stands, which is until the
    next hourly pass ends it. Acts on the change the id names alone, so a page showing a change since replaced re-sends
    nothing.

    Refused as the start is about who asks (`own_adresse`, `verwaltung_adresse`), where the ban list holds the pending address
    (`address_change_barred`), where another pupil has come to sign in on it (`address_change_taken`), where an entry has come to name it,
    confirmed or not (`address_change_occupied`), where a grant's approval week has passed (`link_expired`), and where the change ended
    (`address_change_ended`). 404 for an id naming no change, and unless the change waits on the new mailbox: one awaiting the address on
    file's approval, or confirmed, has no link to re-send.
    """

    akteur = sign_in_identifier(operator)
    # Outside the transaction (`app/api/sperrliste/crud.py :: address_is_gesperrt`).
    massgebliche_saison_id = await sperrliste_saison(sperrliste)

    async def judge_and_remint_the_change(session: AsyncClientSession) -> FLAddressChangeVerwaltungMintResponse:
        record = await _pull_the_change(adresswechsel_collection, address_change_id, session=session)
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
                barred=await hash_gesperrt(
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
                        adresswechsel_collection=adresswechsel_collection,
                        now=germany_now,
                    ),
                    session=session,
                )
            )
        )
        # A grant's approval week that lapsed ends the change at the next pass: a fresh link would be refused on its press.
        genehmigung = record.get("approval")
        bis = als_utc(genehmigung.get("bis")) if isinstance(genehmigung, Mapping) and genehmigung.get("approved_at") is None else None
        refuse(find_abgelaufen_refusal(abgelaufen=bis is not None and bis <= germany_now))

        # The filter is the judgement: a change awaiting its approval or confirmed is the 404 here.
        updated = await patch_one_in_db(
            collection=adresswechsel_collection,
            db_filter=build_live_filter(address_change_id, build_resendable_terms()),
            update=compose_link_update(now=germany_now, freigabe=False),
            session=session,
            return_document=ReturnDocument.AFTER,
        )
        gueltig_bis = als_utc(updated["valid_until"])
        assert gueltig_bis is not None

        await owe_the_link_in_session(
            address_change_id=address_change_id,
            email=email,
            way=updated["way"],
            valid_until=gueltig_bis,
            outbox_collection=outbox_collection,
            now=germany_now,
            session=session,
        )

        return FLAddressChangeVerwaltungMintResponse(id=address_change_id, way=updated["way"], valid_until=gueltig_bis, email=email)

    async with transaction_session(db) as session:
        return await session.with_transaction(judge_and_remint_the_change)


@router.delete(
    by_id("address_change_id"),
    response_model=FLAddressChangeIdResponse,
    summary="Discard a pending address change",
    dependencies=[Depends(verify_step_up)],
)
async def delete_address_change(
    address_change_id: CustomRouteObjectId,
    adresswechsel_collection: AddressChangeCollection,
    berechtigungen_collection: GrantsCollection,
    berechtigungen_angekuendigt_collection: GrantsAnnouncedCollection,
    aktionen_collection: ActionLogCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    operator: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
    germany_now: datetime = Depends(get_germany_now),
) -> FLAddressChangeIdResponse:
    """
    Discard the change this id names: its links open nothing to press, and the address on file stays.

    **Its address goes from the action log too**: every image the log holds of the change
    loses its new address and reason, the rest of each image standing. Journalled as the stop is, so a restore does not
    bring back a change confirmed in its waiting time to take effect. Nothing is mailed. Acts on the change the id names
    alone, so a page showing a change since replaced discards nothing.

    Refused as the start is about who asks (`own_adresse`, `verwaltung_adresse`), and where the change ended
    (`address_change_ended`); 404 for an id naming no change.
    """

    akteur = sign_in_identifier(operator)
    stamp = log_stamp(germany_now)
    journal = Journal()

    @journal.attempted
    async def discard_the_change(session: AsyncClientSession) -> FLAddressChangeIdResponse:
        record = await _pull_the_change(adresswechsel_collection, address_change_id, session=session)
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
            db_filter={"_id": address_change_id},
            art="discarded",
            now=germany_now,
            stamp=stamp,
            session=session,
        )
        journal.note(
            ending_line(
                art="adresswechsel_verworfen",
                neue=str(record["email"]),
                record_id=address_change_id,
                am=stamp,
                key=config.sperrliste_key,
            )
        )

        return FLAddressChangeIdResponse(id=address_change_id)

    # One transaction, so the write, the log row recording it and the redaction land together.
    async with journal:
        async with transaction_session(db) as session:
            return await session.with_transaction(discard_the_change)


@router.post(
    f"{by_id('address_change_id')}/approval",
    response_model=FLAddressChangeApprovalResponse,
    summary="Approve the move of an administrator's access with their address change",
    # The enrolment window a grant takes, not the step-up's: the approval hands access to the administration over.
    dependencies=[Depends(verify_recent_confirmation)],
)
async def post_address_change_approval(
    address_change_id: CustomRouteObjectId,
    adresswechsel_collection: AddressChangeCollection,
    records: SubjektLookup,
    spieler_collection: SpielerCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    saison_teams_collection: SaisonTeamsCollection,
    bewerbungen_collection: BewerbungenCollection,
    registrierungen_collection: RegistrierungenCollection,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    berechtigungen_collection: GrantsCollection,
    berechtigungen_angekuendigt_collection: GrantsAnnouncedCollection,
    outbox_collection: OutboxCollection,
    berechtigungen_antraege_collection: GrantsApprovalRequestsCollection,
    einladungen_collection: InvitationsCollection,
    sperrliste_collection: SperrlisteCollection,
    sperrliste: SperrlisteLookup,
    aktionen_collection: ActionLogCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    operator: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
    germany_now: datetime = Depends(get_germany_now),
) -> FLAddressChangeApprovalResponse:
    """
    Approve the move of an administrator's grant with the change of their address, the second pair of eyes the change waits on.

    Where the new mailbox has confirmed and no waiting time remains, the change takes effect in this transaction: the grant
    is revoked at the replaced address and granted at the new one under this administrator's name, announced to every
    administrator as a grant and a revoke are, and everything else the address holds moves, its completion notice queued
    in this transaction. Otherwise the approval is recorded and the change takes effect at its confirmation
    or at the end of its waiting time. **An approval refused writes nothing**: the change stands unapproved.

    Refused where the change asks no approval or was given it (`address_change_no_approval_open`), where its seven days have passed
    (`link_expired`), to the changed address and to the administrator who started it (`address_change_approval_denied`), to anyone but an
    owner, signed in since becoming one, where the grant is an owner's (`address_change_approval_owner`), and where the change ended
    (`address_change_ended`); and, where it would take effect, as the confirmation is (`link_barred`, `address_change_replaced_barred`,
    `address_change_taken`, `address_change_not_covered`, `address_change_new_granted`, `address_change_occupied`). A change whose address
    has come to hold nothing to move ends discarded, its new address told it did not take effect, answering `address_change_nothing`. 404 for an
    id naming no change. A sign-in or confirmation older than `ENROLMENT_WINDOW_MINUTES` is refused `confirmation_required`, as a grant's is.
    """

    akteur = sign_in_identifier(operator)
    # Outside the transaction (`app/api/sperrliste/crud.py :: address_is_gesperrt`).
    massgebliche_saison_id = await sperrliste_saison(sperrliste)
    journal = Journal()

    @journal.attempted
    async def approve_the_change(session: AsyncClientSession) -> FLAddressChangeApprovalResponse | None:
        record = await _pull_the_change(adresswechsel_collection, address_change_id, session=session)
        refuse(find_keine_genehmigung_offen_refusal(offen=genehmigung_offen(record)))
        refuse(find_abgelaufen_refusal(abgelaufen=ist_abgelaufen(record, now=germany_now)))
        grants = await read_berechtigungen(berechtigungen_collection=berechtigungen_collection, session=session)
        announced = await read_the_announced(berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection, session=session)
        inhaber = holds_an_owners_power(akteur=akteur, auth_time=auth_time, grants=grants, announced=announced)
        verwehrt = genehmigung_verwehrt(
            betroffen=record["adresse"], approval=record["approval"], akteur=akteur, inhaber=inhaber, grants=grants, announced=announced
        )
        refuse(find_genehmigung_verwehrt_refusal(denied=verwehrt))

        # The filter is the judgement: a rival's approval committed since the read is the miss.
        approved = await patch_one_in_db(
            collection=adresswechsel_collection,
            db_filter=build_live_filter(address_change_id, {"approval.approved_at": None}),
            update=compose_genehmigt_update(akteur=akteur, now=germany_now),
            session=session,
            return_document=ReturnDocument.AFTER,
        )
        if not ist_faellig(approved, now=germany_now):
            return FLAddressChangeApprovalResponse(id=address_change_id, effective=False)

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
            outbox_collection=outbox_collection,
            berechtigungen_antraege_collection=berechtigungen_antraege_collection,
            einladungen_collection=einladungen_collection,
            sperrliste_collection=sperrliste_collection,
            aktionen_collection=aktionen_collection,
            key=config.sperrliste_key,
            now=germany_now,
            journal=journal,
            session=session,
            # Its new mailbox confirmed and was told the change waits on this approval.
            mitteilen=True,
        )
        refuse(refusal_of(urteil.ursache))
        if urteil.leer:
            return None

        return FLAddressChangeApprovalResponse(id=address_change_id, effective=wirksam)

    async with journal:
        async with transaction_session(db) as session:
            approved = await session.with_transaction(approve_the_change)

    # After the commit, the discard standing: this approval found nothing left to move and ended the change.
    refuse(find_nichts_refusal(leer=approved is None))
    assert approved is not None

    return approved
