from datetime import datetime
from typing import Final

from fastapi import APIRouter, Depends
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.schiedsrichter.crud import ensure_ghost_schiedsrichter, erase_referee_in_session
from app.api.schiedsrichter.schemas import FLSchiedsrichterSweepResponse
from app.api.schiedsrichter.services import build_erasure_due_filter
from app.core.config import API_VERSION
from app.core.crud import pull_many_from_db
from app.core.dependencies import ActionLogCollection, DBClient, SchiedsrichterCollection, SpieleCollection, get_germany_now
from app.core.recording import log_stamp
from app.core.security import bind_system_actor, verify_access_system
from app.core.transactions import Batch, drain

# System tier and the system actor: the clock erases, and no administrator pressed anything.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/schiedsrichter/sweep",
    dependencies=[Depends(verify_access_system), Depends(bind_system_actor)],
)

# One transaction's referees. Each erasure is six commands where a pupil's is twenty-two, and ten pupils fit
# `app/core/middlewares.py :: REQUEST_DEADLINE_S` (`app/api/identity/system_router.py :: ERASURES_PER_PASS`).
SCHIEDSRICHTER_ERASED_PER_PAGE: Final = 10


@router.post("", response_model=FLSchiedsrichterSweepResponse, summary="Erase the referee entries whose link lapsed unanswered or declined")
async def sweep_schiedsrichter(
    schiedsrichter_collection: SchiedsrichterCollection,
    spiele_collection: SpieleCollection,
    action_log_collection: ActionLogCollection,
    db: DBClient,
    germany_now: datetime = Depends(get_germany_now),
) -> FLSchiedsrichterSweepResponse:
    """
    Erase every referee entry nobody confirmed, or whose person objected, once the midnight after its link's last day has passed.

    Erased as an administrator's erasure erases: the entry goes, every fixture naming it names the ghost, and every log
    image of it is redacted, so the person's name and address leave the log with the entry, as the privacy notice says
    of an unconfirmed or declined one. A confirmed entry and the ghost hold no deletion date and are never due.

    A page of entries is erased in one transaction that reads them again, so one confirmed since is left standing; an
    entry whose erasure fails is logged by its id, passed over and counted in `failed`, and stays due for the next
    pass. No body: the clock takes no season.
    """

    stamp = log_stamp(germany_now)

    async def erase_the_lapsed(session: AsyncClientSession, batch: Batch) -> tuple[int, int, int]:
        """One page: erase each entry due, the ghost written first. Read in-session, so a retry re-judges."""

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
            return len(rows), 0, 0

        await ensure_ghost_schiedsrichter(schiedsrichter_collection=schiedsrichter_collection, session=session)
        for row in taken:
            await erase_referee_in_session(
                schiedsrichter_collection=schiedsrichter_collection,
                spiele_collection=spiele_collection,
                action_log_collection=action_log_collection,
                schiedsrichter_id=row["_id"],
                stamp=stamp,
                session=session,
            )

        return len(rows), len(taken), 0

    erased, _, passed = await drain(
        db=db,
        page_of=erase_the_lapsed,
        page=SCHIEDSRICHTER_ERASED_PER_PAGE,
        what="Schiedsrichter",
        clock="unconfirmed",
    )

    return FLSchiedsrichterSweepResponse(erased=erased, failed=len(passed))
