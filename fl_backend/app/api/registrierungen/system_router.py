from collections.abc import Awaitable, Callable, Mapping
from typing import Any

from fastapi import APIRouter
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.registrierungen.schemas import FLRegistrierungSweepResponse
from app.api.registrierungen.services import build_decline_filter, build_unconfirmed_filter, build_undecided_filter
from app.core.crud import delete_many_from_db, pull_many_from_db, pull_one_from_db
from app.core.dependencies import (
    DBClient,
    GermanDay,
    RegistrierungenCollection,
    SaisonsCollection,
)
from app.core.middlewares import PASS
from app.core.recording import ACT_BY_SYSTEM, record_act
from app.core.security import SYSTEM_TIER
from app.core.transactions import save_each
from app.shared.saison import season_has_ended
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT

# System tier: this pass holds no session, so `bind_actor` would refuse it.
router = APIRouter(prefix="/registrierungen", dependencies=SYSTEM_TIER)


@router.post(
    "/saisons/{saison_id}/sweep",
    summary="Run one season's registration retention clocks",
    openapi_extra=PASS,
)
async def sweep_registrierungen(
    saison_id: str,
    registrierungen_collection: RegistrierungenCollection,
    saisons_collection: SaisonsCollection,
    db: DBClient,
    today: GermanDay,
) -> FLRegistrierungSweepResponse:
    """Erase one season's due registrations, as of today in Europe/Berlin.

    A declined one goes once its wait after the decision has run out, an unconfirmed one past its deadline, and every one
    still undecided once the season is `past`. A clock whose erasure fails is counted once in `failed` and met again next
    pass; what each clock erased is recorded in the action log.
    """

    # The read that answers the 404 carries the status: this season's own end is a clock, and a
    # second query for a document already in hand would be a second answer to when it ended.
    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status"])
    saison_status = saison_raw.get("status")

    async def erase(ids: list[Any], session: AsyncClientSession) -> int:
        """Registrations gone with their one row, in their own transaction, so no deletion stands without its row."""

        result = await delete_many_from_db(
            collection=registrierungen_collection, db_filter={"saison_id": saison_id, "_id": {"$in": ids}}, session=session
        )
        if result.deleted_count:
            await record_act(
                collection=registrierungen_collection,
                action="retention.registrierungen",
                by=ACT_BY_SYSTEM,
                saison_id=saison_id,
                count=result.deleted_count,
                session=session,
            )

        return result.deleted_count

    # Each clock is one write rather than one a row: no validator guards what it deletes and no unique index the rows it
    # takes, so no row can fail alone, and a delete that fails leaves every row due and is logged under the season.
    def clock_of(db_filter: Mapping[str, Any]) -> Callable[[AsyncClientSession, Mapping[str, Any]], Awaitable[int]]:
        """A clock's one transaction: one read's worth of the rows its filter selects, erased in one write.

        The filter is the clock's whole judgement. The deadline ends the call long before a read's last row could, and
        the rest are the next pass's.
        """

        async def erase_the_due(session: AsyncClientSession, _: Mapping[str, Any]) -> int:
            rows = await pull_many_from_db(
                collection=registrierungen_collection, db_filter=db_filter, projection=["_id"], limit=LIST_LIMIT_DEFAULT, session=session
            )

            return await erase([row["_id"] for row in rows], session) if rows else 0

        return erase_the_due

    steps = [("decline", clock_of(build_decline_filter(saison_id=saison_id, today=today)))]
    # The season's end takes every row the deadline clock reads, whatever the pupil answered: no admission is taken for a
    # season that is over.
    if season_has_ended(saison_status=saison_status):
        steps.append(("season's end", clock_of(build_undecided_filter(saison_id=saison_id))))
    else:
        steps.append(("deadline", clock_of(build_unconfirmed_filter(saison_id=saison_id, today=today))))

    failed = 0
    for clock, erase_the_due in steps:
        saved = await save_each(db=db, rows=[{"_id": saison_id}], save=erase_the_due, what="Season", clock=clock)
        failed += saved.failed
        # The deadline cut it, and the next clock would meet the same deadline.
        if saved.cut:
            break

    return FLRegistrierungSweepResponse(failed=failed)
