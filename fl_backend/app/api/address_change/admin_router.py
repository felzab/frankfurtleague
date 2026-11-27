from collections.abc import Mapping
from datetime import datetime
from typing import Any

from fastapi import APIRouter, status
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.address_change.crud import (
    Occupancy,
    address_taken,
    end_the_change_in_session,
    owe_the_link_in_session,
    owe_the_notice_in_session,
    read_the_holdings,
    start_the_change_in_session,
    state_of_the_link,
    tell_the_holders_of_the_end_in_session,
)
from app.api.address_change.schemas import (
    FLAddressChangeAdminListResponse,
    FLAddressChangeAdminOpen,
    FLAddressChangeAdminPayload,
)
from app.api.address_change.services import (
    LIVE_KEYED_TERMS,
    LIVE_TERMS,
    RESENDABLE_TERMS,
    compose_link_update,
    compose_record,
    find_ended_refusal,
    find_nothing_refusal,
    find_taken_refusal,
    find_unchanged_refusal,
    is_expired,
    stored_instant,
    waits_on,
)
from app.api.grants.crud import read_grants
from app.api.grants.guard import ADMIN_TIER
from app.api.identity.crud import refuse_an_address_off_limits
from app.api.identity.lookup import SubjectLookup
from app.api.identity.services import address_change_viewable_denied
from app.api.outbox.schemas import FLOutboxStatus
from app.api.spieler.crud import another_pupil_holds
from app.core.crud import aggregate_many_from_db, patch_one_in_db, refuse
from app.core.dependencies import (
    AddressChangeCollection,
    AddressChangeReadCollection,
    DBClient,
    GermanyNow,
    GrantsCollection,
    GrantsReadCollection,
    OutboxCollection,
    OutboxReadCollection,
    SnapshotSession,
    SpielerCollection,
)
from app.core.exceptions import DocumentNotFoundError
from app.core.readonly import ReadCollection
from app.core.recording import record_act
from app.core.routing import SAFE_WHEN, DryRun, by_id
from app.core.security import ActorEmail
from app.core.transactions import transact
from app.shared.folding import sign_in_identifier
from app.shared.schemas.custom import CustomObjectId
from app.shared.schemas.literals import FLAddressChangeWay, FLAdminTier

router = APIRouter(
    prefix="/address_change",
    dependencies=ADMIN_TIER,
)


async def _pull_the_change(
    address_changes_collection: ReadCollection, address_change_id: Any, *, session: AsyncClientSession | None
) -> Mapping[str, Any]:
    """The change an id names, ended or not: 404 where none is kept, `address_change_ended` where it ended."""

    record = await address_changes_collection.find_one({"_id": address_change_id}, session=session)
    if record is None:
        raise DocumentNotFoundError()
    refuse(find_ended_refusal(is_open=record.get("ended") is None))

    return record


def _open_change(
    record: Mapping[str, Any], *, holder: FLAdminTier | None, delivery: FLOutboxStatus | None, now: datetime
) -> FLAddressChangeAdminOpen:
    return FLAddressChangeAdminOpen(
        id=record["_id"],
        address=record["address"],
        email=record["email"],
        holder=holder,
        waits_on=waits_on(record),
        valid_until=stored_instant(record.get("valid_until")),
        effective_from=stored_instant(record.get("effective_from")),
        delivery=delivery,
        expired=is_expired(record, now=now),
    )


@router.get(
    "",
    summary="List the running address changes",
)
async def get_address_changes(
    address_changes_collection: AddressChangeReadCollection,
    outbox_collection: OutboxReadCollection,
    grants_collection: GrantsReadCollection,
    session: SnapshotSession,
    operator: ActorEmail,
    germany_now: GermanyNow,
) -> FLAddressChangeAdminListResponse:
    """Every running change this administrator may act on, newest first, with its two addresses and the step it waits on."""

    # Read whole: a capped list would hide a running change, each lasting days at most and an ended one holding no address.
    rows = await aggregate_many_from_db(
        collection=address_changes_collection,
        pipeline=[{"$match": dict(LIVE_KEYED_TERMS)}, {"$sort": {"_id": -1}}],
        session=session,
    )
    grants = await read_grants(grants_collection=grants_collection, session=session)
    tiers = {sign_in_identifier(str(grant["address"])): grant["admin_tier"] for grant in grants}

    return FLAddressChangeAdminListResponse(
        changes=[
            _open_change(
                row,
                holder=tiers.get(str(row["address"])),
                delivery=await state_of_the_link(outbox_collection=outbox_collection, address_change_id=row["_id"], session=session),
                now=germany_now,
            )
            for row in rows
            # Left out rather than refused: the actor's own, which their account page shows, and a holder's unless the owner asks.
            if address_change_viewable_denied(str(row["address"]), actor=operator, grants=grants) is None
        ]
    )


@router.post(
    "",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Start an address change for a person who says they cannot sign in",
    openapi_extra=SAFE_WHEN,
)
async def post_address_change_admin(
    address_change_data: FLAddressChangeAdminPayload,
    address_changes_collection: AddressChangeCollection,
    records: SubjectLookup,
    spieler_collection: SpielerCollection,
    grants_collection: GrantsCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    session: SnapshotSession,
    operator: ActorEmail,
    germany_now: GermanyNow,
    dry_run: DryRun = False,
) -> None:
    """Start a change of the typed address for a person who says they cannot sign in.

    The new mailbox is mailed a link and the address on file a stop link, and nothing moves until a waiting period after
    the new mailbox confirms, the old address working until then. A `dry_run` is refused as the start would be, and
    writes nothing.
    """

    identifier, email = sign_in_identifier(str(address_change_data.address)), str(address_change_data.email)
    way: FLAddressChangeWay = "waiting_period"

    async def judge(session: AsyncClientSession) -> None:
        # Every refusal of the start, in the write's transaction or the dry run's snapshot alike.
        await refuse_an_address_off_limits(identifier, actor=operator, grants_collection=grants_collection, session=session)
        refuse(find_unchanged_refusal(address=identifier, folded=sign_in_identifier(email)))

        holdings = await read_the_holdings(identifier, records=records, grants_collection=grants_collection, session=session)
        refuse(find_nothing_refusal(empty=holdings.empty))
        taken = holdings.spieler is not None and await another_pupil_holds(
            spieler_collection=spieler_collection, identifier=sign_in_identifier(email), spieler_id=holdings.spieler["_id"], session=session
        )
        # The entries judged here too, their reader trusted: a change its confirmation would refuse goes nowhere. A banned
        # new address is refused nothing: its link stops at the hand-out.
        refuse(
            find_taken_refusal(
                taken=taken
                or await address_taken(
                    email,
                    records=records,
                    occupancy=Occupancy(grants_collection=grants_collection, address_changes_collection=address_changes_collection),
                    session=session,
                )
            )
        )

    if dry_run:
        await judge(session)
        return

    async def judge_and_start_the_change(session: AsyncClientSession) -> None:
        await judge(session)
        record = compose_record(address=identifier, email=email, way=way, now=germany_now)
        address_change_id = await start_the_change_in_session(
            record=record,
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
            holder=None,
            outbox_collection=outbox_collection,
            now=germany_now,
            session=session,
        )
        await owe_the_link_in_session(
            address_change_id=address_change_id,
            email=email,
            way=way,
            valid_until=record["valid_until"],
            holder=None,
            outbox_collection=outbox_collection,
            now=germany_now,
            session=session,
        )
        await record_act(
            collection=address_changes_collection,
            action="address_change.started",
            record_id=address_change_id,
            session=session,
        )

    # One transaction over the judgement and the write: a record written outside it would stand with a live link an
    # administrator was then told had been refused.
    await transact(db, judge_and_start_the_change)


@router.post(
    f"{by_id('address_change_id')}/confirmation/resend",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Send a pending address a fresh link",
)
async def resend_confirmation(
    address_change_id: CustomObjectId,
    address_changes_collection: AddressChangeCollection,
    outbox_collection: OutboxCollection,
    records: SubjectLookup,
    spieler_collection: SpielerCollection,
    grants_collection: GrantsCollection,
    db: DBClient,
    operator: ActorEmail,
    germany_now: GermanyNow,
) -> None:
    """Mail the new mailbox a fresh link for the change this id names, its deadline restarting now.

    The previous link stops working once the fresh one is handed out, and only a change waiting on the new mailbox has a
    link to re-send.
    """

    async def judge_and_remint_the_change(session: AsyncClientSession) -> None:
        # The change the id names alone, so a page showing a change since replaced re-sends nothing.
        record = await _pull_the_change(address_changes_collection, address_change_id, session=session)
        identifier = str(record["address"])
        await refuse_an_address_off_limits(identifier, actor=operator, grants_collection=grants_collection, session=session)
        email = str(record["email"])
        holdings = await read_the_holdings(identifier, records=records, grants_collection=grants_collection, session=session)
        taken = holdings.spieler is not None and await another_pupil_holds(
            spieler_collection=spieler_collection, identifier=sign_in_identifier(email), spieler_id=holdings.spieler["_id"], session=session
        )
        occupied = await address_taken(
            email,
            records=records,
            occupancy=Occupancy(grants_collection=grants_collection, address_changes_collection=address_changes_collection),
            session=session,
        )
        refuse(find_taken_refusal(taken=taken or occupied))
        # The filter is the judgement: a change confirmed is the 404 here. A lapsed link is no refusal while the change
        # stands, which is until the next hourly pass ends it.
        updated = await patch_one_in_db(
            collection=address_changes_collection,
            db_filter={"_id": address_change_id, **LIVE_TERMS, **RESENDABLE_TERMS},
            update=compose_link_update(now=germany_now, released=False),
            session=session,
            expected_version=None,
            return_document=ReturnDocument.AFTER,
        )
        valid_until = stored_instant(updated["valid_until"])
        assert valid_until is not None

        await owe_the_link_in_session(
            address_change_id=address_change_id,
            email=email,
            way=updated["way"],
            valid_until=valid_until,
            holder=holdings.waits_as if updated["way"] == "account" else None,
            outbox_collection=outbox_collection,
            now=germany_now,
            session=session,
        )

    await transact(db, judge_and_remint_the_change)


@router.delete(
    by_id("address_change_id"),
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Discard a pending address change",
)
async def delete_address_change(
    address_change_id: CustomObjectId,
    address_changes_collection: AddressChangeCollection,
    grants_collection: GrantsCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    operator: ActorEmail,
    germany_now: GermanyNow,
) -> None:
    """Discard the change this id names, the address on file staying.

    A holder's change in its wait tells every holder, and nobody else is mailed.
    """

    async def discard_the_change(session: AsyncClientSession) -> None:
        # The change the id names alone, so a page showing a change since replaced discards nothing.
        record = await _pull_the_change(address_changes_collection, address_change_id, session=session)
        await refuse_an_address_off_limits(str(record["address"]), actor=operator, grants_collection=grants_collection, session=session)
        await end_the_change_in_session(
            address_changes_collection=address_changes_collection,
            db_filter={"_id": address_change_id},
            kind="discarded",
            now=germany_now,
            session=session,
        )
        await tell_the_holders_of_the_end_in_session(
            record,
            grants_collection=grants_collection,
            outbox_collection=outbox_collection,
            now=germany_now,
            session=session,
        )
        await record_act(collection=address_changes_collection, action="address_change.discarded", record_id=address_change_id, session=session)

    # One transaction, so the write and the log row recording it land together.
    await transact(db, discard_the_change)
