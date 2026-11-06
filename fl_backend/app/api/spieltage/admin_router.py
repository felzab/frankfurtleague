from collections.abc import Mapping
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.berechtigungen.guard import verify_actor_is_admin
from app.api.saisons.crud import pull_saison_id_and_rules
from app.api.saisons.schemas import FLSaisonRules
from app.api.saisons.services import find_saison_past_refusal
from app.api.spieltage.schemas import (
    FLPatchSpieltagPayload,
    FLSpieltagAdmin,
    FLSpieltagAdminResponse,
    FLSpieltageFilterParams,
    FLSpieltageListResponse,
    FLSpieltagListAdapter,
    FLSpieltagRecord,
    FLSpieltagWriteResponse,
)
from app.api.spieltage.services import (
    build_spieltage_filter,
    build_spieltage_sort,
    dated_neighbour,
    dated_start,
    find_spieltag_order_refusal,
    find_spieltag_span_refusal,
    order_spieltage,
    with_expected_matches,
)
from app.core.config import API_VERSION
from app.core.crud import anchor_in_db, patch_one_in_db, pull_many_from_db, pull_one_from_db, refuse
from app.core.dependencies import DBClient, SaisonsCollection, SpieleCollection, SpieltageCollection, SpieltageReadCollection
from app.core.routing import by_id
from app.core.security import bind_actor, verify_access_admin
from app.core.transactions import transaction_session
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spieltage",
    dependencies=[Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor)],
)


# Two static segments, matching `GET /saisons/list/admin`. Declared before `{spieltag_id}/admin`,
# whose only separation from this path is the `objectid` convertor.
@router.get(
    "/list/admin",
    response_model=FLSpieltageListResponse,
    summary="Spieltage for the admin surfaces",
)
async def get_spieltage_admin(
    spieltage_collection: SpieltageReadCollection,
    saisons_collection: SaisonsCollection,
    filters: FLSpieltageFilterParams = Depends(),
) -> FLSpieltageListResponse:
    """
    List a season's matchdays for the admin surfaces, a `future` season's included.

    No season gate: a season's matchdays are drawn while it is planned, and dating them is what this
    list is for.
    """

    # Resolved without the public gate: refusing the planned season is the one thing this must not do.
    filters.saison_id, rules = await pull_saison_id_and_rules(saisons_collection=saisons_collection, saison_id=filters.saison_id)

    spieltage_raw = await pull_many_from_db(
        collection=spieltage_collection,
        db_filter=build_spieltage_filter(filters=filters),
        limit=filters.limit,
        sort_by=build_spieltage_sort(sort_by=filters.sort_by, order=filters.order),
    )
    spieltage = FLSpieltagListAdapter.validate_python([with_expected_matches(raw, rules) for raw in spieltage_raw])

    # After the read: the phase's RANK is on no document, so no Mongo sort can put the phases in the
    # order they are played.
    if filters.sort_by == "natural":
        spieltage = order_spieltage(spieltage)
        if filters.order == "desc":
            spieltage.reverse()

    return FLSpieltageListResponse(spieltage=spieltage)


# A static suffix rather than a second `GET /{spieltag_id}`, as the Spiel editor's read has: the
# public router owns that path at this same prefix, so whichever router registered first would answer both.
@router.get(
    f"{by_id('spieltag_id')}/admin",
    response_model=FLSpieltagAdminResponse,
    summary="One Spieltag for the admin editor",
)
async def get_spieltag_admin(
    spieltag_id: CustomRouteObjectId,
    spieltage_collection: SpieltageReadCollection,
    saisons_collection: SaisonsCollection,
) -> FLSpieltagAdminResponse:
    """
    Return one matchday by its id for the admin editor, a `future` season's included.

    The shape of `GET /spieltage/{spieltag_id}`, without its season gate, plus `count_spieltage_in_phase`, how many
    matchdays its phase holds: the editor opens a matchday to date it, and that happens before its season is ever
    activated. Beside it its season's `status`, read as the re-dating judges it, so the editor opens read-only on
    exactly the season the write refuses (`saison_past`).
    """

    spieltag_raw = await pull_one_from_db(collection=spieltage_collection, db_filter={"_id": spieltag_id})

    # Its OWN season, as the base read resolves it: `count_spiele` derives from that season's rules.
    saison_raw = await pull_one_from_db(
        collection=saisons_collection, db_filter={"_id": spieltag_raw["saison_id"]}, projection=["rules", "status"]
    )
    count_spieltage_in_phase = await spieltage_collection.count_documents(
        {"saison_id": spieltag_raw["saison_id"], "saison_phase": spieltag_raw["saison_phase"]}
    )

    return FLSpieltagAdminResponse(
        spieltag=FLSpieltagAdmin.model_validate(
            {
                **with_expected_matches(spieltag_raw, FLSaisonRules.model_validate(saison_raw["rules"])),
                "count_spieltage_in_phase": count_spieltage_in_phase,
            }
        ),
        saison_status=saison_raw["status"],
    )


async def _refuse_an_out_of_order_start(
    *,
    spieltage_collection: AsyncCollection,
    saisons_collection: AsyncCollection,
    stored_raw: Mapping[str, Any],
    start: str,
    # REQUIRED: the anchor below is what closes the race, so forgetting the session has to be a
    # TypeError at the call rather than a silent reopening of it.
    session: AsyncClientSession,
) -> None:
    """Refuse `spieltag_start_out_of_order` when this matchday's new `start` breaks the order its phase's positions are dated in."""

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
    neighbour_fields = {"position": 1, "start": 1}
    previous_raw = await spieltage_collection.find_one(
        {**neighbourhood, "position": {"$lt": stored_raw["position"]}}, neighbour_fields, sort=[("position", -1)], session=session
    )
    following_raw = await spieltage_collection.find_one(
        {**neighbourhood, "position": {"$gt": stored_raw["position"]}}, neighbour_fields, sort=[("position", 1)], session=session
    )

    refuse(
        find_spieltag_order_refusal(
            start=start,
            # The read its neighbours go through as well, so what an undated row means is decided in
            # one place rather than at each side of the comparison.
            stored_start=dated_start(stored_raw),
            previous=dated_neighbour(previous_raw),
            following=dated_neighbour(following_raw),
        )
    )


@router.patch(
    by_id("spieltag_id"),
    response_model=FLSpieltagWriteResponse,
    summary="Re-date a Spieltag",
)
async def patch_spieltag(
    spieltag_id: CustomRouteObjectId,
    spieltag_data: Annotated[FLPatchSpieltagPayload, Body()],
    spieltage_collection: SpieltageCollection,
    saisons_collection: SaisonsCollection,
    spiele_collection: SpieleCollection,
    db: DBClient,
) -> FLSpieltagWriteResponse:
    """
    Move a matchday's span, answering the matchday's `version` after the save.

    No fan-out: matches embed no copy, so a re-dated matchday is picked up on the next read. The span is held
    to its season's, to the days its own fixtures stand on, and its `start` to the order its phase is dated in. A
    `past` season's matchday is refused (`saison_past`), as its fixtures' saves are: a finished season's record is
    closed.
    """

    async def redate_the_matchday(session: AsyncClientSession) -> FLSpieltagWriteResponse:
        """Judge, then move the span. Everything judged is read in-session, the phase's neighbours inside `_refuse_an_out_of_order_start`."""

        stored_raw = await pull_one_from_db(collection=spieltage_collection, db_filter={"_id": spieltag_id}, session=session)

        # The season bounds the span. Its `status` read here stays current through the write: the order's judgement
        # writes the season document, which `activate_saison` writes too, so a rollover landing under this save
        # conflicts with it and the retry reads `past`.
        saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": stored_raw["saison_id"]}, session=session)
        refuse(find_saison_past_refusal(saison_status=str(saison_raw["status"])))

        # Undated fixtures are filtered out rather than passed as nulls: one constrains nothing.
        fixture_dates = [
            row["date"]
            async for row in spiele_collection.find({"spieltag_id": spieltag_id, "date": {"$ne": None}}, {"date": 1}, session=session)
        ]
        refuse(
            find_spieltag_span_refusal(
                start=spieltag_data.start,
                end=spieltag_data.end,
                saison_start=saison_raw["start_date"],
                saison_end=saison_raw["end_date"],
                fixture_dates=fixture_dates,
            )
        )

        # After the span refusals, and reaching for its neighbours only once they pass: a date
        # outside the season is wrong on its own terms, where this one is wrong only beside them.
        await _refuse_an_out_of_order_start(
            spieltage_collection=spieltage_collection,
            saisons_collection=saisons_collection,
            stored_raw=stored_raw,
            start=spieltag_data.start,
            session=session,
        )

        updated_raw = await patch_one_in_db(
            collection=spieltage_collection,
            db_filter={"_id": spieltag_id},
            update={"$set": spieltag_data.model_dump(mode="json", exclude={"version"})},
            expected_version=spieltag_data.version,
            session=session,
            return_document=ReturnDocument.AFTER,
        )

        return FLSpieltagWriteResponse(spieltag_id=spieltag_id, version=FLSpieltagRecord.model_validate(updated_raw).version)

    # One transaction over the span and the season write inside `_refuse_an_out_of_order_start`,
    # which is what makes two matchdays of one phase contend. `with_transaction` is safe to retry,
    # the callback re-reading its neighbours.
    async with transaction_session(db) as session:
        return await session.with_transaction(redate_the_matchday)
