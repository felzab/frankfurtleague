from collections.abc import Awaitable, Callable, Mapping
from typing import Any

from fastapi import APIRouter
from pymongo import ASCENDING, ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.bewerbungen.services import build_ended_after_filter, build_lapsed_seats_filter, compose_lapsed_seats_update, lapsed_seats
from app.api.kontakte.crud import remove_the_seats_reasons
from app.api.spielberichte.crud import strip_the_seasons_reports
from app.api.spielbestaetigungen.crud import strip_the_seasons_confirmations
from app.api.spielbestaetigungen.services import HeldSeats
from app.core.crud import patch_many_in_db, patch_one_in_db, pull_many_from_db, pull_one_from_db
from app.core.dependencies import (
    DBClient,
    GermanDay,
    SaisonsCollection,
    SaisonsReadCollection,
    SaisonTeamsCollection,
    SpielberichteCollection,
    SpielbestaetigungenCollection,
)
from app.core.middlewares import PASS
from app.core.recording import ACT_BY_SYSTEM, record_act
from app.core.security import SYSTEM_TIER
from app.core.transactions import Saved, save_each
from app.shared.saison import season_has_ended
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from app.shared.schemas.literals import FLSaisonStatus
from app.shared.schemas.responses import FLSaisonRetentionResponse, FLSweepSaisonsResponse

# System tier: the hourly passes hold no session, so `bind_actor` would refuse them.
router = APIRouter(prefix="/saisons", dependencies=SYSTEM_TIER)


# System tier rather than base: no base-tier season read serves a `future` season, which is the status every season
# with an open application holds.
@router.get("/sweep", summary="List the seasons an hourly pass visits")
async def get_sweep_saisons(saisons_collection: SaisonsReadCollection, status: FLSaisonStatus | None = None) -> FLSweepSaisonsResponse:
    """Every season's id, or every one of `status` where one is given, oldest first, for the caller to sweep one at a time."""

    seasons = await pull_many_from_db(
        collection=saisons_collection,
        db_filter={} if status is None else {"status": status},
        projection=["_id"],
        sort_by=[("_id", ASCENDING)],
        limit=LIST_LIMIT_DEFAULT,
    )

    return FLSweepSaisonsResponse(saison_ids=[str(season["_id"]) for season in seasons])


@router.post(
    "/{saison_id}/sweep",
    summary="Run one season's retention clocks over its season rows, fixture answers and match reports",
    openapi_extra=PASS,
)
async def sweep_saison_retention(
    saison_id: str,
    saison_teams_collection: SaisonTeamsCollection,
    saisons_collection: SaisonsCollection,
    spielbestaetigungen_collection: SpielbestaetigungenCollection,
    spielberichte_collection: SpielberichteCollection,
    db: DBClient,
    today: GermanDay,
) -> FLSaisonRetentionResponse:
    """Clear one season's contact blocks once a later season has ended, and each seat past its own day unconfirmed before.

    Once a later season has ended, the season's fixture answers and match reports keep the league's record alone. A row
    that cannot be written is passed over, counted in `failed`, and met again by the next pass, as is a clock written in
    one go whose write fails; what each clock cleared is recorded in the action log.
    """

    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=["status"])
    # Ahead of the guard below, so an id that is no year fails the running season's pass too.
    ended_after = build_ended_after_filter(saison_id)
    # Read once, here: no planned season stands below one that has ended, as no season is made while a planned one
    # stands, so no activation can land between this read and the clocks it gates.
    ended_raw = None if saison_raw.get("status") == "active" else await saisons_collection.find_one(ended_after, {"status": 1})
    later_saison_status = ended_raw.get("status") if ended_raw is not None else None

    # The one row of a step the season takes whole, which a failure's line names.
    the_season = [{"_id": saison_id}]

    # One write rather than one a row: no validator guards what it writes and no unique index the rows it takes, so no row
    # can fail alone, and a write that fails leaves every row due and is logged under the season.
    async def clear_the_blocks() -> Saved[int]:
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
            if not junction_rows:
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
                    saison_id=saison_id,
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
                saison_id=saison_id,
                count=len(seats),
                session=session,
            )

            return len(seats)

        rows = await pull_many_from_db(collection=saison_teams_collection, db_filter=clock, projection=["_id"], limit=LIST_LIMIT_DEFAULT)

        return await save_each(db=db, rows=rows, save=clear_one, what="Season team", clock="lapsed seat")

    async def strip_the_confirmations() -> Saved[None]:
        """A transaction apart from the blocks', so a failing strip holds back no block."""

        async def strip(session: AsyncClientSession, _: Mapping[str, Any]) -> None:
            await strip_the_seasons_confirmations(
                spielbestaetigungen_collection=spielbestaetigungen_collection, saison_id=saison_id, session=session
            )

        # Every pass strips what is still left, whether or not a block clears on it.
        return await save_each(db=db, rows=the_season, save=strip, what="Season", clock="confirmation strip")

    async def strip_the_reports() -> Saved[None]:
        """A transaction apart from the confirmations' strip, so neither failure holds the other."""

        async def strip(session: AsyncClientSession, _: Mapping[str, Any]) -> None:
            await strip_the_seasons_reports(spielberichte_collection=spielberichte_collection, saison_id=saison_id, session=session)

        return await save_each(db=db, rows=the_season, save=strip, what="Season", clock="report strip")

    steps: list[Callable[[], Awaitable[Saved[Any]]]] = (
        [clear_the_blocks, strip_the_confirmations, strip_the_reports]
        if season_has_ended(saison_status=later_saison_status)
        # Never beside the blocks, which take the seats with them.
        else [clear_the_lapsed_seats]
    )

    failed = 0
    for step in steps:
        saved = await step()
        failed += saved.failed
        # The deadline cut it, and every later step would meet the same deadline.
        if saved.cut:
            break

    return FLSaisonRetentionResponse(failed=failed)
