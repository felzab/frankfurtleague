from collections.abc import Mapping
from datetime import datetime
from typing import Any, Final

from fastapi import APIRouter, Depends
from pymongo import ASCENDING, ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.bewerbungen.schemas import FLBewerbungSweepResponse
from app.api.bewerbungen.services import (
    SWEEP_PAGE,
    acceptance_erasure_is_due,
    build_deletion_filter,
    build_lapsed_seats_filter,
    build_reminder_filter,
    closed_chases,
    compose_chase_update,
    compose_lapsed_seats_update,
    compose_reminder_update,
    days_after,
    decline_erasure_is_due,
    deletion_is_due,
    lapsed_seats,
    next_saison_id,
    owed_deletion_notices,
    owed_link,
    people_with_address,
    reminder_seats,
    schule_name,
    season_after_has_ended,
    season_has_ended,
    undecided_erasure_is_due,
    unreachable_seats,
)
from app.api.kontakte.crud import remove_the_seats_reasons
from app.api.outbox.crud import states_of
from app.api.outbox.services import OwedMail, enqueue_mails
from app.api.spielberichte.crud import strip_the_seasons_reports
from app.api.spielbestaetigungen.crud import strip_the_seasons_confirmations
from app.api.spielbestaetigungen.services import HeldSeats
from app.api.teams.crud import pull_team_names
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import (
    anchor_in_db,
    delete_many_from_db,
    patch_one_in_db,
    patch_past_the_version_in_db,
    pull_many_from_db,
    pull_one_from_db,
)
from app.core.dependencies import (
    BewerbungenCollection,
    DBClient,
    OutboxCollection,
    SaisonsCollection,
    SaisonsReadCollection,
    SaisonTeamsCollection,
    SpielberichteCollection,
    SpielbestaetigungenCollection,
    TeamsCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.recording import ACT_BY_SYSTEM, record_act
from app.core.security import verify_access_system
from app.core.transactions import Batch, drain, refuse_a_stalled_page, run_isolated
from app.shared.schemas.bounds import DECLINED_RETENTION_DAYS, LIST_LIMIT_DEFAULT
from app.shared.schemas.literals import KONTAKT_ROLLEN, FLKontaktRolle
from app.shared.schemas.responses import FLSweepSaisonsResponse

# System tier: the sweep holds no session, so `bind_actor` would refuse it.
router = APIRouter(prefix=f"/api/v{API_VERSION}/bewerbungen/sweep", dependencies=[Depends(verify_access_system)])

# Both shares at one command a row beside the worst call's other 41: 100 commands at 36 ms plus 1.38 ms take 3.74 s
# of `app/core/middlewares.py :: REQUEST_DEADLINE_S`.
REMINDERS_PER_PASS: Final = 36

# Beside the reminders', which owe a deadline a block's deletion does not. A season at capacity takes more passes.
BLOCKS_CLEARED_PER_PASS: Final = 23

# The blocks' share: a pass runs the one clock or the other, each row at the same one command.
LAPSED_SEAT_ROWS_PER_PASS: Final = BLOCKS_CLEARED_PER_PASS


def _ended_after(saison_id: str) -> dict[str, Any]:
    """Every season later than this one that has ended. Raises for an id that is no year, as `next_saison_id` does."""

    return {"_id": {"$gte": next_saison_id(saison_id)}, "status": "past"}


async def pull_the_season_after(
    *,
    saison_id: str,
    saisons_collection: SaisonsCollection,
    # REQUIRED: judged inside the erasing transaction, the anchor below commits with its erasure.
    session: AsyncClientSession,
) -> Any:
    """`season_after_has_ended`'s input, judged in the erasing transaction: a later ended season's status, `None` while this one runs."""

    # This season and the earliest later one that has ended, in one read: ascending ids put this season first.
    seasons = await pull_many_from_db(
        collection=saisons_collection,
        db_filter={"$or": [{"_id": saison_id}, _ended_after(saison_id)]},
        projection=["status"],
        sort_by=[("_id", ASCENDING)],
        limit=2,
        session=session,
    )
    statuses = {row["_id"]: row.get("status") for row in seasons}
    own_status = statuses.pop(saison_id, None)
    if own_status == "active":
        return None

    later_saison_status = next(iter(statuses.values()), None)
    # Written where its rows go, as a pupil's deletion writes one: an activation
    # committing after this read conflicts with the erasure, whose retry finds this season running.
    if own_status == "future" and season_after_has_ended(later_saison_status=later_saison_status):
        await anchor_in_db(collection=saisons_collection, db_filter={"_id": saison_id}, session=session)

    return later_saison_status


@router.get("", response_model=FLSweepSaisonsResponse, summary="Every season the sweep has to visit")
async def get_sweep_saisons(saisons_collection: SaisonsReadCollection) -> FLSweepSaisonsResponse:
    """Every season's id, oldest first, for the caller to sweep one at a time."""

    seasons = await pull_many_from_db(
        collection=saisons_collection, db_filter={}, projection=["_id"], sort_by=[("_id", 1)], limit=LIST_LIMIT_DEFAULT
    )

    return FLSweepSaisonsResponse(saison_ids=[str(season["_id"]) for season in seasons])


@router.post(
    "/{saison_id}",
    response_model=FLBewerbungSweepResponse,
    summary="Run one season's retention clocks",
)
async def sweep_saison(
    saison_id: str,
    bewerbungen_collection: BewerbungenCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    teams_collection: TeamsCollection,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    spielberichte_collection: SpielberichteCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLBewerbungSweepResponse:
    """Run one season's seven retention clocks as of today, each reminder and deletion notice owed in the write it belongs to.

    The drain sends what the pass owed. A row that cannot be written is passed over, counted in `failed` and met
    again by the next pass. 404 where no season has the id.
    """

    # The read that answers the 404 carries the status: this season's own end is a clock too, and a
    # second query for a document already in hand would be a second answer to when it ended.
    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status"])
    saison_status = saison_raw.get("status")

    # Ahead of the guard below, so an id that is no year fails the running season's pass too.
    ended_after = _ended_after(saison_id)
    # Ended once any later season has while this one is not `active`, as a squad row's pupil goes:
    # the next year's season alone may be skipped, or planned and never run.
    ended_raw = None if saison_status == "active" else await saisons_collection.find_one(ended_after, {"status": 1})
    later_saison_status = ended_raw.get("status") if ended_raw is not None else None

    async def erase_page(ids: list[Any], session: AsyncClientSession) -> int:
        """One page of one clock gone, its one row in the page's transaction, so no deletion stands without its row."""

        result = await delete_many_from_db(collection=bewerbungen_collection, db_filter={"_id": {"$in": ids}}, session=session)
        await record_act(
            collection=bewerbungen_collection,
            action="retention.bewerbungen",
            by=ACT_BY_SYSTEM,
            label=saison_id,
            count=result.deleted_count,
            session=session,
        )

        return result.deleted_count

    async def erase_the_undecided(session: AsyncClientSession, batch: Batch) -> tuple[int, int]:
        """The season's own end, undecided having served nothing: owe the notice and erase. Read in-session, so a retry re-judges."""

        rows = await batch.saw(
            pull_many_from_db(
                collection=bewerbungen_collection,
                db_filter=batch.within({"saison_id": saison_id, "status": "submitted"}),
                projection=["status", "kontakte", "confirmations", "erasure_announced_at"],
                # One over the page: a full page is a page that may be truncated, and a clock cannot
                # see what it never read.
                limit=SWEEP_PAGE + 1,
                session=session,
            )
        )
        # Each notice built before anything is written, so a row whose stored data refuses one is passed over whole.
        owed = batch.judged(
            [
                row
                for row, due in batch.judged(rows, lambda row: undecided_erasure_is_due(bewerbung_raw=row, saison_status=saison_status))
                if due
            ],
            lambda row: owed_deletion_notices(bewerbung_raw=row, saison_id=saison_id),
        )
        taken = batch.took([row for row, _ in owed])
        if not taken:
            return len(rows), 0

        # Owed in the erasure's own write: nothing of the application is left to read once this commits.
        await enqueue_mails(
            outbox_collection=outbox_collection,
            session=session,
            mails=[notice for _, notices in owed for notice in notices],
            now=germany_now,
        )
        ids = [row["_id"] for row in taken]

        return len(rows), await erase_page(ids, session)

    async def remind(session: AsyncClientSession, batch: Batch) -> int:
        """Stamp each seat due its one reminder and owe its person the mail, in one transaction. Read in-session, so a retry re-judges.

        Answers the rows mailed. A seat no mail reaches has its chase closed outside the share, a page of them at a few commands.
        """

        rows = await batch.saw(
            pull_many_from_db(
                collection=bewerbungen_collection,
                db_filter=batch.within(build_reminder_filter(saison_id=saison_id, today=today)),
                limit=SWEEP_PAGE + 1,
                # Oldest first, as near the fourteen-day clock's order as a key on the record comes, each seat keeping
                # its own day; `_id` makes the page the same page whichever plan the server picks.
                sort_by=[("submitted_at", ASCENDING), ("_id", ASCENDING)],
                session=session,
            )
        )
        # Each seat's last mail, read in the same transaction: a seat whose mail did not arrive is not chased.
        states = await states_of(
            outbox_collection=outbox_collection, collection=Collection.BEWERBUNGEN, ids=[row["_id"] for row in rows], session=session
        )

        def chase_of(row: Mapping[str, Any]) -> tuple[list[tuple[str, list[FLKontaktRolle]]], list[FLKontaktRolle]]:
            unreachable = unreachable_seats(row=row, states=states)
            seats = reminder_seats(bewerbung_raw=row, today=today, unreachable=unreachable)

            # One mail a person: an address is one person, whose one link answers every seat they hold.
            return people_with_address(kontakte=row.get("kontakte"), seats=seats), closed_chases(
                bewerbung_raw=row, today=today, unreachable=unreachable
            )

        chases = batch.judged(rows, chase_of)
        people_of = {row["_id"]: people for row, (people, _) in chases if people}
        chased = [row for row in rows if row["_id"] in people_of]
        # One read for the page: a mail names the school, and the row holds only its id.
        club_names = await pull_team_names(teams_collection=teams_collection, team_ids=[row.get("team_id") for row in chased], session=session)

        def reminders_of(row: Mapping[str, Any]) -> list[OwedMail]:
            schule = schule_name(bewerbung_raw=row, club_names=club_names)
            return [
                owed_link(
                    kind="bewerbung_reminder",
                    bewerbung_id=row["_id"],
                    kontakte=row["kontakte"],
                    seats=seats,
                    saison_id=saison_id,
                    schule=schule,
                    # The deadline the seat's last mail gave; a reminder does not move it.
                    deadline=str(row["confirmations"][seats[0]]["deadline"]),
                    # The day too: a re-send clears the stamp, and the seat's next reminder is a mail of its own.
                    key=f"{Collection.BEWERBUNGEN}/{row['_id']}/reminder/{seats[0]}/{today}",
                )
                for _, seats in people_of[row["_id"]]
            ]

        # Owed mails built before any stamp, the share cut from the rows they carry: a refused row writes nothing and
        # costs no second attempt, and the rows past the share stay due.
        taken = batch.judged(chased, reminders_of)[: batch.share]
        refused = {row_id for row_id, _ in batch.refused}
        closing = {row["_id"]: seats for row, (_, seats) in chases if seats and row["_id"] not in refused}
        mailing = {row["_id"] for row, _ in taken}
        written = batch.took([row for row in rows if row["_id"] in closing or row["_id"] in mailing])
        refuse_a_stalled_page(read=len(rows), moved=len(written), page=SWEEP_PAGE, clock="reminder", saison_id=saison_id)

        # Past the version, the stamps and the chases' both: mail bookkeeping no form saves, so a decision read before the
        # pass still lands.
        for row, _ in taken:
            await patch_past_the_version_in_db(
                collection=bewerbungen_collection,
                db_filter={"_id": row["_id"]},
                update=compose_reminder_update(seats=[seat for _, seats in people_of[row["_id"]] for seat in seats], today=today),
                session=session,
            )
        # One write a seat, however many rows, a write a row being a page's worth of commands.
        for seat in KONTAKT_ROLLEN:
            if ids := [row_id for row_id, seats in closing.items() if seat in seats]:
                await patch_past_the_version_in_db(
                    collection=bewerbungen_collection,
                    db_filter={"_id": {"$in": ids}},
                    update=compose_chase_update(seats=[seat], closed_at=today),
                    session=session,
                )
        # In the stamps' own transaction: a stamp never stands without its mail, nor a mail without its stamp.
        await enqueue_mails(
            outbox_collection=outbox_collection,
            session=session,
            mails=[mail for _, mails in taken for mail in mails],
            now=germany_now,
        )

        return len(taken)

    async def erase_the_unconfirmed(session: AsyncClientSession, batch: Batch) -> tuple[int, int]:
        """The fourteen-day clock: owe the notice and erase in one transaction. Read in-session, so a retry re-judges."""

        rows = await batch.saw(
            pull_many_from_db(
                collection=bewerbungen_collection,
                db_filter=batch.within(build_deletion_filter(saison_id=saison_id, today=today)),
                limit=SWEEP_PAGE + 1,
                session=session,
            )
        )

        def due(row: Mapping[str, Any]) -> bool:
            return deletion_is_due(bewerbung_raw=row, today=today)

        # Each notice built before anything is written, so a row whose stored data refuses one is passed over whole.
        owed = batch.judged(
            [row for row, is_due in batch.judged(rows, due) if is_due],
            lambda row: owed_deletion_notices(bewerbung_raw=row, saison_id=saison_id),
        )
        taken = batch.took([row for row, _ in owed])
        refuse_a_stalled_page(read=len(rows), moved=len(taken), page=SWEEP_PAGE, clock="deletion", saison_id=saison_id)
        if not taken:
            return len(rows), 0

        # Owed in the erasure's own write: nothing of the application is left to read once this commits.
        await enqueue_mails(
            outbox_collection=outbox_collection,
            session=session,
            mails=[notice for _, notices in owed for notice in notices],
            now=germany_now,
        )
        ids = [row["_id"] for row in taken]

        return len(rows), await erase_page(ids, session)

    async def erase_declined(session: AsyncClientSession, batch: Batch) -> tuple[int, int]:
        """The decline clock. Read in-session, so a retry re-judges."""

        rows = await batch.saw(
            pull_many_from_db(
                collection=bewerbungen_collection,
                # Narrowed to the decisions whose days are behind them: a page of fresh ones would fill the
                # read ahead of a due one, and the stall would refuse the pass.
                db_filter=batch.within(
                    {
                        "saison_id": saison_id,
                        "status": "declined",
                        "decision.made_at": {"$lte": days_after(day=today, days=-DECLINED_RETENTION_DAYS)},
                    }
                ),
                projection=["status", "decision"],
                limit=SWEEP_PAGE + 1,
                session=session,
            )
        )
        taken = batch.took([row for row in rows if decline_erasure_is_due(bewerbung_raw=row, today=today)])
        if not taken:
            refuse_a_stalled_page(read=len(rows), moved=0, page=SWEEP_PAGE, clock="decline", saison_id=saison_id)
            return len(rows), 0

        ids = [row["_id"] for row in taken]

        return len(rows), await erase_page(ids, session)

    async def erase_accepted(session: AsyncClientSession, batch: Batch) -> tuple[int, int]:
        """The season-and-one clock's first half. Read in-session, the season with it, so a retry re-judges."""

        rows = await batch.saw(
            pull_many_from_db(
                collection=bewerbungen_collection,
                db_filter=batch.within({"saison_id": saison_id, "status": "accepted"}),
                projection=["status"],
                limit=SWEEP_PAGE + 1,
                session=session,
            )
        )
        later_status = await pull_the_season_after(saison_id=saison_id, saisons_collection=saisons_collection, session=session)
        taken = batch.took(
            [
                row
                for row, due in batch.judged(rows, lambda row: acceptance_erasure_is_due(bewerbung_raw=row, later_saison_status=later_status))
                if due
            ]
        )
        if not taken:
            # Read as nothing, so the drain stops: a page of accepted rows it takes none of is one an activation
            # since the call's own read keeps, and reading it again would find the same.
            return 0, 0

        ids = [row["_id"] for row in taken]

        return len(rows), await erase_page(ids, session)

    async def clear_the_blocks(session: AsyncClientSession, batch: Batch) -> int:
        """The season-and-one clock's second half, a share a pass. Read in-session, the season with it, so a retry re-judges."""

        junction_rows = await batch.saw(
            pull_many_from_db(
                collection=saison_teams_collection,
                # Either block standing, not `kontakte` alone, so no row's links, and their delivery records,
                # outlive its people whichever write cleared them.
                db_filter=batch.within({"saison_id": saison_id, "$or": [{"kontakte": {"$ne": None}}, {"confirmations": {"$ne": None}}]}),
                projection=["_id"],
                limit=SWEEP_PAGE + 1,
                session=session,
            )
        )
        if not season_after_has_ended(
            later_saison_status=await pull_the_season_after(saison_id=saison_id, saisons_collection=saisons_collection, session=session)
        ):
            return 0
        # A cleared row leaves the filter, so the rows past the share are the next pass's.
        taken = batch.took(junction_rows[: batch.share])

        for row in taken:
            await patch_one_in_db(
                collection=saison_teams_collection,
                db_filter={"_id": row["_id"]},
                # The links go with their people: each holds a token hash and the delivery record of the
                # message it went out in (`docs/datenschutz.md :: "No delivery state has a clock of its own"`).
                update={"$set": {"kontakte": None, "confirmations": None}},
                session=session,
                expected_version=None,
                return_document=ReturnDocument.BEFORE,
            )
        if taken:
            await record_act(
                collection=saison_teams_collection,
                action="retention.kontakte",
                by=ACT_BY_SYSTEM,
                label=saison_id,
                count=len(taken),
                session=session,
            )

        return len(taken)

    async def clear_the_lapsed_seats(session: AsyncClientSession, batch: Batch) -> int:
        """A season row's seat past its own day unconfirmed, a share of rows a pass. Read in-session, so a retry re-judges."""

        rows = await batch.saw(
            pull_many_from_db(
                collection=saison_teams_collection,
                db_filter=batch.within(build_lapsed_seats_filter(saison_id=saison_id, today=today)),
                projection=["team_id", "kontakte", "confirmations"],
                limit=SWEEP_PAGE + 1,
                session=session,
            )
        )
        # An emptied seat leaves the filter, so the rows past the share are the next pass's.
        taken = batch.took(rows[: batch.share])

        emptied = 0
        held: list[HeldSeats] = []
        for row in taken:
            stored_kontakte = row.get("kontakte")
            seats = lapsed_seats(kontakte=stored_kontakte, confirmations=row.get("confirmations"), today=today)
            await patch_one_in_db(
                collection=saison_teams_collection,
                db_filter={"_id": row["_id"]},
                update=compose_lapsed_seats_update(kontakte=stored_kontakte, seats=seats),
                session=session,
                expected_version=None,
                return_document=ReturnDocument.BEFORE,
            )
            emptied += len(seats)
            held.append(HeldSeats(saison_id=saison_id, team_id=row["team_id"], seats=tuple(seats)))

        # Once for the share: the seats' people leave as a Widerspruch's do.
        await remove_the_seats_reasons(spielbestaetigungen_collection=spielbestaetigungen_collection, held=held, session=session)
        if emptied:
            await record_act(
                collection=saison_teams_collection,
                action="retention.kontakte",
                by=ACT_BY_SYSTEM,
                label=saison_id,
                count=emptied,
                session=session,
            )

        return emptied

    async def strip_the_confirmations(session: AsyncClientSession, batch: Batch) -> None:
        """The season-and-one clock's last part, a transaction apart from the blocks' share, so a failing strip holds back no block."""

        if not season_after_has_ended(
            later_saison_status=await pull_the_season_after(saison_id=saison_id, saisons_collection=saisons_collection, session=session)
        ):
            return
        # The season the step's one row: a strip failing is passed over alone under the season's id, never charged to a block,
        # and every pass strips what is still left whether or not a block clears on it.
        batch.took([{"_id": saison_id}])

        await strip_the_seasons_confirmations(
            spielbestaetigungen_collection=spielbestaetigungen_collection, saison_id=saison_id, session=session
        )

    async def strip_the_reports(session: AsyncClientSession, batch: Batch) -> None:
        """The season-and-one clock's report part, a transaction apart from the confirmations' strip, for that strip's reason."""

        if not season_after_has_ended(
            later_saison_status=await pull_the_season_after(saison_id=saison_id, saisons_collection=saisons_collection, session=session)
        ):
            return
        batch.took([{"_id": saison_id}])

        await strip_the_seasons_reports(spielberichte_collection=spielberichte_collection, saison_id=saison_id, session=session)

    # Every erasure before the reminder, which owes a mail only to an application still standing.
    undecided, failed = 0, 0
    # AHEAD of the fourteen-day clock and the reminder, which read the collection after it: a season that has ended
    # leaves nobody to chase, and a notice about an application this pass erased is a notice about nothing.
    if season_has_ended(saison_status=saison_status):
        undecided, passed = await drain(
            db=db,
            page_of=erase_the_undecided,
            page=SWEEP_PAGE,
            what="Application",
            clock="season's end",
        )
        failed += len(passed)

    declined, passed = await drain(
        db=db,
        page_of=erase_declined,
        page=SWEEP_PAGE,
        what="Application",
        clock="decline",
    )
    failed += len(passed)

    accepted, emptied, seats_emptied = 0, 0, 0
    # A gate alone, each erasing transaction judging the season again: an activation since this read keeps its rows.
    if season_after_has_ended(later_saison_status=later_saison_status):
        accepted, passed = await drain(
            db=db,
            page_of=erase_accepted,
            page=SWEEP_PAGE,
            what="Application",
            clock="acceptance",
        )
        failed += len(passed)

        cleared, passed = await run_isolated(
            db=db,
            batch=Batch(share=BLOCKS_CLEARED_PER_PASS),
            attempt=clear_the_blocks,
            moved=lambda blocks: blocks,
            owes=False,
            what="Season team",
            clock="contact block",
        )
        failed += len(passed)

        _, passed = await run_isolated(
            db=db,
            batch=Batch(),
            attempt=strip_the_confirmations,
            moved=lambda _: 0,
            owes=False,
            what="Season",
            clock="confirmation strip",
        )
        failed += len(passed)

        _, passed = await run_isolated(
            db=db,
            batch=Batch(),
            attempt=strip_the_reports,
            moved=lambda _: 0,
            owes=False,
            what="Season",
            clock="report strip",
        )
        failed += len(passed)
        emptied = sum(cleared)
    # Never beside the blocks, which take the seats with them: the two shares are one budget.
    else:
        lapsed, passed = await run_isolated(
            db=db,
            batch=Batch(share=LAPSED_SEAT_ROWS_PER_PASS),
            attempt=clear_the_lapsed_seats,
            moved=lambda seats: seats,
            owes=False,
            what="Season team",
            clock="lapsed seat",
        )
        failed += len(passed)
        seats_emptied = sum(lapsed)

    # The fourteen-day clock after the season's end and before the reminder: an application erased leaves nobody to
    # chase, and a season that has ended took its undecided rows already.
    erased_count, passed = await drain(
        db=db,
        page_of=erase_the_unconfirmed,
        page=SWEEP_PAGE,
        what="Application",
        clock="fourteen-day",
    )
    failed += len(passed)

    reminded, passed = await run_isolated(
        db=db,
        batch=Batch(share=REMINDERS_PER_PASS),
        attempt=remind,
        moved=lambda reminded: reminded,
        owes=True,
        what="Application",
        clock="reminder",
    )
    failed += len(passed)

    return FLBewerbungSweepResponse(
        saison_id=saison_id,
        reminded=sum(reminded),
        erased=erased_count,
        erased_declined=declined,
        erased_accepted=accepted,
        erased_without_decision=undecided,
        kontakt_blocks_emptied=emptied,
        kontakt_seats_emptied=seats_emptied,
        failed=failed,
    )
