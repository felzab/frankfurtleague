from typing import Annotated

from fastapi import APIRouter, Body, Depends

from app.api.saisons.schemas import FLSaisonRules
from app.api.spieltage.schemas import FLPatchSpieltagPayload, FLSpieltag, FLSpieltagWriteResponse
from app.api.spieltage.services import find_spieltag_span_refusal, with_expected_matches
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db, pull_one_from_db, refuse
from app.core.dependencies import SaisonsCollection, SpieleCollection, SpieltageCollection
from app.core.routing import by_id
from app.core.security import bind_actor, verify_access_admin
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spieltage",
    dependencies=[Depends(verify_access_admin), Depends(bind_actor)],
)


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

    No fan-out: matches embed no copy, so a re-dated matchday is picked up on the next read. The span
    is held to its season's and to the days its own fixtures already stand on.
    """

    stored_raw = await pull_one_from_db(collection=spieltage_collection, db_filter={"_id": spieltag_id})

    # Read for both halves of the write: the season bounds the span, and its `rules` are what the
    # echo's `anzahl_spiele` derives from.
    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": stored_raw["saison_id"]})
    rules = FLSaisonRules.model_validate(saison_raw["rules"])

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
