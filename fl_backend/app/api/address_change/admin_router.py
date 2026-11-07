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
    denied_addresses,
    end_the_change_in_session,
    owe_the_link_in_session,
    owe_the_notice_in_session,
    read_the_holdings,
    start_the_change_in_session,
    state_of_the_link,
    tell_the_holders_of_the_end_in_session,
)
from app.api.address_change.schemas import (
    FLAddressChangeAdminHoldings,
    FLAddressChangeAdminListResponse,
    FLAddressChangeAdminMintResponse,
    FLAddressChangeAdminOpen,
    FLAddressChangeAdminPayload,
    FLAddressChangeAdminViewPayload,
    FLAddressChangeAdminViewResponse,
    FLAddressChangeIdResponse,
)
from app.api.address_change.services import (
    LIVE_KEYED_TERMS,
    as_utc,
    build_address_filter,
    build_live_filter,
    build_resendable_terms,
    compose_link_update,
    compose_record,
    find_ended_refusal,
    find_nothing_refusal,
    find_occupied_refusal,
    find_taken_refusal,
    find_unchanged_refusal,
    is_expired,
    waits_on,
)
from app.api.grants.crud import read_grants
from app.api.grants.guard import verify_actor_is_admin
from app.api.identity.lookup import SubjectLookup
from app.api.identity.services import EACH_ADMIN, find_admin_address_refusal, find_own_address_refusal
from app.api.outbox.schemas import FLOutboxStatus
from app.api.spieler.crud import another_pupil_holds
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db, patch_one_in_db, refuse
from app.core.dependencies import (
    AddressChangeCollection,
    AddressChangeReadCollection,
    DBClient,
    GrantsCollection,
    GrantsReadCollection,
    OutboxCollection,
    OutboxReadCollection,
    SnapshotSession,
    SpielerCollection,
    get_germany_now,
)
from app.core.exceptions import DocumentNotFoundError
from app.core.readonly import ReadCollection
from app.core.recording import record_act
from app.core.routing import SAFE, by_id
from app.core.security import bind_actor, get_actor_email, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.folding import sign_in_identifier
from app.shared.schemas.custom import CustomRouteObjectId
from app.shared.schemas.literals import FLAddressChangeWay

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/address_change",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)


async def _refuse_the_address(identifier: str, *, actor: str, grants_collection: ReadCollection, session: AsyncClientSession) -> None:
    """The tool's refusals about who asks: the administrator's own address (`own_address`), a holder's but for the owner (`admin_address`)."""

    refuse(find_own_address_refusal(identifier=identifier, actor=actor))
    grants = await read_grants(grants_collection=grants_collection, session=session)
    refuse(find_admin_address_refusal(identifier=identifier, actor=actor, grants=grants, protected=EACH_ADMIN))


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
    return FLAddressChangeAdminOpen(
        id=record["_id"],
        address=record["address"],
        email=record["email"],
        way=record["way"],
        change_reason=record.get("change_reason"),
        waits_on=waits_on(record),
        sent_at=record["sent_at"],
        valid_until=as_utc(record.get("valid_until")),
        released_at=as_utc(record.get("released_at")),
        confirmed_at=as_utc(record.get("confirmed_at")),
        effective_from=as_utc(record.get("effective_from")),
        delivery=delivery,
        expired=is_expired(record, now=now),
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


@router.get(
    "",
    response_model=FLAddressChangeAdminListResponse,
    summary="List the running address changes",
)
async def get_address_changes(
    address_changes_collection: AddressChangeReadCollection,
    outbox_collection: OutboxReadCollection,
    grants_collection: GrantsReadCollection,
    session: SnapshotSession,
    operator: str = Depends(get_actor_email),
    germany_now: datetime = Depends(get_germany_now),
) -> FLAddressChangeAdminListResponse:
    """
    Answer every running change, newest first: its two addresses, its way and the step it waits on.

    ADMIN TIER. The rows `address_change_viewable_denied` refuses are left out, rather than refused: the actor's own, which
    their account page shows, and a holder's unless the owner asks. Read whole, a capped list would hide a running change:
    each lasts days at most, and an ended one holds no address.
    """

    rows = await aggregate_many_from_db(
        collection=address_changes_collection,
        pipeline=[{"$match": dict(LIVE_KEYED_TERMS)}, {"$sort": {"_id": -1}}],
        session=session,
    )
    denied = await denied_addresses(
        [str(row["address"]) for row in rows], actor=sign_in_identifier(operator), grants_collection=grants_collection, session=session
    )

    return FLAddressChangeAdminListResponse(
        changes=[
            _pending_addresses(
                row,
                delivery=await state_of_the_link(outbox_collection=outbox_collection, address_change_id=row["_id"], session=session),
                now=germany_now,
            )
            for row in rows
            if str(row["address"]) not in denied
        ]
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
    session: SnapshotSession,
    operator: str = Depends(get_actor_email),
    germany_now: datetime = Depends(get_germany_now),
) -> FLAddressChangeAdminViewResponse:
    """
    Answer what the typed address holds that a change moves, by kind, and its live change whole, the new address and reason included.

    ADMIN TIER, the address tool's read, keyed by the address the administrator types or by a change a page links to;
    never a hash. `possible` where the address holds anything a change moves, a grant included. Stores nothing.

    Refused as the erasure's reveal is: the administrator's own address (`own_address`), and an address holding a grant
    unless the owner asks (`admin_address`). A change id answers 404 where no change is kept, and `address_change_ended`
    where it ended.
    """

    actor_identifier = sign_in_identifier(operator)

    # Every read in the request's snapshot session, so the tool names the records of one moment; never a transaction, a
    # read writing nothing having no conflict to retry for.
    if view_data.address_change_id is not None:
        identifier = str((await _pull_the_change(address_changes_collection, view_data.address_change_id, session=session))["address"])
    else:
        identifier = sign_in_identifier(str(view_data.address))
    await _refuse_the_address(identifier, actor=actor_identifier, grants_collection=grants_collection, session=session)
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


@router.post(
    "",
    response_model=FLAddressChangeAdminMintResponse,
    summary="Start an address change for a person who says they cannot sign in",
)
async def post_address_change_admin(
    address_change_data: Annotated[FLAddressChangeAdminPayload, Body()],
    address_changes_collection: AddressChangeCollection,
    records: SubjectLookup,
    spieler_collection: SpielerCollection,
    grants_collection: GrantsCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    operator: str = Depends(get_actor_email),
    germany_now: datetime = Depends(get_germany_now),
) -> FLAddressChangeAdminMintResponse:
    """
    Start a change of the typed address for a person who says they cannot sign in, its mails owed in the same transaction.

    **Nothing moves here.** The `change_reason` records how the administrator established who asks, the address on file being
    lost: a person who can still sign in there changes it on their own account page. The new mailbox is owed its link
    and the address on file a notice with its stop link; the change then takes effect
    `ADDRESS_CHANGE_WAITING_PERIOD_DAYS` after the new mailbox confirms, the old address working until then. No link is
    answered. The address's live change ends replaced.

    Refused the administrator's own address (`own_address`), a grant holder's unless the owner asks (`admin_address`),
    the address on file typed again (`address_change_unchanged`), an address holding nothing a change moves
    (`address_change_nothing`), a new address another pupil signs in on where the change moves a pupil
    (`address_change_taken`), and a new address any entry names, confirmed or not (`address_change_occupied`). A banned new
    address is refused nothing: its link stops at the hand-out.
    """

    identifier, email, change_reason = (
        sign_in_identifier(str(address_change_data.address)),
        str(address_change_data.email),
        address_change_data.change_reason,
    )
    actor_identifier = sign_in_identifier(operator)
    way: FLAddressChangeWay = "waiting_period"

    async def judge_and_start_the_change(session: AsyncClientSession) -> FLAddressChangeAdminMintResponse:
        await _refuse_the_address(identifier, actor=actor_identifier, grants_collection=grants_collection, session=session)
        refuse(find_unchanged_refusal(address=identifier, folded=sign_in_identifier(email)))

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
                    occupancy=Occupancy(grants_collection=grants_collection, address_changes_collection=address_changes_collection),
                    session=session,
                )
            )
        )

        record = compose_record(address=identifier, email=email, way=way, change_reason=change_reason, now=germany_now)
        address_change_id = await start_the_change_in_session(
            record=record,
            actor=actor_identifier,
            address_changes_collection=address_changes_collection,
            grants_collection=grants_collection,
            outbox_collection=outbox_collection,
            now=germany_now,
            session=session,
        )
        # The notice first and the link after, as the address on file is told before the new mailbox can answer.
        await owe_the_notice_in_session(
            address_change_id=address_change_id,
            address=identifier,
            way=way,
            valid_until=record["valid_until"],
            # Greeting nobody: the lost address on file may have passed to a stranger.
            first_name=None,
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
        await record_act(
            collection=address_changes_collection,
            action="address_change.started",
            record_id=address_change_id,
            label=change_reason,
            session=session,
        )

        return FLAddressChangeAdminMintResponse(id=address_change_id, way=way, valid_until=record["valid_until"], email=email)

    # ONE transaction over the judgement and the write: a record written outside it would stand with a live link an
    # administrator was then told had been refused.
    async with transaction_session(db) as session:
        return await session.with_transaction(judge_and_start_the_change)


@router.post(
    f"{by_id('address_change_id')}/invite",
    response_model=FLAddressChangeAdminMintResponse,
    summary="Send a pending address a fresh link",
)
async def invite_address_change(
    address_change_id: CustomRouteObjectId,
    address_changes_collection: AddressChangeCollection,
    outbox_collection: OutboxCollection,
    records: SubjectLookup,
    spieler_collection: SpielerCollection,
    grants_collection: GrantsCollection,
    db: DBClient,
    operator: str = Depends(get_actor_email),
    germany_now: datetime = Depends(get_germany_now),
) -> FLAddressChangeAdminMintResponse:
    """
    Owe the new mailbox a fresh link for the change this id names, in the same transaction.

    The previous link stops working once the fresh one is handed out; the deadline restarts now. The stop link stays, so
    the address on file is mailed nothing again. A lapsed link is no refusal while the change stands, which is until the
    next hourly pass ends it. Acts on the change the id names alone, so a page showing a change since replaced re-sends
    nothing.

    Refused as the start is about who asks (`own_address`, `admin_address`), where another pupil has come to sign in on the
    pending address (`address_change_taken`), where an entry has come to name it, confirmed or not
    (`address_change_occupied`), and where the change ended (`address_change_ended`). 404 for an id naming no change, and
    unless the change waits on the new mailbox: one awaiting the address on file's confirmation, or confirmed, has no link to
    re-send.
    """

    actor_identifier = sign_in_identifier(operator)

    async def judge_and_remint_the_change(session: AsyncClientSession) -> FLAddressChangeAdminMintResponse:
        record = await _pull_the_change(address_changes_collection, address_change_id, session=session)
        identifier = str(record["address"])
        await _refuse_the_address(identifier, actor=actor_identifier, grants_collection=grants_collection, session=session)
        email = str(record["email"])
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
                    occupancy=Occupancy(grants_collection=grants_collection, address_changes_collection=address_changes_collection),
                    session=session,
                )
            )
        )
        # The filter is the judgement: a change confirmed is the 404 here.
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
)
async def delete_address_change(
    address_change_id: CustomRouteObjectId,
    address_changes_collection: AddressChangeCollection,
    grants_collection: GrantsCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    operator: str = Depends(get_actor_email),
    germany_now: datetime = Depends(get_germany_now),
) -> FLAddressChangeIdResponse:
    """
    Discard the change this id names: its links open nothing to press, and the address on file stays.

    A holder's change in its wait tells every holder; nothing else is mailed. Acts on the change the id names alone, so a page
    showing a change since replaced discards nothing.

    Refused as the start is about who asks (`own_address`, `admin_address`), and where the change ended
    (`address_change_ended`); 404 for an id naming no change.
    """

    actor_identifier = sign_in_identifier(operator)

    async def discard_the_change(session: AsyncClientSession) -> FLAddressChangeIdResponse:
        record = await _pull_the_change(address_changes_collection, address_change_id, session=session)
        await _refuse_the_address(str(record["address"]), actor=actor_identifier, grants_collection=grants_collection, session=session)
        await end_the_change_in_session(
            address_changes_collection=address_changes_collection,
            db_filter={"_id": address_change_id},
            kind="discarded",
            now=germany_now,
            session=session,
        )
        await tell_the_holders_of_the_end_in_session(
            record,
            changed_by=actor_identifier,
            grants_collection=grants_collection,
            outbox_collection=outbox_collection,
            now=germany_now,
            session=session,
        )
        await record_act(collection=address_changes_collection, action="address_change.discarded", record_id=address_change_id, session=session)

        return FLAddressChangeIdResponse(id=address_change_id)

    # One transaction, so the write and the log row recording it land together.
    async with transaction_session(db) as session:
        return await session.with_transaction(discard_the_change)
