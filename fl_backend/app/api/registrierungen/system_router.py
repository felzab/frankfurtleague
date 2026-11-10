from typing import Any

from fastapi import APIRouter, Depends
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.bewerbungen.services import season_has_ended
from app.api.registrierungen.schemas import FLRegistrierungSweepResponse
from app.api.registrierungen.services import (
    SWEEP_PAGE,
    bestaetigung_loeschung_is_due,
    build_decline_filter,
    build_unconfirmed_filter,
    build_undecided_filter,
    decline_loeschung_is_due,
    undecided_loeschung_is_due,
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
    """
    Run the three registration retention clocks over one season, as of today in Europe/Berlin.

    A declined registration is erased 14 days after the decision. Once the season is `past`, every registration still awaiting a
    decision is erased whatever the pupil answered, because no admission can be taken for a season that is over; the deadline
    clock does not run for a `past` season, whose own end takes every row it reads.

    Otherwise an unconfirmed registration strictly past its deadline is erased with no notice at all, the confirmation mail having
    named that day. Every removal names this season alone and is made inside a transaction.

    A registration whose write fails, the database refusing it or anything else, is passed over alone and logged by id: the rest of
    its clock's page goes, and it stays due, so the next pass meets it again and one failing record holds back no clock and
    nobody behind it. `failed` sums the rows each of the three clocks passed over.

    404 where no season has the id. Idempotent: a run after every due row went writes nothing.
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

    async def loeschen_the_undecided(session: AsyncClientSession, batch: Batch) -> tuple[int, int]:
        """The season's own end. Read in-session, so a retry re-judges."""

        rows = await batch.saw(
            pull_many_from_db(
                collection=registrierungen_collection,
                db_filter=batch.within(build_undecided_filter(saison_id=saison_id)),
                projection=["status"],
                # One over the page, as `app/api/saisons/admin_router.py :: delete_spielplan` reads: a
                # full page is a page that may be truncated, and a clock cannot see what it never read.
                limit=SWEEP_PAGE + 1,
                session=session,
            )
        )
        taken = batch.took(
            [
                row
                for row, due in batch.judged(rows, lambda row: undecided_loeschung_is_due(registrierung_raw=row, saison_status=saison_status))
                if due
            ]
        )
        if not taken:
            # Rows passed over in place move the page: the drain reads the next one without them.
            refuse_a_stalled_page(read=len(rows), moved=len(batch.refused), page=SWEEP_PAGE, clock="season's end", saison_id=saison_id)
            return len(rows), 0

        ids = [row["_id"] for row in taken]

        return len(rows), await erase_page(ids, session)

    async def loeschen_the_unconfirmed(session: AsyncClientSession, batch: Batch) -> tuple[int, int]:
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
            [row for row, due in batch.judged(rows, lambda row: bestaetigung_loeschung_is_due(registrierung_raw=row, today=today)) if due]
        )
        if not taken:
            # Rows passed over in place move the page: the drain reads the next one without them.
            refuse_a_stalled_page(read=len(rows), moved=len(batch.refused), page=SWEEP_PAGE, clock="deadline", saison_id=saison_id)
            return len(rows), 0

        ids = [row["_id"] for row in taken]

        return len(rows), await erase_page(ids, session)

    async def loeschen_declined(session: AsyncClientSession, batch: Batch) -> tuple[int, int]:
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
        taken = batch.took([row for row in rows if decline_loeschung_is_due(registrierung_raw=row, today=today)])
        if not taken:
            refuse_a_stalled_page(read=len(rows), moved=0, page=SWEEP_PAGE, clock="decline", saison_id=saison_id)
            return len(rows), 0

        ids = [row["_id"] for row in taken]

        return len(rows), await erase_page(ids, session)

    abgelehnte, passed = await drain(
        db=db,
        page_of=loeschen_declined,
        page=SWEEP_PAGE,
        what="Registration",
        clock="decline",
    )
    failed = len(passed)

    ohne_entscheidung, unconfirmed = 0, 0
    # The season's end takes every row the deadline clock reads.
    if season_has_ended(saison_status=saison_status):
        ohne_entscheidung, passed = await drain(
            db=db,
            page_of=loeschen_the_undecided,
            page=SWEEP_PAGE,
            what="Registration",
            clock="season's end",
        )
        failed += len(passed)
    else:
        unconfirmed, passed = await drain(
            db=db,
            page_of=loeschen_the_unconfirmed,
            page=SWEEP_PAGE,
            what="Registration",
            clock="deadline",
        )
        failed += len(passed)

    return FLRegistrierungSweepResponse(
        saison_id=saison_id,
        erased_unconfirmed=unconfirmed,
        erased_without_decision=ohne_entscheidung,
        erased_declined=abgelehnte,
        failed=failed,
    )
