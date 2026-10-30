from collections.abc import Mapping
from datetime import datetime
from typing import Any, Final

from fastapi import APIRouter, Depends
from pymongo import ASCENDING, ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.aktionen.crud import redact_images_in_session
from app.api.bewerbungen.schemas import FLBewerbungSweepResponse
from app.api.bewerbungen.services import (
    SWEEP_PAGE,
    acceptance_loeschung_is_due,
    build_deletion_filter,
    build_erinnerung_filter,
    compose_erinnerung_update,
    decline_loeschung_is_due,
    deletion_is_due,
    latest_decision_due,
    next_saison_id,
    owed_link,
    owed_loeschung,
    personen_mit_adresse,
    reminder_seats,
    schule_name,
    season_after_has_ended,
    season_has_ended,
    undecided_loeschung_is_due,
    unerreichbare_seats,
)
from app.api.kontakte.services import contact_block_image_edits
from app.api.outbox.crud import states_of
from app.api.outbox.services import OwedMail, enqueue_mails
from app.api.spielberichte.crud import strip_the_seasons_reports
from app.api.spielbestaetigungen.crud import strip_the_seasons_confirmations
from app.api.spielbestaetigungen.services import seat_void_of
from app.api.teams.crud import pull_team_names, void_moved_seats
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import anchor_in_db, erase_many_from_db, patch_one_in_db, pull_many_from_db, pull_one_from_db, redact_log_rows_in_db
from app.core.dependencies import (
    ActionLogCollection,
    BewerbungenCollection,
    DBClient,
    OutboxCollection,
    SaisonsCollection,
    SaisonTeamsCollection,
    SpielberichteCollection,
    SpielbestaetigungenCollection,
    TeamsCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.recording import build_redaction_filter, log_stamp
from app.core.security import bind_system_actor, verify_access_system
from app.core.transactions import Batch, drain, refuse_a_stalled_page, run_isolated
from app.shared.schemas.bounds import LIST_LIMIT_MAX
from app.shared.schemas.responses import FLSweepSaisonsResponse

# System tier and the system actor: the sweep holds no session, so `bind_actor` would refuse it,
# and an invented administrator for a machine is what `SYSTEM_ACTOR` exists to avoid.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/bewerbungen/sweep",
    dependencies=[Depends(verify_access_system), Depends(bind_system_actor)],
)

# Both shares at three commands a row beside the worst call's other 88: 265 commands at 36 ms plus 1.38 ms take 9.91 s
# of `app/core/middlewares.py :: REQUEST_DEADLINE_S`. 37 would make 268, 10.02 s.
REMINDERS_PER_PASS: Final = 36

# The largest share inside the deadline beside the reminders', which owe a deadline a block's deletion does not: 24
# would make 268 commands, 10.02 s. A season at capacity takes more passes.
BLOCKS_CLEARED_PER_PASS: Final = 23


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
async def get_sweep_saisons(saisons_collection: SaisonsCollection) -> FLSweepSaisonsResponse:
    """Every season's id, oldest first, for the caller to sweep one at a time."""

    seasons = await pull_many_from_db(
        collection=saisons_collection, db_filter={}, projection=["_id"], sort_by=[("_id", 1)], limit=LIST_LIMIT_MAX
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
    aktionen_collection: ActionLogCollection,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    spielberichte_collection: SpielberichteCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLBewerbungSweepResponse:
    """Run one season's six retention clocks as of today, each reminder and deletion notice owed in the write it belongs to.

    The drain sends what the pass owed. A row that cannot be written is passed over, counted in `failed` and met
    again by the next pass. 404 where no season has the id.
    """

    # The read that answers the 404 carries the status: this season's own end is a clock too, and a
    # second query for a document already in hand would be a second answer to when it ended.
    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status"])
    saison_status = saison_raw.get("status")

    # Ahead of the guard below, so an id that is no year fails the running season's pass too.
    beendet_danach = _ended_after(saison_id)
    # Ended once any later season has while this one is not `active`, as a squad row's pupil goes:
    # the next year's season alone may be skipped, or planned and never run.
    beendete_raw = None if saison_status == "active" else await saisons_collection.find_one(beendet_danach, {"status": 1})
    later_saison_status = beendete_raw.get("status") if beendete_raw is not None else None

    stamp = log_stamp(germany_now)

    async def loeschen_the_undecided(session: AsyncClientSession, batch: Batch) -> tuple[int, int, int]:
        """The season's own end: erase, then redact the rows that still hold the people. Read in-session, so a retry re-judges."""

        rows = await batch.saw(
            pull_many_from_db(
                collection=bewerbungen_collection,
                db_filter=batch.within({"saison_id": saison_id, "status": "submitted"}),
                projection=["status"],
                # One over the page: a full page is a page that may be truncated, and a clock cannot
                # see what it never read.
                limit=SWEEP_PAGE + 1,
                session=session,
            )
        )
        taken = batch.took(
            [
                row
                for row, due in batch.judged(rows, lambda row: undecided_loeschung_is_due(bewerbung_raw=row, saison_status=saison_status))
                if due
            ]
        )
        if not taken:
            return len(rows), 0, 0

        ids = [row["_id"] for row in taken]
        result = await erase_many_from_db(
            collection=bewerbungen_collection, db_filter={"saison_id": saison_id, "_id": {"$in": ids}}, session=session
        )
        redacted = await redact_log_rows_in_db(
            action_log_collection=aktionen_collection, targets=[(Collection.BEWERBUNGEN, ids)], at=stamp, session=session
        )

        return len(rows), result.deleted_count, redacted

    async def remind(session: AsyncClientSession, batch: Batch) -> int:
        """Stamp each seat due its one reminder and owe its person the mail, in one transaction. Read in-session, so a retry re-judges."""

        rows = await batch.saw(
            pull_many_from_db(
                collection=bewerbungen_collection,
                db_filter=batch.within(build_erinnerung_filter(saison_id=saison_id, today=today)),
                limit=SWEEP_PAGE + 1,
                # Earliest deadline first, so the application the fourteen-day clock takes soonest is
                # chased first; `_id` makes the page the same page whichever plan the server picks.
                sort_by=[("confirmation_deadline", ASCENDING), ("_id", ASCENDING)],
                session=session,
            )
        )
        # Each seat's last mail, read in the same transaction: a seat whose mail did not arrive is not chased.
        lagen = await states_of(
            outbox_collection=outbox_collection, collection=Collection.BEWERBUNGEN, ids=[row["_id"] for row in rows], session=session
        )
        # One mail a person: an address is one person, whose one link answers every seat they hold.
        personen_of = {
            row["_id"]: personen
            for row, personen in batch.judged(
                rows,
                lambda row: personen_mit_adresse(
                    kontakte=row.get("kontakte"),
                    seats=reminder_seats(bewerbung_raw=row, today=today, unerreichbar=unerreichbare_seats(row=row, lagen=lagen)),
                ),
            )
            if personen
        }
        chased = [row for row in rows if row["_id"] in personen_of]
        # One read for the page: a mail names the school, and the row holds only its id.
        club_names = await pull_team_names(teams_collection=teams_collection, team_ids=[row.get("team_id") for row in chased], session=session)

        def reminders_of(row: Mapping[str, Any]) -> list[OwedMail]:
            schule = schule_name(bewerbung_raw=row, club_names=club_names)
            return [
                owed_link(
                    art="bewerbung_reminder",
                    bewerbung_id=row["_id"],
                    kontakte=row["kontakte"],
                    seats=seats,
                    saison_id=saison_id,
                    schule=schule,
                    # The deadline the first mail gave; a reminder does not move it.
                    frist=str(row["confirmation_deadline"]),
                    # The day too: a re-send clears the stamp, and the seat's next reminder is a mail of its own.
                    key=f"{Collection.BEWERBUNGEN}/{row['_id']}/reminder/{seats[0]}/{today}",
                )
                for _, seats in personen_of[row["_id"]]
            ]

        # Owed mails built before any stamp, the share cut from the rows they carry: a refused row writes nothing and
        # costs no second attempt, and the rows past the share stay due.
        taken = batch.judged(chased, reminders_of)[: batch.share]
        batch.took([row for row, _ in taken])
        refuse_a_stalled_page(read=len(rows), moved=len(taken), page=SWEEP_PAGE, clock="reminder", saison_id=saison_id)

        for row, _ in taken:
            await patch_one_in_db(
                collection=bewerbungen_collection,
                db_filter={"_id": row["_id"]},
                update=compose_erinnerung_update(seats=[seat for _, seats in personen_of[row["_id"]] for seat in seats], today=today),
                session=session,
                return_document=ReturnDocument.BEFORE,
            )
        # In the stamps' own transaction: a stamp never stands without its mail, nor a mail without its stamp.
        await enqueue_mails(
            outbox_collection=outbox_collection,
            session=session,
            mails=[mail for _, mails in taken for mail in mails],
            now=germany_now,
        )

        return len(taken)

    async def loeschen_the_unconfirmed(session: AsyncClientSession, batch: Batch) -> tuple[int, int, int]:
        """The fourteen-day clock: owe the submitter the notice, erase, then redact, in one transaction.

        Read in-session, so a retry re-judges.
        """

        rows = await batch.saw(
            pull_many_from_db(
                collection=bewerbungen_collection,
                db_filter=batch.within(build_deletion_filter(saison_id=saison_id, today=today)),
                limit=SWEEP_PAGE + 1,
                session=session,
            )
        )
        # The submitter's last mail, read in the same transaction: a bounce it reports holds the application for the
        # administrator to correct the address.
        lagen = await states_of(
            outbox_collection=outbox_collection, collection=Collection.BEWERBUNGEN, ids=[row["_id"] for row in rows], session=session
        )

        def due(row: Mapping[str, Any]) -> bool:
            unzustellbar = "ansprechperson" in unerreichbare_seats(row=row, lagen=lagen)
            return deletion_is_due(bewerbung_raw=row, today=today, undeliverable=unzustellbar)

        # Each notice built before anything is written, so a row whose stored data refuses one is passed over whole.
        owed = batch.judged(
            [row for row, is_due in batch.judged(rows, due) if is_due], lambda row: owed_loeschung(bewerbung_raw=row, saison_id=saison_id)
        )
        taken = batch.took([row for row, _ in owed])
        refuse_a_stalled_page(read=len(rows), moved=len(taken), page=SWEEP_PAGE, clock="deletion", saison_id=saison_id)
        if not taken:
            return len(rows), 0, 0

        # Owed in the erasure's own write, the notice carrying what it names: nothing of the application is left to
        # read once this commits.
        await enqueue_mails(
            outbox_collection=outbox_collection,
            session=session,
            mails=[notice for _, notice in owed if notice is not None],
            now=germany_now,
        )
        ids = [row["_id"] for row in taken]
        result = await erase_many_from_db(
            collection=bewerbungen_collection, db_filter={"saison_id": saison_id, "_id": {"$in": ids}}, session=session
        )
        redacted = await redact_log_rows_in_db(
            action_log_collection=aktionen_collection, targets=[(Collection.BEWERBUNGEN, ids)], at=stamp, session=session
        )

        return len(rows), result.deleted_count, redacted

    async def loeschen_declined(session: AsyncClientSession, batch: Batch) -> tuple[int, int, int]:
        """The one-month clock: erase, then redact the rows that still hold the people. Read in-session, so a retry re-judges."""

        rows = await batch.saw(
            pull_many_from_db(
                collection=bewerbungen_collection,
                # Narrowed to the decisions whose month is behind them: a page of fresh ones would fill the
                # read ahead of a due one, and the stall would refuse the pass.
                db_filter=batch.within(
                    {"saison_id": saison_id, "status": "declined", "decision.made_at": {"$lte": latest_decision_due(today=today)}}
                ),
                projection=["status", "decision"],
                limit=SWEEP_PAGE + 1,
                session=session,
            )
        )
        taken = batch.took([row for row in rows if decline_loeschung_is_due(bewerbung_raw=row, today=today)])
        if not taken:
            refuse_a_stalled_page(read=len(rows), moved=0, page=SWEEP_PAGE, clock="decline", saison_id=saison_id)
            return len(rows), 0, 0

        ids = [row["_id"] for row in taken]
        # The filter names the season and the ids and nothing else: it is stored as text, and any
        # other key would preserve what this call destroys.
        result = await erase_many_from_db(
            collection=bewerbungen_collection, db_filter={"saison_id": saison_id, "_id": {"$in": ids}}, session=session
        )
        redacted = await redact_log_rows_in_db(
            action_log_collection=aktionen_collection, targets=[(Collection.BEWERBUNGEN, ids)], at=stamp, session=session
        )

        return len(rows), result.deleted_count, redacted

    async def loeschen_accepted(session: AsyncClientSession, batch: Batch) -> tuple[int, int, int]:
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
                for row, due in batch.judged(rows, lambda row: acceptance_loeschung_is_due(bewerbung_raw=row, later_saison_status=later_status))
                if due
            ]
        )
        if not taken:
            # Read as nothing, so the drain stops: a page of accepted rows it takes none of is one an activation
            # since the call's own read keeps, and reading it again would find the same.
            return 0, 0, 0

        ids = [row["_id"] for row in taken]
        result = await erase_many_from_db(
            collection=bewerbungen_collection, db_filter={"saison_id": saison_id, "_id": {"$in": ids}}, session=session
        )
        redacted = await redact_log_rows_in_db(
            action_log_collection=aktionen_collection, targets=[(Collection.BEWERBUNGEN, ids)], at=stamp, session=session
        )

        return len(rows), result.deleted_count, redacted

    async def clear_the_blocks(session: AsyncClientSession, batch: Batch) -> tuple[int, int]:
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
            return 0, 0
        # A cleared row leaves the filter, so the rows past the share are the next pass's.
        taken = batch.took(junction_rows[: batch.share])

        # `patch_one_in_db` per row and never `patch_many_in_db`, which records no `document_id`: the
        # redaction below must match the rows it logs (`app/api/kontakte/crud.py :: clear_seats`).
        cleared: list[Any] = []
        voids = []
        for row in taken:
            before = await patch_one_in_db(
                collection=saison_teams_collection,
                db_filter={"_id": row["_id"]},
                # The links go with their people: each holds a token hash and the delivery record of the
                # message it went out in (`docs/datenschutz.md :: "No delivery state has a clock of its own"`).
                update={"$set": {"kontakte": None, "confirmations": None}},
                session=session,
                return_document=ReturnDocument.BEFORE,
            )
            voids.append(seat_void_of(saison_id=saison_id, team_id=before["team_id"], stored_kontakte=before.get("kontakte"), kontakte=None))
            cleared.append(row["_id"])
        # Once for the share, so voiding its people's match links costs the pass the same however many rows it
        # clears.
        await void_moved_seats(spielbestaetigungen_collection=spielbestaetigungen_collection, voids=voids, session=session)
        # The block alone leaves the row's images, as it leaves the row: its exit record and every
        # earlier state are the season's, not the people's.
        redacted = await redact_images_in_session(
            aktionen_collection=aktionen_collection,
            db_filter=build_redaction_filter([(Collection.SAISON_TEAMS, cleared)]),
            judge=contact_block_image_edits,
            stamp=stamp,
            session=session,
        )

        return len(cleared), redacted

    async def strip_the_confirmations(session: AsyncClientSession, batch: Batch) -> int:
        """The season-and-one clock's last part, a transaction apart from the blocks' share, so a failing strip holds back no block."""

        if not season_after_has_ended(
            later_saison_status=await pull_the_season_after(saison_id=saison_id, saisons_collection=saisons_collection, session=session)
        ):
            return 0
        # The season the step's one row: a strip failing is passed over alone under the season's id, never charged to a block,
        # and every pass strips what is still left whether or not a block clears on it.
        batch.took([{"_id": saison_id}])

        return await strip_the_seasons_confirmations(
            spielbestaetigungen_collection=spielbestaetigungen_collection,
            aktionen_collection=aktionen_collection,
            saison_id=saison_id,
            stamp=stamp,
            session=session,
        )

    async def strip_the_reports(session: AsyncClientSession, batch: Batch) -> int:
        """The season-and-one clock's report part, a transaction apart from the confirmations' strip, for that strip's reason."""

        if not season_after_has_ended(
            later_saison_status=await pull_the_season_after(saison_id=saison_id, saisons_collection=saisons_collection, session=session)
        ):
            return 0
        batch.took([{"_id": saison_id}])

        return await strip_the_seasons_reports(
            spielberichte_collection=spielberichte_collection,
            aktionen_collection=aktionen_collection,
            saison_id=saison_id,
            stamp=stamp,
            session=session,
        )

    # Every erasure before the reminder, which owes a mail only to an application still standing.
    ohne_entscheidung, redacted_undecided, fehlgeschlagen = 0, 0, 0
    # AHEAD of the fourteen-day clock and the reminder, which read the collection after it: a season that has ended
    # leaves nobody to chase, and a notice about an application this pass erased is a notice about nothing.
    if season_has_ended(saison_status=saison_status):
        ohne_entscheidung, redacted_undecided, passed = await drain(
            db=db,
            page_of=loeschen_the_undecided,
            page=SWEEP_PAGE,
            what="Application",
            clock="season's end",
        )
        fehlgeschlagen += len(passed)

    abgelehnte, redacted_declined, passed = await drain(
        db=db,
        page_of=loeschen_declined,
        page=SWEEP_PAGE,
        what="Application",
        clock="decline",
    )
    fehlgeschlagen += len(passed)

    angenommene, geleert, redacted_accepted = 0, 0, 0
    # A gate alone, each erasing transaction judging the season again: an activation since this read keeps its rows.
    if season_after_has_ended(later_saison_status=later_saison_status):
        angenommene, redacted_accepted, passed = await drain(
            db=db,
            page_of=loeschen_accepted,
            page=SWEEP_PAGE,
            what="Application",
            clock="acceptance",
        )
        fehlgeschlagen += len(passed)

        cleared, passed = await run_isolated(
            db=db,
            batch=Batch(share=BLOCKS_CLEARED_PER_PASS),
            attempt=clear_the_blocks,
            moved=lambda blocks: blocks[0],
            owes=False,
            what="Season team",
            clock="contact block",
        )
        fehlgeschlagen += len(passed)

        # Each strip answers the log rows it redacted, which `redacted_action_log` counts with every other clock's.
        stripped_confirmations, passed = await run_isolated(
            db=db,
            batch=Batch(),
            attempt=strip_the_confirmations,
            moved=lambda _: 0,
            owes=False,
            what="Season",
            clock="confirmation strip",
        )
        fehlgeschlagen += len(passed)

        stripped_reports, passed = await run_isolated(
            db=db,
            batch=Batch(),
            attempt=strip_the_reports,
            moved=lambda _: 0,
            owes=False,
            what="Season",
            clock="report strip",
        )
        fehlgeschlagen += len(passed)
        geleert = sum(blocks for blocks, _ in cleared)
        redacted_accepted += sum(redacted for _, redacted in cleared) + sum(stripped_confirmations) + sum(stripped_reports)

    # The fourteen-day clock after the season's end and before the reminder: an application erased leaves nobody to
    # chase, and a season that has ended took its undecided rows already.
    geloescht, redacted_unconfirmed, passed = await drain(
        db=db,
        page_of=loeschen_the_unconfirmed,
        page=SWEEP_PAGE,
        what="Application",
        clock="fourteen-day",
    )
    fehlgeschlagen += len(passed)

    reminded, passed = await run_isolated(
        db=db,
        batch=Batch(share=REMINDERS_PER_PASS),
        attempt=remind,
        moved=lambda erinnert: erinnert,
        owes=True,
        what="Application",
        clock="reminder",
    )
    fehlgeschlagen += len(passed)

    return FLBewerbungSweepResponse(
        saison_id=saison_id,
        reminded=sum(reminded),
        erased=geloescht,
        declined_erased=abgelehnte,
        accepted_erased=angenommene,
        without_decision_erased=ohne_entscheidung,
        kontakt_blocks_emptied=geleert,
        redacted_action_log=redacted_declined + redacted_accepted + redacted_undecided + redacted_unconfirmed,
        failed=fehlgeschlagen,
    )
