from collections import Counter
from collections.abc import Mapping
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, status
from pymongo import ASCENDING
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.address_change.crud import (
    Occupancy,
    end_the_change_in_session,
    judge_the_effect_in_session,
    move_the_address_in_session,
    owe_the_refusal_notice_in_session,
    read_the_holdings,
    tell_the_holders_of_the_end_in_session,
)
from app.api.address_change.schemas import (
    FLAddressChangeAddressPayload,
    FLAddressChangeAddressResponse,
    FLAddressChangeMovesDonePayload,
    FLAddressChangeMovesResponse,
    FLAddressChangeOpenMove,
    FLAddressChangeSweepResponse,
)
from app.api.address_change.services import LIVE_TERMS, build_due_terms, build_lapsed_terms, compose_end_update, is_expired
from app.api.identity.lookup import MoveCollections, MoveHandles
from app.core.crud import aggregate_many_from_db, patch_many_in_db, pull_many_from_db
from app.core.dependencies import (
    AddressChangeCollection,
    AddressChangeReadCollection,
    DBClient,
    GermanyNow,
)
from app.core.middlewares import PASS
from app.core.recording import ACT_BY_SYSTEM, record_act
from app.core.routing import SAFE
from app.core.security import SYSTEM_TIER
from app.core.transactions import save_each
from app.shared.folding import sign_in_identifier
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from app.shared.tokens import hash_token

# System tier: the clock ends a lapsed change and makes a due one take effect, and no administrator pressed anything.
router = APIRouter(
    prefix="/address_change",
    dependencies=SYSTEM_TIER,
)


async def _end_the_lapsed_changes(
    ids: list[Any], *, address_changes_collection: AsyncCollection, now: datetime, session: AsyncClientSession
) -> int:
    """The lapsed changes read ended with their one log row, each judged again here, answering how many ended.

    One write and one row for them all: a lapse writes no person's data, and a row per change would fill a year's list
    with nothing an administrator asks of it.
    """

    result = await patch_many_in_db(
        collection=address_changes_collection,
        db_filter={"_id": {"$in": ids}, **build_lapsed_terms(now)},
        update=compose_end_update(kind="expired", now=now),
        session=session,
    )
    if result.modified_count > 0:
        await record_act(
            collection=address_changes_collection,
            action="retention.address_changes",
            by=ACT_BY_SYSTEM,
            count=result.modified_count,
            session=session,
        )

    return result.modified_count


async def _make_the_due_change_take_effect(
    row: Mapping[str, Any], *, collections: MoveCollections, now: datetime, session: AsyncClientSession
) -> Literal["effective", "discarded"] | None:
    """One due change judged again as its confirmation was, a holder's by confirmed entries alone, its notice owed.

    `None` where stopped, discarded or replaced since the read.
    """

    record = await collections.address_changes_collection.find_one({"_id": row["_id"], **build_due_terms(now)}, session=session)
    if record is None:
        return None

    holdings = await read_the_holdings(
        str(record["address"]), records=collections.records, grants_collection=collections.grants_collection, session=session
    )
    verdict = await judge_the_effect_in_session(
        record=record,
        holdings=holdings,
        records=collections.records,
        spieler_collection=collections.spieler_collection,
        grants_collection=collections.grants_collection,
        occupancy=Occupancy(grants_collection=collections.grants_collection, address_changes_collection=collections.address_changes_collection),
        expired=False,
        session=session,
        at_the_pass=True,
    )
    if verdict.cause is None and not verdict.empty:
        await move_the_address_in_session(
            record=record,
            holdings=holdings,
            collections=collections,
            now=now,
            session=session,
        )
        return "effective"

    # Every judgement the confirmation makes, at the end of the waiting time as at its start.
    await end_the_change_in_session(
        address_changes_collection=collections.address_changes_collection,
        db_filter={"_id": record["_id"]},
        kind="discarded",
        now=now,
        session=session,
    )
    await owe_the_refusal_notice_in_session(record, outbox_collection=collections.outbox_collection, now=now, session=session)
    await tell_the_holders_of_the_end_in_session(
        record,
        grants_collection=collections.grants_collection,
        outbox_collection=collections.outbox_collection,
        now=now,
        session=session,
    )
    await record_act(
        collection=collections.address_changes_collection, action="retention.address_changes", by=ACT_BY_SYSTEM, count=1, session=session
    )
    return "discarded"


@router.post(
    "/sweep",
    summary="End the lapsed address changes, and make the due ones take effect",
    openapi_extra=PASS,
)
async def sweep_address_change(
    collections: MoveHandles,
    db: DBClient,
    germany_now: GermanyNow,
) -> FLAddressChangeSweepResponse:
    """End the changes whose step lapsed, and make each due one take effect, or end it where its judgement now refuses it.

    Each due change is saved on its own, the lapsed ones together; a change whose saving fails is counted in `failed` and
    stays due for the next pass.
    """

    read = await aggregate_many_from_db(
        collection=collections.address_changes_collection,
        pipeline=[
            # No index serves the instants: the collection holds live changes and recent tombstones alone.
            {"$match": {"$or": [build_lapsed_terms(germany_now), build_due_terms(germany_now)]}},
            # What `is_expired` labels a lapse by.
            {"$project": {"_id": 1, "valid_until": 1}},
            {"$sort": {"_id": 1}},
            {"$limit": LIST_LIMIT_DEFAULT},
        ],
    )
    # The lapse and the due terms are disjoint, so the lapse's own judgement parts them.
    lapsed = [row["_id"] for row in read if is_expired(row, now=germany_now)]
    due = [row for row in read if not is_expired(row, now=germany_now)]

    async def end_the_lapsed(session: AsyncClientSession, _: Mapping[str, Any]) -> int:
        return await _end_the_lapsed_changes(
            lapsed, address_changes_collection=collections.address_changes_collection, now=germany_now, session=session
        )

    # One step for them all, named in a failure's line by the lapse rather than by any one change.
    ended = await save_each(db=db, rows=[{"_id": "lapsed"}] if lapsed else [], save=end_the_lapsed, what="Address change", clock="lapse")
    if ended.cut:
        return FLAddressChangeSweepResponse(removed=0, discarded=0, effective=0, failed=0)

    async def take_effect(session: AsyncClientSession, row: Mapping[str, Any]) -> Literal["effective", "discarded"] | None:
        return await _make_the_due_change_take_effect(row, collections=collections, now=germany_now, session=session)

    effects = await save_each(db=db, rows=due, save=take_effect, what="Address change", clock="effect")
    counted = Counter(effects.answers)

    return FLAddressChangeSweepResponse(
        removed=sum(ended.answers),
        discarded=counted["discarded"],
        effective=counted["effective"],
        # Every lapsed change stays due where their one write failed.
        failed=(len(lapsed) if ended.failed else 0) + effects.failed,
    )


# Server to server alone: the answer names addresses. No claim holds a row, as moving an account twice finds none left.
@router.get("/sweep/moves", summary="List the sign-in accounts the effects still owe to carry")
async def get_address_change_moves(address_changes_collection: AddressChangeReadCollection) -> FLAddressChangeMovesResponse:
    """The ended changes still owing to carry a sign-in account to their new address, oldest first and a page at a time.

    The caller reports the ones it moved to `POST /address_change/sweep/moves/done`, and the next call lists the rest again.
    """

    owed = await pull_many_from_db(
        collection=address_changes_collection,
        db_filter={"move": {"$type": "object"}},
        sort_by=[("_id", ASCENDING)],
        limit=LIST_LIMIT_DEFAULT,
        projection=["move"],
    )

    return FLAddressChangeMovesResponse(
        moves=[FLAddressChangeOpenMove(id=row["_id"], old=row["move"]["old"], new=row["move"]["new"]) for row in owed]
    )


@router.post(
    "/sweep/moves/done",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Take the carries done off their changes",
)
async def post_address_change_moves_done(
    done_data: FLAddressChangeMovesDonePayload,
    address_changes_collection: AddressChangeCollection,
) -> None:
    """Take the owed carry off each named change; an id owing none is left alone."""

    await patch_many_in_db(
        collection=address_changes_collection,
        db_filter={"_id": {"$in": sorted(set(done_data.ids))}, "move": {"$type": "object"}},
        update={"$unset": {"move": ""}},
        session=None,
    )


# Server to server alone, as the link's own view never serves the address; a POST that reads, so the token travels in
# the body and the address only in the answer.
@router.post(
    "/address",
    summary="Say which address a live change would move to",
    openapi_extra=SAFE,
)
async def get_address_change_address(
    address_data: FLAddressChangeAddressPayload,
    address_changes_collection: AddressChangeReadCollection,
) -> FLAddressChangeAddressResponse:
    """The new address, folded, of the live change a new-mailbox link token or a change id names.

    A token or id naming no live change is answered null rather than refused, so a lapsed or answered link costs no error.
    """

    db_filter = (
        {"_id": address_data.address_change_id, **LIVE_TERMS}
        if address_data.token is None
        else {"token_hashes": hash_token(address_data.token), **LIVE_TERMS}
    )
    record = await address_changes_collection.find_one(db_filter, projection={"email": 1})

    return FLAddressChangeAddressResponse(email=None if record is None else sign_in_identifier(str(record["email"])))
