from collections.abc import Awaitable, Callable, Mapping
from typing import Any

from fastapi import APIRouter
from pymongo import ASCENDING, ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.bewerbungen.schemas import FLBewerbungSweepResponse
from app.api.bewerbungen.services import (
    acceptance_erasure_is_due,
    build_deletion_filter,
    build_lapsed_seats_filter,
    build_reminder_filter,
    closed_chases,
    compose_chase_update,
    compose_lapsed_seats_update,
    compose_reminder_update,
    decline_erasure_is_due,
    deletion_is_due,
    lapsed_seats,
    next_saison_id,
    outbox_key,
    owed_deletion_notices,
    owed_link,
    people_with_address,
    reminder_seats,
    schule_name,
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
from app.core.clock import days_after
from app.core.collections import Collection
from app.core.crud import (
    anchor_in_db,
    delete_many_from_db,
    patch_many_in_db,
    patch_one_in_db,
    patch_past_the_version_in_db,
    pull_many_from_db,
    pull_one_from_db,
)
from app.core.dependencies import (
    BewerbungenCollection,
    DBClient,
    GermanDay,
    GermanyNow,
    OutboxCollection,
    SaisonsCollection,
    SaisonsReadCollection,
    SaisonTeamsCollection,
    SpielberichteCollection,
    SpielbestaetigungenCollection,
    TeamsCollection,
)
from app.core.middlewares import PASS
from app.core.recording import ACT_BY_SYSTEM, record_act
from app.core.security import SYSTEM_TIER
from app.core.transactions import Saved, save_each
from app.shared.saison import season_has_ended
from app.shared.schemas.bounds import CONFIRMATION_DEADLINE_DAYS, LIST_LIMIT_DEFAULT
from app.shared.schemas.responses import FLSweepSaisonsResponse

# System tier: the sweep holds no session, so `bind_actor` would refuse it.
router = APIRouter(prefix="/bewerbungen", dependencies=SYSTEM_TIER)


def _ended_after(saison_id: str) -> dict[str, Any]:
    """Every season later than this one that has ended. Raises for an id that is no year, as `next_saison_id` does."""

    return {"_id": {"$gte": next_saison_id(saison_id)}, "status": "past"}


async def pull_the_season_after(
    *,
    saison_id: str,
    saisons_collection: SaisonsCollection,
    # Required: judged inside the erasing transaction, the anchor below commits with its erasure.
    session: AsyncClientSession,
) -> Any:
    """A later ended season's status, judged in the erasing transaction, `None` while this one runs.

    The accepted clock and the contact block wait on one test: any season after this one has ended.
    """

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
    if own_status == "future" and season_has_ended(saison_status=later_saison_status):
        await anchor_in_db(collection=saisons_collection, db_filter={"_id": saison_id}, session=session)

    return later_saison_status


@router.get("/sweep", summary="Every season the sweep has to visit")
async def get_sweep_saisons(saisons_collection: SaisonsReadCollection) -> FLSweepSaisonsResponse:
    """Every season's id, oldest first, for the caller to sweep one at a time."""

    seasons = await pull_many_from_db(
        collection=saisons_collection, db_filter={}, projection=["_id"], sort_by=[("_id", 1)], limit=LIST_LIMIT_DEFAULT
    )

    return FLSweepSaisonsResponse(saison_ids=[str(season["_id"]) for season in seasons])


@router.post(
    "/saisons/{saison_id}/sweep",
    summary="Run one season's retention clocks",
    openapi_extra=PASS,
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
    today: GermanDay,
    germany_now: GermanyNow,
) -> FLBewerbungSweepResponse:
    """Run one season's retention clocks as of today, each reminder and deletion notice owed in the write it belongs to.

    A row that cannot be written is passed over, counted in `failed`, and met again by the next pass, as is a clock
    written in one go whose write fails; what each clock erased is recorded in the action log.
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

    # The one row of a step the season takes whole, which a failure's line names.
    the_season = [{"_id": saison_id}]

    async def erase(ids: list[Any], session: AsyncClientSession) -> int:
        """Applications gone with their one row, in their own transaction, so no deletion stands without its row."""

        result = await delete_many_from_db(collection=bewerbungen_collection, db_filter={"_id": {"$in": ids}}, session=session)
        if result.deleted_count:
            await record_act(
                collection=bewerbungen_collection,
                action="retention.bewerbungen",
                by=ACT_BY_SYSTEM,
                label=saison_id,
                count=result.deleted_count,
                session=session,
            )

        return result.deleted_count

    async def due_ids(db_filter: Mapping[str, Any], *, sort_by: list[tuple[str, int]] | None = None) -> list[Mapping[str, Any]]:
        """One read's worth of a clock's rows, each judged again in its own transaction.

        The deadline ends the pass long before the read's last row, and the rest are the next pass's.
        """

        return await pull_many_from_db(
            collection=bewerbungen_collection, db_filter=db_filter, projection=["_id"], sort_by=sort_by, limit=LIST_LIMIT_DEFAULT
        )

    async def erase_with_its_notices(session: AsyncClientSession, row: Mapping[str, Any]) -> int:
        """One application gone, each notice it owes owed in the same write: nothing of it is left to read once this commits."""

        await enqueue_mails(
            outbox_collection=outbox_collection,
            session=session,
            mails=owed_deletion_notices(bewerbung_raw=row, saison_id=saison_id),
            now=germany_now,
        )

        return await erase([row["_id"]], session)

    async def erase_the_undecided() -> Saved[int]:
        """The season's own end, undecided having served nothing: owe the notice and erase, one application at a time."""

        clock = {"saison_id": saison_id, "status": "submitted"}

        async def erase_one(session: AsyncClientSession, row: Mapping[str, Any]) -> int:
            stored = await bewerbungen_collection.find_one({"_id": row["_id"], **clock}, session=session)
            if stored is None or not undecided_erasure_is_due(bewerbung_raw=stored, saison_status=saison_status):
                return 0

            return await erase_with_its_notices(session, stored)

        return await save_each(db=db, rows=await due_ids(clock), save=erase_one, what="Application", clock="season's end")

    async def erase_the_unconfirmed() -> Saved[int]:
        """The fourteen-day clock: owe the notice and erase, one application at a time."""

        clock = build_deletion_filter(saison_id=saison_id, today=today)

        async def erase_one(session: AsyncClientSession, row: Mapping[str, Any]) -> int:
            stored = await bewerbungen_collection.find_one({"_id": row["_id"], **clock}, session=session)
            if stored is None or not deletion_is_due(bewerbung_raw=stored, today=today):
                return 0

            return await erase_with_its_notices(session, stored)

        return await save_each(db=db, rows=await due_ids(clock), save=erase_one, what="Application", clock="fourteen-day")

    async def remind() -> Saved[int]:
        """Stamp each seat due its one reminder and owe its person the mail, one application at a time.

        A seat no mail reaches has its chase closed instead, so it leaves the read rather than hiding a newer row.
        """

        clock = build_reminder_filter(saison_id=saison_id, today=today)

        async def remind_one(session: AsyncClientSession, row: Mapping[str, Any]) -> int:
            stored = await bewerbungen_collection.find_one({"_id": row["_id"], **clock}, session=session)
            if stored is None:
                return 0

            # The seats' last mails, read in the same transaction: a seat whose mail did not arrive is not chased.
            states = await states_of(
                outbox_collection=outbox_collection, collection=Collection.BEWERBUNGEN, ids=[stored["_id"]], session=session
            )
            unreachable = unreachable_seats(row=stored, states=states)
            seats = reminder_seats(bewerbung_raw=stored, today=today, unreachable=unreachable)
            # One mail a person: an address is one person, whose one link answers every seat they hold.
            people = people_with_address(kontakte=stored.get("kontakte"), seats=seats)
            closing = closed_chases(bewerbung_raw=stored, today=today, unreachable=unreachable)

            mails: list[OwedMail] = []
            if people:
                # A mail names the school, and the row holds only its id.
                team_names = await pull_team_names(teams_collection=teams_collection, team_ids=[stored.get("team_id")], session=session)
                schule = schule_name(bewerbung_raw=stored, team_names=team_names)
                # Built before any stamp, so a row the mail's facts refuse writes nothing.
                mails = [
                    owed_link(
                        kind="bewerbung_reminder",
                        bewerbung_id=stored["_id"],
                        kontakte=stored["kontakte"],
                        seats=held,
                        saison_id=saison_id,
                        schule=schule,
                        # The deadline the seat's last mail gave; a reminder does not move it.
                        deadline=str(stored["confirmations"][held[0]]["deadline"]),
                        # The day too: a re-send clears the stamp, and the seat's next reminder is a mail of its own.
                        key=outbox_key(stored["_id"], "reminder", held[0], today),
                    )
                    for _, held in people
                ]
                # Past the version, the stamp and the chase both: mail bookkeeping no form saves, so a decision read
                # before the pass still lands.
                await patch_past_the_version_in_db(
                    collection=bewerbungen_collection,
                    db_filter={"_id": stored["_id"]},
                    update=compose_reminder_update(seats=[seat for _, held in people for seat in held], today=today),
                    session=session,
                )
            if closing:
                await patch_past_the_version_in_db(
                    collection=bewerbungen_collection,
                    db_filter={"_id": stored["_id"]},
                    update=compose_chase_update(seats=closing, closed_at=today),
                    session=session,
                )
            # In the stamp's own transaction: a stamp never stands without its mail, nor a mail without its stamp.
            await enqueue_mails(outbox_collection=outbox_collection, session=session, mails=mails, now=germany_now)

            return len(mails)

        # Oldest first, as near the fourteen-day clock's order as a key on the record comes, each seat keeping its own
        # day; `_id` makes the read the same whichever plan the server picks.
        rows = await due_ids(clock, sort_by=[("submitted_at", ASCENDING), ("_id", ASCENDING)])

        return await save_each(db=db, rows=rows, save=remind_one, what="Application", clock="reminder")

    # The two pure deletions below, and the blocks' clearing, are one write each rather than one a row: no validator
    # guards what they write and no unique index the rows they take, so no row can fail alone, and a write that fails
    # leaves every row due and is logged under the season.

    async def erase_declined() -> Saved[int]:
        async def erase_them(session: AsyncClientSession, _: Mapping[str, Any]) -> int:
            rows = await pull_many_from_db(
                collection=bewerbungen_collection,
                # Narrowed to the decisions whose days are behind them: a read full of fresh ones would hide a due one.
                db_filter={
                    "saison_id": saison_id,
                    "status": "declined",
                    "decision.made_at": {"$lte": days_after(day=today, days=-CONFIRMATION_DEADLINE_DAYS)},
                },
                projection=["status", "decision"],
                limit=LIST_LIMIT_DEFAULT,
                session=session,
            )
            ids = [row["_id"] for row in rows if decline_erasure_is_due(bewerbung_raw=row, today=today)]

            return await erase(ids, session) if ids else 0

        return await save_each(db=db, rows=the_season, save=erase_them, what="Season", clock="decline")

    async def erase_accepted() -> Saved[int]:
        """The season-and-one clock's first half."""

        async def erase_them(session: AsyncClientSession, _: Mapping[str, Any]) -> int:
            # Read ahead of the season's own: an activation committing after it conflicts with the anchor that read writes.
            rows = await pull_many_from_db(
                collection=bewerbungen_collection,
                db_filter={"saison_id": saison_id, "status": "accepted"},
                projection=["status"],
                limit=LIST_LIMIT_DEFAULT,
                session=session,
            )
            later_status = await pull_the_season_after(saison_id=saison_id, saisons_collection=saisons_collection, session=session)
            ids = [row["_id"] for row in rows if acceptance_erasure_is_due(bewerbung_raw=row, later_saison_status=later_status)]

            return await erase(ids, session) if ids else 0

        return await save_each(db=db, rows=the_season, save=erase_them, what="Season", clock="acceptance")

    async def clear_the_blocks() -> Saved[int]:
        """The season-and-one clock's second half."""

        async def clear_them(session: AsyncClientSession, _: Mapping[str, Any]) -> int:
            junction_rows = await pull_many_from_db(
                collection=saison_teams_collection,
                # Either block standing, not `kontakte` alone, so no row's links, and their delivery records,
                # outlive its people whichever write cleared them.
                db_filter={"saison_id": saison_id, "$or": [{"kontakte": {"$ne": None}}, {"confirmations": {"$ne": None}}]},
                projection=["_id"],
                limit=LIST_LIMIT_DEFAULT,
                session=session,
            )
            if not junction_rows or not season_has_ended(
                saison_status=await pull_the_season_after(saison_id=saison_id, saisons_collection=saisons_collection, session=session)
            ):
                return 0

            result = await patch_many_in_db(
                collection=saison_teams_collection,
                db_filter={"_id": {"$in": [row["_id"] for row in junction_rows]}},
                # The links go with their people: each holds a token hash and the delivery record of the
                # message it went out in, and no delivery state has a clock of its own.
                update={"$set": {"kontakte": None, "confirmations": None}},
                session=session,
            )
            if result.modified_count:
                await record_act(
                    collection=saison_teams_collection,
                    action="retention.kontakte",
                    by=ACT_BY_SYSTEM,
                    label=saison_id,
                    count=result.modified_count,
                    session=session,
                )

            return result.modified_count

        return await save_each(db=db, rows=the_season, save=clear_them, what="Season", clock="contact block")

    async def clear_the_lapsed_seats() -> Saved[int]:
        """A season row's seat past its own day unconfirmed, one row at a time."""

        clock = build_lapsed_seats_filter(saison_id=saison_id, today=today)

        async def clear_one(session: AsyncClientSession, row: Mapping[str, Any]) -> int:
            stored = await saison_teams_collection.find_one(
                {"_id": row["_id"], **clock}, {"team_id": 1, "kontakte": 1, "confirmations": 1}, session=session
            )
            if stored is None:
                return 0

            stored_kontakte = stored.get("kontakte")
            seats = lapsed_seats(kontakte=stored_kontakte, confirmations=stored.get("confirmations"), today=today)
            # A `$set` of nothing is refused, and the filter already says a seat lapsed.
            if not seats:
                return 0

            await patch_one_in_db(
                collection=saison_teams_collection,
                db_filter={"_id": stored["_id"]},
                update=compose_lapsed_seats_update(kontakte=stored_kontakte, seats=seats),
                session=session,
                expected_version=None,
                return_document=ReturnDocument.BEFORE,
            )
            # The seats' people leave as a Widerspruch's do.
            await remove_the_seats_reasons(
                spielbestaetigungen_collection=spielbestaetigungen_collection,
                held=[HeldSeats(saison_id=saison_id, team_id=stored["team_id"], seats=tuple(seats))],
                session=session,
            )
            await record_act(
                collection=saison_teams_collection,
                action="retention.kontakte",
                by=ACT_BY_SYSTEM,
                label=saison_id,
                count=len(seats),
                session=session,
            )

            return len(seats)

        rows = await pull_many_from_db(collection=saison_teams_collection, db_filter=clock, projection=["_id"], limit=LIST_LIMIT_DEFAULT)

        return await save_each(db=db, rows=rows, save=clear_one, what="Season team", clock="lapsed seat")

    async def strip_the_confirmations() -> Saved[None]:
        """The season-and-one clock's last part, a transaction apart from the blocks', so a failing strip holds back no block."""

        async def strip(session: AsyncClientSession, _: Mapping[str, Any]) -> None:
            if season_has_ended(
                saison_status=await pull_the_season_after(saison_id=saison_id, saisons_collection=saisons_collection, session=session)
            ):
                await strip_the_seasons_confirmations(
                    spielbestaetigungen_collection=spielbestaetigungen_collection, saison_id=saison_id, session=session
                )

        # Every pass strips what is still left, whether or not a block clears on it.
        return await save_each(db=db, rows=the_season, save=strip, what="Season", clock="confirmation strip")

    async def strip_the_reports() -> Saved[None]:
        """The season-and-one clock's report part, a transaction apart from the confirmations' strip, so neither failure holds the other."""

        async def strip(session: AsyncClientSession, _: Mapping[str, Any]) -> None:
            if season_has_ended(
                saison_status=await pull_the_season_after(saison_id=saison_id, saisons_collection=saisons_collection, session=session)
            ):
                await strip_the_seasons_reports(spielberichte_collection=spielberichte_collection, saison_id=saison_id, session=session)

        return await save_each(db=db, rows=the_season, save=strip, what="Season", clock="report strip")

    steps: list[Callable[[], Awaitable[Saved[Any]]]] = []
    # Ahead of the fourteen-day clock and the reminder, which read the collection after it: a season that has ended
    # leaves nobody to chase, and a notice about an application this pass erased is a notice about nothing.
    if season_has_ended(saison_status=saison_status):
        steps.append(erase_the_undecided)
    steps.append(erase_declined)
    # A gate alone, each erasing transaction judging the season again: an activation since this read keeps its rows.
    if season_has_ended(saison_status=later_saison_status):
        steps += [erase_accepted, clear_the_blocks, strip_the_confirmations, strip_the_reports]
    # Never beside the blocks, which take the seats with them.
    else:
        steps.append(clear_the_lapsed_seats)
    # Every erasure before the reminder, which owes a mail only to an application still standing.
    steps += [erase_the_unconfirmed, remind]

    failed = 0
    for step in steps:
        saved = await step()
        failed += saved.failed
        # The deadline cut it, and every later step would meet the same deadline.
        if saved.cut:
            break

    return FLBewerbungSweepResponse(failed=failed)
