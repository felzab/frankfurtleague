from datetime import datetime
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
from app.api.schiedsrichter.services import (
    ANONYMISED_KONTAKT,
    find_anonymisation_refusal,
    find_referee_retire_refusal,
    holds_a_kontakt_value,
)
from app.api.spiele.schemas import SONDEREREIGNIS_WITHOUT_A_RESULT
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import (
    insert_live,
    patch_many_in_db,
    patch_one_in_db,
    pull_many_from_db,
    pull_one_from_db,
    refuse,
    set_inactive_since,
)
from app.core.dependencies import (
    AktionenCollection,
    DBClient,
    SchiedsrichterCollection,
    SpieleCollection,
    get_german_date_str,
    get_germany_now,
)
from app.core.recording import build_redaction_filter, build_redaction_update, log_stamp
from app.core.routing import by_id
from app.core.security import bind_actor, verify_access_admin
from app.shared.schemas.custom import CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/schiedsrichter",
    dependencies=[Depends(verify_access_admin), Depends(bind_actor)],
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
        db_filter={
            "schiedsrichter.schiedsrichter_id": schiedsrichter_id,
            "ergebnis": None,
            "sonderereignis": {"$nin": list(SONDEREREIGNIS_WITHOUT_A_RESULT)},
        },
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


@router.post(
    f"{by_id('schiedsrichter_id')}/anonymisieren",
    response_model=FLSchiedsrichterWriteResponse,
    summary="Clear a Schiedsrichter's contact details",
)
async def anonymise_schiedsrichter(
    schiedsrichter_id: CustomRouteObjectId,
    schiedsrichter_collection: SchiedsrichterCollection,
    aktionen_collection: AktionenCollection,
    db: DBClient,
    germany_now: datetime = Depends(get_germany_now),
) -> FLSchiedsrichterWriteResponse:
    """Null the referee's telephone number and email address, in the row and in the log.

    The row and its `name` stay: every Spiel embeds both, so a removal would strand copies. A
    re-entry under it is refused (`REQ-ANONYMISE-001`).
    """

    async def clear_the_details_and_the_record(session: AsyncIOMotorClientSession) -> FLSchiedsrichterWriteResponse:
        async def a_kontakt_value_stands(kontakt_session: AsyncIOMotorClientSession | None) -> bool:
            """Whether the row still carries a contact value, read either through the transaction or outside it.

            A `schiedsrichter_id` naming nobody raises the 404 here, before anything is written.
            """

            return holds_a_kontakt_value(
                await pull_one_from_db(
                    collection=schiedsrichter_collection,
                    db_filter={"_id": schiedsrichter_id},
                    projection={"kontakt": 1},
                    session=kontakt_session,
                )
            )

        # BEFORE the write, which is what makes the guard below reachable: a row this snapshot reads
        # as cleared already is `$set` to what it holds.
        rewrites_nothing = not await a_kontakt_value_stands(session)

        updated_document_raw = await patch_one_in_db(
            collection=schiedsrichter_collection,
            db_filter={"_id": schiedsrichter_id},
            update={"$set": ANONYMISED_KONTAKT},
            session=session,
        )

        # AFTER the patch, so it reaches the row that patch itself just wrote -- the one holding the
        # values being cleared. Redacting first would leave exactly that copy behind.
        await patch_many_in_db(
            collection=aktionen_collection,
            db_filter=build_redaction_filter([(Collection.SCHIEDSRICHTER, [schiedsrichter_id])]),
            update=build_redaction_update(at=log_stamp(germany_now)),
            session=session,
        )

        # A `$set` rewriting nothing joins no write set, so a `PATCH` re-entering the details raises
        # no conflict to retry on. Re-read OUTSIDE the session, where that PATCH is visible and this
        # write is not (I53) -- hence only on the no-op path.
        if rewrites_nothing:
            refuse(find_anonymisation_refusal(re_entered=await a_kontakt_value_stands(None)))

        return FLSchiedsrichterWriteResponse(updated_document=FLSchiedsrichter(**updated_document_raw))

    # ONE transaction over both (D83): a referee cleared while the log still holds their details
    # reports an anonymisation that did not happen. `with_transaction` over a bare one -- the
    # callback derives both writes from the path id, so a retry is safe.
    async with await db.start_session() as session:
        return await session.with_transaction(clear_the_details_and_the_record)
