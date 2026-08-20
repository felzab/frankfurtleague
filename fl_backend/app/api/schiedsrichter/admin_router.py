from typing import Annotated

from fastapi import APIRouter, Body, Depends
from motor.motor_asyncio import AsyncIOMotorClientSession

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
from app.core.crud import insert_live, patch_many_in_db, patch_one_in_db, pull_many_from_db, refuse, set_inactive_since
from app.core.dependencies import DBClient, SchiedsrichterCollection, SpieleCollection, get_german_date_str
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

    post_operation = await insert_live(collection=schiedsrichter_collection, document=schiedsrichter_data.model_dump(mode="json"))

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
    db: DBClient,
) -> FLPatchSchiedsrichterResponse:
    """
    Update a referee, then update the embedded name on every Spiel that uses them.

    Only the name. `payment` is NOT propagated: the fee on a match is what was agreed for it.
    """

    async def rename_and_fan_out(session: AsyncIOMotorClientSession) -> FLPatchSchiedsrichterResponse:
        updated_document_raw = await patch_one_in_db(
            collection=schiedsrichter_collection,
            db_filter={"_id": schiedsrichter_id},
            update={"$set": schiedsrichter_data.model_dump(mode="json")},
            session=session,
        )
        updated_document = FLSchiedsrichter(**updated_document_raw)

        fan_out = await patch_many_in_db(
            collection=spiele_collection,
            db_filter={"schiedsrichter.schiedsrichter_id": updated_document.id},
            update={"$set": {"schiedsrichter.name": updated_document.name}},
            session=session,
        )

        return FLPatchSchiedsrichterResponse(updated_document=updated_document, fanned_out_to_spiele=fan_out.modified_count)

    # One transaction: a rename landing on the referee and not on their fixtures is the stale copy
    # the fan-out exists to prevent. `with_transaction` over a bare `start_transaction` -- the
    # callback derives both writes from the payload, so a retry is safe.
    async with await db.start_session() as session:
        return await session.with_transaction(rename_and_fan_out)


@router.delete(by_id("schiedsrichter_id"), response_model=FLSchiedsrichterWriteResponse, summary="Deactivate a Schiedsrichter (soft delete)")
async def delete_schiedsrichter(
    schiedsrichter_id: CustomRouteObjectId,
    schiedsrichter_collection: SchiedsrichterCollection,
    spiele_collection: SpieleCollection,
    today: str = Depends(get_german_date_str),
) -> FLSchiedsrichterWriteResponse:
    """Deactivate a referee. SOFT, for the same reason as venues: matches embed a copy."""

    # `unplayed_spiel_nrs`'s definition, so the two rules agree about what is still to come.
    assigned = await pull_many_from_db(
        collection=spiele_collection,
        db_filter={"schiedsrichter.schiedsrichter_id": schiedsrichter_id, "ergebnis": None, "is_canceled": False},
        projection={"spiel_nr": 1},
    )
    refuse(find_referee_retire_refusal(upcoming_spiel_nrs=sorted(int(row["spiel_nr"]) for row in assigned)))

    updated_document_raw = await set_inactive_since(collection=schiedsrichter_collection, db_filter={"_id": schiedsrichter_id}, when=today)

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

    updated_document_raw = await set_inactive_since(collection=schiedsrichter_collection, db_filter={"_id": schiedsrichter_id}, when=None)

    return FLSchiedsrichterWriteResponse(updated_document=FLSchiedsrichter(**updated_document_raw))
