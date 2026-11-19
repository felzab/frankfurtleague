from collections.abc import Mapping
from typing import Any

from fastapi import APIRouter
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.schiedsrichter.crud import erase_referee_in_session
from app.api.schiedsrichter.schemas import FLSchiedsrichterSweepResponse
from app.api.schiedsrichter.services import build_erasure_due_filter
from app.core.crud import pull_many_from_db
from app.core.dependencies import DBClient, GermanyNow, SchiedsrichterCollection, SpielbestaetigungenCollection, SpieleCollection
from app.core.middlewares import PASS
from app.core.recording import ACT_BY_SYSTEM, record_act
from app.core.security import SYSTEM_TIER
from app.core.transactions import save_each
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT

# System tier: the clock erases, and no administrator pressed anything.
router = APIRouter(
    prefix="/schiedsrichter/sweep",
    dependencies=SYSTEM_TIER,
)


@router.post("", summary="Erase the referee entries whose link lapsed unanswered", openapi_extra=PASS)
async def sweep_schiedsrichter(
    schiedsrichter_collection: SchiedsrichterCollection,
    spiele_collection: SpieleCollection,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    db: DBClient,
    germany_now: GermanyNow,
) -> FLSchiedsrichterSweepResponse:
    """Erase every referee entry nobody confirmed once the midnight after its link's last day has passed.

    Each goes as a person's own erasure takes a referee entry, one at a time, and one whose erasure fails is counted in
    `failed` and stays due for the next pass, as do those the call's deadline leaves.
    """

    due = build_erasure_due_filter(now=germany_now)

    async def erase_one(session: AsyncClientSession, row: Mapping[str, Any]) -> bool:
        # Judged again in the entry's own transaction: a confirmation since the read keeps it.
        if await schiedsrichter_collection.find_one({"_id": row["_id"], **due}, {"_id": 1}, session=session) is None:
            return False

        await erase_referee_in_session(
            schiedsrichter_collection=schiedsrichter_collection,
            spiele_collection=spiele_collection,
            spielbestaetigungen_collection=spielbestaetigungen_collection,
            schiedsrichter_id=row["_id"],
            now=germany_now,
            session=session,
        )
        await record_act(collection=schiedsrichter_collection, action="retention.schiedsrichter", by=ACT_BY_SYSTEM, count=1, session=session)

        return True

    # One read's worth: the deadline ends the call long before its last entry, and the rest are the next pass's.
    rows = await pull_many_from_db(collection=schiedsrichter_collection, db_filter=due, projection=["_id"], limit=LIST_LIMIT_DEFAULT)
    saved = await save_each(db=db, rows=rows, save=erase_one, what="Schiedsrichter", clock="unconfirmed")

    return FLSchiedsrichterSweepResponse(erased=sum(saved.answers), failed=saved.failed)
