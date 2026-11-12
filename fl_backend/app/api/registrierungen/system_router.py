from typing import Any

from fastapi import APIRouter, Depends
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.bewerbungen.services import season_has_ended
from app.api.registrierungen.schemas import FLRegistrierungSweepResponse
from app.api.registrierungen.services import (
    SWEEP_PAGE,
    build_decline_filter,
    build_unconfirmed_filter,
    build_undecided_filter,
    confirmation_erasure_is_due,
    decline_erasure_is_due,
    undecided_erasure_is_due,
)
from app.core.config import API_VERSION
from app.core.crud import delete_many_from_db, pull_many_from_db, pull_one_from_db
from app.core.dependencies import (
    DBClient,
    RegistrierungenCollection,
    SaisonsCollection,
    get_german_date_str,
)
from app.core.recording import ACT_BY_SYSTEM, record_act
from app.core.security import verify_access_system
from app.core.transactions import Batch, drain, refuse_a_stalled_page

# System tier, as the application sweep's own router is: this pass holds no session, so `bind_actor` would refuse it.
router = APIRouter(prefix=f"/api/v{API_VERSION}/registrierungen/sweep", dependencies=[Depends(verify_access_system)])


@router.post(
    "/{saison_id}",
    response_model=FLRegistrierungSweepResponse,
    summary="Run one season's registration retention clocks",
)
async def sweep_registrierungen(
    saison_id: str,
    registrierungen_collection: RegistrierungenCollection,
    saisons_collection: SaisonsCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLRegistrierungSweepResponse:
    """Erase one season's due registrations, as of today in Europe/Berlin.

    A declined one goes once its wait after the decision has run out, an unconfirmed one past its deadline, and every one
    still undecided once the season is `past`; one whose erasure fails is counted in `failed` and met again next pass.
    """

    # The read that answers the 404 carries the status: this season's own end is a clock, and a
    # second query for a document already in hand would be a second answer to when it ended.
    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status"])
    saison_status = saison_raw.get("status")

    async def erase_page(ids: list[Any], session: AsyncClientSession) -> int:
        """One page of one clock gone, its one row in the page's transaction, so no deletion stands without its row."""

        result = await delete_many_from_db(
            collection=registrierungen_collection, db_filter={"saison_id": saison_id, "_id": {"$in": ids}}, session=session
        )
        await record_act(
            collection=registrierungen_collection,
            action="retention.registrierungen",
            by=ACT_BY_SYSTEM,
            label=saison_id,
            count=result.deleted_count,
            session=session,
        )

        return result.deleted_count

    async def erase_the_undecided(session: AsyncClientSession, batch: Batch) -> tuple[int, int]:
        """The season's own end. Read in-session, so a retry re-judges."""

        rows = await batch.saw(
            pull_many_from_db(
                collection=registrierungen_collection,
                db_filter=batch.within(build_undecided_filter(saison_id=saison_id)),
                projection=["status"],
                # One over the page: a full page is a page that may be truncated, and a clock cannot see
                # what it never read.
                limit=SWEEP_PAGE + 1,
                session=session,
            )
        )
        taken = batch.took(
            [
                row
                for row, due in batch.judged(rows, lambda row: undecided_erasure_is_due(registrierung_raw=row, saison_status=saison_status))
                if due
            ]
        )
        if not taken:
            # Rows passed over in place move the page: the drain reads the next one without them.
            refuse_a_stalled_page(read=len(rows), moved=len(batch.refused), page=SWEEP_PAGE, clock="season's end", saison_id=saison_id)
            return len(rows), 0

        ids = [row["_id"] for row in taken]

        return len(rows), await erase_page(ids, session)

    async def erase_the_unconfirmed(session: AsyncClientSession, batch: Batch) -> tuple[int, int]:
        """The deadline clock. Read in-session, so a retry re-judges."""

        rows = await batch.saw(
            pull_many_from_db(
                collection=registrierungen_collection,
                db_filter=batch.within(build_unconfirmed_filter(saison_id=saison_id, today=today)),
                projection=["status", "einwilligung", "confirmation"],
                limit=SWEEP_PAGE + 1,
                session=session,
            )
        )
        taken = batch.took(
            [row for row, due in batch.judged(rows, lambda row: confirmation_erasure_is_due(registrierung_raw=row, today=today)) if due]
        )
        if not taken:
            # Rows passed over in place move the page: the drain reads the next one without them.
            refuse_a_stalled_page(read=len(rows), moved=len(batch.refused), page=SWEEP_PAGE, clock="deadline", saison_id=saison_id)
            return len(rows), 0

        ids = [row["_id"] for row in taken]

        return len(rows), await erase_page(ids, session)

    async def erase_declined(session: AsyncClientSession, batch: Batch) -> tuple[int, int]:
        """The decline clock. Read in-session, so a retry re-judges."""

        rows = await batch.saw(
            pull_many_from_db(
                collection=registrierungen_collection,
                db_filter=batch.within(build_decline_filter(saison_id=saison_id, today=today)),
                projection=["status", "decision"],
                limit=SWEEP_PAGE + 1,
                session=session,
            )
        )
        taken = batch.took([row for row in rows if decline_erasure_is_due(registrierung_raw=row, today=today)])
        if not taken:
            refuse_a_stalled_page(read=len(rows), moved=0, page=SWEEP_PAGE, clock="decline", saison_id=saison_id)
            return len(rows), 0

        ids = [row["_id"] for row in taken]

        return len(rows), await erase_page(ids, session)

    declined, passed = await drain(
        db=db,
        page_of=erase_declined,
        page=SWEEP_PAGE,
        what="Registration",
        clock="decline",
    )
    failed = len(passed)

    undecided, unconfirmed = 0, 0
    # The season's end takes every row the deadline clock reads, whatever the pupil answered: no admission is taken for
    # a season that is over.
    if season_has_ended(saison_status=saison_status):
        undecided, passed = await drain(
            db=db,
            page_of=erase_the_undecided,
            page=SWEEP_PAGE,
            what="Registration",
            clock="season's end",
        )
        failed += len(passed)
    else:
        unconfirmed, passed = await drain(
            db=db,
            page_of=erase_the_unconfirmed,
            page=SWEEP_PAGE,
            what="Registration",
            clock="deadline",
        )
        failed += len(passed)

    return FLRegistrierungSweepResponse(
        saison_id=saison_id,
        erased_unconfirmed=unconfirmed,
        erased_without_decision=undecided,
        erased_declined=declined,
        failed=failed,
    )
