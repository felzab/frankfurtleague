"""
SPIELTAGE · write endpoints

Matchdays: named blocks of fixtures inside a season, ordered by `order_val`.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • `verify_access_admin` is attached at ROUTER level, so every endpoint added here is guarded by
    construction. Never move the guard onto an individual endpoint.
  • `order_val` is what the bracket orders by, NOT the date. Matchdays routinely share dates, so
    ordering by `beginn` interleaves playoff rounds unpredictably -- which makes this field load-bearing
    rather than decorative, and it is the one most worth getting right when creating a season's rounds.
  • Deletion is SOFT. `spiele.spieltag_id` points here and nothing cascades, so a hard delete would
    leave matches referencing a matchday that no longer exists.
  • `anzahl_spiele` is a hand-maintained count of something countable. It is written as given and never
    derived, which is the state ADR-0026 pointedly did not extend to it.
"""

from typing import Annotated

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument

from app.api.spieltage.schemas import (
    FLPatchSpieltagPayload,
    FLPostSpieltagPayload,
    FLSpieltag,
    FLSpieltagWriteResponse,
)
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db, post_one_to_db
from app.core.dependencies import SpieltageCollection, get_german_date_str
from app.core.exceptions import DocumentNotFoundException
from app.core.routing import by_id
from app.core.security import verify_access_admin
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spieltage",
    dependencies=[Depends(verify_access_admin)],
)


@router.post("", response_model=FLSpieltagWriteResponse, status_code=201, summary="Create a Spieltag")
async def post_spieltag(
    spieltag_data: Annotated[FLPostSpieltagPayload, Body()],
    spieltage_collection: SpieltageCollection,
) -> FLSpieltagWriteResponse:
    """
    Create a matchday.

    `order_val` decides where it sits in the bracket and in every ordered listing — not `beginn`, since
    matchdays routinely share dates. Nothing enforces that two matchdays in a season hold different
    `order_val`s; equal values sort against each other by `beginn` as a tie-break.
    """

    post_operation = await post_one_to_db(
        collection=spieltage_collection,
        document={**spieltag_data.model_dump(mode="json"), "inactive_since": None},
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
) -> FLSpieltagWriteResponse:
    """
    Update a matchday.

    No fan-out: matches reference a matchday by id and embed no copy of it, so a renamed or re-dated
    matchday is picked up by every consumer on the next read.
    """

    updated_raw = await patch_one_in_db(
        collection=spieltage_collection,
        filter={"_id": spieltag_id},
        update={"$set": spieltag_data.model_dump(mode="json")},
        return_document=ReturnDocument.AFTER,
    )
    if updated_raw is None:
        raise DocumentNotFoundException(filter={"_id": spieltag_id}, error_code="DB-COMMON-001")

    return FLSpieltagWriteResponse(spieltag_id=spieltag_id, updated_document=FLSpieltag.model_validate(updated_raw))


@router.delete(by_id("spieltag_id"), response_model=FLSpieltagWriteResponse, summary="Retire a Spieltag (soft delete)")
async def delete_spieltag(
    spieltag_id: CustomRouteObjectId,
    spieltage_collection: SpieltageCollection,
    today: str = Depends(get_german_date_str),
) -> FLSpieltagWriteResponse:
    """
    Retire a matchday. SOFT: it stamps `inactive_since` and the document stays.

    Its matches are **not** touched and stay fully readable — `GET /spiele` never joins `spieltage`, so
    they keep resolving. That is the reason this is soft rather than a delete: a hard one would leave
    every one of those matches pointing at nothing.
    """

    updated_raw = await patch_one_in_db(
        collection=spieltage_collection,
        filter={"_id": spieltag_id},
        update={"$set": {"inactive_since": today}},
        return_document=ReturnDocument.AFTER,
    )
    if updated_raw is None:
        raise DocumentNotFoundException(filter={"_id": spieltag_id}, error_code="DB-COMMON-001")

    return FLSpieltagWriteResponse(spieltag_id=spieltag_id, updated_document=FLSpieltag.model_validate(updated_raw))


@router.post(f"{by_id('spieltag_id')}/reactivate", response_model=FLSpieltagWriteResponse, summary="Bring a retired Spieltag back")
async def reactivate_spieltag(
    spieltag_id: CustomRouteObjectId,
    spieltage_collection: SpieltageCollection,
) -> FLSpieltagWriteResponse:
    """Clear `inactive_since`, restoring the matchday to every read that hides retired ones."""

    updated_raw = await patch_one_in_db(
        collection=spieltage_collection,
        filter={"_id": spieltag_id},
        update={"$set": {"inactive_since": None}},
        return_document=ReturnDocument.AFTER,
    )
    if updated_raw is None:
        raise DocumentNotFoundException(filter={"_id": spieltag_id}, error_code="DB-COMMON-001")

    return FLSpieltagWriteResponse(spieltag_id=spieltag_id, updated_document=FLSpieltag.model_validate(updated_raw))
