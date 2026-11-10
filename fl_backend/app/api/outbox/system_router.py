import secrets
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Annotated, Any

from bson import ObjectId
from fastapi import APIRouter, Body, Depends, status
from pydantic import TypeAdapter, ValidationError
from pymongo import ASCENDING
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.ban_list.crud import read_barred_addresses
from app.api.bewerbungen.services import compose_chase_update, reopened_chases
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
    SIGN_IN_KINDS,
    UNBARRED,
    OwedMail,
    final_update,
    retry_update,
    row_of,
)
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import ANCHOR_FIELD, patch_many_in_db, patch_past_the_version_in_db, post_one_to_db, pull_many_from_db
from app.core.dependencies import DB, BanListReadCollection, BewerbungenCollection, DBClient, OutboxCollection, get_germany_now
from app.core.logging import fl_logger
from app.core.security import verify_access_system
from app.core.transactions import transaction_session
from app.shared.schemas.literals import KONTAKT_ROLLEN
from app.shared.tokens import mint_token

# System tier and the system actor: the drain, the sign-in library and the provider's callback hold no session.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/outbox",
    dependencies=[Depends(verify_access_system)],
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


def _club_seat_filter(row: Mapping[str, Any]) -> dict[str, Any]:
    """The club's season row a mail to its contact seats names, while a confirmed seat there still holds the mail's address."""

    club = row["club"]

    return {
        "saison_id": club["saison_id"],
        "team_id": club["team_id"],
        "$or": [{f"kontakte.{seat}.email": row["to"], f"kontakte.{seat}.einwilligung.confirmed_at": {"$ne": None}} for seat in KONTAKT_ROLLEN],
    }


def _link_update(link: Mapping[str, Any], token_hash: str) -> dict[str, Any]:
    if link["replaced"]:
        return {"$set": {path: [token_hash] for path in link["paths"]}}

    return {"$addToSet": {path: token_hash for path in link["paths"]}}


@router.post("/handout", response_model=FLOutboxHandoutResponse, summary="Claim the mails owed now and hand them out")
async def post_handout(
    outbox_collection: OutboxCollection,
    ban_list_collection: BanListReadCollection,
    db: DB,
    db_client: DBClient,
    now: datetime = Depends(get_germany_now),
) -> FLOutboxHandoutResponse:
    """
    Claim, a page at a time, the owed mails no claim holds, for five minutes, and hand each out.

    The sign-in library's mails come first, each tried once, then the rest, each oldest first. A mail past its deadline
    is given up rather than handed out, and counted in `abandoned`, as is one whose facts no kind reads, which would
    hold every claim until its deadline. A mail to an address a ban holds is stopped as
    `barred`, the ban's own notice alone excepted. A mail to a club's contact seats is stopped as `dropped` where no
    confirmed seat of that club's season row holds its address any more. A mail carrying a link has it minted here, its hash written to
    the record the mail is about and the raw token answered once, in `token`; a record gone since, or one no longer
    holding the mail's address where its link names it, stops the mail as `dropped`. A second call inside the lease is
    answered none of these rows. The caller sends each under the idempotency key its `attempt` names and reports every
    outcome, with `lease`, to `POST /outbox/result`;
    where the lease lapses first, the next call hands the row out again with a fresh link and number, every earlier link
    staying valid unless the mail's link supersedes them. Server to server alone: the answer names addresses, live links
    and secrets.
    """

    async def claim(session: AsyncClientSession) -> tuple[list[FLOutboxHandout], str | None, int, list[Mapping[str, Any]]]:
        overdue = await patch_many_in_db(
            collection=outbox_collection,
            db_filter={**_free(now), "deadline": {"$lte": now}},
            update=final_update("abandoned", now=now),
            session=session,
        )
        # The sign-in library's mails first, then the rest, each oldest first: a sign-in mail has one attempt, and a queue
        # of league mail ahead of it would spend the drain's deadline before its claim.
        sign_in_kinds = list(SIGN_IN_KINDS)
        due: list[Mapping[str, Any]] = []
        for kind_filter in ({"$in": sign_in_kinds}, {"$nin": sign_in_kinds}):
            if len(due) == PAGE:
                break
            due += await pull_many_from_db(
                collection=outbox_collection,
                db_filter={**_free(now), "deadline": {"$gt": now}, "kind": kind_filter},
                sort_by=[("recorded_at", ASCENDING), ("_id", ASCENDING)],
                limit=PAGE - len(due),
                session=session,
            )
        if not due:
            return [], None, overdue.modified_count, []

        unreadable = [row for row in due if not _is_readable(row)]
        if unreadable:
            await patch_many_in_db(
                collection=outbox_collection,
                db_filter={"_id": {"$in": [row["_id"] for row in unreadable]}},
                update=final_update("abandoned", now=now),
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
            if row.get("club") is not None:
                # An anchor on the seat's row, judged by its filter: a seat edit landing beside this claim conflicts with
                # it, and the retry reads the seat as it then stands.
                held = await patch_past_the_version_in_db(
                    collection=db[Collection.SAISON_TEAMS],
                    db_filter=_club_seat_filter(row),
                    update={"$inc": {ANCHOR_FIELD: 1}},
                    session=session,
                )
                if held == 0:
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
                update=final_update("barred", now=now),
                session=session,
            )
        if dropped_ids:
            await patch_many_in_db(
                collection=outbox_collection,
                db_filter={"_id": {"$in": dropped_ids}},
                update=final_update("dropped", now=now),
                session=session,
            )

        handed = [row for row in due if row["_id"] not in barred_ids and row["_id"] not in dropped_ids]
        if not handed:
            return [], None, abandoned, unreadable

        lease = secrets.token_urlsafe(24)
        # Every claimed row written, so two overlapping claims conflict on the rows both read and the retry finds them held;
        # the count rises in this write, so a retried claim counts once.
        await patch_many_in_db(
            collection=outbox_collection,
            db_filter={"_id": {"$in": [row["_id"] for row in handed]}},
            update={"$set": {"lease": lease, "leased_until": now.astimezone(UTC) + LEASE_DURATION}, "$inc": {"attempts": 1}},
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

    async with transaction_session(db_client) as session:
        mails, lease, abandoned, unreadable = await session.with_transaction(claim)

    # Past the commit, so a retried claim logs each once; the kind and the row alone, the facts holding addresses.
    for row in unreadable:
        fl_logger.warning("outbox.row_unreadable", extra={"kind": row["kind"], "row_id": str(row["_id"])})

    return FLOutboxHandoutResponse(
        lease=lease,
        mails=mails,
        abandoned=abandoned,
    )


@router.post("/result", response_model=FLOutboxResultResponse, summary="Settle one mail a claim handed out")
async def post_result(
    result_data: Annotated[FLOutboxResultPayload, Body()],
    outbox_collection: OutboxCollection,
    now: datetime = Depends(get_germany_now),
) -> FLOutboxResultResponse:
    """
    Settle the named mail, where the named claim still holds it, by the outcome of its send, and nothing else.

    `sent` records the provider's message id; `held` a deployment that sends no mail; `abandon` a
    refusal every send would meet, any 4xx but a 429. A failed send's `delivery_reason`, the provider's own name for the refusal,
    is recorded on the row, the send's one record of why. `retry`, for a 429, a 5xx or a send that never reached the
    provider, hands the mail back for a drain a minute from now, or gives it up where it has grown past its deadline; a
    mail of the sign-in library is given up at once, its library's repair being a fresh one. A mail the claim does not
    hold -- unknown, settled already, or claimed since by another drain after this claim lapsed -- is left alone and
    counted in `ignored`; the answer counts one outcome. Each write names the claim, so its check and the outcome are
    one atomic operation on one row, needing no transaction; a settled row keeps no facts and no secret.
    """

    held = {"_id": result_data.id, "lease": result_data.lease, "state": "open"}

    async def settled(update: Mapping[str, Any], narrowed: Mapping[str, Any]) -> bool:
        # Every report writes its refusal or none, so a mail sent after a failed send keeps no reason it no longer has.
        with_delivery_reason = {**update, "$set": {**update["$set"], "delivery_reason": result_data.delivery_reason}}
        result = await patch_many_in_db(collection=outbox_collection, db_filter={**held, **narrowed}, update=with_delivery_reason)
        return result.modified_count > 0

    result = result_data.result
    state = FINAL_STATE[result]
    # A send to be tried again ends here only where it may not be: a sign-in mail, or one past its deadline.
    ends = {"$or": [{"kind": {"$in": list(SIGN_IN_KINDS)}}, {"deadline": {"$lte": now}}]} if result == "retry" else {}
    counted: str
    if await settled(final_update(state, now=now, message_id=result_data.message_id), ends):
        counted = state
    elif result == "retry" and await settled(retry_update(now=now), {}):
        counted = "repeated"
    else:
        counted = "ignored"

    return FLOutboxResultResponse.model_validate({field: int(field == counted) for field in FLOutboxResultResponse.model_fields})


@router.post("/sign_in", status_code=status.HTTP_204_NO_CONTENT, summary="Owe one mail of the sign-in library")
async def post_sign_in(
    sign_in_data: Annotated[FLOutboxSignInPayload, Body()],
    outbox_collection: OutboxCollection,
    now: datetime = Depends(get_germany_now),
) -> None:
    """
    Owe one mail the sign-in library sends -- the code, a passkey notice, the deletion link -- to the address named.

    Every call owes a mail of its own, under a key minted here: the library asks for each send once, and nothing repeats
    the call. `secret` is stored as it arrives, encrypted under a key this service never holds, and dropped once the mail
    is settled; `valid_until` is both the last moment a hand-out may send it and the moment the row is deleted, settled
    or not.
    """

    mail = OwedMail(key=f"{sign_in_data.data.kind}/{ObjectId()}", to=sign_in_data.to, data=sign_in_data.data)
    await post_one_to_db(
        collection=outbox_collection,
        document=row_of(mail, now=now, secret=sign_in_data.secret, valid_until=sign_in_data.valid_until),
    )


async def _reopen_chases(
    *, mail_id: Any, outbox_collection: AsyncCollection, bewerbungen_collection: AsyncCollection, session: AsyncClientSession
) -> None:
    """Opens every chase the delivered mail's address proves reachable, on the application the mail is about."""

    mail = await outbox_collection.find_one(
        {"_id": mail_id, "reference.collection": str(Collection.BEWERBUNGEN)}, {"to": 1, "reference": 1}, session=session
    )
    row = (
        None
        if mail is None
        else await bewerbungen_collection.find_one({"_id": mail["reference"]["id"]}, {"kontakte": 1, "confirmations": 1}, session=session)
    )
    if mail is None or row is None:
        return

    if seats := reopened_chases(bewerbung_raw=row, to=mail["to"]):
        # Past the version: the chase's stamp is mail bookkeeping no form saves, so a decision read before it still lands.
        await patch_past_the_version_in_db(
            collection=bewerbungen_collection,
            db_filter={"_id": row["_id"]},
            update=compose_chase_update(seats=seats, closed_at=None),
            session=session,
        )


@router.post("/event", response_model=FLOutboxEventResponse, summary="Record one delivery event on its mail's row")
async def post_event(
    event_data: Annotated[FLOutboxEventPayload, Body()],
    outbox_collection: OutboxCollection,
    bewerbungen_collection: BewerbungenCollection,
    db_client: DBClient,
) -> FLOutboxEventResponse:
    """
    Record what the mail provider reported about one message, on the row of the mail it was.

    The row is the one `id` names, which the send carried as a tag, so an event arriving before the send's report finds
    it all the same. Applied only where the row's delivery state is one the event's may follow -- a delay before
    anything, a complaint after a delivery, nothing after a refusal -- so a redelivery or an event arriving after a later
    one changes nothing. Both answer `applied: false`, as do an id no row has and a row whose address was replaced since
    its send, which keeps its key alone, rather than a refusal the provider
    would retry for hours. A delivery applied to a mail about an application opens the closed chase of every seat holding
    its address, in the same transaction.
    """

    async def record(session: AsyncClientSession) -> bool:
        result = await patch_many_in_db(
            collection=outbox_collection,
            db_filter={
                "_id": event_data.id,
                "delivery.state": {"$in": list(FOLLOWS[event_data.state])},
                # A tombstone takes no event: what its replaced mailbox reports is no longer the person's.
                "to": {"$type": "string"},
            },
            update={"$set": {"delivery": {"state": event_data.state, "reason": event_data.reason, "at": event_data.at}}},
            session=session,
        )
        applied = result.modified_count > 0
        if applied and event_data.state == "delivered":
            await _reopen_chases(
                mail_id=event_data.id, outbox_collection=outbox_collection, bewerbungen_collection=bewerbungen_collection, session=session
            )

        return applied

    async with transaction_session(db_client) as session:
        return FLOutboxEventResponse(applied=await session.with_transaction(record))
