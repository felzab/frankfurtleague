"""
API · every read and write of the grants that reaches a collection

The anchor lives here beside the read it protects, so no caller can judge the list without writing
every row of it.
"""

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any, Final

from bson import ObjectId
from pymongo import ASCENDING, ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.address_change.services import build_addresses_filter
from app.api.grants.services import ADMINISTRATION, OWNER, Notice, compose_handover_end, compose_notice, in_effect
from app.api.outbox.schemas import FLGrantData
from app.api.outbox.services import OwedMail, enqueue_mails
from app.core.crud import (
    aggregate_many_from_db,
    anchor_in_db,
    delete_many_from_db,
    patch_many_in_db,
    patch_one_in_db,
    post_one_to_db,
)
from app.core.readonly import ReadCollection
from app.core.recording import ACT_BY_SYSTEM, record_act
from app.shared.schemas.bounds import GRANT_WAIT_HOURS, OWNER_WAIT_DAYS
from app.shared.schemas.custom import as_utc
from app.shared.schemas.literals import FLAdminTier


async def read_grants(*, grants_collection: ReadCollection, session: AsyncClientSession | None = None) -> list[Mapping[str, Any]]:
    """Every grant as stored, by address, a waiting row among them, and unbounded: the judgements read the whole list."""

    return await aggregate_many_from_db(collection=grants_collection, pipeline=[{"$sort": {"address": ASCENDING}}], session=session)


async def pull_the_list_to_judge(
    *,
    grants_collection: AsyncCollection,
    # REQUIRED: the anchor is what closes the race, so forgetting the session has to be a TypeError
    # at the call rather than a silent reopening of it.
    session: AsyncClientSession,
) -> list[Mapping[str, Any]]:
    """Read every grant, then write each one, in the caller's transaction.

    A snapshot re-validates no read: a rival judging the list writes the same rows, so whichever
    lands second meets a write conflict and retries.
    """

    grants = await read_grants(grants_collection=grants_collection, session=session)

    # Exactly the rows the read returned, each named: the rows judged are the rows a rival must meet.
    await anchor_in_db(
        collection=grants_collection,
        db_filter={"_id": {"$in": [grant["_id"] for grant in grants]}},
        session=session,
    )

    return grants


async def read_admin_tier_of(
    *, grants_collection: ReadCollection, address: str, now: datetime, session: AsyncClientSession
) -> tuple[FLAdminTier, datetime] | None:
    """The tier this folded address holds at `now`, and when it took effect, or `None`, a waiting row holding nothing yet.

    The sign-in reads it too, so a person named on a waiting addition is admitted by nothing but their other records, and a
    person holding a seat keeps Konto through the wait.
    """

    found = await grants_collection.find_one({"address": address}, {"admin_tier": 1, "effective_from": 1}, session=session)
    if found is None or not in_effect(found, now):
        return None

    return found["admin_tier"], as_utc(found["effective_from"])


# A grant's notice still to be handed out: the one shape an erasure rewrites, a sent one being past saying.
OPEN_NOTICE: Final[Mapping[str, Any]] = {"state": "open", "kind": "grant"}


def _named_recipients(data: FLGrantData) -> set[str]:
    """Who a notice names, beyond the holders: a completed address change's old address alone has its short-lived mail.

    A row kept here would hold that address 30 days past an erasure (`app/api/outbox/services.py :: RETENTION`).
    """

    if data.address is None or (data.change == "address" and data.stage == "completed"):
        return set()

    return {data.address}


async def _read_lost_mailboxes(
    addresses: Sequence[str], *, address_changes_collection: ReadCollection, session: AsyncClientSession
) -> set[str]:
    """Which of these folded addresses a lost-mailbox change stands on: each may have passed to a stranger."""

    rows = await aggregate_many_from_db(
        collection=address_changes_collection,
        pipeline=[{"$match": {**build_addresses_filter(list(addresses)), "way": "waiting_period"}}, {"$project": {"address": 1}}],
        session=session,
    )

    return {str(row["address"]) for row in rows}


async def owe_in_session(
    notices: Sequence[Notice],
    *,
    outbox_collection: AsyncCollection,
    grants_collection: AsyncCollection,
    address_changes_collection: ReadCollection,
    now: datetime,
    session: AsyncClientSession,
    # An address these notices owe nothing though its change has just ended, in this transaction.
    passing_over: Sequence[str] = (),
) -> None:
    """Owe each notice, in the caller's transaction, to every holder in effect and to the address it names, one row apiece.

    The starter is among them: on a hijacked session the mail is how its owner learns of it. The holders are read after the
    caller's write, on its session, so a removed one is told only as the address named. A barred recipient is stopped at the
    hand-out, not here (`app/api/outbox/system_router.py :: post_handout`). An address a lost-mailbox change stands on is told
    nothing: these mails name people, and it hears only through that change's own notice and `address_change_effective`.
    """

    if not notices:
        return
    grants = await read_grants(grants_collection=grants_collection, session=session)
    holders = {str(row["address"]) for row in grants if in_effect(row, now)}
    named = {address for notice in notices for address in _named_recipients(FLGrantData.model_validate(notice.data))}
    addresses = sorted(holders | named)
    silent = {*passing_over, *await _read_lost_mailboxes(addresses, address_changes_collection=address_changes_collection, session=session)}

    mails: list[OwedMail] = []
    for notice in notices:
        data = FLGrantData.model_validate(notice.data)
        mails.extend(
            OwedMail(
                # The write's own instant keeps two notices about one record apart.
                key=f"grant/{notice.grant_id}/{data.change}/{data.stage}/{now.isoformat()}/{address}",
                to=address,
                data=data,
                reference=None,
            )
            for address in sorted((holders | _named_recipients(data)) - silent)
        )
    await enqueue_mails(outbox_collection=outbox_collection, session=session, mails=mails, now=now)


async def grant_in_session(
    *,
    address: str,
    granted_by: str,
    grants_collection: AsyncCollection,
    address_changes_collection: ReadCollection,
    outbox_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession,
) -> ObjectId:
    """Write an addition, which holds once its wait ends, and owe its notice, answering its id.

    Its row stands from the first moment, so the address counts as held for everyone reading the list as stored.
    """

    # In UTC: added to a Berlin value the hours would be the wall clock's, 23 or 25 across a clock change.
    effective_from = now.astimezone(UTC) + timedelta(hours=GRANT_WAIT_HOURS)
    created = await post_one_to_db(
        collection=grants_collection,
        document={
            "address": address,
            "admin_tier": ADMINISTRATION,
            # The bound actor rather than a payload field, so the grant and its `action_log` row name one person.
            "granted_by": granted_by,
            "effective_from": effective_from,
        },
        session=session,
    )
    await record_act(collection=grants_collection, action="grant.added", record_id=created.inserted_id, label=address, session=session)
    await owe_in_session(
        [
            compose_notice(
                grant_id=created.inserted_id,
                change="granted",
                stage="started",
                address=address,
                effective_from=effective_from,
            )
        ],
        outbox_collection=outbox_collection,
        grants_collection=grants_collection,
        address_changes_collection=address_changes_collection,
        now=now,
        session=session,
    )

    return created.inserted_id


async def move_the_grant_in_session(
    grant: Mapping[str, Any],
    *,
    new_address: str,
    grants_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession,
) -> None:
    """Move a holder's grant to their new address at the switch, a session older than the switch holding nothing of it.

    `$max` rather than `$set`: a grant still waiting keeps its own later date, or the move would cut its wait short.
    """

    await patch_one_in_db(
        collection=grants_collection,
        db_filter={"_id": grant["_id"]},
        update={"$set": {"address": new_address}, "$max": {"effective_from": now}},
        expected_version=None,
        session=session,
        return_document=ReturnDocument.BEFORE,
    )


async def revoke_in_session(
    *,
    grant: Mapping[str, Any],
    grants_collection: AsyncCollection,
    address_changes_collection: ReadCollection,
    outbox_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession,
) -> None:
    """Remove one grant, owing the notice of its end, or of the addition's withdrawal where it had not taken effect.

    A handover waiting on the row ends with it, whose holders were told a date, so that ending is owed too.
    """

    holds = in_effect(grant, now)
    await delete_many_from_db(collection=grants_collection, db_filter={"_id": grant["_id"]}, session=session)
    await record_act(
        collection=grants_collection,
        action="grant.removed" if holds else "grant.addition_withdrawn",
        record_id=grant["_id"],
        label=str(grant["address"]),
        session=session,
    )
    # After the removal, so the holders told are the ones who remain, and the removed one as the address named.
    await owe_in_session(
        [
            compose_notice(
                grant_id=grant["_id"],
                change="revoked" if holds else "granted",
                stage="completed" if holds else "withdrawn",
                address=str(grant["address"]),
            ),
            *compose_handover_end(grant),
        ],
        outbox_collection=outbox_collection,
        grants_collection=grants_collection,
        address_changes_collection=address_changes_collection,
        now=now,
        session=session,
    )


async def start_the_handover_in_session(
    grant: Mapping[str, Any],
    *,
    grants_collection: AsyncCollection,
    address_changes_collection: ReadCollection,
    outbox_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession,
) -> None:
    """Date the named row's handover and owe its notice: the tier moves only at the pass, the owner staying the owner until then."""

    owner_from = now.astimezone(UTC) + timedelta(days=OWNER_WAIT_DAYS)
    await patch_one_in_db(
        collection=grants_collection,
        db_filter={"_id": grant["_id"]},
        update={"$set": {"owner_from": owner_from}},
        expected_version=None,
        session=session,
        return_document=ReturnDocument.BEFORE,
    )
    await record_act(
        collection=grants_collection, action="grant.handover_started", record_id=grant["_id"], label=str(grant["address"]), session=session
    )
    await owe_in_session(
        [
            compose_notice(
                grant_id=grant["_id"],
                change="handover",
                stage="started",
                address=str(grant["address"]),
                effective_from=owner_from,
            )
        ],
        outbox_collection=outbox_collection,
        grants_collection=grants_collection,
        address_changes_collection=address_changes_collection,
        now=now,
        session=session,
    )


async def stop_the_handover_in_session(
    grant: Mapping[str, Any],
    *,
    grants_collection: AsyncCollection,
    address_changes_collection: ReadCollection,
    outbox_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession,
) -> None:
    """Take a waiting handover back: the field is stored only while one waits."""

    await patch_one_in_db(
        collection=grants_collection,
        db_filter={"_id": grant["_id"]},
        update={"$unset": {"owner_from": ""}},
        expected_version=None,
        session=session,
        return_document=ReturnDocument.BEFORE,
    )
    await record_act(
        collection=grants_collection, action="grant.handover_withdrawn", record_id=grant["_id"], label=str(grant["address"]), session=session
    )
    await owe_in_session(
        [
            compose_notice(grant_id=grant["_id"], change="handover", stage="withdrawn", address=str(grant["address"])),
        ],
        outbox_collection=outbox_collection,
        grants_collection=grants_collection,
        address_changes_collection=address_changes_collection,
        now=now,
        session=session,
    )


async def complete_the_handover_in_session(
    grant: Mapping[str, Any],
    *,
    grants_collection: AsyncCollection,
    address_changes_collection: ReadCollection,
    outbox_collection: AsyncCollection,
    now: datetime,
    session: AsyncClientSession,
) -> None:
    """Move the owner role to the named row, the date set to now so the new owner's older sessions hold nothing of it.

    Demoted first: `uniq_grant_owner` is checked at each write, so the other order meets it inside the transaction.
    """

    await patch_many_in_db(
        collection=grants_collection,
        db_filter={"admin_tier": OWNER},
        update={"$set": {"admin_tier": ADMINISTRATION}},
        session=session,
    )
    await patch_one_in_db(
        collection=grants_collection,
        db_filter={"_id": grant["_id"]},
        update={"$set": {"admin_tier": OWNER, "effective_from": now}, "$unset": {"owner_from": ""}},
        expected_version=None,
        session=session,
        return_document=ReturnDocument.BEFORE,
    )
    await record_act(
        collection=grants_collection,
        action="grant.handover_completed",
        by=ACT_BY_SYSTEM,
        record_id=grant["_id"],
        label=str(grant["address"]),
        session=session,
    )
    await owe_in_session(
        [compose_notice(grant_id=grant["_id"], change="handover", stage="completed", address=str(grant["address"]))],
        outbox_collection=outbox_collection,
        grants_collection=grants_collection,
        address_changes_collection=address_changes_collection,
        now=now,
        session=session,
    )
