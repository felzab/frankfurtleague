from typing import Annotated

from fastapi import APIRouter, Body, Depends

from app.api.saisons.schedule import expected_matches, implied_matchdays
from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.schemas import KNOCKOUT_PHASES
from app.api.spieltage.schemas import (
    FLPatchSpieltagPayload,
    FLPostSpieltagPayload,
    FLSpieltag,
    FLSpieltagWriteResponse,
)
from app.api.spieltage.services import (
    find_spieltag_boundary_refusal,
    find_spieltag_create_refusal,
    find_spieltag_phase_refusal,
    find_spieltag_span_refusal,
    find_spieltag_unplayed_phase_refusal,
    with_expected_matches,
)
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db, post_one_to_db, pull_one_from_db, refuse
from app.core.dependencies import SaisonsCollection, SpieleCollection, SpieltageCollection, get_german_date_str
from app.core.routing import by_id
from app.core.security import bind_actor, verify_access_admin
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spieltage",
    dependencies=[Depends(verify_access_admin), Depends(bind_actor)],
)


@router.post("", response_model=FLSpieltagWriteResponse, status_code=201, summary="Create a Spieltag")
async def post_spieltag(
    spieltag_data: Annotated[FLPostSpieltagPayload, Body()],
    spieltage_collection: SpieltageCollection,
    saisons_collection: SaisonsCollection,
    today: str = Depends(get_german_date_str),
) -> FLSpieltagWriteResponse:
    """
    Create a matchday.

    The payload carries no `position`: a create APPENDS to its phase, and the `PATCH` is where one
    moves. A season whose knockout phase is under way takes no new matchday.
    """

    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": spieltag_data.saison_id})
    rules = FLSaisonRules.model_validate(saison_raw["rules"])

    earliest_knockout = await spieltage_collection.find_one(
        {"saison_id": spieltag_data.saison_id, "saison_phase": {"$in": list(KNOCKOUT_PHASES)}},
        {"beginn": 1},
        sort=[("beginn", 1)],
    )
    refuse(
        find_spieltag_create_refusal(
            implied_in_phase=implied_matchdays(rules, spieltag_data.saison_phase),
            saison_phase=spieltag_data.saison_phase,
            earliest_knockout_beginn=None if earliest_knockout is None else str(earliest_knockout["beginn"]),
            today=today,
        )
    )

    # A new matchday has no fixtures, so `REQ-DATE-003` has nothing to check yet.
    refuse(
        find_spieltag_span_refusal(
            beginn=spieltag_data.beginn,
            ende=spieltag_data.ende,
            saison_start=str(saison_raw["start_date"]),
            saison_end=str(saison_raw["end_date"]),
            fixture_dates=[],
        )
    )

    # The phase's HIGHEST, never its count: a gap would otherwise hand out a number somebody holds.
    # Two creates racing compute the same one, and `uniq_saison_id_saison_phase_position` refuses the
    # second.
    last_in_phase = await spieltage_collection.find_one(
        {"saison_id": spieltag_data.saison_id, "saison_phase": spieltag_data.saison_phase},
        {"position": 1},
        sort=[("position", -1)],
    )
    position = 1 if last_in_phase is None else int(last_in_phase["position"]) + 1

    post_operation = await post_one_to_db(
        collection=spieltage_collection,
        document={**spieltag_data.model_dump(mode="json"), "position": position},
    )

    return FLSpieltagWriteResponse(
        acknowledged=1 if post_operation.acknowledged else 0,
        spieltag_id=post_operation.inserted_id,
    )


@router.patch(by_id("spieltag_id"), response_model=FLSpieltagWriteResponse, summary="Update a Spieltag")
async def patch_spieltag(
    spieltag_id: CustomRouteObjectId,
    spieltag_data: Annotated[FLPatchSpieltagPayload, Body()],
    spieltage_collection: SpieltageCollection,
    saisons_collection: SaisonsCollection,
    spiele_collection: SpieleCollection,
) -> FLSpieltagWriteResponse:
    """
    Update a matchday.

    No fan-out: matches embed no copy, so a re-dated matchday is picked up on the next read. A phase
    change is refused where it would strand fixtures; an EMPTY matchday moves freely. `position` and
    `saison_phase` land in one write, a slot another matchday of that phase holds being a 409.
    """

    stored_raw = await pull_one_from_db(collection=spieltage_collection, db_filter={"_id": spieltag_id})

    # The refusal needs the rules, and so does the echo, whose `anzahl_spiele` is derived from the
    # phase this write may have just moved.
    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": stored_raw["saison_id"]})
    rules = FLSaisonRules.model_validate(saison_raw["rules"])

    attached = await spiele_collection.count_documents({"spieltag_id": spieltag_id})

    # Split by the FIXTURE's own `saison_phase`, which need not agree with its matchday's, so the
    # transition rule can tell a move away from the fixtures from a move towards them.
    attached_knockout = await spiele_collection.count_documents({"spieltag_id": spieltag_id, "saison_phase": {"$in": list(KNOCKOUT_PHASES)}})
    on_group_side = attached - attached_knockout
    stored_phase = stored_raw["saison_phase"]

    # Asked first: a round the season never plays is wrong whatever the matchday holds.
    refuse(
        find_spieltag_unplayed_phase_refusal(
            stored_phase=stored_phase,
            proposed_phase=spieltag_data.saison_phase,
            implied_in_proposed=implied_matchdays(rules, spieltag_data.saison_phase),
        )
    )

    refuse(
        find_spieltag_phase_refusal(
            attached_count=attached,
            expected_count=expected_matches(rules, spieltag_data.saison_phase),
            # The stored phase's own figure, so the refusal judges the STEP: a payload repeating the
            # phase compares equal and is a dates-only edit.
            expected_in_stored_phase=expected_matches(rules, stored_raw["saison_phase"]),
        )
    )

    # Asked last, because it is the widest statement: the rule above names two numbers to compare.
    refuse(
        find_spieltag_boundary_refusal(
            stored_phase=stored_phase,
            proposed_phase=spieltag_data.saison_phase,
            fixtures_on_stored_side=on_group_side if stored_phase == "gruppenphase" else attached_knockout,
            fixtures_on_proposed_side=on_group_side if spieltag_data.saison_phase == "gruppenphase" else attached_knockout,
        )
    )

    # Undated fixtures are filtered out rather than passed as nulls: one constrains nothing.
    fixture_dates = [
        str(row["datum"]) async for row in spiele_collection.find({"spieltag_id": spieltag_id, "datum": {"$ne": None}}, {"datum": 1})
    ]
    refuse(
        find_spieltag_span_refusal(
            beginn=spieltag_data.beginn,
            ende=spieltag_data.ende,
            saison_start=str(saison_raw["start_date"]),
            saison_end=str(saison_raw["end_date"]),
            fixture_dates=fixture_dates,
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
