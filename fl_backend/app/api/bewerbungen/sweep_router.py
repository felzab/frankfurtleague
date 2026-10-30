from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Annotated, Any, Final

from fastapi import APIRouter, Body, Depends
from pymongo import ASCENDING, ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.aktionen.crud import redact_images_in_session
from app.api.bewerbungen.schemas import (
    DELETIONS_LISTED_PER_PASS,
    FLBewerbungSweepAngekuendigtPayload,
    FLBewerbungSweepAngekuendigtResponse,
    FLBewerbungSweepAusstehend,
    FLBewerbungSweepErinnerung,
    FLBewerbungSweepLoeschenPayload,
    FLBewerbungSweepLoeschenResponse,
    FLBewerbungSweepLoeschung,
    FLBewerbungSweepResponse,
    FLBewerbungSweepSaisonsResponse,
    FLBewerbungSweepSeat,
)
from app.api.bewerbungen.services import (
    SWEEP_PAGE,
    acceptance_erasure_is_due,
    ansprechperson_mailbox,
    ausstehende_seats,
    build_deletion_filter,
    build_erinnerung_filter,
    compose_ankuendigung_update,
    compose_erinnerung_update,
    decline_erasure_is_due,
    deletion_is_due,
    deletion_was_announced,
    group_seats_by_mailbox,
    latest_decision_due,
    mint_token,
    next_saison_id,
    reminder_link_groups,
    reminder_seats,
    schule_name,
    season_after_has_ended,
    season_has_ended,
    undecided_erasure_is_due,
    vorname_of,
)
from app.api.kontakte.services import contact_block_image_edits
from app.api.sperrliste.lookup import SperrlisteLookup, adressen_gesperrt, sperrliste_saison
from app.api.spielberichte.crud import strip_the_seasons_reports
from app.api.spielbestaetigungen.crud import strip_the_seasons_confirmations
from app.api.spielbestaetigungen.services import seat_void_of
from app.api.teams.crud import pull_team_names, void_moved_seats
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import anchor_in_db, erase_many_from_db, patch_many_in_db, patch_one_in_db, pull_many_from_db, pull_one_from_db
from app.core.dependencies import (
    AktionenCollection,
    BewerbungenCollection,
    DBClient,
    SaisonsCollection,
    SaisonTeamsCollection,
    SpielberichteCollection,
    SpielbestaetigungenCollection,
    TeamsCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.logging import fl_logger
from app.core.recording import build_redaction_filter, build_redaction_update, log_stamp
from app.core.security import bind_system_actor, verify_access_system
from app.core.transactions import Batch, drain, log_passed, refuse_a_stalled_page, run_isolated, transaction_session
from app.shared.schemas.bounds import LIST_LIMIT_MAX
from app.shared.schemas.literals import FLKontaktRolle

# System tier and the system actor: the sweep holds no session, so `bind_actor` would refuse it,
# and an invented administrator for a machine is what `SYSTEM_ACTOR` exists to avoid.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/bewerbungen/sweep",
    dependencies=[Depends(verify_access_system), Depends(bind_system_actor)],
)

# Both shares at three commands a row beside the worst call's other 83
# (`tests/api/test_bewerbung_sweep_refusal.py :: test_a_full_share_finishes_inside_the_deadline_at_the_round_trip_its_comment_names`):
# 266 commands at 36 ms plus 1.38 ms take 9.94 s of `app/core/middlewares.py :: REQUEST_DEADLINE_S`, a command short.
REMINDERS_PER_PASS: Final = 39

# The largest share inside the deadline beside the reminders', which owe a deadline a block's deletion does not: 23
# would make 269 commands, 10.06 s. A season at capacity takes more passes.
BLOCKS_CLEARED_PER_PASS: Final = 22


async def _redact(
    *, aktionen_collection: AktionenCollection, collection: Collection, ids: Sequence[Any], stamp: str, session: AsyncClientSession
) -> int:
    """Every log row naming the removed documents, emptied and stamped -- the erasure's second half."""

    if not ids:
        return 0

    redacted = await patch_many_in_db(
        collection=aktionen_collection,
        db_filter=build_redaction_filter([(collection, list(ids))]),
        update=build_redaction_update(at=stamp),
        session=session,
    )

    return redacted.modified_count


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


@router.get("", response_model=FLBewerbungSweepSaisonsResponse, summary="Every season the sweep has to visit")
async def get_sweep_saisons(saisons_collection: SaisonsCollection) -> FLBewerbungSweepSaisonsResponse:
    """
    Answer every season's id, oldest first, so the caller runs the clocks one season at a time, and the day each pass last ran.

    System tier rather than the base one: a season taking applications is `future`, which the base tier is never served,
    and the two clocks that matter run over exactly those seasons.

    Null against this database means no pass has ever run, never that the last one found nothing to do: a pass that reminds
    nobody and deletes nothing records the day exactly as a busy one does. Reading it writes nothing.
    """

    seasons = await pull_many_from_db(
        collection=saisons_collection,
        db_filter={},
        projection=["_id", "sweep_gelaufen_am", "registrierung_sweep_gelaufen_am"],
        sort_by=[("_id", 1)],
        limit=LIST_LIMIT_MAX,
    )

    # The newest day any season carries rather than one season's: a season created since the last
    # pass carries none, and reading that one would answer `never` for a sweep that ran yesterday.
    def newest(field: str) -> str | None:
        return max((str(season[field]) for season in seasons if season.get(field)), default=None)

    return FLBewerbungSweepSaisonsResponse(
        saison_ids=[str(season["_id"]) for season in seasons],
        sweep_gelaufen_am=newest("sweep_gelaufen_am"),
        # Answered beside the application's from the same read: the two passes stop separately, and
        # an operator holding one date cannot tell which of them did.
        registrierung_sweep_gelaufen_am=newest("registrierung_sweep_gelaufen_am"),
    )


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
    aktionen_collection: AktionenCollection,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    spielberichte_collection: SpielberichteCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLBewerbungSweepResponse:
    """
    Run the six retention clocks over one season, as of today in Europe/Berlin, and answer what the caller must mail.

    The reminder clock stamps `erinnert_am` and mints a fresh link per seat BEFORE answering, so a failed mail costs one
    person one reminder and never a repeat; the first link stays valid beside the fresh one. A seat whose last message the
    mail provider refused is not chased at all, its one reminder buying nothing. A seat whose address the ban list holds is
    sent nothing and has nothing written: it stays due, so every pass asks the ban list for it again until its deadline, and
    reminds it once a lift comes first; each pass logs how many mailboxes it withheld, never which. The fourteen-day clock only
    LISTS its candidates here, each saying whether its notice has already gone out -- the caller mails the rest, stamps the
    delivered ones through `/angekuendigt` and erases every announced one through `/loeschen`. An application whose
    Ansprechperson the provider refuses is listed by neither: it is held past its deadline for an administrator to
    correct the address, because erasing it would destroy a school's application with nobody told. That hold ends with the
    season: once the season applied for is `past`, every application still awaiting a decision is erased here, whatever its
    seats answered and whether or not its notice could be delivered, because no decision can be taken for a season that is
    over. That clock runs before the two above it, so an application it takes is neither chased nor listed for a notice. The
    declined, accepted and contact-block clocks erase and redact in this call. Every removal names this season alone.

    One call reminds, lists and clears contact blocks for a bounded share of what is due, the first two earliest deadline
    first; the rest stay due and the calls after it take them. The reminders are committed by the call's LAST transactions, so no later step
    of the same call can answer an error in their place; where the request's deadline cuts them after one has committed, the call
    answers what committed and warns once.

    An application or a season row whose write fails, the database refusing it or anything else, or one the answer cannot carry,
    is passed over alone and logged by id: the rest of its clock's page or share goes, and it stays due, so the next pass meets it
    again and one failing record holds back no clock and nobody behind it. `fehlgeschlagen` sums the rows each of the six clocks
    passed over: a day stamped beside a sum that is not zero is a clock passing rows over, not one that ran clean.

    404 where no season has the id. Idempotent per day once every share has been taken: a run after that writes nothing,
    though it logs the count of withheld seats again.

    The accepted clock and the contact block run once a later season has ended while this one is not `active`, the moment the
    season-after rule stops keeping this season's pupils: a running season keeps both, and a later season planned and never run
    holds neither back. A season whose id is not a four-digit year fails the whole pass rather than running the four clocks
    that need no later season, because a pass that skipped those two quietly would leave both stopped for ever with nothing
    anywhere saying so. From that moment every pass also strips, on the rows and in their log images, the season's fixture
    confirmation rows of every seat's link entry, each reason and a contact's holder digest, and its match
    reports of their remarks and every card's reason; the answers' way, day and role and the reports' scorers, cards and
    result stay as the record. Each strip is its own transaction after the blocks' share: one that fails is
    logged under the season's id and counted in `fehlgeschlagen`, and the blocks clear all the same.

    One thing here reaches past this season: the day is stamped on every season not already carrying it, and `GET /bewerbungen/sweep`
    answers it. So a day's first call records the day and the rest of that day's calls record nothing.
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
    # Outside the reminder's transaction, whose callback may run again, as the correction reads it
    # (`app/api/sperrliste/crud.py :: address_is_gesperrt`).
    massgebliche_saison_id = await sperrliste_saison(sperrliste)

    async def stamp_the_run(session: AsyncClientSession) -> None:
        """One fan-out over every season today has not reached, inside the pass's LAST transaction, so a stamped day is a committed call."""

        await patch_many_in_db(
            collection=saisons_collection,
            # Every season today has not reached, so the hourly pass writes, and logs, the first of the day alone.
            db_filter={"sweep_gelaufen_am": {"$ne": today}},
            # The whole PASS's day, on every stale season at once: it says when the sweep last ran
            # and never when this season was visited.
            update={"$set": {"sweep_gelaufen_am": today}},
            session=session,
        )

    async def erase_the_undecided(session: AsyncClientSession, batch: Batch) -> tuple[int, int, int]:
        """The season's own end: erase, then redact the rows that still hold the people. Read in-session, so a retry re-judges."""

        rows = await batch.saw(
            pull_many_from_db(
                collection=bewerbungen_collection,
                db_filter=batch.within({"saison_id": saison_id, "status": "eingereicht"}),
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
                for row, due in batch.judged(rows, lambda row: undecided_erasure_is_due(bewerbung_raw=row, saison_status=saison_status))
                if due
            ]
        )
        if not taken:
            return len(rows), 0, 0

        ids = [row["_id"] for row in taken]
        result = await erase_many_from_db(
            collection=bewerbungen_collection, db_filter={"saison_id": saison_id, "_id": {"$in": ids}}, session=session
        )
        redacted = await _redact(
            aktionen_collection=aktionen_collection, collection=Collection.BEWERBUNGEN, ids=ids, stamp=stamp, session=session
        )

        return len(rows), result.deleted_count, redacted

    async def remind(session: AsyncClientSession, batch: Batch) -> list[FLBewerbungSweepErinnerung]:
        """Stamp, mint, stamp the run, then hand back, as the pass's last transaction. Read in-session, so a retry re-judges.

        Counts on the batch how many mailboxes on the page a ban kept from their reminder, for the log line.
        """

        rows = await batch.saw(
            pull_many_from_db(
                collection=bewerbungen_collection,
                db_filter=batch.within(build_erinnerung_filter(saison_id=saison_id, today=today)),
                limit=SWEEP_PAGE + 1,
                # Earliest deadline first, so the application the fourteen-day clock takes soonest is
                # chased first; `_id` makes the page the same page whichever plan the server picks.
                sort_by=[("bestaetigungsfrist", ASCENDING), ("_id", ASCENDING)],
                session=session,
            )
        )

        def mailboxes_of(row: Mapping[str, Any]) -> list[tuple[str, list[list[FLKontaktRolle]]]]:
            kontakte, bestaetigungen = row.get("kontakte"), row.get("bestaetigungen")

            return [
                (email, reminder_link_groups(kontakte=kontakte, bestaetigungen=bestaetigungen, seats=held))
                for email, held in group_seats_by_mailbox(kontakte=kontakte, seats=reminder_seats(bewerbung_raw=row, today=today))
            ]

        per_row = [(row, mailboxes) for row, mailboxes in batch.judged(rows, mailboxes_of) if mailboxes]
        # Asked over the whole page before the share is cut: nothing of a ban is stored, so a barred row
        # stays due, and a share cut first would fill with the same barred rows on every pass.
        gesperrt = await adressen_gesperrt(
            sperrliste,
            [email for _, mailboxes in per_row for email, _ in mailboxes],
            massgebliche_saison_id=massgebliche_saison_id,
            session=session,
        )
        batch.withheld = sum(1 for _, mailboxes in per_row for email, _ in mailboxes if email in gesperrt)
        reachable = {row["_id"]: [(email, gruppen) for email, gruppen in mailboxes if email not in gesperrt] for row, mailboxes in per_row}
        chased = [row for row, _ in per_row if reachable[row["_id"]]]
        # One read for the page: a mail names the school, and the row holds only its id.
        club_names = await pull_team_names(teams_collection=teams_collection, team_ids=[row.get("team_id") for row in chased], session=session)

        def reminder_of(row: Mapping[str, Any]) -> tuple[list[FLBewerbungSweepErinnerung], dict[str, str]]:
            per_mailbox = reachable[row["_id"]]
            gruppen_alle = [gruppe for _, gruppen in per_mailbox for gruppe in gruppen]
            # Minted per LINK rather than per seat: a token for a seat riding another's link is a
            # credential nobody is sent, live on the wire and in the document until the deadline.
            minted = {gruppe[0]: mint_token() for gruppe in gruppen_alle}
            erinnerungen = [
                FLBewerbungSweepErinnerung(
                    bewerbung_id=row["_id"],
                    saison_id=saison_id,
                    schule=schule_name(bewerbung_raw=row, club_names=club_names),
                    bestaetigungsfrist=str(row["bestaetigungsfrist"]),
                    email=email,
                    seats=[
                        FLBewerbungSweepSeat(
                            rollen=list(gruppe),
                            vorname=vorname_of(kontakte=row.get("kontakte"), seat=gruppe[0]) or "",
                            token=minted[gruppe[0]][0],
                        )
                        for gruppe in gruppen
                    ],
                )
                for email, gruppen in per_mailbox
            ]

            return erinnerungen, {seat: minted[gruppe[0]][1] for gruppe in gruppen_alle for seat in gruppe}

        # Answers built before any stamp, the share cut from the rows they carry: a refused row writes nothing
        # and costs no second attempt, and the rows past the share stay due.
        taken = batch.judged(chased, reminder_of)[: batch.share]
        batch.took([row for row, _ in taken])
        refuse_a_stalled_page(read=len(rows), moved=len(taken), page=SWEEP_PAGE, clock="reminder", saison_id=saison_id)

        for row, (_, hashes) in taken:
            # The stamp lands before the caller can mail: a crash between the two costs one reminder,
            # where the other order would repeat it every day until the address works.
            await patch_one_in_db(
                collection=bewerbungen_collection,
                db_filter={"_id": row["_id"]},
                update=compose_erinnerung_update(hashes=hashes, bestaetigungen=row.get("bestaetigungen"), today=today),
                session=session,
                return_document=ReturnDocument.BEFORE,
            )

        await stamp_the_run(session)

        return [erinnerung for _, (erinnerungen, _) in taken for erinnerung in erinnerungen]

    async def erase_declined(session: AsyncClientSession, batch: Batch) -> tuple[int, int, int]:
        """The one-month clock: erase, then redact the rows that still hold the people. Read in-session, so a retry re-judges."""

        rows = await batch.saw(
            pull_many_from_db(
                collection=bewerbungen_collection,
                # Narrowed to the decisions whose month is behind them: a page of fresh ones would fill the
                # read ahead of a due one, and the stall would refuse the pass.
                db_filter=batch.within(
                    {"saison_id": saison_id, "status": "abgelehnt", "entscheidung.getroffen_am": {"$lte": latest_decision_due(today=today)}}
                ),
                projection=["status", "entscheidung"],
                limit=SWEEP_PAGE + 1,
                session=session,
            )
        )
        # Judged row by row: a decision date a hand edit left unreadable is passed over in place, and the rest of the page goes.
        taken = batch.took([row for row, due in batch.judged(rows, lambda row: decline_erasure_is_due(bewerbung_raw=row, today=today)) if due])
        if not taken:
            refuse_a_stalled_page(read=len(rows), moved=len(batch.refused), page=SWEEP_PAGE, clock="decline", saison_id=saison_id)
            return len(rows), 0, 0

        ids = [row["_id"] for row in taken]
        # The filter names the season and the ids and nothing else: it is stored as text, and any
        # other key would preserve what this call destroys.
        result = await erase_many_from_db(
            collection=bewerbungen_collection, db_filter={"saison_id": saison_id, "_id": {"$in": ids}}, session=session
        )
        redacted = await _redact(
            aktionen_collection=aktionen_collection, collection=Collection.BEWERBUNGEN, ids=ids, stamp=stamp, session=session
        )

        return len(rows), result.deleted_count, redacted

    async def erase_accepted(session: AsyncClientSession, batch: Batch) -> tuple[int, int, int]:
        """The season-and-one clock's first half. Read in-session, the season with it, so a retry re-judges."""

        rows = await batch.saw(
            pull_many_from_db(
                collection=bewerbungen_collection,
                db_filter=batch.within({"saison_id": saison_id, "status": "angenommen"}),
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
            return 0, 0, 0

        ids = [row["_id"] for row in taken]
        result = await erase_many_from_db(
            collection=bewerbungen_collection, db_filter={"saison_id": saison_id, "_id": {"$in": ids}}, session=session
        )
        redacted = await _redact(
            aktionen_collection=aktionen_collection, collection=Collection.BEWERBUNGEN, ids=ids, stamp=stamp, session=session
        )

        return len(rows), result.deleted_count, redacted

    async def clear_the_blocks(session: AsyncClientSession, batch: Batch) -> tuple[int, int]:
        """The season-and-one clock's second half, a share a pass. Read in-session, the season with it, so a retry re-judges."""

        junction_rows = await batch.saw(
            pull_many_from_db(
                collection=saison_teams_collection,
                # Either block standing, not `kontakte` alone, so no row's links, and their delivery records,
                # outlive its people whichever write cleared them.
                db_filter=batch.within({"saison_id": saison_id, "$or": [{"kontakte": {"$ne": None}}, {"bestaetigungen": {"$ne": None}}]}),
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
                update={"$set": {"kontakte": None, "bestaetigungen": None}},
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

    # Every transaction before the LAST, which is the reminder's: what that one hands back is owed a
    # message, and a failure after it would answer this request with an error instead.
    ohne_entscheidung, redacted_undecided, fehlgeschlagen = 0, 0, 0
    # AHEAD of the reminder and of the list below, which read the collection after it: a season that
    # has ended leaves nobody to chase, and a notice about an application this pass erased is a
    # notice about nothing.
    if season_has_ended(saison_status=saison_status):
        ohne_entscheidung, redacted_undecided, passed = await drain(
            db=db,
            page_of=lambda session, batch: session.with_transaction(erase_the_undecided, batch),
            page=SWEEP_PAGE,
            what="Application",
            clock="season's end",
        )
        fehlgeschlagen += len(passed)

    abgelehnte, redacted_declined, passed = await drain(
        db=db,
        page_of=lambda session, batch: session.with_transaction(erase_declined, batch),
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
            page_of=lambda session, batch: session.with_transaction(erase_accepted, batch),
            page=SWEEP_PAGE,
            what="Application",
            clock="acceptance",
        )
        fehlgeschlagen += len(passed)

        cleared, passed = await run_isolated(
            db=db,
            batch=Batch(share=BLOCKS_CLEARED_PER_PASS),
            attempt=lambda session, batch: session.with_transaction(clear_the_blocks, batch),
            moved=lambda blocks: blocks[0],
            owes=False,
            what="Season team",
            clock="contact block",
        )
        fehlgeschlagen += len(passed)

        # Each strip answers the log rows it redacted, which `redigierte_aktionen` counts with every other clock's.
        stripped_confirmations, passed = await run_isolated(
            db=db,
            batch=Batch(),
            attempt=lambda session, batch: session.with_transaction(strip_the_confirmations, batch),
            moved=lambda _: 0,
            owes=False,
            what="Season",
            clock="confirmation strip",
        )
        fehlgeschlagen += len(passed)

        stripped_reports, passed = await run_isolated(
            db=db,
            batch=Batch(),
            attempt=lambda session, batch: session.with_transaction(strip_the_reports, batch),
            moved=lambda _: 0,
            owes=False,
            what="Season",
            clock="report strip",
        )
        fehlgeschlagen += len(passed)
        geleert = sum(blocks for blocks, _ in cleared)
        redacted_accepted += sum(redacted for _, redacted in cleared) + sum(stripped_confirmations) + sum(stripped_reports)

    # Reads alone: the notice goes out first, and the erasure is the caller's second call.
    candidates = await pull_many_from_db(
        collection=bewerbungen_collection,
        db_filter=build_deletion_filter(saison_id=saison_id, today=today),
        limit=SWEEP_PAGE + 1,
        sort_by=[("bestaetigungsfrist", ASCENDING), ("_id", ASCENDING)],
    )
    # A share, because the caller stamps every one it mails through `/angekuendigt` in ONE
    # transaction; the rest stay due and the passes after this one list them.
    due = [row for row in candidates if deletion_is_due(bewerbung_raw=row, today=today)][:DELETIONS_LISTED_PER_PASS]
    refuse_a_stalled_page(read=len(candidates), moved=len(due), page=SWEEP_PAGE, clock="deletion", saison_id=saison_id)
    # No session, as the candidates' read has none: this list writes nothing, and `/angekuendigt` and
    # `/loeschen` re-judge every id it names in their own transactions.
    club_names = await pull_team_names(teams_collection=teams_collection, team_ids=[row.get("team_id") for row in due])
    loeschungen: list[FLBewerbungSweepLoeschung] = []
    for row in due:
        # The mailbox and every seat it holds, from the helper the confirm router addresses its own
        # message with: one person on two seats reads one phrase naming both, in both messages.
        empfaenger, rollen = ansprechperson_mailbox(kontakte=row.get("kontakte"))
        # Each row apart, so one that raises, a deadline the answer's model refuses say, is passed over
        # rather than failing every clock of the call.
        try:
            loeschung = FLBewerbungSweepLoeschung(
                bewerbung_id=row["_id"],
                saison_id=saison_id,
                schule=schule_name(bewerbung_raw=row, club_names=club_names),
                bestaetigungsfrist=str(row["bestaetigungsfrist"]),
                ansprechperson_email=empfaenger,
                ansprechperson_rollen=rollen,
                ausstehend=[
                    FLBewerbungSweepAusstehend(rolle=seat, vorname=vorname_of(kontakte=row.get("kontakte"), seat=seat))
                    for seat in ausstehende_seats(kontakte=row.get("kontakte"))
                ],
                angekuendigt=deletion_was_announced(bewerbung_raw=row),
            )
        except Exception as failure:
            log_passed(what="Application", row_id=row["_id"], clock="deletion", failure=failure)
            fehlgeschlagen += 1
            continue
        loeschungen.append(loeschung)

    share = Batch(share=REMINDERS_PER_PASS)
    reminded, passed = await run_isolated(
        db=db,
        batch=share,
        attempt=lambda session, batch: session.with_transaction(remind, batch),
        moved=lambda answered: len({erinnerung.bewerbung_id for erinnerung in answered}),
        owes=True,
        what="Application",
        clock="reminder",
    )
    fehlgeschlagen += len(passed)
    # Every half that committed stamped the day; where none did, nothing is owed and it is stamped alone.
    if not reminded:
        async with transaction_session(db) as session:
            await session.with_transaction(stamp_the_run)

    erinnerungen = [erinnerung for answered in reminded for erinnerung in answered]

    # After the commit, so a retried transaction writes no second line. A count and never an id: a
    # line naming the application would tie it to the ban for as long as the log is kept.
    if share.withheld:
        fl_logger.info("bewerbungen.reminders_withheld", extra={"saison_id": saison_id, "mailboxes": share.withheld})

    return FLBewerbungSweepResponse(
        saison_id=saison_id,
        erinnerungen=erinnerungen,
        loeschungen=loeschungen,
        abgelehnte_geloescht=abgelehnte,
        angenommene_geloescht=angenommene,
        ohne_entscheidung_geloescht=ohne_entscheidung,
        kontaktbloecke_geleert=geleert,
        redigierte_aktionen=redacted_declined + redacted_accepted + redacted_undecided,
        fehlgeschlagen=fehlgeschlagen,
    )


@router.post(
    "/{saison_id}/angekuendigt",
    response_model=FLBewerbungSweepAngekuendigtResponse,
    summary="Stamp the candidates whose notice was delivered",
)
async def angekuendigt_bewerbungen(
    saison_id: str,
    angekuendigt_data: Annotated[FLBewerbungSweepAngekuendigtPayload, Body()],
    bewerbungen_collection: BewerbungenCollection,
    saisons_collection: SaisonsCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLBewerbungSweepAngekuendigtResponse:
    """
    Record that the deletion notice reached the applications named, so an erasure that fails afterwards mails nobody twice.

    An id whose stamp fails, the database refusing it or anything else, is passed over alone, logged by id, left unstamped and
    counted in `fehlgeschlagen`. Every later pass then lists it as unannounced, so a caller mailing those mails its notice again,
    and `/loeschen` skips it: until a stamp lands it stands until its season is `past`.

    The ids are re-judged in-session: only one still submitted, past its deadline and with a seat outstanding is stamped, and one
    already carrying a stamp keeps the day it has. An id whose Ansprechperson the mail provider refused between the pass and this
    call is skipped, so a notice the provider never carried is not recorded as delivered. 404 where no season has the id. An empty
    list answers zero.
    """

    await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["_id"])

    async def stamp_the_notified(session: AsyncClientSession, batch: Batch) -> int:
        """Judge and stamp in one transaction. Everything judged is read in-session, so a retry re-judges it."""

        rows = await batch.saw(
            pull_many_from_db(
                collection=bewerbungen_collection,
                db_filter=batch.within(
                    {"saison_id": saison_id, "_id": {"$in": list(angekuendigt_data.bewerbung_ids)}, "status": "eingereicht"}
                ),
                limit=LIST_LIMIT_MAX,
                session=session,
            )
        )

        taken = batch.took(
            [
                row
                for row, unstamped in batch.judged(
                    rows, lambda row: deletion_is_due(bewerbung_raw=row, today=today) and not deletion_was_announced(bewerbung_raw=row)
                )
                if unstamped
            ]
        )
        for row in taken:
            # `patch_one_in_db` per row and never `patch_many_in_db`, which records no `document_id`:
            # the erasure that follows names these ids, and its log rows have to be findable by them.
            await patch_one_in_db(
                collection=bewerbungen_collection,
                db_filter={"_id": row["_id"]},
                update=compose_ankuendigung_update(today=today),
                session=session,
                return_document=ReturnDocument.BEFORE,
            )

        return len(taken)

    stamped, passed = await run_isolated(
        db=db,
        batch=Batch(),
        attempt=lambda session, batch: session.with_transaction(stamp_the_notified, batch),
        moved=lambda count: count,
        owes=False,
        what="Application",
        clock="announcement",
    )

    return FLBewerbungSweepAngekuendigtResponse(saison_id=saison_id, angekuendigt=sum(stamped), fehlgeschlagen=len(passed))


@router.post(
    "/{saison_id}/loeschen",
    response_model=FLBewerbungSweepLoeschenResponse,
    summary="Erase the notified deletion candidates",
)
async def loeschen_bewerbungen(
    saison_id: str,
    loeschen_data: Annotated[FLBewerbungSweepLoeschenPayload, Body()],
    bewerbungen_collection: BewerbungenCollection,
    saisons_collection: SaisonsCollection,
    aktionen_collection: AktionenCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLBewerbungSweepLoeschenResponse:
    """
    Erase the applications whose deletion notice went out, and redact every log row naming them.

    The ids are re-judged in-session: only one still submitted, past its deadline, with a seat outstanding, whose announcement the
    mail provider will still carry AND carrying the announcement stamp is erased, so an application confirmed and accepted between
    the calls survives, one whose notice bounced after it was stamped is held rather than destroyed, and an id from another
    season or one nobody was told about is skipped rather than refused. 404 where no season has the id. An empty list answers zeros.

    An id whose erasure fails, the database refusing it or anything else, is passed over alone, logged by id, left standing and
    counted in `fehlgeschlagen`.
    """

    await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["_id"])

    async def erase_the_notified(session: AsyncClientSession, batch: Batch) -> tuple[int, int]:
        """Judge, erase, redact, in one transaction. Everything judged is read in-session, so a retry re-judges it."""

        rows = await batch.saw(
            pull_many_from_db(
                collection=bewerbungen_collection,
                db_filter=batch.within({"saison_id": saison_id, "_id": {"$in": list(loeschen_data.bewerbung_ids)}, "status": "eingereicht"}),
                limit=LIST_LIMIT_MAX,
                session=session,
            )
        )
        # Announced as well as due: an unannounced id here is a caller that skipped the stamp, and
        # erasing it would destroy an application whose people were never told.
        taken = batch.took(
            [
                row
                for row, announced in batch.judged(
                    rows, lambda row: deletion_is_due(bewerbung_raw=row, today=today) and deletion_was_announced(bewerbung_raw=row)
                )
                if announced
            ]
        )
        if not taken:
            return 0, 0

        ids = [row["_id"] for row in taken]

        result = await erase_many_from_db(
            collection=bewerbungen_collection, db_filter={"saison_id": saison_id, "_id": {"$in": ids}}, session=session
        )
        redacted = await _redact(
            aktionen_collection=aktionen_collection, collection=Collection.BEWERBUNGEN, ids=ids, stamp=log_stamp(germany_now), session=session
        )

        return result.deleted_count, redacted

    erased, passed = await run_isolated(
        db=db,
        batch=Batch(),
        attempt=lambda session, batch: session.with_transaction(erase_the_notified, batch),
        moved=lambda counts: counts[0],
        owes=False,
        what="Application",
        clock="fourteen-day",
    )

    return FLBewerbungSweepLoeschenResponse(
        saison_id=saison_id,
        geloescht=sum(geloescht for geloescht, _ in erased),
        redigierte_aktionen=sum(redigiert for _, redigiert in erased),
        fehlgeschlagen=len(passed),
    )
