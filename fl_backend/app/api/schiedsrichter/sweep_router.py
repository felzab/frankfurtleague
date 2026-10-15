from datetime import datetime
from typing import Any, Final

from fastapi import APIRouter, Depends
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.api.schiedsrichter.crud import discard_adresswechsel_in_session
from app.api.schiedsrichter.schemas import FLSchiedsrichterAdresswechselSweepResponse
from app.api.schiedsrichter.services import build_lapsed_adresswechsel_filter
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db
from app.core.dependencies import AktionenCollection, DBClient, SchiedsrichterCollection, get_german_date_str, get_germany_now
from app.core.exception_handlers import DATABASE_FAILED, UNKNOWN_OUTCOME
from app.core.exceptions import DocumentNotFoundException
from app.core.logging import fl_logger
from app.core.recording import log_stamp
from app.core.security import bind_system_actor, verify_access_system
from app.core.transactions import transaction_session

# System tier and the system actor: the clock removes a lapsed address, and no administrator pressed anything.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/schiedsrichter/sweep",
    dependencies=[Depends(verify_access_system), Depends(bind_system_actor)],
)

# Six commands a referee, each costing the round trip plus at most 1.84 ms (whole calls timed locally,
# 2026-10-16): this share keeps a call inside `app/core/middlewares.py :: REQUEST_DEADLINE_S` up to a
# 37 ms round trip (`docs/backend/spec.md :: I322`).
ADRESSWECHSEL_PER_PASS: Final = 42


async def _discard_lapsed(
    schiedsrichter_id: Any,
    *,
    schiedsrichter_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    db: AsyncMongoClient,
    today: str,
    stamp: str,
) -> None:
    """One referee in a transaction of their own, judged again there: `DocumentNotFoundException` where the change has not lapsed."""

    async def discard_the_lapsed_change(session: AsyncClientSession) -> None:
        await discard_adresswechsel_in_session(
            schiedsrichter_collection=schiedsrichter_collection,
            aktionen_collection=aktionen_collection,
            db_filter=build_lapsed_adresswechsel_filter(today=today, schiedsrichter_id=schiedsrichter_id),
            stamp=stamp,
            # Nothing reads the document afterwards, and `AFTER` costs a round trip each.
            return_document=ReturnDocument.BEFORE,
            session=session,
        )

    async with transaction_session(db) as session:
        await session.with_transaction(discard_the_lapsed_change)


@router.post(
    "/adresswechsel",
    response_model=FLSchiedsrichterAdresswechselSweepResponse,
    summary="Remove the pending referee addresses whose link lapsed",
)
async def sweep_adresswechsel(
    schiedsrichter_collection: SchiedsrichterCollection,
    aktionen_collection: AktionenCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLSchiedsrichterAdresswechselSweepResponse:
    """
    Remove a bounded share of the confirmed referees' pending addresses whose link lapsed before today in Europe/Berlin.

    The day after a link's deadline, the pending address goes as an administrator's discard takes it: the block and its link,
    and the address out of every log image of that referee, the rest of each image standing. The referee's row and the address
    on file stand, a retired referee's included. The deadline's own day still takes the link, so a change lapsing today is left.
    Nothing is mailed.

    Each referee is removed in a transaction of their own that judges the lapse again, so a change confirmed, discarded or sent
    a fresh link since this call read it is left standing. One call removes at most a fixed share in `_id` order, and
    `verbleibend` counts the lapsed changes still standing afterwards. **A change whose removal the database refuses is logged by
    the referee's id and passed over**, the call going on to the next; it stays lapsed, so a caller looping until `verbleibend`
    is zero never ends where one fails: stop at a call that removed nothing.
    """

    lapsed = await aggregate_many_from_db(
        collection=schiedsrichter_collection,
        pipeline=[{"$match": build_lapsed_adresswechsel_filter(today=today)}, {"$sort": {"_id": 1}}, {"$project": {"_id": 1}}],
    )
    stamp = log_stamp(germany_now)

    entfernt, uebersprungen = 0, 0
    for row in lapsed[:ADRESSWECHSEL_PER_PASS]:
        # Both caught outside the referee's session (`docs/backend/spec.md :: I539`).
        try:
            await _discard_lapsed(
                row["_id"],
                schiedsrichter_collection=schiedsrichter_collection,
                aktionen_collection=aktionen_collection,
                db=db,
                today=today,
                stamp=stamp,
            )
        except DocumentNotFoundException:
            # The filter is the judgement: confirmed, discarded or sent a fresh link since the read, and not due.
            uebersprungen += 1
            continue
        except PyMongoError as failure:
            ungewiss = failure.has_error_label("UnknownTransactionCommitResult")
            # The id and the class alone, never the address this pass exists to remove.
            fl_logger.error(
                f"The lapsed address change of referee {row['_id']} was "
                f"{'removed or not, the commit unanswered' if ungewiss else 'not removed'}: {type(failure).__name__}",
                extra={"error_code": UNKNOWN_OUTCOME if ungewiss else DATABASE_FAILED},
            )
            continue

        entfernt += 1

    return FLSchiedsrichterAdresswechselSweepResponse(entfernt=entfernt, verbleibend=len(lapsed) - entfernt - uebersprungen)
