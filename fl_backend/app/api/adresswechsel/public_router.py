from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.adresswechsel.crud import (
    Belegung,
    end_the_change_in_session,
    ending_line,
    judge_the_effect_in_session,
    read_the_bestand,
    refusal_of,
    take_effect_in_session,
)
from app.api.adresswechsel.schemas import (
    FLAddressChangeAntwortPayload,
    FLAddressChangeAntwortResponse,
    FLAddressChangeStopResponse,
    FLAddressChangeViewEnded,
    FLAddressChangeViewNew,
    FLAddressChangeViewPrevious,
    FLAddressChangeViewResponse,
)
from app.api.adresswechsel.services import (
    als_utc,
    bisherig_zustand,
    build_open_link_terms,
    compose_confirmation_update,
    find_beendet_refusal,
    find_unbekannt_refusal,
    genehmigung_offen,
    ist_abgelaufen,
    neu_zustand,
)
from app.api.identitaet.lookup import SubjektLookup
from app.api.sperrliste.lookup import SperrlisteLookup, sperrliste_saison
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
from app.core.journal import Journal
from app.core.recording import log_stamp
from app.core.security import bind_public_actor, verify_access_base
from app.core.transactions import transaction_session
from app.shared.schemas.confirmation import FLTokenPayload
from app.shared.tokens import hash_token

# The token is the whole credential, so these endpoints are base-tier and bind the public actor.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/address_change/confirmation",
    dependencies=[Depends(verify_access_base), Depends(bind_public_actor)],
)

# What a link's view and press read: never `grund`, and the addresses for the judgement alone.
_FIELDS: Mapping[str, int] = {
    "adresse": 1,
    "email": 1,
    "way": 1,
    "released_at": 1,
    "valid_until": 1,
    "confirmed_at": 1,
    "effective_from": 1,
    "approval": 1,
    "ended": 1,
}

# Causes the press refuses for the replaced address's sake, which the view reads alike as unconfirmable.
_NICHT_BESTAETIGBAR = frozenset({"ersetzte_gesperrt", "vergeben", "nicht_gedeckt", "neue_berechtigt", "belegt"})


@router.post(
    "/view",
    response_model=FLAddressChangeViewResponse,
    summary="What one address link opens",
)
async def get_address_change_view(
    ansicht_data: Annotated[FLTokenPayload, Body()],
    adresswechsel_collection: AddressChangeCollection,
    records: SubjektLookup,
    spieler_collection: SpielerCollection,
    berechtigungen_collection: GrantsCollection,
    berechtigungen_angekuendigt_collection: GrantsAnnouncedCollection,
    berechtigungen_antraege_collection: GrantsApprovalRequestsCollection,
    sperrliste: SperrlisteLookup,
    germany_now: datetime = Depends(get_germany_now),
) -> FLAddressChangeViewResponse:
    """
    Answer what this token opens: the new mailbox's link, the stop link the address on file was mailed, or how either's change ended.

    **Nothing else about the change**: never a name, either address or the id. A POST that reads, so the token travels in
    a body and never in a second URL. Refuses only a token no change holds (`link_invalid`); an ended change's
    links answer `ended` and how it ended for as long as its record is kept.

    The new mailbox's side is served in a state: once pressed, `confirmed`, or `approval_expired` where its
    approval week lapsed unapproved; else `barred` wherever the ban list holds the address the link was mailed to, then
    `abgelaufen`, then `not_confirmable` wherever the press would be refused for the address on file's sake or would
    find it holding nothing to move, each a state the confirmation is refused in. Those read alike here, though the press
    answers each by its own code; what keeps the link's holder from telling them apart is the edge, where
    `nginx/shared/site.conf` routes no public call to this service. The stop side answers the step the change waits on and
    until when, and never whether it could be confirmed: the stop is refused nothing.
    """

    token_hash = hash_token(ansicht_data.token)
    # `find_one` rather than `pull_one_from_db`: a miss is this endpoint's own refusal, never a 404.
    record = await adresswechsel_collection.find_one({"token_hashes": token_hash}, projection=dict(_FIELDS))
    seite: Literal["new", "previous"] = "new"
    if record is None:
        record = await adresswechsel_collection.find_one({"stop.token_hashes": token_hash}, projection=dict(_FIELDS))
        seite = "previous"
    refuse(find_unbekannt_refusal(found=record is not None))
    assert record is not None

    beendet = record.get("ended")
    if isinstance(beendet, Mapping):
        return FLAddressChangeViewResponse(view=FLAddressChangeViewEnded(seite=seite, state="ended", art=beendet["art"]))

    gueltig_bis, wirksam_ab = als_utc(record.get("valid_until")), als_utc(record.get("effective_from"))
    if seite == "previous":
        return FLAddressChangeViewResponse(
            view=FLAddressChangeViewPrevious(
                seite="previous", state=bisherig_zustand(record), valid_until=gueltig_bis, effective_from=wirksam_ab, way=record["way"]
            )
        )

    gesperrt, nicht_bestaetigbar = False, False
    if record.get("confirmed_at") is None:
        # Every judgement the press makes, read here too, so the page never offers a confirmation the press refuses.
        bestand = await read_the_bestand(
            str(record["adresse"]), records=records, berechtigungen_collection=berechtigungen_collection, session=None
        )
        urteil = await judge_the_effect_in_session(
            record=record,
            holdings=bestand,
            records=records,
            spieler_collection=spieler_collection,
            berechtigungen_collection=berechtigungen_collection,
            berechtigungen_angekuendigt_collection=berechtigungen_angekuendigt_collection,
            sperrliste=sperrliste,
            massgebliche_saison_id=await sperrliste_saison(sperrliste),
            belegung=Belegung(
                berechtigungen_collection=berechtigungen_collection,
                berechtigungen_antraege_collection=berechtigungen_antraege_collection,
                adresswechsel_collection=adresswechsel_collection,
                now=germany_now,
            ),
            abgelaufen=False,
            session=None,
        )
        gesperrt = urteil.ursache == "neue_gesperrt"
        # An address left holding nothing to move too: the press ends that change discarded and answers `address_change_ended`.
        nicht_bestaetigbar = urteil.ursache in _NICHT_BESTAETIGBAR or urteil.leer

    zustand = neu_zustand(record, now=germany_now, barred=gesperrt, nicht_bestaetigbar=nicht_bestaetigbar)

    return FLAddressChangeViewResponse(
        view=FLAddressChangeViewNew(
            seite="new",
            state=zustand,
            valid_until=gueltig_bis,
            effective_from=wirksam_ab,
            way=record["way"],
            # Only once confirmed, where the page says what the change waits on: before, it would tell whoever holds a
            # mistyped link that the account holds access to the administration.
            approval_open=genehmigung_offen(record) if zustand == "confirmed" else None,
        )
    )


@router.post(
    "",
    response_model=FLAddressChangeAntwortResponse,
    summary="Confirm or decline a pending address",
    # `uniq_spieler_email` and `uniq_grant_adresse` are published by the duplicate-key trace and stay unreached: the
    # in-session reads of another pupil and of the new address's grant include every row either index holds.
)
async def post_address_change_antwort(
    antwort_data: Annotated[FLAddressChangeAntwortPayload, Body()],
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
    germany_now: datetime = Depends(get_germany_now),
) -> FLAddressChangeAntwortResponse:
    """
    Record whether the mailbox this link was sent to is the person's: `confirmed` confirms it, `declined` ends the change.

    **A confirmation moves the person, not a record.** Unless the change waits -- on a waiting time an administrator's
    start with a reason asked, or on another administrator's approval of the grant it moves -- it takes effect in this
    transaction: every pupil row, confirmed referee row, confirmed contact seat, registration and grant the address on
    file holds moves to the new one, asking no consent and writing none, and `effective` says so; its completion notice is
    owed in this transaction, and so is its sign-in account's carry. A change that waits is confirmed alone,
    answering `effective_from` or `approval_open`.
    Either answer spends the link, which keeps answering what became of the change.

    Refuses a token no change holds (`link_invalid`), a link already answered or a change ended
    (`address_change_ended`), and, in the order the link's view ranks its states, a CONFIRMATION through a link mailed to
    an address the ban list holds now (`link_barred`), one past its deadline (`link_expired`), one whose change would replace an address
    the ban list holds now (`address_change_replaced_barred`), so a barred person cannot move their records off the address the ban keys on,
    one moving a pupil onto an address another pupil signs in on (`address_change_taken`), one whose address came to hold a grant its approval
    does not cover (`address_change_not_covered`), one moving a grant onto an address holding one (`address_change_new_granted`), and one
    whose new address any entry names, confirmed or not, an open grant request among them (`address_change_occupied`): moving the person onto it
    would join two people's records. **A decline is refused none of these**: it removes an address nobody proved, out of every log image of the
    change too.

    A change whose address has come to hold nothing to move ends discarded, and the press answers `address_change_ended`. The codes past
    `link_barred` tell a caller what the view's `not_confirmable` keeps alike; only the edge keeps them from the link's holder.
    """

    token_hash = hash_token(antwort_data.token)
    # Outside the transaction (`app/api/sperrliste/crud.py :: address_is_gesperrt`).
    massgebliche_saison_id = await sperrliste_saison(sperrliste)
    stamp = log_stamp(germany_now)
    journal = Journal()

    @journal.attempted
    async def answer_for_the_mailbox(session: AsyncClientSession) -> FLAddressChangeAntwortResponse | None:
        """Judge, then write, everything judged read in-session, so a second press is refused by the spent link rather than writing twice."""

        record = await adresswechsel_collection.find_one({"token_hashes": token_hash}, session=session)
        refuse(find_unbekannt_refusal(found=record is not None))
        assert record is not None
        refuse(find_beendet_refusal(offen=record.get("ended") is None and record.get("confirmed_at") is None))
        db_filter = {"_id": record["_id"], **build_open_link_terms(token_hash)}

        if antwort_data.antwort == "declined":
            await end_the_change_in_session(
                adresswechsel_collection=adresswechsel_collection,
                aktionen_collection=aktionen_collection,
                db_filter=db_filter,
                art="declined",
                now=germany_now,
                stamp=stamp,
                session=session,
            )
            journal.note(
                ending_line(
                    art="adresswechsel_abgelehnt",
                    neue=str(record["email"]),
                    record_id=record["_id"],
                    am=stamp,
                    key=config.sperrliste_key,
                )
            )
            return FLAddressChangeAntwortResponse(antwort="declined", effective_from=None, approval_open=False, effective=False)

        urteil, wirksam = await take_effect_in_session(
            record=record,
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
            mitteilen=False,
            abgelaufen=ist_abgelaufen(record, now=germany_now),
            jetzt=record["way"] != "waiting_period",
        )
        refuse(refusal_of(urteil.ursache))
        if urteil.leer:
            return None
        if wirksam:
            return FLAddressChangeAntwortResponse(antwort="confirmed", effective_from=None, approval_open=False, effective=True)

        bestaetigt: Mapping[str, Any] = await patch_one_in_db(
            collection=adresswechsel_collection,
            db_filter=db_filter,
            update=compose_confirmation_update(record=record, now=germany_now),
            session=session,
            return_document=ReturnDocument.AFTER,
        )
        return FLAddressChangeAntwortResponse(
            antwort="confirmed",
            effective_from=als_utc(bestaetigt.get("effective_from")),
            approval_open=genehmigung_offen(bestaetigt),
            effective=False,
        )

    async with journal:
        async with transaction_session(db) as session:
            answered = await session.with_transaction(answer_for_the_mailbox)

    # After the commit, the discard standing: the link now answers how the change ended.
    refuse(find_beendet_refusal(offen=answered is not None))
    assert answered is not None

    return answered


@router.post(
    "/stop",
    response_model=FLAddressChangeStopResponse,
    summary="Stop a pending address change",
)
async def post_address_change_stop(
    stopp_data: Annotated[FLTokenPayload, Body()],
    adresswechsel_collection: AddressChangeCollection,
    aktionen_collection: ActionLogCollection,
    db: DBClient,
    config: Annotated[BackendConfig, Depends(get_app_config)],
    germany_now: datetime = Depends(get_germany_now),
) -> FLAddressChangeStopResponse:
    """
    Stop the change the address on file was told of: its new address goes, out of every log image of the change too.

    **Refused nothing but a token no change holds** (`link_invalid`) **and a change ended** (`address_change_ended`): a stop
    hands nothing over, so it answers past every deadline, a barred address's holder too, until the change ends.
    """

    stopp_hash = hash_token(stopp_data.token)
    stamp = log_stamp(germany_now)
    journal = Journal()

    @journal.attempted
    async def stop_the_change(session: AsyncClientSession) -> FLAddressChangeStopResponse:
        record = await adresswechsel_collection.find_one({"stop.token_hashes": stopp_hash}, {"email": 1, "ended": 1}, session=session)
        refuse(find_unbekannt_refusal(found=record is not None))
        assert record is not None
        refuse(find_beendet_refusal(offen=record.get("ended") is None))

        await end_the_change_in_session(
            adresswechsel_collection=adresswechsel_collection,
            aktionen_collection=aktionen_collection,
            db_filter={"_id": record["_id"]},
            art="stopped",
            now=germany_now,
            stamp=stamp,
            session=session,
        )
        journal.note(
            ending_line(
                art="adresswechsel_gestoppt",
                neue=str(record["email"]),
                record_id=record["_id"],
                am=stamp,
                key=config.sperrliste_key,
            )
        )

        return FLAddressChangeStopResponse(stopped=True)

    async with journal:
        async with transaction_session(db) as session:
            return await session.with_transaction(stop_the_change)
