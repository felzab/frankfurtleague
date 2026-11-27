from collections.abc import Mapping
from typing import Any

from fastapi import APIRouter
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.grants.guard import ADMIN_TIER
from app.api.saisons.services import find_saison_past_refusal
from app.api.spieltage.schemas import (
    FLPatchSpieltagPayload,
    FLSpieltagAdmin,
    FLSpieltagAdminResponse,
    FLSpieltagRecord,
)
from app.api.spieltage.services import find_spieltag_order_refusal, find_spieltag_span_refusal
from app.core.crud import anchor_in_db, patch_one_in_db, pull_one_from_db, pull_whole_from_db, refuse, refuse_faults
from app.core.dependencies import (
    DBClient,
    SaisonsCollection,
    SaisonsReadCollection,
    SpieleCollection,
    SpieltageCollection,
    SpieltageReadCollection,
)
from app.core.exceptions import FieldFault
from app.core.recording import record_act
from app.core.routing import by_id
from app.core.transactions import transact
from app.shared.schemas.custom import CustomObjectId
from app.shared.schemas.responses import FLVersionResponse

router = APIRouter(
    prefix="/spieltage",
    dependencies=ADMIN_TIER,
)


@router.get(
    by_id("spieltag_id"),
    summary="One Spieltag for the admin editor",
)
async def get_spieltag_admin(
    spieltag_id: CustomObjectId,
    spieltage_collection: SpieltageReadCollection,
    saisons_collection: SaisonsReadCollection,
) -> FLSpieltagAdminResponse:
    """One matchday by its id, a `future` season's included, with how many matchdays its phase holds.

    Beside it stands its season's `status`, so a `past` season's matchday, which no re-dating moves, can be shown as
    final.
    """

    spieltag_raw = await pull_one_from_db(collection=spieltage_collection, db_filter={"_id": spieltag_id})

    # Its own season's `status`, the one the re-dating judges.
    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": spieltag_raw["saison_id"]}, projection=["status"])
    count_spieltage_in_phase = await spieltage_collection.count_documents(
        {"saison_id": spieltag_raw["saison_id"], "saison_phase": spieltag_raw["saison_phase"]}
    )

    return FLSpieltagAdminResponse(
        spieltag=FLSpieltagAdmin.model_validate({**spieltag_raw, "count_spieltage_in_phase": count_spieltage_in_phase}),
        saison_status=saison_raw["status"],
    )


async def _find_out_of_order_start(
    *,
    spieltage_collection: AsyncCollection,
    saisons_collection: AsyncCollection,
    stored_raw: Mapping[str, Any],
    start: str,
    # Required: the anchor below is what closes the race, so forgetting the session has to be a
    # TypeError at the call rather than a silent reopening of it.
    session: AsyncClientSession,
) -> FieldFault | None:
    """`spieltag_start_out_of_order` where this matchday's new `start` breaks the order its phase's positions are dated in."""

    # The neighbour reads are the whole of what two writers dating one phase share, and a read is
    # what a snapshot re-validates nowhere -- so the season is written to put the two in one write set.

    await anchor_in_db(
        collection=saisons_collection,
        db_filter={"_id": stored_raw["saison_id"]},
        session=session,
    )

    neighbourhood = {
        "saison_id": stored_raw["saison_id"],
        # The phase is part of the key: positions restart at 1 in each, so a matchday of another
        # phase is no neighbour. An undated one states no date to compare and is stepped over.
        "saison_phase": stored_raw["saison_phase"],
        "start": {"$ne": None},
    }
    previous_raw = await spieltage_collection.find_one(
        {**neighbourhood, "position": {"$lt": stored_raw["position"]}}, {"start": 1}, sort=[("position", -1)], session=session
    )
    following_raw = await spieltage_collection.find_one(
        {**neighbourhood, "position": {"$gt": stored_raw["position"]}}, {"start": 1}, sort=[("position", 1)], session=session
    )

    return find_spieltag_order_refusal(
        start=start,
        # Each `start` as stored, string or null, and never through `str()`, which would turn an undated row into a day
        # above every ISO date.
        stored_start=stored_raw["start"],
        previous_start=None if previous_raw is None else previous_raw["start"],
        following_start=None if following_raw is None else following_raw["start"],
    )


@router.patch(
    by_id("spieltag_id"),
    summary="Re-date a Spieltag",
)
async def patch_spieltag(
    spieltag_id: CustomObjectId,
    spieltag_data: FLPatchSpieltagPayload,
    spieltage_collection: SpieltageCollection,
    saisons_collection: SaisonsCollection,
    spiele_collection: SpieleCollection,
    db: DBClient,
) -> FLVersionResponse:
    """Move a matchday's span, answering its `version` after the save.

    The span stays inside its season and around its own dated fixtures, and its `start` keeps the order its phase is
    dated in.
    """

    async def redate_the_matchday(session: AsyncClientSession) -> FLVersionResponse:
        stored_raw = await pull_one_from_db(collection=spieltage_collection, db_filter={"_id": spieltag_id}, session=session)

        # The season bounds the span. Its `status` read here stays current through the write: the order's judgement
        # writes the season document, which `activate_saison` writes too, so a rollover landing under this save
        # conflicts with it and the retry reads `past`.
        saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": stored_raw["saison_id"]}, session=session)
        refuse(find_saison_past_refusal(saison_status=str(saison_raw["status"])))

        # Undated fixtures are filtered out rather than passed as nulls: one constrains nothing.
        spiel_dates = [
            row["date"]
            for row in await pull_whole_from_db(
                collection=spiele_collection,
                db_filter={"spieltag_id": spieltag_id, "date": {"$ne": None}},
                projection={"date": 1},
                session=session,
            )
        ]
        span = find_spieltag_span_refusal(
            start=spieltag_data.start,
            end=spieltag_data.end,
            saison_start=saison_raw["start_date"],
            saison_end=saison_raw["end_date"],
            spiel_dates=spiel_dates,
        )
        refuse_faults(
            span,
            # Behind a span fault on the start, and reaching for its neighbours only once it holds none: a start outside
            # the season or past its fixtures is wrong on its own terms, where this one is wrong only beside them.
            None
            if any(fault.path == ("start",) for fault in span)
            else await _find_out_of_order_start(
                spieltage_collection=spieltage_collection,
                saisons_collection=saisons_collection,
                stored_raw=stored_raw,
                start=spieltag_data.start,
                session=session,
            ),
        )

        updated_raw = await patch_one_in_db(
            collection=spieltage_collection,
            db_filter={"_id": spieltag_id},
            update={"$set": spieltag_data.model_dump(mode="json", exclude={"version"})},
            expected_version=spieltag_data.version,
            session=session,
            return_document=ReturnDocument.AFTER,
        )
        await record_act(
            collection=spieltage_collection,
            action="spieltag.changed",
            record_id=spieltag_id,
            saison_id=str(stored_raw["saison_id"]),
            session=session,
        )

        return FLVersionResponse(version=FLSpieltagRecord.model_validate(updated_raw).version)

    # One transaction over the span and the season write inside `_find_out_of_order_start`,
    # which is what makes two matchdays of one phase contend.
    return await transact(db, redate_the_matchday)
