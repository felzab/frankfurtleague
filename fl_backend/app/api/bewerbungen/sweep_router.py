from datetime import datetime
from typing import Annotated, Any, Mapping, Sequence

from fastapi import APIRouter, Body, Depends
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.bewerbungen.schemas import (
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
    acceptance_erasure_is_due,
    ansprechperson_email,
    ausstehende_seats,
    compose_erinnerung_update,
    decline_erasure_is_due,
    deletion_is_due,
    group_seats_by_mailbox,
    mint_token,
    next_saison_id,
    reminder_seats,
    schule_name,
    season_after_has_ended,
    vorname_of,
)
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
from app.shared.schemas.bounds import LIST_LIMIT_MAX

# System tier and the system actor: the sweep holds no session, so `bind_actor` would refuse it,
# and an invented administrator for a machine is what `SYSTEM_ACTOR` exists to avoid.
router = APIRouter(
    prefix=f"/api/v{API_VERSION}/bewerbungen/sweep",
    dependencies=[Depends(verify_access_system), Depends(bind_system_actor)],
)


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
    Answer every season's id, oldest first, so the caller runs the clocks one season at a time.

    System tier rather than the base one: a season taking applications is `future`, which the base tier is never served,
    and the two clocks that matter run over exactly those seasons.
    """

    seasons = await pull_many_from_db(
        collection=saisons_collection, db_filter={}, projection=["_id"], sort_by=[("_id", 1)], limit=LIST_LIMIT_MAX
    )

    return FLBewerbungSweepSaisonsResponse(saison_ids=[str(season["_id"]) for season in seasons])


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
    Run the five retention clocks over one season, as of today in Europe/Berlin, and answer what the caller must mail.

    The reminder clock stamps `erinnert_am` and mints a fresh link per seat BEFORE answering, so a failed mail costs one
    person one reminder and never a repeat; the first link stays valid beside the fresh one. The fourteen-day clock only
    LISTS its candidates here -- the caller mails the notice and erases the delivered ones through `/loeschen`. The
    declined, accepted and contact-block clocks erase and redact in this call. Every removal names this season alone.
    404 where no season has the id. Idempotent per day: a second run finds nothing left to do.
    """

    await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["_id"])

    naechste = next_saison_id(saison_id)
    naechste_raw = await saisons_collection.find_one({"_id": naechste}, {"status": 1}) if naechste is not None else None
    next_saison_status = naechste_raw.get("status") if naechste_raw is not None else None

    stamp = log_stamp(germany_now)

    async def remind(session: AsyncClientSession) -> list[FLBewerbungSweepErinnerung]:
        """Stamp, mint, then hand back. Everything judged is read in-session, so a retry re-judges it."""

        rows = await pull_many_from_db(
            collection=bewerbungen_collection,
            db_filter={"saison_id": saison_id, "status": "eingereicht"},
            limit=LIST_LIMIT_MAX,
            session=session,
        )
        due = [(row, reminder_seats(bewerbung_raw=row, today=today)) for row in rows]
        due = [(row, seats) for row, seats in due if seats]
        club_names = await _club_names(teams_collection=teams_collection, rows=[row for row, _ in due], session=session)

        erinnerungen: list[FLBewerbungSweepErinnerung] = []
        for row, seats in due:
            minted = {seat: mint_token() for seat in seats}
            # The stamp lands before the caller can mail: a crash between the two costs one reminder,
            # where the other order would repeat it every day until the address works.
            await patch_one_in_db(
                collection=bewerbungen_collection,
                db_filter={"_id": row["_id"]},
                update=compose_erinnerung_update(
                    hashes={seat: token_hash for seat, (_, token_hash) in minted.items()}, bestaetigungen=row.get("bestaetigungen"), today=today
                ),
                session=session,
            )
            for email, held in group_seats_by_mailbox(kontakte=row.get("kontakte"), seats=seats):
                erinnerungen.append(
                    FLBewerbungSweepErinnerung(
                        bewerbung_id=row["_id"],
                        saison_id=saison_id,
                        schule=schule_name(bewerbung_raw=row, club_names=club_names),
                        bestaetigungsfrist=str(row["bestaetigungsfrist"]),
                        email=email,
                        seats=[
                            FLBewerbungSweepSeat(
                                rolle=seat, vorname=vorname_of(kontakte=row.get("kontakte"), seat=seat) or "", token=minted[seat][0]
                            )
                            for seat in held
                        ],
                    )
                )

        return erinnerungen

    async def erase_declined(session: AsyncClientSession) -> tuple[int, int]:
        """The one-month clock: erase, then redact the rows that still hold the people. Read in-session, so a retry re-judges."""

        rows = await pull_many_from_db(
            collection=bewerbungen_collection,
            db_filter={"saison_id": saison_id, "status": "abgelehnt"},
            projection=["status", "entscheidung"],
            limit=LIST_LIMIT_MAX,
            session=session,
        )
        ids = [row["_id"] for row in rows if decline_erasure_is_due(bewerbung_raw=row, today=today)]
        if not ids:
            return 0, 0

        # The filter names the season and the ids and nothing else: it is stored as text, and any
        # other key would preserve what this call destroys (`docs/backend/spec.md :: I48`).
        result = await erase_many_from_db(
            collection=bewerbungen_collection, db_filter={"saison_id": saison_id, "_id": {"$in": ids}}, session=session
        )
        redacted = await _redact(
            aktionen_collection=aktionen_collection, collection=Collection.BEWERBUNGEN, ids=ids, stamp=stamp, session=session
        )

        return result.deleted_count, redacted

    async def erase_accepted_and_clear_the_block(session: AsyncClientSession) -> tuple[int, int, int]:
        """The season-and-one clock, both halves on one test. Read in-session, so a retry re-judges."""

        rows = await pull_many_from_db(
            collection=bewerbungen_collection,
            db_filter={"saison_id": saison_id, "status": "angenommen"},
            projection=["status"],
            limit=LIST_LIMIT_MAX,
            session=session,
        )
        ids = [row["_id"] for row in rows if acceptance_erasure_is_due(bewerbung_raw=row, next_saison_status=next_saison_status)]

        erased = 0
        redacted = 0
        if ids:
            result = await erase_many_from_db(
                collection=bewerbungen_collection, db_filter={"saison_id": saison_id, "_id": {"$in": ids}}, session=session
            )
            erased = result.deleted_count
            redacted += await _redact(
                aktionen_collection=aktionen_collection, collection=Collection.BEWERBUNGEN, ids=ids, stamp=stamp, session=session
            )

        junction_rows = await pull_many_from_db(
            collection=saison_teams_collection,
            db_filter={"saison_id": saison_id, "kontakte": {"$ne": None}},
            projection=["_id"],
            limit=LIST_LIMIT_MAX,
            session=session,
        )
        # `patch_one_in_db` per row and never `patch_many_in_db`, which records no `document_id`: the
        # redaction below must match the rows it logs (`app/api/kontakte/admin_router.py :: _clear_each`).
        cleared: list[Any] = []
        for row in junction_rows:
            await patch_one_in_db(
                collection=saison_teams_collection, db_filter={"_id": row["_id"]}, update={"$set": {"kontakte": None}}, session=session
            )
            cleared.append(row["_id"])
        redacted += await _redact(
            aktionen_collection=aktionen_collection, collection=Collection.SAISON_TEAMS, ids=cleared, stamp=stamp, session=session
        )

        return erased, len(cleared), redacted

    async with db.start_session() as session:
        erinnerungen = await session.with_transaction(remind)

    # Reads alone: the notice goes out first, and the erasure is the caller's second call.
    candidates = await pull_many_from_db(
        collection=bewerbungen_collection, db_filter={"saison_id": saison_id, "status": "eingereicht"}, limit=LIST_LIMIT_MAX
    )
    due = [row for row in candidates if deletion_is_due(bewerbung_raw=row, today=today)]
    club_names = await _club_names(teams_collection=teams_collection, rows=due, session=None) if due else {}
    loeschungen = [
        FLBewerbungSweepLoeschung(
            bewerbung_id=row["_id"],
            saison_id=saison_id,
            schule=schule_name(bewerbung_raw=row, club_names=club_names),
            bestaetigungsfrist=str(row["bestaetigungsfrist"]),
            ansprechperson_email=ansprechperson_email(kontakte=row.get("kontakte")),
            ausstehend=[
                FLBewerbungSweepAusstehend(rolle=seat, vorname=vorname_of(kontakte=row.get("kontakte"), seat=seat))
                for seat in ausstehende_seats(kontakte=row.get("kontakte"))
            ],
        )
        for row in due
    ]

    async with db.start_session() as session:
        abgelehnte, redacted_declined = await session.with_transaction(erase_declined)

    angenommene, geleert, redacted_accepted = 0, 0, 0
    if season_after_has_ended(next_saison_status=next_saison_status):
        async with db.start_session() as session:
            angenommene, geleert, redacted_accepted = await session.with_transaction(erase_accepted_and_clear_the_block)

    return FLBewerbungSweepResponse(
        saison_id=saison_id,
        erinnerungen=erinnerungen,
        loeschungen=loeschungen,
        abgelehnte_geloescht=abgelehnte,
        angenommene_geloescht=angenommene,
        kontaktbloecke_geleert=geleert,
        redigierte_aktionen=redacted_declined + redacted_accepted,
    )


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
    Erase the applications whose deletion notice the caller delivered, and redact every log row naming them.

    The ids are re-judged in-session: only one still submitted, past its deadline and with a seat outstanding is
    erased, so an application confirmed and accepted between the two calls survives, and an id from another season
    is skipped. 404 where no season has the id. An empty list answers zeros.
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
        ids = [row["_id"] for row in rows if deletion_is_due(bewerbung_raw=row, today=today)]
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
