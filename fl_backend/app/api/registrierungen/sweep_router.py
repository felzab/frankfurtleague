from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any, Final

from fastapi import APIRouter, Depends
from pymongo import ASCENDING, ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.bewerbungen.services import mint_token, season_has_ended
from app.api.registrierungen.schemas import FLRegistrierungSweepBenachrichtigung, FLRegistrierungSweepErinnerung, FLRegistrierungSweepResponse
from app.api.registrierungen.services import (
    SWEEP_PAGE,
    bestaetigung_erasure_is_due,
    build_decline_filter,
    build_erinnerung_filter,
    build_stale_stamp_filter,
    build_unconfirmed_filter,
    build_undecided_filter,
    compose_erinnerung_update,
    compose_sweep_stamp,
    decline_erasure_is_due,
    erinnerung_is_due,
    registrierung_ist_bestaetigt,
    undecided_erasure_is_due,
)
from app.api.sperrliste.lookup import SperrlisteLookup, adressen_gesperrt, sperrliste_saison
from app.api.teams.crud import pull_team_names
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import erase_many_from_db, patch_many_in_db, patch_one_in_db, pull_many_from_db, pull_one_from_db
from app.core.dependencies import (
    AktionenCollection,
    DBClient,
    RegistrierungenCollection,
    SaisonsCollection,
    TeamsCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.logging import fl_logger
from app.core.recording import build_redaction_filter, build_redaction_update, log_stamp
from app.core.security import bind_system_actor, verify_access_system
from app.core.transactions import Batch, drain, refuse_a_stalled_page, run_isolated, transaction_session

# System tier and the system actor, as the application sweep's own router is: this pass holds no
# session, so `bind_actor` would refuse it.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/registrierungen/sweep",
    dependencies=[Depends(verify_access_system), Depends(bind_system_actor)],
)

# What a message names where the team row is gone: a note that reaches its reader is worth more than
# a pass that stops on a club somebody retired.
_TEAM_UNBEKANNT = ""

# Three commands a row beside the eighteen of the worst call erasing one page per clock
# (`tests/api/test_registrierung_sweep_refusal.py :: OTHER_COMMANDS`): 261 commands at a 37 ms round trip
# plus 1.27 ms take 9.99 s of `app/core/middlewares.py :: REQUEST_DEADLINE_S`.
REMINDERS_PER_PASS: Final = 81


async def _redact(*, aktionen_collection: AktionenCollection, ids: Sequence[Any], stamp: str, session: AsyncClientSession) -> int:
    """Every log row naming the erased registrations, emptied and stamped.

    A twin of `app/api/bewerbungen/sweep_router.py :: _redact` with the collection fixed: two slices
    of two instances each fall short of `.claude/CLAUDE.md` §3's three.
    """

    if not ids:
        return 0

    redacted = await patch_many_in_db(
        collection=aktionen_collection,
        db_filter=build_redaction_filter([(Collection.REGISTRIERUNGEN, list(ids))]),
        update=build_redaction_update(at=stamp),
        session=session,
    )

    return redacted.modified_count


@router.post(
    "/{saison_id}",
    response_model=FLRegistrierungSweepResponse,
    summary="Run one season's registration retention clocks",
)
async def sweep_registrierungen(
    saison_id: str,
    registrierungen_collection: RegistrierungenCollection,
    saisons_collection: SaisonsCollection,
    teams_collection: TeamsCollection,
    aktionen_collection: AktionenCollection,
    sperrliste: SperrlisteLookup,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLRegistrierungSweepResponse:
    """
    Run the four registration retention clocks over one season, as of today in Europe/Berlin, and answer what the caller must mail.

    A declined registration is erased a month after the decision. Once the season is `past`, every registration still awaiting a
    decision is erased whatever the pupil answered, because no admission can be taken for a season that is over. The confirmed ones
    among them are listed in `benachrichtigt` and told AFTERWARDS -- one message saying it happened -- while an unconfirmed one is
    told neither before nor after, its address never having been confirmed. A call whose erasure names somebody to tell answers once
    that erasure has committed, so the rest of the season's registrations wait for the next call; the two clocks below do not run
    for a `past` season, whose own end takes every row they read.

    Otherwise an unconfirmed registration strictly past its deadline is erased with no notice at all, the confirmation mail having
    named that day. Then one reminder per registration at its reminder age, earliest deadline first: a fresh link is minted and
    `erinnert_am` stamped BEFORE this answers, so a failed send costs one pupil one reminder and never a repeat, and the link already
    in that inbox stays valid beside the fresh one. One call reminds a bounded share of the registrations due; the rest stay due and
    the calls after it remind them. A registration whose last message the mail provider refused is not chased at all, and one whose
    address the ban list holds is sent nothing and has nothing written: it stays due, so every pass asks the ban list for it again
    until its deadline, and reminds it once a lift comes first; each pass logs how many it withheld, never which. Every removal
    names this season alone, is made inside a transaction and takes its log rows with it.

    Whatever a call answers in `erinnerungen` and `benachrichtigt` was committed by its last transactions, so no later step of the same
    call can answer an error in their place; where the request's deadline cuts them after one has committed, the call answers what
    committed and warns once.

    A registration whose write fails, the database refusing it or anything else, or one the answer cannot carry, is passed over
    alone and logged by id: the rest of its clock's page or share goes, and it stays due, so the next pass meets it again and one
    failing record holds back no clock and nobody behind it. `fehlgeschlagen` sums the rows each of the four clocks passed over: a
    day stamped beside a sum that is not zero is a clock passing rows over, not one that ran clean.

    404 where no season has the id. Idempotent per day once every due reminder and notice has gone out: a run after that writes
    nothing, though it logs the count of withheld registrations again.

    One thing here reaches past this season: the day is stamped on every season not already carrying it, and `GET /bewerbungen/sweep`
    answers it beside the application pass's own day. So a day's first call records the day and the rest of that day's calls record
    nothing.
    """

    # The read that answers the 404 carries the status: this season's own end is a clock, and a
    # second query for a document already in hand would be a second answer to when it ended.
    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status"])
    saison_status = saison_raw.get("status")

    stamp = log_stamp(germany_now)
    # Outside the reminder's transaction, whose callback may run again, as the application sweep reads it.
    massgebliche_saison_id = await sperrliste_saison(sperrliste)

    async def stamp_the_run(session: AsyncClientSession) -> None:
        """One fan-out over every season today has not reached, inside the pass's LAST transaction, so a stamped day is a committed call."""

        await patch_many_in_db(
            collection=saisons_collection,
            db_filter=build_stale_stamp_filter(today=today),
            update=compose_sweep_stamp(today=today),
            session=session,
        )

    async def erase_the_undecided(
        session: AsyncClientSession, batch: Batch
    ) -> tuple[list[FLRegistrierungSweepBenachrichtigung], int, int, bool]:
        """The season's own end: erase, then redact the rows that still hold the people. Read in-session, so a retry re-judges.

        Also answers whether it was the pass's last transaction, or whether another page follows.
        """

        rows = await batch.saw(
            pull_many_from_db(
                collection=registrierungen_collection,
                db_filter=batch.within(build_undecided_filter(saison_id=saison_id)),
                projection=["status", "einwilligung", "vorname", "email", "team_id"],
                # One over the page, as `app/api/saisons/admin_router.py :: undraw_spielplan` reads: a
                # full page is a page that may be truncated, and a clock cannot see what it never read.
                limit=SWEEP_PAGE + 1,
                session=session,
            )
        )
        due = [
            row
            for row, is_due in batch.judged(rows, lambda row: undecided_erasure_is_due(registrierung_raw=row, saison_status=saison_status))
            if is_due
        ]

        # The note goes to the pupils who confirmed and to nobody else: an unconfirmed address is one
        # the league could not reach at all, and the message would go to whoever was mistyped.
        def told(row: Mapping[str, Any]) -> bool:
            return registrierung_ist_bestaetigt(einwilligung=row.get("einwilligung"))

        # One read for the page: a message names the team, and a registration holds only its id.
        team_names = await pull_team_names(
            teams_collection=teams_collection, team_ids=[row.get("team_id") for row in due if told(row)], session=session
        )

        def notiz_of(row: Mapping[str, Any]) -> FLRegistrierungSweepBenachrichtigung | None:
            if not told(row):
                return None

            return FLRegistrierungSweepBenachrichtigung(
                registrierung_id=row["_id"],
                saison_id=saison_id,
                team=team_names.get(row.get("team_id"), _TEAM_UNBEKANNT),
                vorname=str(row.get("vorname") or ""),
                email=str(row.get("email") or ""),
            )

        # Each note built before anything is erased: a pupil the answer cannot carry stays, never erased untold.
        taken = batch.judged(due, notiz_of)
        batch.took([row for row, _ in taken])
        benachrichtigt = [notiz for _, notiz in taken if notiz is not None]
        if not taken:
            # Rows passed over in place move the page: the next one is read without them.
            refuse_a_stalled_page(read=len(rows), moved=len(batch.refused), page=SWEEP_PAGE, clock="season's end", saison_id=saison_id)
            last = len(rows) <= SWEEP_PAGE
            if last:
                await stamp_the_run(session)
            return [], 0, 0, last

        ids = [row["_id"] for row, _ in taken]
        result = await erase_many_from_db(
            collection=registrierungen_collection, db_filter={"saison_id": saison_id, "_id": {"$in": ids}}, session=session
        )
        redacted = await _redact(aktionen_collection=aktionen_collection, ids=ids, stamp=stamp, session=session)

        # A page naming somebody to tell ends the pass: its answer is the only record of who is owed
        # a message, and a later transaction failing would answer the request with an error instead.
        last = len(rows) <= SWEEP_PAGE or bool(benachrichtigt)
        if last:
            await stamp_the_run(session)

        return benachrichtigt, result.deleted_count, redacted, last

    async def erase_the_unconfirmed(session: AsyncClientSession, batch: Batch) -> tuple[int, int, int]:
        """The deadline clock: erase, then redact. Read in-session, so a retry re-judges."""

        rows = await batch.saw(
            pull_many_from_db(
                collection=registrierungen_collection,
                db_filter=batch.within(build_unconfirmed_filter(saison_id=saison_id, today=today)),
                projection=["status", "einwilligung", "bestaetigung"],
                limit=SWEEP_PAGE + 1,
                session=session,
            )
        )
        taken = batch.took(
            [row for row, due in batch.judged(rows, lambda row: bestaetigung_erasure_is_due(registrierung_raw=row, today=today)) if due]
        )
        if not taken:
            # Rows passed over in place move the page: the drain reads the next one without them.
            refuse_a_stalled_page(read=len(rows), moved=len(batch.refused), page=SWEEP_PAGE, clock="deadline", saison_id=saison_id)
            return len(rows), 0, 0

        ids = [row["_id"] for row in taken]
        # The filter names the season and the ids and nothing else: it is stored as text, and any
        # other key would preserve what this call destroys.
        result = await erase_many_from_db(
            collection=registrierungen_collection, db_filter={"saison_id": saison_id, "_id": {"$in": ids}}, session=session
        )
        redacted = await _redact(aktionen_collection=aktionen_collection, ids=ids, stamp=stamp, session=session)

        return len(rows), result.deleted_count, redacted

    async def remind(session: AsyncClientSession, batch: Batch) -> list[FLRegistrierungSweepErinnerung]:
        """Stamp, mint, stamp the run, then hand back, as the pass's last transaction. Read in-session, so a retry re-judges.

        Counts on the batch how many registrations on the page a ban kept from their reminder, for the log line.
        """

        rows = await batch.saw(
            pull_many_from_db(
                collection=registrierungen_collection,
                db_filter=batch.within(build_erinnerung_filter(saison_id=saison_id, today=today)),
                projection=["status", "einwilligung", "bestaetigung", "email", "team_id"],
                limit=SWEEP_PAGE + 1,
                # Earliest deadline first, so the pupil the unconfirmed clock takes soonest is reminded
                # first; `_id` makes the page the same page whichever plan the server picks.
                sort_by=[("bestaetigung.frist", ASCENDING), ("_id", ASCENDING)],
                session=session,
            )
        )
        due = [row for row, is_due in batch.judged(rows, lambda row: erinnerung_is_due(registrierung_raw=row, today=today)) if is_due]
        # Asked over the whole page before the share is cut: nothing of a ban is stored, so a barred row
        # stays due, and a share cut first would fill with the same barred rows on every pass.
        gesperrt = await adressen_gesperrt(
            sperrliste, [str(row["email"]) for row in due if row.get("email")], massgebliche_saison_id=massgebliche_saison_id, session=session
        )
        reachable = [row for row in due if not (row.get("email") and str(row["email"]) in gesperrt)]
        batch.withheld = len(due) - len(reachable)
        team_names = await pull_team_names(
            teams_collection=teams_collection, team_ids=[row.get("team_id") for row in reachable], session=session
        )

        def erinnerung_of(row: Mapping[str, Any]) -> tuple[FLRegistrierungSweepErinnerung, str]:
            raw, token_hash = mint_token()
            erinnerung = FLRegistrierungSweepErinnerung(
                registrierung_id=row["_id"],
                saison_id=saison_id,
                team=team_names.get(row.get("team_id"), _TEAM_UNBEKANNT),
                email=str(row.get("email") or ""),
                token=raw,
            )
            return erinnerung, token_hash

        # Answers built before any stamp, the share cut from the rows they carry: a refused row writes nothing
        # and costs no second attempt, and the rows past the share stay due.
        taken = batch.judged(reachable, erinnerung_of)[: batch.share]
        batch.took([row for row, _ in taken])
        refuse_a_stalled_page(read=len(rows), moved=len(taken), page=SWEEP_PAGE, clock="reminder", saison_id=saison_id)

        for row, (_, token_hash) in taken:
            # The stamp lands before the caller can mail: a crash between the two costs one reminder,
            # where the other order would repeat it every day until the address worked.
            await patch_one_in_db(
                collection=registrierungen_collection,
                db_filter={"_id": row["_id"]},
                update=compose_erinnerung_update(token_hash=token_hash, bestaetigung=row.get("bestaetigung"), today=today),
                session=session,
                return_document=ReturnDocument.BEFORE,
            )

        await stamp_the_run(session)

        return [erinnerung for _, (erinnerung, _) in taken]

    async def erase_declined(session: AsyncClientSession, batch: Batch) -> tuple[int, int, int]:
        """The one-month clock: erase, then redact. Read in-session, so a retry re-judges."""

        rows = await batch.saw(
            pull_many_from_db(
                collection=registrierungen_collection,
                db_filter=batch.within(build_decline_filter(saison_id=saison_id, today=today)),
                projection=["status", "entscheidung"],
                limit=SWEEP_PAGE + 1,
                session=session,
            )
        )
        # Judged row by row: a decision date a hand edit left unreadable is passed over in place, and the rest of the page goes.
        taken = batch.took(
            [row for row, due in batch.judged(rows, lambda row: decline_erasure_is_due(registrierung_raw=row, today=today)) if due]
        )
        if not taken:
            refuse_a_stalled_page(read=len(rows), moved=len(batch.refused), page=SWEEP_PAGE, clock="decline", saison_id=saison_id)
            return len(rows), 0, 0

        ids = [row["_id"] for row in taken]
        result = await erase_many_from_db(
            collection=registrierungen_collection, db_filter={"saison_id": saison_id, "_id": {"$in": ids}}, session=session
        )
        redacted = await _redact(aktionen_collection=aktionen_collection, ids=ids, stamp=stamp, session=session)

        return len(rows), result.deleted_count, redacted

    # FIRST, and every other drain before the pass's last transaction: what that transaction hands
    # back is owed a message, and a failure after it would answer this request with an error instead.
    abgelehnte, redacted_declined, passed = await drain(
        db=db,
        page_of=lambda session, batch: session.with_transaction(erase_declined, batch),
        page=SWEEP_PAGE,
        what="Registration",
        clock="decline",
    )
    fehlgeschlagen = len(passed)

    benachrichtigt: list[FLRegistrierungSweepBenachrichtigung] = []
    erinnerungen: list[FLRegistrierungSweepErinnerung] = []
    ohne_entscheidung, redacted_undecided = 0, 0
    unbestaetigt, redacted_unconfirmed = 0, 0
    # The season's end takes every row the two clocks in the other arm read, so a link minted
    # for one of them would be a credential nobody can spend.
    if season_has_ended(saison_status=saison_status):
        passed_at_the_end: list[Any] = []
        # Its own loop rather than `app/core/transactions.py :: drain`, which stops only at a short
        # page: this clock also stops at the first page owing somebody a message.
        while True:
            # Accepted: this commit going unanswered erases a page and loses whom it owed a
            # message.
            pages, passed = await run_isolated(
                db=db,
                # Without the rows passed over, as `drain` reads its pages.
                batch=Batch(passed=passed_at_the_end),
                attempt=lambda session, batch: session.with_transaction(erase_the_undecided, batch),
                moved=lambda page: page[1],
                owes=True,
                what="Registration",
                clock="season's end",
            )
            passed_at_the_end.extend(passed)
            for notizen, erased, redacted, _ in pages:
                benachrichtigt.extend(notizen)
                ohne_entscheidung += erased
                redacted_undecided += redacted
            # Every half of a page taken apart reads under the page and so ends the call, having
            # stamped the day; where none committed, nothing is owed and the day is stamped alone.
            if not pages:
                async with transaction_session(db) as session:
                    await session.with_transaction(stamp_the_run)
            if all(last for *_, last in pages):
                break
        fehlgeschlagen += len(passed_at_the_end)
    else:
        unbestaetigt, redacted_unconfirmed, passed = await drain(
            db=db,
            page_of=lambda session, batch: session.with_transaction(erase_the_unconfirmed, batch),
            page=SWEEP_PAGE,
            what="Registration",
            clock="deadline",
        )
        fehlgeschlagen += len(passed)

        share = Batch(share=REMINDERS_PER_PASS)
        reminded, passed = await run_isolated(
            db=db,
            batch=share,
            attempt=lambda session, batch: session.with_transaction(remind, batch),
            moved=len,
            owes=True,
            what="Registration",
            clock="reminder",
        )
        fehlgeschlagen += len(passed)
        # Every half that committed stamped the day; where none did, nothing is owed and it is stamped alone.
        if not reminded:
            async with transaction_session(db) as session:
                await session.with_transaction(stamp_the_run)
        erinnerungen = [erinnerung for answered in reminded for erinnerung in answered]

        # After the commit, so a retried transaction writes no second line. A count and never an id:
        # a line naming the registration would tie it to the ban for as long as the log is kept.
        if share.withheld:
            fl_logger.info(f"Reminders withheld from barred addresses in season {saison_id}: {share.withheld} registration(s)")

    return FLRegistrierungSweepResponse(
        saison_id=saison_id,
        erinnerungen=erinnerungen,
        benachrichtigt=benachrichtigt,
        geloescht_unbestaetigt=unbestaetigt,
        geloescht_ohne_entscheidung=ohne_entscheidung,
        geloescht_abgelehnt=abgelehnte,
        redigierte_aktionen=redacted_undecided + redacted_unconfirmed + redacted_declined,
        fehlgeschlagen=fehlgeschlagen,
    )
