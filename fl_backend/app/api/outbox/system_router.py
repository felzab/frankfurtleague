import secrets
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from fastapi import APIRouter, status
from pydantic import TypeAdapter, ValidationError
from pymongo import ASCENDING
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.ban_list.crud import read_barred_addresses
from app.api.outbox.schemas import (
    FLOutboxData,
    FLOutboxEventPayload,
    FLOutboxEventResponse,
    FLOutboxHandout,
    FLOutboxHandoutResponse,
    FLOutboxResultPayload,
    FLOutboxResultResponse,
    FLOutboxSignInPayload,
)
from app.api.outbox.services import (
    FINAL_STATE,
    FOLLOWS,
    LEASE_DURATION,
    PAGE,
    TRIED_ONCE_KINDS,
    UNBARRED,
    OwedMail,
    final_update,
    retry_update,
    row_of,
)
from app.core.collections import Collection
from app.core.crud import ANCHOR_FIELD, patch_many_in_db, patch_past_the_version_in_db, post_one_to_db, pull_many_from_db
from app.core.dependencies import DB, BanListReadCollection, DBClient, GermanyNow, OutboxCollection
from app.core.logging import fl_logger
from app.core.security import SYSTEM_TIER
from app.core.transactions import transact
from app.shared.schemas.literals import KONTAKT_SEATS
from app.shared.tokens import mint_token

# System tier and the system actor: the drain, the sign-in library and the provider's callback hold no session.
router = APIRouter(
    prefix="/outbox",
    dependencies=SYSTEM_TIER,
)


_OUTBOX_DATA: TypeAdapter[FLOutboxData] = TypeAdapter(FLOutboxData)


def _is_readable(row: Mapping[str, Any]) -> bool:
    """Whether a row's facts are a member of `FLOutboxData`: one a release left in an older shape fails the whole answer otherwise."""

    try:
        _OUTBOX_DATA.validate_python(row["data"])
    except ValidationError:
        return False

    return True


# Open, and no live claim holding it.
def _free(now: datetime) -> dict[str, Any]:
    return {"state": "open", "$or": [{"leased_until": None}, {"leased_until": {"$lte": now}}]}


def _link_record_filter(row: Mapping[str, Any]) -> dict[str, Any]:
    """The record a mail's link is minted on, while it still holds the mail's address at every path the link names.

    A seat emptied, handed on or re-addressed since the mail was owed matches nothing, and neither does a record gone,
    so the mail is dropped rather than minting a live link for an address the record no longer names. Each array's
    parent an object, as a write through a null one is refused, which would abort the whole claim.
    """

    link = row["link"]
    parents = {path.rpartition(".")[0] for path in link["paths"]} - {""}

    return {
        "_id": row["reference"]["id"],
        **{address_path: row["to"] for address_path in link["addresses"]},
        **{parent: {"$type": "object"} for parent in sorted(parents)},
    }


def _team_seat_filter(row: Mapping[str, Any]) -> dict[str, Any]:
    """The club's season row a mail to its contact seats names, while a confirmed seat there still holds the mail's address."""

    team = row["team"]

    return {
        "saison_id": team["saison_id"],
        "team_id": team["team_id"],
        "$or": [{f"kontakte.{seat}.email": row["to"], f"kontakte.{seat}.einwilligung.confirmed_at": {"$ne": None}} for seat in KONTAKT_SEATS],
    }


def _link_update(link: Mapping[str, Any], token_hash: str) -> dict[str, Any]:
    # A superseding link replaces every earlier one; any other joins them, so a link a lapsed claim handed out stays valid.
    if link["replaced"]:
        return {"$set": {path: [token_hash] for path in link["paths"]}}

    return {"$addToSet": {path: token_hash for path in link["paths"]}}


# Server to server alone: the answer names addresses, live links and secrets.
@router.post("/handout", summary="Claim the mails owed now and hand them out")
async def post_handout(
    outbox_collection: OutboxCollection,
    ban_list_collection: BanListReadCollection,
    db: DB,
    db_client: DBClient,
    germany_now: GermanyNow,
) -> FLOutboxHandoutResponse:
    """Claim a page of the mails owed now, the sign-in library's first, and hand each out with the link minted for it.

    The caller sends each under the idempotency key its `attempt` names and reports every outcome with `lease` before the
    lease lapses, after which the next claim hands the mail out again.
    """

    async def claim(session: AsyncClientSession) -> tuple[list[FLOutboxHandout], str | None, int, list[Mapping[str, Any]]]:
        # A mail past its deadline is given up rather than handed out.
        overdue = await patch_many_in_db(
            collection=outbox_collection,
            db_filter={**_free(germany_now), "deadline": {"$lte": germany_now}},
            update=final_update("abandoned", now=germany_now),
            session=session,
        )
        # The mails tried once first, then the rest, each oldest first: a code or a deletion link has one attempt, and a
        # queue of league mail ahead of it would spend the drain's deadline before its claim.
        tried_once = list(TRIED_ONCE_KINDS)
        due: list[Mapping[str, Any]] = []
        for kind_filter in ({"$in": tried_once}, {"$nin": tried_once}):
            if len(due) == PAGE:
                break
            due += await pull_many_from_db(
                collection=outbox_collection,
                db_filter={**_free(germany_now), "deadline": {"$gt": germany_now}, "kind": kind_filter},
                sort_by=[("recorded_at", ASCENDING), ("_id", ASCENDING)],
                limit=PAGE - len(due),
                session=session,
            )
        if not due:
            return [], None, overdue.modified_count, []

        # Given up too: left open, a row no kind reads would hold every claim until its deadline.
        unreadable = [row for row in due if not _is_readable(row)]
        if unreadable:
            await patch_many_in_db(
                collection=outbox_collection,
                db_filter={"_id": {"$in": [row["_id"] for row in unreadable]}},
                update=final_update("abandoned", now=germany_now),
                session=session,
            )
            given_up = {row["_id"] for row in unreadable}
            due = [row for row in due if row["_id"] not in given_up]
        abandoned = overdue.modified_count + len(unreadable)

        # The ban is judged here, at the last moment before the send, rather than when the mail was owed.
        judged = {str(row["to"]) for row in due if row["kind"] not in UNBARRED}
        barred = await read_barred_addresses(judged, ban_list_collection=ban_list_collection, session=session)
        barred_ids = [row["_id"] for row in due if row["kind"] not in UNBARRED and row["to"] in barred]
        dropped_ids: list[Any] = []

        tokens: dict[Any, str] = {}
        for row in due:
            if row["_id"] in barred_ids:
                continue
            if row.get("team") is not None:
                # An anchor on the seat's row, judged by its filter: a seat edit landing beside this claim conflicts with
                # it, and the retry reads the seat as it then stands.
                anchored = await patch_past_the_version_in_db(
                    collection=db[Collection.SAISON_TEAMS],
                    db_filter=_team_seat_filter(row),
                    update={"$inc": {ANCHOR_FIELD: 1}},
                    session=session,
                )
                if anchored == 0:
                    dropped_ids.append(row["_id"])
                    continue
            if row["link"] is None:
                continue
            raw, token_hash = mint_token()
            # Past the version: a hash changes nothing a reader sees, and raising the count would refuse the next
            # save of an editor read before the hand-out.
            minted = await patch_past_the_version_in_db(
                collection=db[Collection(row["reference"]["collection"])],
                db_filter=_link_record_filter(row),
                update=_link_update(row["link"], token_hash),
                session=session,
            )
            if minted == 0:
                dropped_ids.append(row["_id"])
                continue
            tokens[row["_id"]] = raw

        if barred_ids:
            await patch_many_in_db(
                collection=outbox_collection,
                db_filter={"_id": {"$in": barred_ids}},
                update=final_update("barred", now=germany_now),
                session=session,
            )
        if dropped_ids:
            await patch_many_in_db(
                collection=outbox_collection,
                db_filter={"_id": {"$in": dropped_ids}},
                update=final_update("dropped", now=germany_now),
                session=session,
            )

        handed = [row for row in due if row["_id"] not in barred_ids and row["_id"] not in dropped_ids]
        if not handed:
            return [], None, abandoned, unreadable

        lease = secrets.token_urlsafe(24)
        # Every claimed row written, so two overlapping claims conflict on the rows both read and the retry finds them claimed;
        # the count rises in this write, so a retried claim counts once.
        await patch_many_in_db(
            collection=outbox_collection,
            db_filter={"_id": {"$in": [row["_id"] for row in handed]}},
            update={"$set": {"lease": lease, "leased_until": germany_now.astimezone(UTC) + LEASE_DURATION}, "$inc": {"attempts": 1}},
            session=session,
        )

        return (
            [
                FLOutboxHandout(
                    id=row["_id"],
                    to=row["to"],
                    data=row["data"],
                    token=tokens.get(row["_id"]),
                    secret=row["secret"],
                    attempt=row["attempts"] + 1,
                )
                for row in handed
            ],
            lease,
            abandoned,
            unreadable,
        )

    mails, lease, abandoned, unreadable = await transact(db_client, claim)

    # Past the commit, so a retried claim logs each once; the kind and the row alone, the facts holding addresses.
    for row in unreadable:
        fl_logger.warning("outbox.row_unreadable", extra={"kind": row["kind"], "row_id": str(row["_id"])})

    return FLOutboxHandoutResponse(
        lease=lease,
        mails=mails,
        abandoned=abandoned,
    )


@router.post("/result", summary="Settle one mail a claim handed out")
async def post_result(
    result_data: FLOutboxResultPayload,
    outbox_collection: OutboxCollection,
    germany_now: GermanyNow,
) -> FLOutboxResultResponse:
    """Settle the named mail by its send's outcome where the named claim still holds it, counting a mail it does not hold in `ignored`.

    `held` reports a deployment that sends no mail, `abandon` a refusal every send would meet (any 4xx but a 429), and
    `retry` a 429, a 5xx or a send that never reached the provider, which hands the mail back unless it is a sign-in
    code, a deletion link or past its deadline.
    """

    # Each write names the claim, so its check and the outcome are one atomic operation on one row, needing no transaction.
    still_claimed = {"_id": result_data.id, "lease": result_data.lease, "state": "open"}

    async def settled(update: Mapping[str, Any], narrowed: Mapping[str, Any]) -> bool:
        # Every report writes its refusal or none, so a mail sent after a failed send keeps no reason it no longer has.
        with_delivery_reason = {**update, "$set": {**update["$set"], "delivery_reason": result_data.delivery_reason}}
        result = await patch_many_in_db(
            collection=outbox_collection, db_filter={**still_claimed, **narrowed}, update=with_delivery_reason, session=None
        )
        return result.modified_count > 0

    result = result_data.result
    state = FINAL_STATE[result]
    # A send to be tried again ends here only where it may not be: a mail tried once, or one past its deadline.
    ends = {"$or": [{"kind": {"$in": list(TRIED_ONCE_KINDS)}}, {"deadline": {"$lte": germany_now}}]} if result == "retry" else {}
    counted: str
    if await settled(final_update(state, now=germany_now), ends):
        counted = state
    elif result == "retry" and await settled(retry_update(now=germany_now), {}):
        counted = "repeated"
    else:
        counted = "ignored"

    return FLOutboxResultResponse.model_validate({field: int(field == counted) for field in FLOutboxResultResponse.model_fields})


@router.post("/sign_in", status_code=status.HTTP_204_NO_CONTENT, summary="Owe one mail of the sign-in library")
async def post_sign_in(
    sign_in_data: FLOutboxSignInPayload,
    outbox_collection: OutboxCollection,
    germany_now: GermanyNow,
) -> None:
    """Owe one mail the sign-in library sends, such as a code, a passkey notice or the deletion link, to the address named.

    `secret` is stored as it arrives and dropped once the mail is settled; `valid_until` is both the last moment a send
    may happen and when the row is deleted.
    """

    # A key minted per call: the library asks for each send once, and nothing repeats the call.
    mail = OwedMail(key=f"{sign_in_data.data.kind}/{ObjectId()}", to=sign_in_data.to, data=sign_in_data.data)
    await post_one_to_db(
        collection=outbox_collection,
        document=row_of(mail, now=germany_now, secret=sign_in_data.secret, valid_until=sign_in_data.valid_until),
        session=None,
    )


@router.post("/event", summary="Record one delivery event on its mail's row")
async def post_event(
    event_data: FLOutboxEventPayload,
    outbox_collection: OutboxCollection,
) -> FLOutboxEventResponse:
    """Record what the mail provider reported about one message on its mail's row, where the row's state may follow into it.

    A redelivered or out-of-order event changes nothing.
    """

    # One document, so the filter's condition and the write are one atomic operation and need no transaction.
    result = await patch_many_in_db(
        collection=outbox_collection,
        db_filter={
            "_id": event_data.id,
            # Never back from a later state, so a redelivery or an event arriving after a later one changes nothing.
            "delivery.state": {"$in": list(FOLLOWS[event_data.state])},
            # A tombstone takes no event: what its replaced mailbox reports is no longer the person's.
            "to": {"$type": "string"},
        },
        update={"$set": {"delivery": {"state": event_data.state, "reason": event_data.reason, "at": event_data.at}}},
        session=None,
    )

    return FLOutboxEventResponse(applied=result.modified_count > 0)
