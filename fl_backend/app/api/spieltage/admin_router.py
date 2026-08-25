from typing import Annotated

from fastapi import APIRouter, Body, Depends

from app.api.saisons.crud import pull_saison_id_and_rules
from app.api.saisons.schemas import FLSaisonRules
from app.api.spieltage.schemas import (
    FLPatchSpieltagPayload,
    FLSpieltag,
    FLSpieltageFilterParams,
    FLSpieltageListResponse,
    FLSpieltageSingleResponse,
    FLSpieltagListAdapter,
    FLSpieltagWriteResponse,
)
from app.api.spieltage.services import (
    build_spieltage_filter,
    build_spieltage_sort,
    dated_beginn,
    dated_neighbour,
    find_spieltag_order_refusal,
    find_spieltag_span_refusal,
    order_spieltage,
    with_expected_matches,
)
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db, pull_many_from_db, pull_one_from_db, refuse
from app.core.dependencies import SaisonsCollection, SpieleCollection, SpieltageCollection
from app.core.routing import by_id
from app.core.security import bind_actor, verify_access_admin
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spieltage",
    dependencies=[Depends(verify_access_admin), Depends(bind_actor)],
)


# Two static segments, matching `GET /saisons/list/admin`. Declared before `{spieltag_id}/admin`,
# whose only separation from this path is the `objectid` convertor (`docs/backend/spec.md :: I37`).
@router.get("/list/admin", response_model=FLSpieltageListResponse, summary="Spieltage for the admin surfaces")
async def get_spieltage_for_admin(
    spieltage_collection: SpieltageCollection,
    saisons_collection: SaisonsCollection,
    filters: FLSpieltageFilterParams = Depends(),
) -> FLSpieltageListResponse:
    """
    List a season's matchdays for the admin surfaces, a `future` season's included.

    Same filters, order and shape as `GET /spieltage`, without its season gate: a season's matchdays
    are drawn while it is planned, and dating them is what this list is for.
    """

    # Mirrors `app/api/spieltage/router.py :: get_spieltage`, which cannot be called here: the gate
    # is inside it, and refusing the planned season is the one thing this must not do.
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
@router.get(f"{by_id('spieltag_id')}/admin", response_model=FLSpieltageSingleResponse, summary="One Spieltag for the admin editor")
async def get_spieltag_for_admin(
    spieltag_id: CustomRouteObjectId,
    spieltage_collection: SpieltageCollection,
    saisons_collection: SaisonsCollection,
) -> FLSpieltageSingleResponse:
    """
    Return one matchday by its id for the admin editor, a `future` season's included.

    Same shape as `GET /spieltage/{spieltag_id}`, without its season gate: the editor opens a
    matchday to date it, and that happens before its season is ever activated.
    """

    spieltag_raw = await pull_one_from_db(collection=spieltage_collection, db_filter={"_id": spieltag_id})

    # Its OWN season, as the base read resolves it: `anzahl_spiele` derives from that season's rules.
    _, rules = await pull_saison_id_and_rules(saisons_collection=saisons_collection, saison_id=str(spieltag_raw["saison_id"]))

    return FLSpieltageSingleResponse(spieltag=FLSpieltag.model_validate(with_expected_matches(spieltag_raw, rules)))


@router.patch(by_id("spieltag_id"), response_model=FLSpieltagWriteResponse, summary="Re-date a Spieltag")
async def patch_spieltag(
    spieltag_id: CustomRouteObjectId,
    spieltag_data: Annotated[FLPatchSpieltagPayload, Body()],
    spieltage_collection: SpieltageCollection,
    saisons_collection: SaisonsCollection,
    spiele_collection: SpieleCollection,
) -> FLSpieltagWriteResponse:
    """
    Move a matchday's span.

    No fan-out: matches embed no copy, so a re-dated matchday is picked up on the next read. The span is held
    to its season's, to the days its own fixtures stand on, and its `beginn` to the order its phase is dated in.
    """

    stored_raw = await pull_one_from_db(collection=spieltage_collection, db_filter={"_id": spieltag_id})

    # Read for both halves of the write: the season bounds the span, and its `rules` are what the
    # echo's `anzahl_spiele` derives from.
    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": stored_raw["saison_id"]})
    rules = FLSaisonRules.model_validate(saison_raw["rules"])

    # Undated fixtures are filtered out rather than passed as nulls: one constrains nothing.
    fixture_dates = [row["datum"] async for row in spiele_collection.find({"spieltag_id": spieltag_id, "datum": {"$ne": None}}, {"datum": 1})]
    refuse(
        find_spieltag_span_refusal(
            beginn=spieltag_data.beginn,
            ende=spieltag_data.ende,
            saison_start=saison_raw["start_date"],
            saison_end=saison_raw["end_date"],
            fixture_dates=fixture_dates,
        )
    )

    # After the span refusals, and reading only once they pass: a date outside the season is wrong
    # on its own terms, where this one is wrong only beside the neighbours read below.
    neighbourhood = {
        "saison_id": stored_raw["saison_id"],
        # The phase is part of the key: positions restart at 1 in each, so a matchday of another
        # phase is no neighbour. An undated one states no date to compare and is stepped over.
        "saison_phase": stored_raw["saison_phase"],
        "beginn": {"$ne": None},
    }
    neighbour_fields = {"position": 1, "beginn": 1}
    # Read-then-write, not transactional: two positions dated at once write different documents, so
    # no session would conflict on the pair either, and losing the race leaves a phase dated out of
    # order rather than corrupt data, on a single-admin surface.
    previous_raw = await spieltage_collection.find_one(
        {**neighbourhood, "position": {"$lt": stored_raw["position"]}}, neighbour_fields, sort=[("position", -1)]
    )
    following_raw = await spieltage_collection.find_one(
        {**neighbourhood, "position": {"$gt": stored_raw["position"]}}, neighbour_fields, sort=[("position", 1)]
    )
    refuse(
        find_spieltag_order_refusal(
            beginn=spieltag_data.beginn,
            ende=spieltag_data.ende,
            # The read its neighbours go through as well, so what an undated row means is decided in
            # one place rather than at each side of the comparison.
            stored_beginn=dated_beginn(stored_raw),
            previous=dated_neighbour(previous_raw),
            following=dated_neighbour(following_raw),
        )
    )

    updated_raw = await patch_one_in_db(
        collection=spieltage_collection,
        db_filter={"_id": spieltag_id},
        update={"$set": spieltag_data.model_dump(mode="json")},
    )

    return FLSpieltagWriteResponse(
        spieltag_id=spieltag_id,
        updated_document=FLSpieltag.model_validate(with_expected_matches(updated_raw, rules)),
    )
