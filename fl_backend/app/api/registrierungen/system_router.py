from datetime import datetime
from typing import Final

from fastapi import APIRouter, Depends
from pymongo import ASCENDING, ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.bewerbungen.services import season_has_ended
from app.api.postausgang.schemas import FLPostausgangBezug, FLRegistrierungLinkDaten
from app.api.postausgang.services import enqueue_mail
from app.api.registrierungen.schemas import FLRegistrierungSweepResponse
from app.api.registrierungen.services import (
    REGISTRIERUNG_LINK,
    SWEEP_PAGE,
    bestaetigung_loeschung_is_due,
    build_decline_filter,
    build_erinnerung_filter,
    build_unconfirmed_filter,
    build_undecided_filter,
    compose_erinnerung_update,
    decline_loeschung_is_due,
    erinnerung_is_due,
    undecided_loeschung_is_due,
)
from app.api.teams.crud import pull_team_names
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import loeschen_many_from_db, patch_one_in_db, pull_many_from_db, pull_one_from_db, redact_log_rows_in_db
from app.core.dependencies import (
    AktionenCollection,
    DBClient,
    PostausgangCollection,
    RegistrierungenCollection,
    SaisonsCollection,
    TeamsCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.recording import log_stamp
from app.core.security import bind_system_actor, verify_access_system
from app.core.transactions import Batch, drain, refuse_a_stalled_page, run_isolated
from app.shared.schemas.bounds import REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE

# System tier and the system actor, as the application sweep's own router is: this pass holds no
# session, so `bind_actor` would refuse it.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/registrierungen/sweep",
    dependencies=[Depends(verify_access_system), Depends(bind_system_actor)],
)

_TEAM_UNBEKANNT = ""

# Five commands a row (the stamp, its read-back and its log row, the Postausgang's key lookup and its insert) beside the
# fourteen of the worst call erasing one page per clock: 259 commands at a 37 ms round trip plus 1.27 ms take 9.91 s of
# `app/core/middlewares.py :: REQUEST_DEADLINE_S`.
REMINDERS_PER_PASS: Final = 49


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
    postausgang_collection: PostausgangCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLRegistrierungSweepResponse:
    """
    Run the four registration retention clocks over one season, as of today in Europe/Berlin.

    A declined registration is erased a month after the decision. Once the season is `past`, every registration still awaiting a
    decision is erased whatever the pupil answered, because no admission can be taken for a season that is over; the two clocks
    below do not run for a `past` season, whose own end takes every row they read.

    Otherwise an unconfirmed registration strictly past its deadline is erased with no notice at all, the confirmation mail having
    named that day. Then one reminder per registration at its reminder age, earliest deadline first: `erinnert_am` is stamped and the
    reminder owed in the Postausgang in one transaction, its link joining the one already in that inbox. One call reminds a bounded
    share of the registrations due; the rest stay due and the calls after it remind them. Every removal names this season alone, is
    made inside a transaction and takes its log rows with it.

    A registration whose write fails, the database refusing it or anything else, is passed over alone and logged by id: the rest of
    its clock's page or share goes, and it stays due, so the next pass meets it again and one failing record holds back no clock and
    nobody behind it. `fehlgeschlagen` sums the rows each of the four clocks passed over.

    404 where no season has the id. Idempotent per day: a run after every due reminder is owed writes nothing.
    """

    # The read that answers the 404 carries the status: this season's own end is a clock, and a
    # second query for a document already in hand would be a second answer to when it ended.
    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status"])
    saison_status = saison_raw.get("status")

    stamp = log_stamp(germany_now)

    async def loeschen_the_undecided(session: AsyncClientSession, batch: Batch) -> tuple[int, int, int]:
        """The season's own end: erase, then redact the rows that still hold the people. Read in-session, so a retry re-judges."""

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
            return len(rows), 0, 0

        ids = [row["_id"] for row in taken]
        result = await loeschen_many_from_db(
            collection=registrierungen_collection, db_filter={"saison_id": saison_id, "_id": {"$in": ids}}, session=session
        )
        redacted = await redact_log_rows_in_db(
            aktionen_collection=aktionen_collection, targets=[(Collection.REGISTRIERUNGEN, ids)], at=stamp, session=session
        )

        return len(rows), result.deleted_count, redacted

    async def loeschen_the_unconfirmed(session: AsyncClientSession, batch: Batch) -> tuple[int, int, int]:
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
            [row for row, due in batch.judged(rows, lambda row: bestaetigung_loeschung_is_due(registrierung_raw=row, today=today)) if due]
        )
        if not taken:
            # Rows passed over in place move the page: the drain reads the next one without them.
            refuse_a_stalled_page(read=len(rows), moved=len(batch.refused), page=SWEEP_PAGE, clock="deadline", saison_id=saison_id)
            return len(rows), 0, 0

        ids = [row["_id"] for row in taken]
        # The filter names the season and the ids and nothing else: it is stored as text, and any
        # other key would preserve what this call destroys.
        result = await loeschen_many_from_db(
            collection=registrierungen_collection, db_filter={"saison_id": saison_id, "_id": {"$in": ids}}, session=session
        )
        redacted = await redact_log_rows_in_db(
            aktionen_collection=aktionen_collection, targets=[(Collection.REGISTRIERUNGEN, ids)], at=stamp, session=session
        )

        return len(rows), result.deleted_count, redacted

    async def remind(session: AsyncClientSession, batch: Batch) -> int:
        """Stamp each reminder and owe its mail in one transaction, a share a pass. Read in-session, so a retry re-judges."""

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
        taken = batch.took(due[: batch.share])
        refuse_a_stalled_page(read=len(rows), moved=len(taken), page=SWEEP_PAGE, clock="reminder", saison_id=saison_id)
        # One read for the share: a mail names the team, and a registration holds only its id.
        team_names = await pull_team_names(teams_collection=teams_collection, team_ids=[row.get("team_id") for row in taken], session=session)

        for row in taken:
            await patch_one_in_db(
                collection=registrierungen_collection,
                db_filter={"_id": row["_id"]},
                update=compose_erinnerung_update(today=today),
                session=session,
                return_document=ReturnDocument.BEFORE,
            )
            # The stamp and the mail commit together; the ban is judged when the mail is handed out.
            await enqueue_mail(
                postausgang_collection=postausgang_collection,
                session=session,
                # The day too: an address change owes the moved row its reminder again, which an earlier key would swallow.
                schluessel=f"{Collection.REGISTRIERUNGEN}/{row['_id']}/erinnerung/{today}",
                an=str(row["email"]),
                daten=FLRegistrierungLinkDaten(
                    art="registrierung_erinnerung",
                    # Empty where the team row is gone: a reminder naming no team beats a pass that stops.
                    team=team_names.get(row.get("team_id"), _TEAM_UNBEKANNT),
                    saison_id=saison_id,
                    frist_tage=REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE,
                ),
                now=germany_now,
                bezug=FLPostausgangBezug(sammlung=Collection.REGISTRIERUNGEN, id=row["_id"], sitz=None),
                link=REGISTRIERUNG_LINK,
            )

        return len(taken)

    async def loeschen_declined(session: AsyncClientSession, batch: Batch) -> tuple[int, int, int]:
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
        taken = batch.took([row for row in rows if decline_loeschung_is_due(registrierung_raw=row, today=today)])
        if not taken:
            refuse_a_stalled_page(read=len(rows), moved=0, page=SWEEP_PAGE, clock="decline", saison_id=saison_id)
            return len(rows), 0, 0

        ids = [row["_id"] for row in taken]
        result = await loeschen_many_from_db(
            collection=registrierungen_collection, db_filter={"saison_id": saison_id, "_id": {"$in": ids}}, session=session
        )
        redacted = await redact_log_rows_in_db(
            aktionen_collection=aktionen_collection, targets=[(Collection.REGISTRIERUNGEN, ids)], at=stamp, session=session
        )

        return len(rows), result.deleted_count, redacted

    abgelehnte, redacted_declined, passed = await drain(
        db=db,
        page_of=loeschen_declined,
        page=SWEEP_PAGE,
        what="Registration",
        clock="decline",
    )
    fehlgeschlagen = len(passed)

    erinnert = 0
    ohne_entscheidung, redacted_undecided = 0, 0
    unbestaetigt, redacted_unconfirmed = 0, 0
    # The season's end takes every row the two clocks in the other arm read, so a link minted
    # for one of them would be a credential nobody can spend.
    if season_has_ended(saison_status=saison_status):
        ohne_entscheidung, redacted_undecided, passed = await drain(
            db=db,
            page_of=loeschen_the_undecided,
            page=SWEEP_PAGE,
            what="Registration",
            clock="season's end",
        )
        fehlgeschlagen += len(passed)
    else:
        unbestaetigt, redacted_unconfirmed, passed = await drain(
            db=db,
            page_of=loeschen_the_unconfirmed,
            page=SWEEP_PAGE,
            what="Registration",
            clock="deadline",
        )
        fehlgeschlagen += len(passed)

        reminded, passed = await run_isolated(
            db=db,
            batch=Batch(share=REMINDERS_PER_PASS),
            attempt=remind,
            moved=lambda count: count,
            owes=False,
            what="Registration",
            clock="reminder",
        )
        fehlgeschlagen += len(passed)
        erinnert = sum(reminded)

    return FLRegistrierungSweepResponse(
        saison_id=saison_id,
        erinnert=erinnert,
        geloescht_unbestaetigt=unbestaetigt,
        geloescht_ohne_entscheidung=ohne_entscheidung,
        geloescht_abgelehnt=abgelehnte,
        redigierte_aktionen=redacted_undecided + redacted_unconfirmed + redacted_declined,
        fehlgeschlagen=fehlgeschlagen,
    )
