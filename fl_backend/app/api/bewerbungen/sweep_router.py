from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Annotated, Any, Final

from fastapi import APIRouter, Body, Depends
from pymongo import ASCENDING, ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

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
from app.api.saisons.cache import dropping_the_saison_cache
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import erase_many_from_db, patch_many_in_db, patch_one_in_db, pull_many_from_db, pull_one_from_db
from app.core.dependencies import (
    AktionenCollection,
    BewerbungenCollection,
    DBClient,
    SaisonsCollection,
    SaisonTeamsCollection,
    TeamsCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.recording import build_redaction_filter, build_redaction_update, log_stamp
from app.core.security import bind_system_actor, verify_access_system
from app.core.transactions import drain, refuse_a_stalled_page
from app.shared.schemas.bounds import LIST_LIMIT_MAX

# System tier and the system actor: the sweep holds no session, so `bind_actor` would refuse it,
# and an invented administrator for a machine is what `SYSTEM_ACTOR` exists to avoid.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/bewerbungen/sweep",
    dependencies=[Depends(verify_access_system), Depends(bind_system_actor)],
)

# Two commands a row, each costing the round trip plus about 1.1 ms (from whole passes timed locally,
# 2026-09-23): the two shares together keep a pass inside `app/core/middlewares.py :: REQUEST_DEADLINE_S`
# up to a 36 ms round trip (`docs/backend/spec.md :: I322`).
REMINDERS_PER_PASS: Final = 62

# A season at the capacity its rules allow holds more junction rows than this, and takes more passes.
BLOCKS_CLEARED_PER_PASS: Final = 62


async def _club_names(
    *, teams_collection: TeamsCollection, rows: Sequence[Mapping[str, Any]], session: AsyncClientSession | None
) -> dict[Any, str]:
    """The picked clubs' names, one read for the pass: a mail names the school and the row holds only its id."""

    team_ids = [row["team_id"] for row in rows if row.get("team_id") is not None]
    if not team_ids:
        return {}

    clubs = await pull_many_from_db(
        collection=teams_collection, db_filter={"_id": {"$in": team_ids}}, projection=["name"], limit=LIST_LIMIT_MAX, session=session
    )

    return {club["_id"]: str(club.get("name") or "") for club in clubs}


async def _redact(
    *, aktionen_collection: AktionenCollection, collection: Collection, ids: Sequence[Any], stamp: str, session: AsyncClientSession
) -> int:
    """Every log row naming the removed documents, emptied and stamped -- the erasure's second half (`docs/backend/spec.md :: I42`)."""

    if not ids:
        return 0

    redacted = await patch_many_in_db(
        collection=aktionen_collection,
        db_filter=build_redaction_filter([(collection, list(ids))]),
        update=build_redaction_update(at=stamp),
        session=session,
    )

    return redacted.modified_count


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


@router.post("/{saison_id}", response_model=FLBewerbungSweepResponse, summary="Run one season's retention clocks")
async def sweep_saison(
    saison_id: str,
    bewerbungen_collection: BewerbungenCollection,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    teams_collection: TeamsCollection,
    aktionen_collection: AktionenCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLBewerbungSweepResponse:
    """
    Run the six retention clocks over one season, as of today in Europe/Berlin, and answer what the caller must mail.

    The reminder clock stamps `erinnert_am` and mints a fresh link per seat BEFORE answering, so a failed mail costs one
    person one reminder and never a repeat; the first link stays valid beside the fresh one. A seat whose last message the
    mail provider refused is not chased at all, its one reminder buying nothing. The fourteen-day clock only
    LISTS its candidates here, each saying whether its notice has already gone out -- the caller mails the rest, stamps the
    delivered ones through `/angekuendigt` and erases every announced one through `/loeschen`. An application whose
    Ansprechperson the provider refuses is listed by neither: it is held past its deadline for an administrator to
    correct the address, because erasing it would destroy a school's application with nobody told. That hold ends with the
    season: once the season applied for is `past`, every application still awaiting a decision is erased here, whatever its
    seats answered and whether or not its notice could be delivered, because no decision can be taken for a season that is
    over. That clock runs before the two above it, so an application it takes is neither chased nor listed for a notice. The
    declined, accepted and contact-block clocks erase and redact in this call. Every removal names this season alone.

    One call reminds, lists and clears contact blocks for a bounded share of what is due, the first two earliest deadline
    first; the rest stay due and the calls after it take them. The reminders are committed by the call's LAST transaction, so no later step
    of the same call can answer an error in their place.

    404 where no season has the id. Idempotent per day once every share has been taken: a run after that finds nothing
    left to do.

    A season whose id is not a four-digit year fails the whole pass rather than running the four clocks that do not need a
    successor: the accepted clock and the contact block read the season after this one, and a pass that skipped them quietly
    would leave both stopped for ever with nothing anywhere saying so.

    One thing here reaches past this season: the day is stamped on every season not already carrying it, and `GET /bewerbungen/sweep`
    answers it. So a day's first call records the day and the rest of that day's calls record nothing.
    """

    # The read that answers the 404 carries the status: this season's own end is a clock too, and a
    # second query for a document already in hand would be a second answer to when it ended.
    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status"])
    saison_status = saison_raw.get("status")

    naechste_raw = await saisons_collection.find_one({"_id": next_saison_id(saison_id)}, {"status": 1})
    next_saison_status = naechste_raw.get("status") if naechste_raw is not None else None

    stamp = log_stamp(germany_now)

    async def stamp_the_run(session: AsyncClientSession) -> None:
        """One fan-out over every season today has not reached, inside the pass's LAST transaction, so a stamped day is a committed call."""

        stale = await pull_many_from_db(
            collection=saisons_collection,
            db_filter={"sweep_gelaufen_am": {"$ne": today}},
            projection=["_id"],
            limit=LIST_LIMIT_MAX,
            session=session,
        )
        # The guard that keeps a day to ONE log row: `patch_many_in_db` files one per call, a call
        # matching nothing included, and this runs hourly against every season.
        if not stale:
            return

        await patch_many_in_db(
            collection=saisons_collection,
            db_filter={"_id": {"$in": [row["_id"] for row in stale]}},
            # The whole PASS's day, on every stale season at once: it says when the sweep last ran
            # and never when this season was visited.
            update={"$set": {"sweep_gelaufen_am": today}},
            session=session,
        )

    async def erase_the_undecided(session: AsyncClientSession) -> tuple[int, int, int]:
        """The season's own end: erase, then redact the rows that still hold the people. Read in-session, so a retry re-judges."""

        rows = await pull_many_from_db(
            collection=bewerbungen_collection,
            db_filter={"saison_id": saison_id, "status": "eingereicht"},
            projection=["status"],
            # One over the page: a full page is a page that may be truncated, and a clock cannot
            # see what it never read (`docs/backend/spec.md :: I295`).
            limit=SWEEP_PAGE + 1,
            session=session,
        )
        ids = [row["_id"] for row in rows if undecided_erasure_is_due(bewerbung_raw=row, saison_status=saison_status)]
        if not ids:
            return len(rows), 0, 0

        result = await erase_many_from_db(
            collection=bewerbungen_collection, db_filter={"saison_id": saison_id, "_id": {"$in": ids}}, session=session
        )
        redacted = await _redact(
            aktionen_collection=aktionen_collection, collection=Collection.BEWERBUNGEN, ids=ids, stamp=stamp, session=session
        )

        return len(rows), result.deleted_count, redacted

    async def remind(session: AsyncClientSession) -> list[FLBewerbungSweepErinnerung]:
        """Stamp, mint, stamp the run, then hand back, as the pass's last transaction. Read in-session, so a retry re-judges."""

        rows = await pull_many_from_db(
            collection=bewerbungen_collection,
            db_filter=build_erinnerung_filter(saison_id=saison_id, today=today),
            limit=SWEEP_PAGE + 1,
            # Earliest deadline first, so the application the fourteen-day clock takes soonest is
            # chased first; `_id` makes the page the same page whichever plan the server picks.
            sort_by=[("bestaetigungsfrist", ASCENDING), ("_id", ASCENDING)],
            session=session,
        )
        # The rows past the share stay due and unstamped, so the next pass takes them: a stamped
        # seat leaves the filter, so a full page is drained by the passes that follow.
        due = [(row, reminder_seats(bewerbung_raw=row, today=today)) for row in rows]
        taken = [(row, seats) for row, seats in due if seats][:REMINDERS_PER_PASS]
        refuse_a_stalled_page(read=len(rows), moved=len(taken), page=SWEEP_PAGE, clock="reminder", saison_id=saison_id)
        club_names = await _club_names(teams_collection=teams_collection, rows=[row for row, _ in taken], session=session)

        erinnerungen: list[FLBewerbungSweepErinnerung] = []
        for row, seats in taken:
            per_mailbox = [
                (email, reminder_link_groups(kontakte=row.get("kontakte"), bestaetigungen=row.get("bestaetigungen"), seats=held))
                for email, held in group_seats_by_mailbox(kontakte=row.get("kontakte"), seats=seats)
            ]
            gruppen_alle = [gruppe for _, gruppen in per_mailbox for gruppe in gruppen]
            # Minted per LINK rather than per seat: a token for a seat riding another's link is a
            # credential nobody is sent, live on the wire and in the document until the deadline.
            minted = {gruppe[0]: mint_token() for gruppe in gruppen_alle}

            # The stamp lands before the caller can mail: a crash between the two costs one reminder,
            # where the other order would repeat it every day until the address works.
            await patch_one_in_db(
                collection=bewerbungen_collection,
                db_filter={"_id": row["_id"]},
                update=compose_erinnerung_update(
                    hashes={seat: minted[gruppe[0]][1] for gruppe in gruppen_alle for seat in gruppe},
                    bestaetigungen=row.get("bestaetigungen"),
                    today=today,
                ),
                session=session,
                return_document=ReturnDocument.BEFORE,
            )
            for email, gruppen in per_mailbox:
                erinnerungen.append(
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
                )

        await stamp_the_run(session)

        return erinnerungen

    async def erase_declined(session: AsyncClientSession) -> tuple[int, int, int]:
        """The one-month clock: erase, then redact the rows that still hold the people. Read in-session, so a retry re-judges."""

        rows = await pull_many_from_db(
            collection=bewerbungen_collection,
            # Narrowed to the decisions whose month is behind them: a page of fresh ones would fill the
            # read ahead of a due one, and the stall would refuse the pass.
            db_filter={"saison_id": saison_id, "status": "abgelehnt", "entscheidung.getroffen_am": {"$lte": latest_decision_due(today=today)}},
            projection=["status", "entscheidung"],
            limit=SWEEP_PAGE + 1,
            session=session,
        )
        ids = [row["_id"] for row in rows if decline_erasure_is_due(bewerbung_raw=row, today=today)]
        if not ids:
            refuse_a_stalled_page(read=len(rows), moved=0, page=SWEEP_PAGE, clock="decline", saison_id=saison_id)
            return len(rows), 0, 0

        # The filter names the season and the ids and nothing else: it is stored as text, and any
        # other key would preserve what this call destroys (`docs/backend/spec.md :: I48`).
        result = await erase_many_from_db(
            collection=bewerbungen_collection, db_filter={"saison_id": saison_id, "_id": {"$in": ids}}, session=session
        )
        redacted = await _redact(
            aktionen_collection=aktionen_collection, collection=Collection.BEWERBUNGEN, ids=ids, stamp=stamp, session=session
        )

        return len(rows), result.deleted_count, redacted

    async def erase_accepted(session: AsyncClientSession) -> tuple[int, int, int]:
        """The season-and-one clock's first half. Read in-session, so a retry re-judges."""

        rows = await pull_many_from_db(
            collection=bewerbungen_collection,
            db_filter={"saison_id": saison_id, "status": "angenommen"},
            projection=["status"],
            limit=SWEEP_PAGE + 1,
            session=session,
        )
        ids = [row["_id"] for row in rows if acceptance_erasure_is_due(bewerbung_raw=row, next_saison_status=next_saison_status)]
        if not ids:
            return len(rows), 0, 0

        result = await erase_many_from_db(
            collection=bewerbungen_collection, db_filter={"saison_id": saison_id, "_id": {"$in": ids}}, session=session
        )
        redacted = await _redact(
            aktionen_collection=aktionen_collection, collection=Collection.BEWERBUNGEN, ids=ids, stamp=stamp, session=session
        )

        return len(rows), result.deleted_count, redacted

    async def clear_the_blocks(session: AsyncClientSession) -> tuple[int, int]:
        """The season-and-one clock's second half, a share a pass. Read in-session, so a retry re-judges."""

        junction_rows = await pull_many_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": saison_id, "kontakte": {"$ne": None}},
            projection=["_id"],
            limit=SWEEP_PAGE + 1,
            session=session,
        )
        # A cleared row leaves the filter, so the rows past the share are the next pass's.
        taken = junction_rows[:BLOCKS_CLEARED_PER_PASS]

        # `patch_one_in_db` per row and never `patch_many_in_db`, which records no `document_id`: the
        # redaction below must match the rows it logs (`app/api/kontakte/admin_router.py :: _clear_each`).
        cleared: list[Any] = []
        for row in taken:
            await patch_one_in_db(
                collection=saison_teams_collection,
                db_filter={"_id": row["_id"]},
                update={"$set": {"kontakte": None}},
                session=session,
                return_document=ReturnDocument.BEFORE,
            )
            cleared.append(row["_id"])
        redacted = await _redact(
            aktionen_collection=aktionen_collection, collection=Collection.SAISON_TEAMS, ids=cleared, stamp=stamp, session=session
        )

        return len(cleared), redacted

    # Every transaction before the LAST, which is the reminder's: what that one hands back is owed a
    # message, and a failure after it would answer this request with an error instead
    # (`docs/backend/spec.md :: I323`).
    ohne_entscheidung, redacted_undecided = 0, 0
    # AHEAD of the reminder and of the list below, which read the collection after it: a season that
    # has ended leaves nobody to chase, and a notice about an application this pass erased is a
    # notice about nothing.
    if season_has_ended(saison_status=saison_status):
        ohne_entscheidung, redacted_undecided = await drain(
            db=db, page_of=lambda session: session.with_transaction(erase_the_undecided), page=SWEEP_PAGE
        )

    abgelehnte, redacted_declined = await drain(db=db, page_of=lambda session: session.with_transaction(erase_declined), page=SWEEP_PAGE)

    angenommene, geleert, redacted_accepted = 0, 0, 0
    if season_after_has_ended(next_saison_status=next_saison_status):
        angenommene, redacted_accepted = await drain(db=db, page_of=lambda session: session.with_transaction(erase_accepted), page=SWEEP_PAGE)

        async with db.start_session() as session:
            geleert, redacted_blocks = await session.with_transaction(clear_the_blocks)
        redacted_accepted += redacted_blocks

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
    club_names = await _club_names(teams_collection=teams_collection, rows=due, session=None) if due else {}
    loeschungen: list[FLBewerbungSweepLoeschung] = []
    for row in due:
        # The mailbox and every seat it holds, from the helper the confirm router addresses its own
        # message with: one person on two seats reads one phrase naming both, in both messages.
        empfaenger, rollen = ansprechperson_mailbox(kontakte=row.get("kontakte"))
        loeschungen.append(
            FLBewerbungSweepLoeschung(
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
        )

    # The run's day is a season write, which the cache serves.
    with dropping_the_saison_cache():
        async with db.start_session() as session:
            erinnerungen = await session.with_transaction(remind)

    return FLBewerbungSweepResponse(
        saison_id=saison_id,
        erinnerungen=erinnerungen,
        loeschungen=loeschungen,
        abgelehnte_geloescht=abgelehnte,
        angenommene_geloescht=angenommene,
        ohne_entscheidung_geloescht=ohne_entscheidung,
        kontaktbloecke_geleert=geleert,
        redigierte_aktionen=redacted_declined + redacted_accepted + redacted_undecided,
    )


@router.post(
    "/{saison_id}/angekuendigt", response_model=FLBewerbungSweepAngekuendigtResponse, summary="Stamp the candidates whose notice was delivered"
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

    The ids are re-judged in-session: only one still submitted, past its deadline and with a seat outstanding is stamped, and one
    already carrying a stamp keeps the day it has. An id whose Ansprechperson the mail provider refused between the pass and this
    call is skipped, so a notice the provider never carried is not recorded as delivered. 404 where no season has the id. An empty
    list answers zero.
    """

    await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["_id"])

    async def stamp_the_notified(session: AsyncClientSession) -> int:
        """Judge and stamp in one transaction. Everything judged is read in-session, so a retry re-judges it."""

        rows = await pull_many_from_db(
            collection=bewerbungen_collection,
            db_filter={"saison_id": saison_id, "_id": {"$in": list(angekuendigt_data.bewerbung_ids)}, "status": "eingereicht"},
            limit=LIST_LIMIT_MAX,
            session=session,
        )

        stamped = 0
        for row in rows:
            if not deletion_is_due(bewerbung_raw=row, today=today) or deletion_was_announced(bewerbung_raw=row):
                continue
            # `patch_one_in_db` per row and never `patch_many_in_db`, which records no `document_id`:
            # the erasure that follows names these ids, and its log rows have to be findable by them.
            await patch_one_in_db(
                collection=bewerbungen_collection,
                db_filter={"_id": row["_id"]},
                update=compose_ankuendigung_update(today=today),
                session=session,
                return_document=ReturnDocument.BEFORE,
            )
            stamped += 1

        return stamped

    async with db.start_session() as session:
        angekuendigt = await session.with_transaction(stamp_the_notified)

    return FLBewerbungSweepAngekuendigtResponse(saison_id=saison_id, angekuendigt=angekuendigt)


@router.post("/{saison_id}/loeschen", response_model=FLBewerbungSweepLoeschenResponse, summary="Erase the notified deletion candidates")
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
    """

    await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["_id"])

    async def erase_the_notified(session: AsyncClientSession) -> tuple[int, int]:
        """Judge, erase, redact, in one transaction. Everything judged is read in-session, so a retry re-judges it."""

        rows = await pull_many_from_db(
            collection=bewerbungen_collection,
            db_filter={"saison_id": saison_id, "_id": {"$in": list(loeschen_data.bewerbung_ids)}, "status": "eingereicht"},
            limit=LIST_LIMIT_MAX,
            session=session,
        )
        # Announced as well as due: an unannounced id here is a caller that skipped the stamp, and
        # erasing it would destroy an application whose people were never told.
        ids = [row["_id"] for row in rows if deletion_is_due(bewerbung_raw=row, today=today) and deletion_was_announced(bewerbung_raw=row)]
        if not ids:
            return 0, 0

        result = await erase_many_from_db(
            collection=bewerbungen_collection, db_filter={"saison_id": saison_id, "_id": {"$in": ids}}, session=session
        )
        redacted = await _redact(
            aktionen_collection=aktionen_collection, collection=Collection.BEWERBUNGEN, ids=ids, stamp=log_stamp(germany_now), session=session
        )

        return result.deleted_count, redacted

    async with db.start_session() as session:
        geloescht, redigiert = await session.with_transaction(erase_the_notified)

    return FLBewerbungSweepLoeschenResponse(saison_id=saison_id, geloescht=geloescht, redigierte_aktionen=redigiert)
