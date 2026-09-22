from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends
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
    refuse_a_stalled_page,
    registrierung_ist_bestaetigt,
    undecided_erasure_is_due,
)
from app.api.saisons.cache import invalidate_saison_cache
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
from app.core.recording import build_redaction_filter, build_redaction_update, log_stamp
from app.core.security import bind_system_actor, verify_access_system
from app.shared.schemas.bounds import LIST_LIMIT_MAX

# System tier and the system actor, as the application sweep's own router is: this pass holds no
# session, so `bind_actor` would refuse it.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/registrierungen/sweep",
    dependencies=[Depends(verify_access_system), Depends(bind_system_actor)],
)

# What a message names where the team row is gone: a note that reaches its reader is worth more than
# a pass that stops on a club somebody retired.
_TEAM_UNBEKANNT = ""


async def _team_names(
    *, teams_collection: TeamsCollection, rows: Sequence[Mapping[str, Any]], session: AsyncClientSession | None
) -> dict[Any, str]:
    """The teams' names, one read for the pass: a message names the team and a registration holds only its id."""

    team_ids = [row["team_id"] for row in rows if row.get("team_id") is not None]
    if not team_ids:
        return {}

    teams = await pull_many_from_db(
        collection=teams_collection, db_filter={"_id": {"$in": team_ids}}, projection=["name"], limit=LIST_LIMIT_MAX, session=session
    )

    return {team["_id"]: str(team.get("name") or "") for team in teams}


async def _redact(*, aktionen_collection: AktionenCollection, ids: Sequence[Any], stamp: str, session: AsyncClientSession) -> int:
    """Every log row naming the erased registrations, emptied and stamped (`docs/backend/spec.md :: I42`).

    Its own rather than an import of `app/api/bewerbungen/sweep_router.py :: _redact`, which names
    that flow's collection.
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


@router.post("/{saison_id}", response_model=FLRegistrierungSweepResponse, summary="Run one season's registration retention clocks")
async def sweep_registrierungen(
    saison_id: str,
    registrierungen_collection: RegistrierungenCollection,
    saisons_collection: SaisonsCollection,
    teams_collection: TeamsCollection,
    aktionen_collection: AktionenCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
    germany_now: datetime = Depends(get_germany_now),
) -> FLRegistrierungSweepResponse:
    """
    Run the four registration retention clocks over one season, as of today in Europe/Berlin, and answer what the caller must mail.

    The season's own end comes first: once the season is `past`, every registration still awaiting a decision is erased whatever the
    pupil answered, because no admission can be taken for a season that is over. The confirmed ones among them are listed in
    `benachrichtigt` and told AFTERWARDS -- one message saying it happened -- while an unconfirmed one is told neither before nor
    after, its address never having been confirmed. Then an unconfirmed registration strictly past its deadline is erased with no
    notice at all, the confirmation mail having named that day. Then one reminder per registration at its reminder age: a fresh link
    is minted and `erinnert_am` stamped BEFORE this answers, so a failed send costs one pupil one reminder and never a repeat, and
    the link already in that inbox stays valid beside the fresh one. A registration whose last message the mail provider refused is
    not chased at all. Last, a declined registration is erased a month after the decision. Every removal names this season alone, is
    made inside a transaction and takes its log rows with it.

    404 where no season has the id. Idempotent per day: a second run finds nothing left to do.

    One thing here reaches past this season: the day is stamped on every season not already carrying it, and `GET /bewerbungen/sweep`
    answers it beside the application pass's own day. So a day's first call records the day and the rest of that day's calls record
    nothing.
    """

    # The read that answers the 404 carries the status: this season's own end is a clock, and a
    # second query for a document already in hand would be a second answer to when it ended.
    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status"])
    saison_status = saison_raw.get("status")

    stamp = log_stamp(germany_now)

    async def erase_the_undecided(session: AsyncClientSession) -> tuple[int, list[FLRegistrierungSweepBenachrichtigung], int, int]:
        """The season's own end: erase, then redact the rows that still hold the people. Read in-session, so a retry re-judges.

        Answers the PAGE it read beside its counts, which is what tells the caller to come back for
        another one.
        """

        rows = await pull_many_from_db(
            collection=registrierungen_collection,
            db_filter=build_undecided_filter(saison_id=saison_id),
            projection=["status", "einwilligung", "vorname", "email", "team_id"],
            # One over the page, as `app/api/saisons/admin_router.py :: undraw_spielplan` reads: a
            # full page is a page that may be truncated, and a clock cannot see what it never read.
            limit=SWEEP_PAGE + 1,
            session=session,
        )
        taken = [row for row in rows if undecided_erasure_is_due(registrierung_raw=row, saison_status=saison_status)]
        if not taken:
            refuse_a_stalled_page(read=len(rows), moved=0, clock="season's end", saison_id=saison_id)
            return len(rows), [], 0, 0

        # The note goes to the pupils who confirmed and to nobody else: an unconfirmed address is one
        # the league could not reach at all, and the message would go to whoever was mistyped.
        told = [row for row in taken if registrierung_ist_bestaetigt(einwilligung=row.get("einwilligung"))]
        team_names = await _team_names(teams_collection=teams_collection, rows=told, session=session)
        benachrichtigt = [
            FLRegistrierungSweepBenachrichtigung(
                registrierung_id=row["_id"],
                saison_id=saison_id,
                team=team_names.get(row.get("team_id"), _TEAM_UNBEKANNT),
                vorname=str(row.get("vorname") or ""),
                email=str(row.get("email") or ""),
            )
            for row in told
        ]

        ids = [row["_id"] for row in taken]
        result = await erase_many_from_db(
            collection=registrierungen_collection, db_filter={"saison_id": saison_id, "_id": {"$in": ids}}, session=session
        )
        redacted = await _redact(aktionen_collection=aktionen_collection, ids=ids, stamp=stamp, session=session)

        return len(rows), benachrichtigt, result.deleted_count, redacted

    async def erase_the_unconfirmed(session: AsyncClientSession) -> tuple[int, int, int]:
        """The deadline clock: erase, then redact. Read in-session, so a retry re-judges."""

        rows = await pull_many_from_db(
            collection=registrierungen_collection,
            db_filter=build_unconfirmed_filter(saison_id=saison_id, today=today),
            projection=["status", "einwilligung", "bestaetigung"],
            limit=SWEEP_PAGE + 1,
            session=session,
        )
        ids = [row["_id"] for row in rows if bestaetigung_erasure_is_due(registrierung_raw=row, today=today)]
        if not ids:
            refuse_a_stalled_page(read=len(rows), moved=0, clock="deadline", saison_id=saison_id)
            return len(rows), 0, 0

        # The filter names the season and the ids and nothing else: it is stored as text, and any
        # other key would preserve what this call destroys (`docs/backend/spec.md :: I48`).
        result = await erase_many_from_db(
            collection=registrierungen_collection, db_filter={"saison_id": saison_id, "_id": {"$in": ids}}, session=session
        )
        redacted = await _redact(aktionen_collection=aktionen_collection, ids=ids, stamp=stamp, session=session)

        return len(rows), result.deleted_count, redacted

    async def remind(session: AsyncClientSession) -> list[FLRegistrierungSweepErinnerung]:
        """Stamp, mint, then hand back. Everything judged is read in-session, so a retry re-judges it."""

        rows = await pull_many_from_db(
            collection=registrierungen_collection,
            db_filter=build_erinnerung_filter(saison_id=saison_id, today=today),
            projection=["status", "einwilligung", "bestaetigung", "vorname", "email", "team_id"],
            limit=SWEEP_PAGE + 1,
            session=session,
        )
        due = [row for row in rows if erinnerung_is_due(registrierung_raw=row, today=today)]
        # The stamp below is this clock's progress: a reminded row leaves the filter, so a full page
        # is drained by the passes that follow rather than by a loop mailing a season at once.
        refuse_a_stalled_page(read=len(rows), moved=len(due), clock="reminder", saison_id=saison_id)
        team_names = await _team_names(teams_collection=teams_collection, rows=due, session=session)

        erinnerungen: list[FLRegistrierungSweepErinnerung] = []
        for row in due:
            raw, token_hash = mint_token()
            # The stamp lands before the caller can mail: a crash between the two costs one reminder,
            # where the other order would repeat it every day until the address worked.
            await patch_one_in_db(
                collection=registrierungen_collection,
                db_filter={"_id": row["_id"]},
                update=compose_erinnerung_update(token_hash=token_hash, bestaetigung=row.get("bestaetigung"), today=today),
                session=session,
            )
            erinnerungen.append(
                FLRegistrierungSweepErinnerung(
                    registrierung_id=row["_id"],
                    saison_id=saison_id,
                    team=team_names.get(row.get("team_id"), _TEAM_UNBEKANNT),
                    vorname=str(row.get("vorname") or ""),
                    email=str(row.get("email") or ""),
                    token=raw,
                )
            )

        return erinnerungen

    async def erase_declined(session: AsyncClientSession) -> tuple[int, int, int]:
        """The one-month clock: erase, then redact. Read in-session, so a retry re-judges."""

        rows = await pull_many_from_db(
            collection=registrierungen_collection,
            db_filter=build_decline_filter(saison_id=saison_id, today=today),
            projection=["status", "entscheidung"],
            limit=SWEEP_PAGE + 1,
            session=session,
        )
        ids = [row["_id"] for row in rows if decline_erasure_is_due(registrierung_raw=row, today=today)]
        if not ids:
            refuse_a_stalled_page(read=len(rows), moved=0, clock="decline", saison_id=saison_id)
            return len(rows), 0, 0

        result = await erase_many_from_db(
            collection=registrierungen_collection, db_filter={"saison_id": saison_id, "_id": {"$in": ids}}, session=session
        )
        redacted = await _redact(aktionen_collection=aktionen_collection, ids=ids, stamp=stamp, session=session)

        return len(rows), result.deleted_count, redacted

    async def stamp_the_run(session: AsyncClientSession) -> int:
        """One fan-out over every season today has not reached. Everything judged is read in-session, so a retry re-judges it."""

        stale = await pull_many_from_db(
            collection=saisons_collection,
            db_filter=build_stale_stamp_filter(today=today),
            projection=["_id"],
            limit=LIST_LIMIT_MAX,
            session=session,
        )
        # The guard that keeps a day to ONE log row: `patch_many_in_db` files one per call, a call
        # matching nothing included, and this runs hourly against every season.
        if not stale:
            return 0

        result = await patch_many_in_db(
            collection=saisons_collection,
            db_filter={"_id": {"$in": [row["_id"] for row in stale]}},
            update=compose_sweep_stamp(today=today),
            session=session,
        )

        return result.modified_count

    benachrichtigt: list[FLRegistrierungSweepBenachrichtigung] = []
    ohne_entscheidung, redacted_undecided = 0, 0
    # AHEAD of the two clocks below, which read the collection after it: a season that has ended
    # leaves nobody to chase, and a link minted for a row this pass erased is one nobody can spend.
    if season_has_ended(saison_status=saison_status):
        # DRAINS: a full page is erased and read again, because the population that fills it is the
        # one only the erasure shrinks, and a pass that stopped there would stop every later one too.
        while True:
            async with db.start_session() as session:
                page, told, erased, redacted = await session.with_transaction(erase_the_undecided)
            benachrichtigt.extend(told)
            ohne_entscheidung += erased
            redacted_undecided += redacted
            if page <= SWEEP_PAGE:
                break

    unbestaetigt, redacted_unconfirmed = 0, 0
    # NOT extracted, though the three drains here repeat it: a shared helper takes the call out of
    # `tests/core/app_source.py :: transactional_callbacks`, which reads a callback's own lexical
    # body, and a `session=` dropped inside one would then stay green.
    while True:
        async with db.start_session() as session:
            page, erased, redacted = await session.with_transaction(erase_the_unconfirmed)
        unbestaetigt += erased
        redacted_unconfirmed += redacted
        if page <= SWEEP_PAGE:
            break

    async with db.start_session() as session:
        erinnerungen = await session.with_transaction(remind)

    abgelehnte, redacted_declined = 0, 0
    while True:
        async with db.start_session() as session:
            page, erased, redacted = await session.with_transaction(erase_declined)
        abgelehnte += erased
        redacted_declined += redacted
        if page <= SWEEP_PAGE:
            break

    async with db.start_session() as session:
        gestempelt = await session.with_transaction(stamp_the_run)

    # Nothing cached reads the day; dropped anyway, so the rule stays "every season write drops it".
    if gestempelt:
        invalidate_saison_cache()

    return FLRegistrierungSweepResponse(
        saison_id=saison_id,
        erinnerungen=erinnerungen,
        benachrichtigt=benachrichtigt,
        geloescht_unbestaetigt=unbestaetigt,
        geloescht_ohne_entscheidung=ohne_entscheidung,
        geloescht_abgelehnt=abgelehnte,
        redigierte_aktionen=redacted_undecided + redacted_unconfirmed + redacted_declined,
    )
