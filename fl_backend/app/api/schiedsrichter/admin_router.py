"""
SCHIEDSRICHTER · write endpoints

Referees. Every mutation sits beside the reads for its resource, in a second router guarded at
router level by `verify_access_admin` (ADR-0034) — never move the guard onto an endpoint.

Invariants:
- A rename fans out only the name: `payment` on a match records what was agreed for that match.
- `default_payment` carries no default — the patch writes the payload back wholesale.
- Deletion is soft: matches embed a copy of the referee and reference them by id (ADR-0032).
- `kontakt` is personal data: the shape must be present, never filled in.
"""

from typing import Annotated

from fastapi import APIRouter, Body, Depends
from pymongo import ReturnDocument

from app.api.schiedsrichter.schemas import (
    FLPatchSchiedsrichterPayload,
    FLPatchSchiedsrichterResponse,
    FLPostSchiedsrichterPayload,
    FLPostSchiedsrichterResponse,
    FLSchiedsrichter,
    FLSchiedsrichterWriteResponse,
)
from app.api.schiedsrichter.services import find_referee_retire_refusal
from app.core.config import API_VERSION
from app.core.crud import patch_many_in_db, patch_one_in_db, post_one_to_db, pull_many_from_db
from app.core.dependencies import SchiedsrichterCollection, SpieleCollection, get_german_date_str
from app.core.exceptions import DocumentConflictException, DocumentNotFoundException
from app.core.routing import by_id
from app.core.security import verify_access_admin
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/schiedsrichter",
    dependencies=[Depends(verify_access_admin)],
)


@router.post("", response_model=FLPostSchiedsrichterResponse, status_code=201, summary="Create a Schiedsrichter")
async def post_schiedsrichter(
    schiedsrichter_data: Annotated[FLPostSchiedsrichterPayload, Body()],
    schiedsrichter_collection: SchiedsrichterCollection,
) -> FLPostSchiedsrichterResponse:
    """Create a referee. `inactive_since` is set to null here and is not part of the payload."""

    post_operation = await post_one_to_db(
        collection=schiedsrichter_collection,
        document={**schiedsrichter_data.model_dump(mode="json"), "inactive_since": None},
    )

    return FLPostSchiedsrichterResponse(
        acknowledged=1 if post_operation.acknowledged else 0,
        created_id=post_operation.inserted_id,
    )


@router.patch(
    by_id("schiedsrichter_id"),
    response_model=FLPatchSchiedsrichterResponse,
    summary="Update a Schiedsrichter and fan the change out",
)
async def patch_schiedsrichter(
    schiedsrichter_id: CustomRouteObjectId,
    schiedsrichter_data: Annotated[FLPatchSchiedsrichterPayload, Body()],
    schiedsrichter_collection: SchiedsrichterCollection,
    spiele_collection: SpieleCollection,
) -> FLPatchSchiedsrichterResponse:
    """
    Update a referee, then update the embedded name on every Spiel that uses them.

    Only the name is fanned out. `payment` is deliberately not propagated: the fee recorded on a match
    is what was agreed for that match, and rewriting it would rewrite history.
    """

    updated_document_raw = await patch_one_in_db(
        collection=schiedsrichter_collection,
        filter={"_id": schiedsrichter_id},
        update={"$set": schiedsrichter_data.model_dump(mode="json")},
        return_document=ReturnDocument.AFTER,
    )
    if updated_document_raw is None:
        raise DocumentNotFoundException(filter={"_id": schiedsrichter_id}, error_code="DB-COMMON-001")
    updated_document = FLSchiedsrichter(**updated_document_raw)

    await patch_many_in_db(
        collection=spiele_collection,
        filter={"schiedsrichter.schiedsrichter_id": updated_document.id},
        update={"$set": {"schiedsrichter.name": updated_document.name}},
    )

    return FLPatchSchiedsrichterResponse(updated_document=updated_document)


@router.delete(by_id("schiedsrichter_id"), response_model=FLSchiedsrichterWriteResponse, summary="Deactivate a Schiedsrichter (soft delete)")
async def delete_schiedsrichter(
    schiedsrichter_id: CustomRouteObjectId,
    schiedsrichter_collection: SchiedsrichterCollection,
    spiele_collection: SpieleCollection,
    today: str = Depends(get_german_date_str),
) -> FLSchiedsrichterWriteResponse:
    """Deactivate a referee. SOFT, for the same reason as venues: matches embed a copy."""

    # Unplayed means no result and not cancelled, matching `unplayed_spiel_nrs` so the two rules cannot
    # disagree about which fixtures are still to come.
    assigned = await pull_many_from_db(
        collection=spiele_collection,
        db_filter={"schiedsrichter.schiedsrichter_id": schiedsrichter_id, "ergebnis": None, "is_canceled": False},
        projection={"spiel_nr": 1},
    )
    refusal = find_referee_retire_refusal(upcoming_spiel_nrs=sorted(int(row["spiel_nr"]) for row in assigned))
    if refusal is not None:
        error_code, detail = refusal
        raise DocumentConflictException(error_code=error_code, message=detail)

    updated_document_raw = await patch_one_in_db(
        collection=schiedsrichter_collection,
        filter={"_id": schiedsrichter_id},
        update={"$set": {"inactive_since": today}},
        return_document=ReturnDocument.AFTER,
    )
    if updated_document_raw is None:
        raise DocumentNotFoundException(filter={"_id": schiedsrichter_id}, error_code="DB-COMMON-001")

    return FLSchiedsrichterWriteResponse(updated_document=FLSchiedsrichter(**updated_document_raw))


@router.post(
    f"{by_id('schiedsrichter_id')}/reactivate",
    response_model=FLSchiedsrichterWriteResponse,
    summary="Bring a deactivated Schiedsrichter back",
)
async def reactivate_schiedsrichter(
    schiedsrichter_id: CustomRouteObjectId,
    schiedsrichter_collection: SchiedsrichterCollection,
) -> FLSchiedsrichterWriteResponse:
    """Clear `inactive_since`, putting the referee back into the picker and every default read."""

    updated_document_raw = await patch_one_in_db(
        collection=schiedsrichter_collection,
        filter={"_id": schiedsrichter_id},
        update={"$set": {"inactive_since": None}},
        return_document=ReturnDocument.AFTER,
    )
    if updated_document_raw is None:
        raise DocumentNotFoundException(filter={"_id": schiedsrichter_id}, error_code="DB-COMMON-001")

    return FLSchiedsrichterWriteResponse(updated_document=FLSchiedsrichter(**updated_document_raw))
