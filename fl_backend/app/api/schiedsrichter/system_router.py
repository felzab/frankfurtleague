from datetime import datetime
from typing import Final

from fastapi import APIRouter, Depends
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.schiedsrichter.crud import erase_referee_in_session
from app.api.schiedsrichter.schemas import FLSchiedsrichterSweepResponse
from app.api.schiedsrichter.services import build_erasure_due_filter
from app.core.config import API_VERSION
from app.core.crud import pull_many_from_db
from app.core.dependencies import DBClient, SchiedsrichterCollection, SpielbestaetigungenCollection, SpieleCollection, get_germany_now
from app.core.recording import ACT_BY_SYSTEM, record_act
from app.core.security import verify_access_system
from app.core.transactions import Batch, drain

# System tier: the clock erases, and no administrator pressed anything.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/schiedsrichter/sweep",
    dependencies=[Depends(verify_access_system)],
)

# One transaction's referees. Each erasure costs fewer commands than a pupil's, and ten pupils fit
# `app/core/middlewares.py :: REQUEST_DEADLINE_S` (`app/api/identity/system_router.py :: ERASURES_PER_PASS`).
SCHIEDSRICHTER_ERASED_PER_PAGE: Final = 10


@router.post("", response_model=FLSchiedsrichterSweepResponse, summary="Erase the referee entries whose link lapsed unanswered or declined")
async def sweep_schiedsrichter(
    schiedsrichter_collection: SchiedsrichterCollection,
    spiele_collection: SpieleCollection,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    db: DBClient,
    germany_now: datetime = Depends(get_germany_now),
) -> FLSchiedsrichterSweepResponse:
    """
    Erase every referee entry nobody confirmed, or whose person objected, once the midnight after its link's last day has passed.

    Erased as a person's own erasure erases a referee entry, as the privacy notice says of an unconfirmed or declined
    one: the entry goes with its confirmation rows and its bookings of fixtures still to come, and a played fixture's
    booking stands naming nobody. A confirmed entry holds no deletion date and is never due.

    A page of entries is erased in one transaction that reads them again, so one confirmed since is left standing; an
    entry whose erasure fails is logged by its id, passed over and counted in `failed`, and stays due for the next
    pass. No body: the clock takes no season.
    """

    async def erase_the_lapsed(session: AsyncClientSession, batch: Batch) -> tuple[int, int]:
        """One page: erase each entry due. Read in-session, so a retry re-judges."""

        rows = await batch.saw(
            pull_many_from_db(
                collection=schiedsrichter_collection,
                db_filter=batch.within(build_erasure_due_filter(now=germany_now)),
                projection=["_id"],
                # One over the page, so the drain can tell a full page from the last one.
                limit=SCHIEDSRICHTER_ERASED_PER_PAGE + 1,
                session=session,
            )
        )
        taken = batch.took(rows[:SCHIEDSRICHTER_ERASED_PER_PAGE])
        if not taken:
            return len(rows), 0

        for row in taken:
            await erase_referee_in_session(
                schiedsrichter_collection=schiedsrichter_collection,
                spiele_collection=spiele_collection,
                spielbestaetigungen_collection=spielbestaetigungen_collection,
                schiedsrichter_id=row["_id"],
                now=germany_now,
                session=session,
            )
        await record_act(
            collection=schiedsrichter_collection, action="retention.schiedsrichter", by=ACT_BY_SYSTEM, count=len(taken), session=session
        )

        return len(rows), len(taken)

    erased, passed = await drain(
        db=db,
        page_of=erase_the_lapsed,
        page=SCHIEDSRICHTER_ERASED_PER_PAGE,
        what="Schiedsrichter",
        clock="unconfirmed",
    )

    return FLSchiedsrichterSweepResponse(erased=erased, failed=len(passed))
