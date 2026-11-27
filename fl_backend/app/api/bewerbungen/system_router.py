from collections.abc import Awaitable, Callable, Mapping
from typing import Any

from fastapi import APIRouter
from pymongo import ASCENDING
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.bewerbungen.schemas import FLBewerbungSweepResponse
from app.api.bewerbungen.services import (
    build_deletion_filter,
    build_ended_after_filter,
    build_reminder_filter,
    compose_reminder_update,
    outbox_key,
    owed_deletion_notices,
    owed_link,
    people_with_address,
    reminder_seats,
    unreachable_seats,
)
from app.api.outbox.crud import states_of
from app.api.outbox.services import OwedMail, enqueue_mails
from app.core.clock import days_after
from app.core.collections import Collection
from app.core.crud import (
    delete_many_from_db,
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
)
from app.core.middlewares import PASS
from app.core.recording import ACT_BY_SYSTEM, record_act
from app.core.security import SYSTEM_TIER
from app.core.transactions import Saved, save_each
from app.shared.saison import season_has_ended
from app.shared.schemas.bounds import CONFIRMATION_DEADLINE_DAYS, LIST_LIMIT_DEFAULT

# System tier: the sweep holds no session, so `bind_actor` would refuse it.
router = APIRouter(prefix="/bewerbungen", dependencies=SYSTEM_TIER)


@router.post(
    "/saisons/{saison_id}/sweep",
    summary="Run one season's application clocks",
    openapi_extra=PASS,
)
async def sweep_saison(
    saison_id: str,
    bewerbungen_collection: BewerbungenCollection,
    saisons_collection: SaisonsCollection,
    outbox_collection: OutboxCollection,
    db: DBClient,
    today: GermanDay,
    germany_now: GermanyNow,
) -> FLBewerbungSweepResponse:
    """Run one season's application clocks as of today, each reminder and deletion notice owed in the write it belongs to.

    A row that cannot be written is passed over, counted in `failed`, and met again by the next pass, as is a clock
    written in one go whose write fails; what each clock erased is recorded in the action log.
    """

    # The read that answers the 404 carries the status: this season's own end is a clock too, and a
    # second query for a document already in hand would be a second answer to when it ended.
    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status"])
    saison_status = saison_raw.get("status")

    # Ahead of the guard below, so an id that is no year fails the running season's pass too.
    ended_after = build_ended_after_filter(saison_id)
    # Read once, here: no planned season stands below one that has ended, as no season is made while a planned one
    # stands, so no activation can land between this read and the clock it gates.
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
                saison_id=saison_id,
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

            return 0 if stored is None else await erase_with_its_notices(session, stored)

        return await save_each(db=db, rows=await due_ids(clock), save=erase_one, what="Application", clock="season's end")

    async def erase_the_unconfirmed() -> Saved[int]:
        """The confirmation deadline's clock: owe the notice and erase, one application at a time."""

        clock = build_deletion_filter(saison_id=saison_id, today=today)

        async def erase_one(session: AsyncClientSession, row: Mapping[str, Any]) -> int:
            stored = await bewerbungen_collection.find_one({"_id": row["_id"], **clock}, session=session)

            return 0 if stored is None else await erase_with_its_notices(session, stored)

        return await save_each(db=db, rows=await due_ids(clock), save=erase_one, what="Application", clock="confirmation deadline")

    async def remind() -> Saved[int]:
        """Stamp each seat due its one reminder and owe its person the mail, one application at a time."""

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

            mails: list[OwedMail] = []
            if people:
                # Built before any stamp, so a row the mail's facts refuse writes nothing.
                mails = [
                    owed_link(
                        kind="bewerbung_reminder",
                        bewerbung_id=stored["_id"],
                        kontakte=stored["kontakte"],
                        seats=held,
                        saison_id=saison_id,
                        # The deadline the seat's last mail gave; a reminder does not move it.
                        deadline=str(stored["confirmations"][held[0]]["deadline"]),
                        # The day too: a re-send clears the stamp, and the seat's next reminder is a mail of its own.
                        key=outbox_key(stored["_id"], "reminder", held[0], today),
                    )
                    for _, held in people
                ]
                # Past the version: the stamp is mail bookkeeping no form saves, so a decision read before the pass
                # still lands.
                await patch_past_the_version_in_db(
                    collection=bewerbungen_collection,
                    db_filter={"_id": stored["_id"]},
                    update=compose_reminder_update(seats=[seat for _, held in people for seat in held], today=today),
                    session=session,
                )
            # In the stamp's own transaction: a stamp never stands without its mail, nor a mail without its stamp.
            await enqueue_mails(outbox_collection=outbox_collection, session=session, mails=mails, now=germany_now)

            return len(mails)

        # Oldest first, as near the confirmation deadline's order as a key on the record comes, each seat keeping its own
        # day; `_id` makes the read the same whichever plan the server picks.
        rows = await due_ids(clock, sort_by=[("submitted_at", ASCENDING), ("_id", ASCENDING)])

        return await save_each(db=db, rows=rows, save=remind_one, what="Application", clock="reminder")

    # The two pure deletions below are one write each rather than one a row: no validator guards what they write and no
    # unique index the rows they take, so no row can fail alone, and a write that fails leaves every row due and is
    # logged under the season.

    async def erase_declined() -> Saved[int]:
        """The decline clock: a declined application goes a confirmation deadline's days after the decision, that day included."""

        async def erase_them(session: AsyncClientSession, _: Mapping[str, Any]) -> int:
            rows = await pull_many_from_db(
                collection=bewerbungen_collection,
                # The rule in the query: a read full of fresh decisions would hide a due one.
                db_filter={
                    "saison_id": saison_id,
                    "status": "declined",
                    "decision.made_at": {"$lte": days_after(day=today, days=-CONFIRMATION_DEADLINE_DAYS)},
                },
                projection=["_id"],
                limit=LIST_LIMIT_DEFAULT,
                session=session,
            )
            ids = [row["_id"] for row in rows]

            return await erase(ids, session) if ids else 0

        return await save_each(db=db, rows=the_season, save=erase_them, what="Season", clock="decline")

    async def erase_accepted() -> Saved[int]:
        """The season-and-one clock: an accepted application goes once a later season has ended, as its season row's blocks do."""

        async def erase_them(session: AsyncClientSession, _: Mapping[str, Any]) -> int:
            rows = await pull_many_from_db(
                collection=bewerbungen_collection,
                db_filter={"saison_id": saison_id, "status": "accepted"},
                projection=["_id"],
                limit=LIST_LIMIT_DEFAULT,
                session=session,
            )
            ids = [row["_id"] for row in rows]

            return await erase(ids, session) if ids else 0

        return await save_each(db=db, rows=the_season, save=erase_them, what="Season", clock="acceptance")

    steps: list[Callable[[], Awaitable[Saved[Any]]]] = []
    # Ahead of the confirmation deadline's clock and the reminder, which read the collection after it: a season that has ended
    # leaves nobody to chase, and a notice about an application this pass erased is a notice about nothing.
    if season_has_ended(saison_status=saison_status):
        steps.append(erase_the_undecided)
    steps.append(erase_declined)
    if season_has_ended(saison_status=later_saison_status):
        steps.append(erase_accepted)
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
