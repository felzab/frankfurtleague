from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.adresswechsel.crud import (
    end_the_change_in_session,
    ending_line,
    live_grant_of,
    owe_the_hinweis_in_session,
    owe_the_link_in_session,
    read_the_bestand,
    start_the_change_in_session,
)
from app.api.adresswechsel.schemas import FLAddressChangeApprovalStand
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
from app.api.berechtigungen.services import genehmiger_of
from app.api.identitaet.crud import funktionen_aus
from app.api.identitaet.lookup import RecordCollections, SubjektLookup
from app.api.identitaet.services import ist_eigener_schiedsrichter, ist_eigener_spieler, may_grant_on_schiedsrichter, may_grant_on_spieler
from app.api.konto.schemas import (
    FLAccountAddressChangeMintResponse,
    FLAccountAddressChangeOpen,
    FLAccountAddressChangePayload,
    FLAccountAddressChangeReleasePayload,
    FLAccountAddressChangeResponse,
    FLAccountEinwilligungenResponse,
)
from app.api.konto.services import (
    build_angenommene_bewerbungen_pipeline,
    build_kontext_teams_pipeline,
    build_self_bewerbung_pipeline,
    build_self_registrierung_pipeline,
    build_self_seat_pipeline,
    compose_bewerbungssitze_self,
    compose_registrierungen_self,
    compose_schiedsrichter_konto,
    compose_sitze_self,
    compose_spieler_konto,
    kontext_zeile,
)
from app.api.schiedsrichter.services import build_self_referee_pipeline
from app.api.sperrliste.guard import PERSON_ACTOR_BINDERS, KontaktIdentifier
from app.api.sperrliste.lookup import SperrlisteLookup, adressen_gesperrt
from app.api.spieler.services import build_self_pupil_pipeline
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.crud import aggregate_many_from_db, patch_one_in_db, refuse
from app.core.dependencies import (
    ActionLogCollection,
    AddressChangeCollection,
    BewerbungenCollection,
    DBClient,
    GrantsAnnouncedCollection,
    GrantsCollection,
    OutboxCollection,
    RegistrierungenCollection,
    SaisonTeamsCollection,
    SchiedsrichterCollection,
    SpielerCollection,
    TeamsCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.exceptions import DocumentNotFoundError
from app.core.journal import Journal
from app.core.recording import log_stamp
from app.core.security import (
    SessionActor,
    verify_access_admin,
    verify_person_actor,
    verify_person_passkey_confirmation,
    verify_recent_person_confirmation,
)
from app.core.transactions import transaction_session
from app.shared.folding import sign_in_identifier

# Every person binder fixes a Funktion and this page is none's: `kontakt` is bound, its seat control
# having no page of its own. Its one write is the address change, which crosses every record the address holds.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/account",
    dependencies=[Depends(verify_access_admin), Depends(PERSON_ACTOR_BINDERS["kontakt"])],
)


@router.get("/einwilligungen", response_model=FLAccountEinwilligungenResponse, summary="A signed-in person's own consent records")
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
) -> FLAccountEinwilligungenResponse:
    """
    Answer every confirmed consent record the signed-in address holds, its pupil, referee and contact-seat records alike.

    The seats come one entry per team season on which the address holds a confirmed seat, however many of its slots;
    `bewerbungen` one per PENDING application on which it does, whose two choices the account page may only withdraw;
    `registrierungen` one per pending registration its pupil confirmed, withdraw-only alike until the admission; a
    returning pupil's asked no choice, so it serves its stored data with both choices null and offers nothing to press.

    PERSON TIER, for the account page, which every signed-in person reaches: an address holding nothing is answered
    `spieler: null` and four empty lists, never refused. A retired record, a past season's seat and a withdrawn team's
    seat are served too, a withdrawal staying open wherever a consent stands; `context` carries what the record's
    confirmation page filled its words with, as those records stand today; `givable` says whether a grant is
    admitted, `medien_offered` whether the media consent may be switched on. A record awaiting its person's
    confirmation is not served: there is nothing on it yet to change.
    """

    # A snapshot, so every record is answered as of one moment; never a transaction, which a read
    # writing nothing has no conflict to retry for.
    async with db.start_session(snapshot=True) as session:
        pupils = await aggregate_many_from_db(collection=spieler_collection, pipeline=build_self_pupil_pipeline(identifier), session=session)
        referees = await aggregate_many_from_db(
            collection=schiedsrichter_collection, pipeline=build_self_referee_pipeline(identifier), session=session
        )
        seat_rows = await aggregate_many_from_db(
            collection=saison_teams_collection, pipeline=build_self_seat_pipeline(identifier), session=session
        )
        bewerbung_rows = await aggregate_many_from_db(
            collection=bewerbungen_collection, pipeline=build_self_bewerbung_pipeline(identifier), session=session
        )
        registrierung_rows = await aggregate_many_from_db(
            collection=registrierungen_collection, pipeline=build_self_registrierung_pipeline(identifier), session=session
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

        return FLAccountEinwilligungenResponse.model_validate(
            {
                "spieler": None
                if pupil is None
                else compose_spieler_konto(
                    pupil,
                    givable=may_grant_on_spieler(subjekt, pupil["_id"]),
                    today=today,
                    team=None if zeile is None else teams.get(zeile["team_id"]),
                ),
                "schiedsrichter": [
                    compose_schiedsrichter_konto(row, givable=may_grant_on_schiedsrichter(subjekt, row["_id"]), today=today)
                    for row in referees
                    if ist_eigener_schiedsrichter(row, identifier)
                ],
                "seats": compose_sitze_self(
                    seat_rows, identifier, sitze_mit_panel=subjekt.seats, today=today, teams=teams, bewerbungen=bewerbungen
                ),
                "bewerbungen": compose_bewerbungssitze_self(bewerbung_rows, identifier, teams=teams),
                "registrierungen": compose_registrierungen_self(registrierung_rows, identifier, teams=teams),
            }
        )


# --- The ADDRESS CHANGE the person starts, approves and stops for themselves. Recorded under `kontakt`, as the erasure
# is: the change crosses every Funktion the address holds.


def _offen(record: Mapping[str, Any], *, now: datetime) -> FLAccountAddressChangeOpen:
    genehmigung = record.get("approval")
    gestand = None
    if isinstance(genehmigung, Mapping):
        bis = als_utc(genehmigung.get("bis"))
        assert bis is not None
        gestand = FLAddressChangeApprovalStand(
            verwaltung=genehmigung["verwaltung"], approved=genehmigung.get("approved_at") is not None, bis=bis
        )

    return FLAccountAddressChangeOpen(
        id=record["_id"],
        # The address the person typed here is theirs to see; one an administrator typed is shown recognisable alone.
        email=record["email"] if record["way"] == "account" else maskierte_adresse(str(record["email"])),
        way=record["way"],
        waits_on=wartet_auf(record),
        valid_until=als_utc(record.get("valid_until")),
        effective_from=als_utc(record.get("effective_from")),
        approval=gestand,
        expired=ist_abgelaufen(record, now=now),
    )


async def _adresswechsel_answer(
    identifier: str,
    *,
    records: RecordCollections,
    adresswechsel_collection: AsyncCollection,
    berechtigungen_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession | None,
) -> FLAccountAddressChangeResponse:
    bestand = await read_the_bestand(identifier, records=records, berechtigungen_collection=berechtigungen_collection, session=session)
    record = await adresswechsel_collection.find_one(build_address_filter(identifier), session=session)

    return FLAccountAddressChangeResponse(possible=not bestand.leer, open=None if record is None else _offen(record, now=now))


@router.get("/address_change", response_model=FLAccountAddressChangeResponse, summary="Whether a signed-in person may change their address")
async def get_address_change(
    identifier: KontaktIdentifier,
    records: SubjektLookup,
    adresswechsel_collection: AddressChangeCollection,
    berechtigungen_collection: GrantsCollection,
    db: DBClient,
    germany_now: datetime = Depends(get_germany_now),
) -> FLAccountAddressChangeResponse:
    """
    Answer whether the signed-in address holds anything its own change moves, and the change pending on it.

    PERSON TIER. `possible` where the address holds a pupil row, a confirmed referee row, a confirmed contact seat, a
    registration or a grant. **The pending address is served masked where an administrator started the change**, whole
    only where the person typed it here: a change an administrator started may be a pretext whose target the holder of
    the address on file must not learn. `approval` is the approval a change moving the person's grant waits on;
    `abgelaufen` says the step the change waits on lapsed, whose press is refused until the hourly pass ends the change.
    """

    # A snapshot, so the records and the change are answered as of one moment.
    async with db.start_session(snapshot=True) as session:
        return await _adresswechsel_answer(
            identifier,
            records=records,
            adresswechsel_collection=adresswechsel_collection,
            berechtigungen_collection=berechtigungen_collection,
            now=germany_now,
            session=session,
        )


@router.post(
    "/address_change",
    response_model=FLAccountAddressChangeMintResponse,
    summary="Start a change of the signed-in person's address",
    dependencies=[Depends(verify_recent_person_confirmation)],
)
async def post_address_change(
    identifier: KontaktIdentifier,
    adresswechsel_data: Annotated[FLAccountAddressChangePayload, Body()],
    records: SubjektLookup,
    adresswechsel_collection: AddressChangeCollection,
    berechtigungen_collection: GrantsCollection,
    berechtigungen_angekuendigt_collection: GrantsAnnouncedCollection,
    postausgang_collection: OutboxCollection,
    sperrliste: SperrlisteLookup,
    aktionen_collection: ActionLogCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    actor: Annotated[SessionActor, Depends(verify_person_actor)],
    germany_now: datetime = Depends(get_germany_now),
) -> FLAccountAddressChangeMintResponse:
    """
    Start a change of the address the person signs in on, its two mails owed in the same transaction and no link answered.

    The new mailbox is owed its link, and the address on file a notice with a stop link; **everything the address holds
    as its person's own moves when the new mailbox confirms**, within `ADDRESS_CHANGE_VALID_HOURS`. Where it holds a
    grant, the change also waits on another administrator's approval, an owner's for an owner's grant. The address's live
    change ends replaced, an administrator's too: a sign-in at the address on file proves the mailbox is not lost.
    **Nothing about the new address is judged here** -- the ban list, another pupil, a grant it holds -- so this start
    answers alike whatever the new address holds.

    Refused `confirmation_required` from a sign-in or confirmation older than `ENROLMENT_WINDOW_MINUTES`, or by code where the
    address holds a grant;
    `address_change_nothing` where the address holds nothing a change moves; `address_change_unchanged` where the typed address is the one
    signed in; and `address_change_no_approver` where nobody could approve the grant's move, the last owner making another first.
    """

    email = adresswechsel_data.email
    journal = Journal()

    @journal.attempted
    async def start_the_change(session: AsyncClientSession) -> FLAccountAddressChangeMintResponse:
        bestand = await read_the_bestand(identifier, records=records, berechtigungen_collection=berechtigungen_collection, session=session)
        refuse(find_nichts_refusal(leer=bestand.leer))
        refuse(find_unveraendert_refusal(adresse=identifier, folded=sign_in_identifier(email)))

        genehmigung = None
        if bestand.grant is not None:
            # The change hands the grant over, so it asks the passkey a revoke does: this lane admits a sign-in by code.
            verify_person_passkey_confirmation(actor)
            grants = await read_berechtigungen(berechtigungen_collection=berechtigungen_collection, session=session)
            announced = await read_the_announced(berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection, session=session)
            gesperrt = await adressen_gesperrt(sperrliste, [str(row["adresse"]) for row in grants], session=session)
            verwaltung = str(bestand.grant["verwaltung"])
            genehmiger = genehmiger_of(
                verwaltung=verwaltung, ausgenommen={identifier}, grants=grants, announced=announced, barred=gesperrt, vor=germany_now
            )
            refuse(find_kein_genehmiger_refusal(genehmiger=len(genehmiger)))
            genehmigung = compose_genehmigung(verwaltung=verwaltung, started_by=identifier, now=germany_now)

        record = compose_record(
            adresse=identifier,
            email=email,
            way="account",
            grund=None,
            approval=genehmigung,
            now=germany_now,
        )
        address_change_id = await start_the_change_in_session(
            record=record,
            adresswechsel_collection=adresswechsel_collection,
            aktionen_collection=aktionen_collection,
            key=config.sperrliste_key,
            now=germany_now,
            journal=journal,
            session=session,
        )
        # The notice first and the link after, as the address on file is told before the new mailbox can answer.
        await owe_the_hinweis_in_session(
            address_change_id=address_change_id,
            adresse=identifier,
            way="account",
            valid_until=record["valid_until"],
            vorname=bestand.vorname,
            postausgang_collection=postausgang_collection,
            now=germany_now,
            session=session,
        )
        await owe_the_link_in_session(
            address_change_id=address_change_id,
            email=email,
            way="account",
            valid_until=record["valid_until"],
            postausgang_collection=postausgang_collection,
            now=germany_now,
            session=session,
        )

        return FLAccountAddressChangeMintResponse(id=address_change_id, valid_until=record["valid_until"], email=email)

    async with journal:
        async with transaction_session(db) as session:
            return await session.with_transaction(start_the_change)


@router.post(
    "/address_change/release",
    response_model=FLAccountAddressChangeMintResponse,
    summary="Approve the address change an administrator asked of the signed-in person",
    dependencies=[Depends(verify_recent_person_confirmation)],
)
async def post_address_change_release(
    identifier: KontaktIdentifier,
    freigabe_data: Annotated[FLAccountAddressChangeReleasePayload, Body()],
    adresswechsel_collection: AddressChangeCollection,
    berechtigungen_collection: GrantsCollection,
    postausgang_collection: OutboxCollection,
    db: DBClient,
    actor: Annotated[SessionActor, Depends(verify_person_actor)],
    germany_now: datetime = Depends(get_germany_now),
) -> FLAccountAddressChangeMintResponse:
    """
    Approve the change `id` names, which an administrator started without a reason, owing the new mailbox its link.

    **Nothing reaches the new mailbox before this press**. Nothing about the new address is
    judged here either: the approver is owed no answer about it, and the confirmation judges it. **The press approves the
    change its page showed alone**: an administrator's later start replaces that one, and its id then names an ended change.

    Refused `confirmation_required` as the start is; `address_change_ended` where the change `id` names has ended; 404 where it
    is no change of this address awaiting its approval; and `link_expired` past the approval's deadline.
    """

    address_change_id = freigabe_data.id
    db_filter = {"_id": address_change_id, **build_address_filter(identifier), **build_awaiting_approval_terms()}

    async def approve_the_change(session: AsyncClientSession) -> Mapping[str, Any]:
        record = await adresswechsel_collection.find_one(db_filter, session=session)
        if record is None:
            ended = await adresswechsel_collection.find_one(
                {"_id": address_change_id, "ended": {"$type": "object"}}, {"_id": 1}, session=session
            )
            refuse(find_beendet_refusal(offen=ended is None))
            raise DocumentNotFoundError()
        refuse(find_abgelaufen_refusal(abgelaufen=ist_abgelaufen(record, now=germany_now)))
        # As the start: the press lets a link go that hands over any grant the address holds at the effect.
        if await live_grant_of(identifier, berechtigungen_collection=berechtigungen_collection, session=session) is not None:
            verify_person_passkey_confirmation(actor)

        approved = await patch_one_in_db(
            collection=adresswechsel_collection,
            db_filter={"_id": record["_id"], **LIVE_TERMS},
            update=compose_link_update(now=germany_now, freigabe=True),
            session=session,
            return_document=ReturnDocument.AFTER,
        )
        # Read back with no offset, as the driver reads every stored instant.
        gueltig_bis = als_utc(approved["valid_until"])
        assert gueltig_bis is not None
        await owe_the_link_in_session(
            address_change_id=approved["_id"],
            email=str(approved["email"]),
            way=approved["way"],
            valid_until=gueltig_bis,
            postausgang_collection=postausgang_collection,
            now=germany_now,
            session=session,
        )

        return approved

    async with transaction_session(db) as session:
        record = await session.with_transaction(approve_the_change)

    gueltig_bis = als_utc(record["valid_until"])
    assert gueltig_bis is not None

    return FLAccountAddressChangeMintResponse(id=record["_id"], valid_until=gueltig_bis, email=record["email"])


@router.delete(
    "/address_change",
    response_model=FLAccountAddressChangeResponse,
    summary="Stop the address change pending on the signed-in person",
)
async def delete_address_change(
    identifier: KontaktIdentifier,
    records: SubjektLookup,
    adresswechsel_collection: AddressChangeCollection,
    berechtigungen_collection: GrantsCollection,
    aktionen_collection: ActionLogCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    germany_now: datetime = Depends(get_germany_now),
) -> FLAccountAddressChangeResponse:
    """
    Stop the change pending on the signed-in address, the stop link's twin: its new address goes, out of every log image too.

    Asks no fresh confirmation and counts nothing: a stop hands nothing over. 404 where no change is pending on the address.
    """

    stamp = log_stamp(germany_now)
    journal = Journal()

    @journal.attempted
    async def stop_the_change(session: AsyncClientSession) -> FLAccountAddressChangeResponse:
        live = await adresswechsel_collection.find_one(build_address_filter(identifier), {"_id": 1}, session=session)
        if live is None:
            raise DocumentNotFoundError()

        stored = await end_the_change_in_session(
            adresswechsel_collection=adresswechsel_collection,
            aktionen_collection=aktionen_collection,
            db_filter={"_id": live["_id"]},
            art="stopped",
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
                key=config.sperrliste_key,
            )
        )

        return await _adresswechsel_answer(
            identifier,
            records=records,
            adresswechsel_collection=adresswechsel_collection,
            berechtigungen_collection=berechtigungen_collection,
            now=germany_now,
            session=session,
        )

    async with journal:
        async with transaction_session(db) as session:
            return await session.with_transaction(stop_the_change)
