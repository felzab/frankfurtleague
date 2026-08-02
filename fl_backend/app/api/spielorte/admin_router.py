"""
SPIELORTE · write endpoints

Venues. Every mutation sits beside the reads for the resource it changes, in a second router whose
guard is `verify_access_admin` (ADR-0034).

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • `verify_access_admin` is attached at ROUTER level, so every endpoint added here is guarded by
    construction. Never move the guard onto an individual endpoint.
  • `maps_link` is DERIVED server-side from the name and address and is on no payload -- a client
    cannot set it. Despite the name it is a Google Maps search string, not a URL, so it must never be
    rendered into an href.
  • `default_mietpreis` carries no default. The patch writes the payload back wholesale, so a Pydantic
    default would let a request omitting the field overwrite a real rent with 0.
  • Renaming a venue FANS OUT into every match embedding it. Without that, match cards show the old
    name indefinitely.
  • Deletion is SOFT. Matches embed a copy of the venue and reference it by id, so a hard delete would
    orphan every historical match played there.
"""

from typing import Annotated

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument

from app.api.spielorte.schemas import (
    FLPatchSpielortPayload,
    FLPatchSpielortResponse,
    FLPostSpielortPayload,
    FLPostSpielortResponse,
    FLSpielort,
    FLSpielortWriteResponse,
)
from app.core.config import API_VERSION
from app.core.crud import patch_many_in_db, patch_one_in_db, post_one_to_db
from app.core.dependencies import SpieleCollection, SpielorteCollection, get_german_date_str
from app.core.exceptions import DocumentNotFoundException
from app.core.routing import by_id
from app.core.security import verify_access_admin
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spielorte",
    dependencies=[Depends(verify_access_admin)],
)


def _maps_link(name: str, address) -> str:
    """The Google Maps SEARCH STRING, not a URL. Derived here so a client can never supply one."""
    return f"{name}, {address.to_string}, Deutschland"


@router.post("", response_model=FLPostSpielortResponse, status_code=201, summary="Create a Spielort")
async def post_spielort(
    spielort_data: Annotated[FLPostSpielortPayload, Body()],
    spielorte_collection: SpielorteCollection,
) -> FLPostSpielortResponse:
    """
    Create a venue.

    `maps_link` is built server-side from the name and address and must not be submitted. Despite the
    name it is a Google Maps search string, not a URL.
    """

    post_operation = await post_one_to_db(
        collection=spielorte_collection,
        document={
            **spielort_data.model_dump(mode="json"),
            "maps_link": _maps_link(spielort_data.name, spielort_data.address),
            "inactive_since": None,
        },
    )

    return FLPostSpielortResponse(
        acknowledged=1 if post_operation.acknowledged else 0,
        created_id=post_operation.inserted_id,
    )


@router.patch(by_id("spielort_id"), response_model=FLPatchSpielortResponse, summary="Update a Spielort and fan the change out")
async def patch_spielort(
    spielort_id: CustomRouteObjectId,
    spielort_data: Annotated[FLPatchSpielortPayload, Body()],
    spielorte_collection: SpielorteCollection,
    spiele_collection: SpieleCollection,
) -> FLPatchSpielortResponse:
    """
    Update a venue, then update every Spiel that embeds it.

    Matches carry an embedded copy of the venue's name and maps link, so the fan-out is not optional:
    without it, match cards keep showing the old name indefinitely.

    `mietpreis` is deliberately **not** fanned out. The rent recorded on a match is what was agreed for
    that match; rewriting it would rewrite history.
    """

    maps_link = _maps_link(spielort_data.name, spielort_data.address)

    updated_document_raw = await patch_one_in_db(
        collection=spielorte_collection,
        filter={"_id": spielort_id},
        update={"$set": {**spielort_data.model_dump(mode="json"), "maps_link": maps_link}},
        return_document=ReturnDocument.AFTER,
    )
    if updated_document_raw is None:
        raise DocumentNotFoundException(filter={"_id": spielort_id}, error_code="DB-COMMON-001")
    updated_document = FLSpielort(**updated_document_raw)

    await patch_many_in_db(
        collection=spiele_collection,
        filter={"ort.spielort_id": updated_document.id},
        update={"$set": {"ort.maps_link": updated_document.maps_link, "ort.name": updated_document.name}},
    )

    return FLPatchSpielortResponse(updated_document=updated_document)


@router.delete(by_id("spielort_id"), response_model=FLSpielortWriteResponse, summary="Deactivate a Spielort (soft delete)")
async def delete_spielort(
    spielort_id: CustomRouteObjectId,
    spielorte_collection: SpielorteCollection,
    today: str = Depends(get_german_date_str),
) -> FLSpielortWriteResponse:
    """
    Deactivate a venue. SOFT: it stamps `inactive_since`, and the document stays.

    Matches embed a copy of the venue, so a hard delete would orphan every historical match that used
    it. Returns the updated document rather than a bare acknowledgement.
    """

    updated_document_raw = await patch_one_in_db(
        collection=spielorte_collection,
        filter={"_id": spielort_id},
        update={"$set": {"inactive_since": today}},
        return_document=ReturnDocument.AFTER,
    )
    if updated_document_raw is None:
        raise DocumentNotFoundException(filter={"_id": spielort_id}, error_code="DB-COMMON-001")

    return FLSpielortWriteResponse(updated_document=FLSpielort(**updated_document_raw))


@router.post(f"{by_id('spielort_id')}/reactivate", response_model=FLSpielortWriteResponse, summary="Bring a deactivated Spielort back")
async def reactivate_spielort(
    spielort_id: CustomRouteObjectId,
    spielorte_collection: SpielorteCollection,
) -> FLSpielortWriteResponse:
    """Clear `inactive_since`, putting the venue back into the picker and every default read."""

    updated_document_raw = await patch_one_in_db(
        collection=spielorte_collection,
        filter={"_id": spielort_id},
        update={"$set": {"inactive_since": None}},
        return_document=ReturnDocument.AFTER,
    )
    if updated_document_raw is None:
        raise DocumentNotFoundException(filter={"_id": spielort_id}, error_code="DB-COMMON-001")

    return FLSpielortWriteResponse(updated_document=FLSpielort(**updated_document_raw))
