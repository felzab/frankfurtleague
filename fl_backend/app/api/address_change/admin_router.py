from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.address_change.crud import (
    Holdings,
    Occupancy,
    address_taken,
    end_the_change_in_session,
    ending_line,
    owe_the_link_in_session,
    owe_the_notice_in_session,
    read_the_holdings,
    refusal_of,
    start_the_change_in_session,
    state_of_the_link,
    take_effect_in_session,
)
from app.api.address_change.schemas import (
    FLAddressChangeAdminApproval,
    FLAddressChangeAdminHoldings,
    FLAddressChangeAdminMintResponse,
    FLAddressChangeAdminOpen,
    FLAddressChangeAdminPayload,
    FLAddressChangeAdminViewPayload,
    FLAddressChangeAdminViewResponse,
    FLAddressChangeApprovalResponse,
    FLAddressChangeIdResponse,
)
from app.api.address_change.services import (
    approval_open,
    as_utc,
    build_address_filter,
    build_live_filter,
    build_resendable_terms,
    compose_approval,
    compose_approved_update,
    compose_link_update,
    compose_record,
    find_approval_denied_refusal,
    find_barred_refusal,
    find_ended_refusal,
    find_expired_refusal,
    find_no_approval_open_refusal,
    find_no_approver_refusal,
    find_nothing_refusal,
    find_occupied_refusal,
    find_taken_refusal,
    find_unchanged_refusal,
    is_due,
    is_expired,
    waits_on,
)
from app.api.berechtigungen.crud import read_berechtigungen, read_the_announced
from app.api.berechtigungen.guard import verify_actor_is_admin
from app.api.berechtigungen.services import approval_denied, approver_of, holds_an_owners_power
from app.api.identity.lookup import SubjectLookup
from app.api.identity.services import EACH_ADMIN, find_admin_address_refusal, find_own_address_refusal
from app.api.outbox.schemas import FLOutboxStatus
from app.api.sperrliste.lookup import BanList, BanListLookup, ban_list_saison, barred_addresses, hash_barred
from app.api.spieler.crud import another_pupil_holds
from app.core.config import API_VERSION, BackendConfig, get_app_config
from app.core.crud import patch_one_in_db, refuse
from app.core.dependencies import (
    ActionLogCollection,
    AddressChangeCollection,
    AddressChangeReadCollection,
    BanListCollection,
    BewerbungenCollection,
    DBClient,
    GrantApprovalRequestsCollection,
    GrantsAnnouncedCollection,
    GrantsAnnouncedReadCollection,
    GrantsCollection,
    GrantsReadCollection,
    InvitationsCollection,
    OutboxCollection,
    OutboxReadCollection,
    RegistrierungenCollection,
    SaisonTeamsCollection,
    SchiedsrichterCollection,
    SnapshotSession,
    SpielbestaetigungenCollection,
    SpielerCollection,
    get_germany_now,
)
from app.core.exceptions import DocumentNotFoundError
from app.core.journal import Journal
from app.core.readonly import ReadCollection
from app.core.recording import log_stamp
from app.core.routing import SAFE, by_id
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
    actor: str,
    auth_time: int,
    grants_collection: ReadCollection,
    grants_announced_collection: ReadCollection,
    session: AsyncClientSession,
) -> tuple[list[Mapping[str, Any]], list[Mapping[str, Any]]]:
    """The erasure tool's two refusals about who asks, judged on the grants read here, which the caller reuses.

    The administrator's own address (`own_address`), and a grant holder's unless they hold an owner's power (`admin_address`).
    """

    refuse(find_own_address_refusal(identifier=identifier, actor=actor))
    grants = await read_berechtigungen(grants_collection=grants_collection, session=session)
    announced = await read_the_announced(grants_announced_collection=grants_announced_collection, session=session)
    refuse(
        find_admin_address_refusal(
            identifier=identifier, actor=actor, auth_time=auth_time, grants=grants, announced=announced, protected=EACH_ADMIN
        )
    )

    return grants, announced


async def _pull_the_change(
    address_changes_collection: ReadCollection, address_change_id: Any, *, session: AsyncClientSession | None
) -> Mapping[str, Any]:
    """The change an id names, ended or not: 404 where none is kept, `address_change_ended` where it ended."""

    record = await address_changes_collection.find_one({"_id": address_change_id}, session=session)
    if record is None:
        raise DocumentNotFoundError()
    refuse(find_ended_refusal(is_open=record.get("ended") is None))

    return record


def _pending_addresses(record: Mapping[str, Any], *, delivery: FLOutboxStatus | None, now: datetime) -> FLAddressChangeAdminOpen:
    approval = record.get("approval")

    return FLAddressChangeAdminOpen(
        id=record["_id"],
        email=record["email"],
        way=record["way"],
        grund=record.get("grund"),
        waits_on=waits_on(record),
        sent_at=record["sent_at"],
        valid_until=as_utc(record.get("valid_until")),
        released_at=as_utc(record.get("released_at")),
        confirmed_at=as_utc(record.get("confirmed_at")),
        effective_from=as_utc(record.get("effective_from")),
        delivery=delivery,
        expired=is_expired(record, now=now),
        approval=None if not isinstance(approval, Mapping) else FLAddressChangeAdminApproval.model_validate(approval),
    )


def _holdings(holdings: Holdings) -> FLAddressChangeAdminHoldings:
    return FLAddressChangeAdminHoldings(
        spieler=0 if holdings.spieler is None else 1,
        schiedsrichter=len(holdings.schiedsrichter),
        seats=sum(len(slots) for _, slots in holdings.seats),
        bewerbung_seats=sum(len(slots) for _, slots in holdings.bewerbung_seats),
        registrierungen=len(holdings.registrierungen),
        grant=None if holdings.grant is None else holdings.grant["admin_tier"],
    )


@router.post(
    "/view",
    response_model=FLAddressChangeAdminViewResponse,
    summary="Show what an address holds that a change moves, and its live change",
    openapi_extra=SAFE,
)
async def get_address_change_admin_view(
    view_data: Annotated[FLAddressChangeAdminViewPayload, Body()],
    address_changes_collection: AddressChangeReadCollection,
    outbox_collection: OutboxReadCollection,
    records: SubjectLookup,
    grants_collection: GrantsReadCollection,
    grants_announced_collection: GrantsAnnouncedReadCollection,
    session: SnapshotSession,
    operator: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
    germany_now: datetime = Depends(get_germany_now),
) -> FLAddressChangeAdminViewResponse:
    """
    Answer what the typed address holds that a change moves, by kind, and its live change whole, the new address and reason included.

    ADMIN TIER, the address tool's read, keyed by the address the administrator types or by a change a page links to;
    never a hash. `possible` where the address holds anything a change moves, a grant included. Stores nothing.

    Refused as the erasure's reveal is: the administrator's own address (`own_address`), and an address holding a live
    grant unless the administrator holds an owner's power (`admin_address`). A change id answers 404 where no change is
    kept, and `address_change_ended` where it ended.
    """

    actor_identifier = sign_in_identifier(operator)

    # Every read in the request's snapshot session, so the tool names the records of one moment; never a transaction, a
    # read writing nothing having no conflict to retry for.
    if view_data.address_change_id is not None:
        identifier = str((await _pull_the_change(address_changes_collection, view_data.address_change_id, session=session))["address"])
    else:
        identifier = sign_in_identifier(str(view_data.address))
    await _refuse_the_address(
        identifier,
        actor=actor_identifier,
        auth_time=auth_time,
        grants_collection=grants_collection,
        grants_announced_collection=grants_announced_collection,
        session=session,
    )
    holdings = await read_the_holdings(identifier, records=records, grants_collection=grants_collection, session=session)
    open = await address_changes_collection.find_one(build_address_filter(identifier), session=session)
    delivery = (
        None if open is None else await state_of_the_link(outbox_collection=outbox_collection, address_change_id=open["_id"], session=session)
    )

    return FLAddressChangeAdminViewResponse(
        address=identifier,
        holdings=_holdings(holdings),
        possible=not holdings.empty,
        open=None if open is None else _pending_addresses(open, delivery=delivery, now=germany_now),
    )


async def _refuse_without_approver(
    holdings: Holdings,
    *,
    actor: str,
    grants: list[Mapping[str, Any]],
    announced: list[Mapping[str, Any]],
    ban_list: BanList,
    now: datetime,
    session: AsyncClientSession,
) -> None:
    """Refused `address_change_no_approver` where nobody but the start's actor could approve a change of this address's grant."""

    assert holdings.grant is not None
    barred = await barred_addresses(ban_list, [str(row["address"]) for row in grants], session=session)
    approver = approver_of(
        admin_tier=str(holdings.grant["admin_tier"]),
        excepted={holdings.identifier, actor},
        grants=grants,
        announced=announced,
        barred=barred,
        before=now,
    )
    refuse(find_no_approver_refusal(approver=len(approver)))


@router.post(
    "",
    response_model=FLAddressChangeAdminMintResponse,
    summary="Start an address change for a person who says they cannot sign in",
    dependencies=[Depends(verify_step_up)],
)
async def post_address_change_admin(
    address_change_data: Annotated[FLAddressChangeAdminPayload, Body()],
    address_changes_collection: AddressChangeCollection,
    records: SubjectLookup,
    spieler_collection: SpielerCollection,
    grants_collection: GrantsCollection,
    grants_announced_collection: GrantsAnnouncedCollection,
    outbox_collection: OutboxCollection,
    grant_approval_requests_collection: GrantApprovalRequestsCollection,
    ban_list: BanListLookup,
    action_log_collection: ActionLogCollection,
    db: DBClient,
    operator: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
    germany_now: datetime = Depends(get_germany_now),
) -> FLAddressChangeAdminMintResponse:
    """
    Start a change of the typed address for a person who says they cannot sign in, its mails owed in the same transaction.

    **Nothing moves here.** The `grund` records how the administrator established who asks, the address on file being
    lost: a person who can still sign in there changes it on their own account page. The new mailbox is owed its link
    and the address on file a notice with its stop link; the change then takes effect
    `ADDRESS_CHANGE_WAITING_PERIOD_DAYS` after the new mailbox confirms. Where the address holds a grant, the change also
    waits on another administrator's approval, never this one's. No link is answered. The address's live change ends
    replaced.

    Refused the administrator's own address (`own_address`), a grant holder's without an owner's power
    (`admin_address`), the address on file typed again (`address_change_unchanged`), a new address the ban list holds
    (`address_change_barred`), an address holding nothing a change moves (`address_change_nothing`), a new address another pupil signs in on
    where the change moves a pupil (`address_change_taken`), a new address any entry names, confirmed or not (`address_change_occupied`), and a
    grant nobody could approve (`address_change_no_approver`).
    """

    identifier, email, grund = sign_in_identifier(str(address_change_data.address)), str(address_change_data.email), address_change_data.grund
    actor_identifier = sign_in_identifier(operator)
    way: FLAddressChangeWay = "waiting_period"
    hashed = ban_list.hash_of(email)
    # Outside the transaction (`app/api/sperrliste/crud.py :: address_is_barred`).
    governing_saison_id = await ban_list_saison(ban_list)
    journal = Journal()

    @journal.attempted
    async def judge_and_start_the_change(session: AsyncClientSession) -> FLAddressChangeAdminMintResponse:
        grants, announced = await _refuse_the_address(
            identifier,
            actor=actor_identifier,
            auth_time=auth_time,
            grants_collection=grants_collection,
            grants_announced_collection=grants_announced_collection,
            session=session,
        )
        refuse(find_unchanged_refusal(address=identifier, folded=sign_in_identifier(email)))
        refuse(find_barred_refusal(barred=await hash_barred(ban_list, hashed, governing_saison_id=governing_saison_id, session=session)))

        holdings = await read_the_holdings(identifier, records=records, grants_collection=grants_collection, session=session)
        refuse(find_nothing_refusal(empty=holdings.empty))
        taken = holdings.spieler is not None and await another_pupil_holds(
            spieler_collection=spieler_collection, identifier=sign_in_identifier(email), spieler_id=holdings.spieler["_id"], session=session
        )
        refuse(find_taken_refusal(taken=taken))
        # Judged here too, its reader trusted: a change its confirmation would refuse goes nowhere.
        refuse(
            find_occupied_refusal(
                occupied=await address_taken(
                    email,
                    records=records,
                    occupancy=Occupancy(
                        grants_collection=grants_collection,
                        grant_approval_requests_collection=grant_approval_requests_collection,
                        address_changes_collection=address_changes_collection,
                        now=germany_now,
                    ),
                    session=session,
                )
            )
        )
        if holdings.grant is not None:
            await _refuse_without_approver(
                holdings, actor=actor_identifier, grants=grants, announced=announced, ban_list=ban_list, now=germany_now, session=session
            )

        record = compose_record(
            address=identifier,
            email=email,
            way=way,
            grund=grund,
            approval=None
            if holdings.grant is None
            else compose_approval(admin_tier=str(holdings.grant["admin_tier"]), started_by=actor_identifier, now=germany_now),
            now=germany_now,
        )
        address_change_id = await start_the_change_in_session(
            record=record,
            address_changes_collection=address_changes_collection,
            action_log_collection=action_log_collection,
            key=ban_list.key,
            now=germany_now,
            journal=journal,
            session=session,
        )
        # The notice first and the link after, as the address on file is told before the new mailbox can answer.
        await owe_the_notice_in_session(
            address_change_id=address_change_id,
            address=identifier,
            way=way,
            valid_until=record["valid_until"],
            # Greeting nobody: the lost address on file may have passed to a stranger.
            vorname=None,
            outbox_collection=outbox_collection,
            now=germany_now,
            session=session,
        )
        await owe_the_link_in_session(
            address_change_id=address_change_id,
            email=email,
            way=way,
            valid_until=record["valid_until"],
            outbox_collection=outbox_collection,
            now=germany_now,
            session=session,
        )

        return FLAddressChangeAdminMintResponse(id=address_change_id, way=way, valid_until=record["valid_until"], email=email)

    # ONE transaction over the judgement and the write: a record written outside it would stand with a live link an
    # administrator was then told had been refused.
    async with journal:
        async with transaction_session(db) as session:
            return await session.with_transaction(judge_and_start_the_change)


@router.post(
    f"{by_id('address_change_id')}/invite",
    response_model=FLAddressChangeAdminMintResponse,
    summary="Send a pending address a fresh link",
    dependencies=[Depends(verify_step_up)],
)
async def invite_address_change(
    address_change_id: CustomRouteObjectId,
    address_changes_collection: AddressChangeCollection,
    outbox_collection: OutboxCollection,
    records: SubjectLookup,
    spieler_collection: SpielerCollection,
    grants_collection: GrantsCollection,
    grants_announced_collection: GrantsAnnouncedCollection,
    grant_approval_requests_collection: GrantApprovalRequestsCollection,
    ban_list: BanListLookup,
    db: DBClient,
    operator: str = Depends(get_actor_email),
    auth_time: int = Depends(get_actor_auth_time),
    germany_now: datetime = Depends(get_germany_now),
) -> FLAddressChangeAdminMintResponse:
    """
    Owe the new mailbox a fresh link for the change this id names, in the same transaction.

    The previous link stops working once the fresh one is handed out; the deadline restarts now. The stop link stays, so
    the address on file is mailed nothing again. A lapsed link is no refusal while the change stands, which is until the
    next hourly pass ends it. Acts on the change the id names alone, so a page showing a change since replaced re-sends
    nothing.

    Refused as the start is about who asks (`own_address`, `admin_address`), where the ban list holds the pending address
    (`address_change_barred`), where another pupil has come to sign in on it (`address_change_taken`), where an entry has come to name it,
    confirmed or not (`address_change_occupied`), where a grant's approval week has passed (`link_expired`), and where the change ended
    (`address_change_ended`). 404 for an id naming no change, and unless the change waits on the new mailbox: one awaiting the address on
    file's confirmation, or confirmed, has no link to re-send.
    """

    actor_identifier = sign_in_identifier(operator)
    # Outside the transaction (`app/api/sperrliste/crud.py :: address_is_barred`).
    governing_saison_id = await ban_list_saison(ban_list)

    async def judge_and_remint_the_change(session: AsyncClientSession) -> FLAddressChangeAdminMintResponse:
        record = await _pull_the_change(address_changes_collection, address_change_id, session=session)
        identifier = str(record["address"])
        await _refuse_the_address(
            identifier,
            actor=actor_identifier,
            auth_time=auth_time,
            grants_collection=grants_collection,
            grants_announced_collection=grants_announced_collection,
            session=session,
        )
        email = str(record["email"])
        refuse(
            find_barred_refusal(
                barred=await hash_barred(ban_list, ban_list.hash_of(email), governing_saison_id=governing_saison_id, session=session)
            )
        )
        holdings = await read_the_holdings(identifier, records=records, grants_collection=grants_collection, session=session)
        taken = holdings.spieler is not None and await another_pupil_holds(
            spieler_collection=spieler_collection, identifier=sign_in_identifier(email), spieler_id=holdings.spieler["_id"], session=session
        )
        refuse(find_taken_refusal(taken=taken))
        refuse(
            find_occupied_refusal(
                occupied=await address_taken(
                    email,
                    records=records,
                    occupancy=Occupancy(
                        grants_collection=grants_collection,
                        grant_approval_requests_collection=grant_approval_requests_collection,
                        address_changes_collection=address_changes_collection,
                        now=germany_now,
                    ),
                    session=session,
                )
            )
        )
        # A grant's approval week that lapsed ends the change at the next pass: a fresh link would be refused on its press.
        approval = record.get("approval")
        until = as_utc(approval.get("until")) if isinstance(approval, Mapping) and approval.get("approved_at") is None else None
        refuse(find_expired_refusal(expired=until is not None and until <= germany_now))

        # The filter is the judgement: a change awaiting its approval or confirmed is the 404 here.
        updated = await patch_one_in_db(
            collection=address_changes_collection,
            db_filter=build_live_filter(address_change_id, build_resendable_terms()),
            update=compose_link_update(now=germany_now, released=False),
            session=session,
            expected_version=None,
            return_document=ReturnDocument.AFTER,
        )
        valid_until = as_utc(updated["valid_until"])
        assert valid_until is not None

        await owe_the_link_in_session(
            address_change_id=address_change_id,
            email=email,
            way=updated["way"],
            valid_until=valid_until,
            outbox_collection=outbox_collection,
            now=germany_now,
            session=session,
        )

        return FLAddressChangeAdminMintResponse(id=address_change_id, way=updated["way"], valid_until=valid_until, email=email)

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
    address_changes_collection: AddressChangeCollection,
    grants_collection: GrantsCollection,
    grants_announced_collection: GrantsAnnouncedCollection,
    action_log_collection: ActionLogCollection,
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

    Refused as the start is about who asks (`own_address`, `admin_address`), and where the change ended
    (`address_change_ended`); 404 for an id naming no change.
    """

    actor_identifier = sign_in_identifier(operator)
    stamp = log_stamp(germany_now)
    journal = Journal()

    @journal.attempted
    async def discard_the_change(session: AsyncClientSession) -> FLAddressChangeIdResponse:
        record = await _pull_the_change(address_changes_collection, address_change_id, session=session)
        await _refuse_the_address(
            str(record["address"]),
            actor=actor_identifier,
            auth_time=auth_time,
            grants_collection=grants_collection,
            grants_announced_collection=grants_announced_collection,
            session=session,
        )
        await end_the_change_in_session(
            address_changes_collection=address_changes_collection,
            action_log_collection=action_log_collection,
            db_filter={"_id": address_change_id},
            kind="discarded",
            now=germany_now,
            stamp=stamp,
            session=session,
        )
        journal.note(
            ending_line(
                kind="address_change_discarded",
                new_address=str(record["email"]),
                record_id=address_change_id,
                at=stamp,
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
    address_changes_collection: AddressChangeCollection,
    records: SubjectLookup,
    spieler_collection: SpielerCollection,
    schiedsrichter_collection: SchiedsrichterCollection,
    saison_teams_collection: SaisonTeamsCollection,
    bewerbungen_collection: BewerbungenCollection,
    registrierungen_collection: RegistrierungenCollection,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    grants_collection: GrantsCollection,
    grants_announced_collection: GrantsAnnouncedCollection,
    outbox_collection: OutboxCollection,
    grant_approval_requests_collection: GrantApprovalRequestsCollection,
    invitations_collection: InvitationsCollection,
    ban_list_collection: BanListCollection,
    ban_list: BanListLookup,
    action_log_collection: ActionLogCollection,
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

    actor_identifier = sign_in_identifier(operator)
    # Outside the transaction (`app/api/sperrliste/crud.py :: address_is_barred`).
    governing_saison_id = await ban_list_saison(ban_list)
    journal = Journal()

    @journal.attempted
    async def approve_the_change(session: AsyncClientSession) -> FLAddressChangeApprovalResponse | None:
        record = await _pull_the_change(address_changes_collection, address_change_id, session=session)
        refuse(find_no_approval_open_refusal(is_open=approval_open(record)))
        refuse(find_expired_refusal(expired=is_expired(record, now=germany_now)))
        grants = await read_berechtigungen(grants_collection=grants_collection, session=session)
        announced = await read_the_announced(grants_announced_collection=grants_announced_collection, session=session)
        owner = holds_an_owners_power(actor=actor_identifier, auth_time=auth_time, grants=grants, announced=announced)
        denied = approval_denied(
            target=record["address"], approval=record["approval"], actor=actor_identifier, owner=owner, grants=grants, announced=announced
        )
        refuse(find_approval_denied_refusal(denied=denied))

        # The filter is the judgement: a rival's approval committed since the read is the miss.
        approved = await patch_one_in_db(
            collection=address_changes_collection,
            db_filter=build_live_filter(address_change_id, {"approval.approved_at": None}),
            update=compose_approved_update(actor=actor_identifier, now=germany_now),
            session=session,
            expected_version=None,
            return_document=ReturnDocument.AFTER,
        )
        if not is_due(approved, now=germany_now):
            return FLAddressChangeApprovalResponse(id=address_change_id, effective=False)

        verdict, effective = await take_effect_in_session(
            record=approved,
            records=records,
            ban_list=ban_list,
            governing_saison_id=governing_saison_id,
            address_changes_collection=address_changes_collection,
            spieler_collection=spieler_collection,
            schiedsrichter_collection=schiedsrichter_collection,
            saison_teams_collection=saison_teams_collection,
            bewerbungen_collection=bewerbungen_collection,
            registrierungen_collection=registrierungen_collection,
            spielbestaetigungen_collection=spielbestaetigungen_collection,
            grants_collection=grants_collection,
            grants_announced_collection=grants_announced_collection,
            outbox_collection=outbox_collection,
            grant_approval_requests_collection=grant_approval_requests_collection,
            invitations_collection=invitations_collection,
            ban_list_collection=ban_list_collection,
            action_log_collection=action_log_collection,
            key=config.sperrliste_key,
            now=germany_now,
            journal=journal,
            session=session,
            # Its new mailbox confirmed and was told the change waits on this approval.
            notify=True,
        )
        refuse(refusal_of(verdict.cause))
        if verdict.empty:
            return None

        return FLAddressChangeApprovalResponse(id=address_change_id, effective=effective)

    async with journal:
        async with transaction_session(db) as session:
            approved = await session.with_transaction(approve_the_change)

    # After the commit, the discard standing: this approval found nothing left to move and ended the change.
    refuse(find_nothing_refusal(empty=approved is None))
    assert approved is not None

    return approved
