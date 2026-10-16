from datetime import datetime
from typing import Annotated, Any, Final

from fastapi import APIRouter, Depends, Query
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError

from app.api.identitaet.crud import UNKNOWN_COMMIT_RESULT
from app.api.schiedsrichter.crud import discard_adresswechsel_in_session
from app.api.schiedsrichter.schemas import FLAdresswechselSweepParams, FLSchiedsrichterAdresswechselSweepResponse
from app.api.schiedsrichter.services import build_lapsed_adresswechsel_filter
from app.api.spieler.crud import discard_spieler_adresswechsel_in_session
from app.api.spieler.services import build_lapsed_spieler_adresswechsel_filter
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db
from app.core.dependencies import (
    AktionenCollection,
    DBClient,
    SchiedsrichterCollection,
    SpielerCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.exception_handlers import DATABASE_FAILED, UNHANDLED_CRASH, UNKNOWN_OUTCOME
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

# Six commands a row, each costing the round trip plus at most 1.84 ms (whole calls timed
# locally, 2026-10-16): this share keeps a call inside `app/core/middlewares.py :: REQUEST_DEADLINE_S` up to
# a 37 ms round trip (`docs/backend/spec.md :: I322`).
ADRESSWECHSEL_PER_PASS: Final = 42

# Which collection a lapsed row is read from, carried beside its id through the one page both halves share.
SCHIEDSRICHTER, SPIELER = "schiedsrichter", "spieler"


def _lapsed_pipeline(*, today: str, nach: Any, groesse: int) -> list[dict[str, Any]]:
    """Both halves' lapsed rows after `nach` in one `_id` order, at most `groesse`, beside how many lapsed in all, as ONE document.

    One keyset over two collections: an `ObjectId` the driver generates is unique across them.
    """

    seite: list[dict[str, Any]] = [{"$sort": {"_id": 1}}, {"$limit": groesse}]

    return [
        {"$match": build_lapsed_adresswechsel_filter(today=today)},
        {"$project": {"_id": 1, "art": {"$literal": SCHIEDSRICHTER}}},
        {
            "$unionWith": {
                "coll": Collection.SPIELER,
                "pipeline": [
                    {"$match": build_lapsed_spieler_adresswechsel_filter(today=today)},
                    {"$project": {"_id": 1, "art": {"$literal": SPIELER}}},
                ],
            }
        },
        {"$facet": {"seite": seite if nach is None else [{"$match": {"_id": {"$gt": nach}}}, *seite], "anzahl": [{"$count": "anzahl"}]}},
    ]


async def _discard_the_referees_lapsed_change(
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


async def _discard_the_pupils_lapsed_change(
    spieler_id: Any,
    *,
    spieler_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    db: AsyncMongoClient,
    today: str,
    stamp: str,
) -> None:
    """One pupil in a transaction of their own, judged again there: `DocumentNotFoundException` where the change has not lapsed."""

    async def discard_the_lapsed_pupil_change(session: AsyncClientSession) -> None:
        await discard_spieler_adresswechsel_in_session(
            spieler_collection=spieler_collection,
            aktionen_collection=aktionen_collection,
            db_filter=build_lapsed_spieler_adresswechsel_filter(today=today, spieler_id=spieler_id),
            stamp=stamp,
            # As the referee's: nothing reads the document afterwards.
            return_document=ReturnDocument.BEFORE,
            session=session,
        )

    async with transaction_session(db) as session:
        await session.with_transaction(discard_the_lapsed_pupil_change)


@router.post(
    "/adresswechsel",
    response_model=FLSchiedsrichterAdresswechselSweepResponse,
    summary="Remove the pending referee and pupil addresses whose link lapsed",
)
async def sweep_adresswechsel(
    params: Annotated[FLAdresswechselSweepParams, Query()],
    schiedsrichter_collection: SchiedsrichterCollection,
    spieler_collection: SpielerCollection,
    aktionen_collection: AktionenCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLSchiedsrichterAdresswechselSweepResponse:
    """
    Remove a bounded share of the pending addresses whose link lapsed before today in Europe/Berlin, a confirmed referee's and a pupil's.

    The day after a link's deadline, the pending address goes as an administrator's discard takes it: the block and its link,
    and the address out of every log image of that referee or pupil, the rest of each image standing. The row and the address
    on file stand, a retired referee's or pupil's included. The deadline's own day still takes the link, so a change lapsing
    today is left. Nothing is mailed.

    Each change is removed in a transaction of its own that judges the lapse again, so a change confirmed, discarded or sent a
    fresh link since this call read it is left standing. **A pass is a run of calls, each handing the next the `nach` the last
    answered**, the first naming none; it ends at the call answering `nach` null. A call reaches at most a fixed share of the
    lapsed changes after `nach`, the referees' and the pupils' in one `_id` order, and the pass holds no state on the server.
    A change whose removal fails, the database refusing it or anything else, is logged by its row's id and passed, so it holds
    back nobody behind it in the pass; it stays lapsed, and the next pass tries it again. Where the request's deadline cuts the
    call, it stops at that change, warns once, and answers what it did. `verbleibend` counts the lapsed changes standing after
    the call, so it is no stopping condition.
    """

    [gelesen] = await aggregate_many_from_db(
        collection=schiedsrichter_collection,
        # One past the share, so a call ending exactly at the share's last row can tell whether any follow.
        pipeline=_lapsed_pipeline(today=today, nach=params.nach, groesse=ADRESSWECHSEL_PER_PASS + 1),
    )
    seite, anzahl = gelesen["seite"], sum(row["anzahl"] for row in gelesen["anzahl"])
    stamp = log_stamp(germany_now)

    entfernt, uebersprungen = 0, 0
    erreicht: Any = None
    abgebrochen = False
    for row in seite[:ADRESSWECHSEL_PER_PASS]:
        erreicht = row["_id"]
        wessen = "referee" if row["art"] == SCHIEDSRICHTER else "pupil"
        # Each caught outside the row's session (`docs/backend/spec.md :: I539`).
        try:
            if row["art"] == SCHIEDSRICHTER:
                await _discard_the_referees_lapsed_change(
                    row["_id"],
                    schiedsrichter_collection=schiedsrichter_collection,
                    aktionen_collection=aktionen_collection,
                    db=db,
                    today=today,
                    stamp=stamp,
                )
            else:
                await _discard_the_pupils_lapsed_change(
                    row["_id"], spieler_collection=spieler_collection, aktionen_collection=aktionen_collection, db=db, today=today, stamp=stamp
                )
        except DocumentNotFoundException:
            # The filter is the judgement: confirmed, discarded or sent a fresh link since the read, and not due.
            uebersprungen += 1
            continue
        except PyMongoError as failure:
            # The only branch an unanswered commit reaches: `with_transaction` retries one until the deadline and raises
            # it as a timeout keeping the label.
            if failure.timeout:
                ungewiss = failure.has_error_label(UNKNOWN_COMMIT_RESULT)
                # Below the handler's ERROR: no record is at fault, and every later change would fail the same way.
                fl_logger.warning(
                    f"Database deadline passed at the lapsed address change of {wessen} {row['_id']}"
                    f"{', its removal unanswered' if ungewiss else ''}: the call stops, and the rest stay due",
                    extra={"error_code": UNKNOWN_OUTCOME if ungewiss else DATABASE_FAILED},
                )
                abgebrochen = True
                break

            # The id and the class alone, never the address this pass exists to remove.
            fl_logger.error(
                f"The lapsed address change of {wessen} {row['_id']} was not removed: {type(failure).__name__}",
                extra={"error_code": DATABASE_FAILED},
            )
            continue
        # Any class, or the next pass stops at this change again and holds back every one behind it
        # (`docs/backend/spec.md :: I717`); not `BaseException`, so a cancellation still ends the call. The id and the
        # class alone, as above.
        except Exception as failure:
            fl_logger.error(
                f"The lapsed address change of {wessen} {row['_id']} was not removed, the failure not the database's: {type(failure).__name__}",
                extra={"error_code": UNHANDLED_CRASH},
            )
            continue

        entfernt += 1

    return FLSchiedsrichterAdresswechselSweepResponse(
        entfernt=entfernt,
        verbleibend=anzahl - entfernt - uebersprungen,
        nach=erreicht if abgebrochen or len(seite) > ADRESSWECHSEL_PER_PASS else None,
    )
