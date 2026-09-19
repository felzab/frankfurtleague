from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.schiedsrichter.schemas import (
    FLPatchSchiedsrichterPayload,
    FLPatchSchiedsrichterResponse,
    FLPostSchiedsrichterPayload,
    FLPostSchiedsrichterResponse,
    FLSchiedsrichter,
    FLSchiedsrichterWriteResponse,
)
from app.api.schiedsrichter.services import (
    build_assignment_filter,
    build_booked_image_filter,
    build_ghost_repoint,
    build_ghost_schiedsrichter,
    build_referee_filter,
    build_unplayed_assignment_filter,
    find_ghost_erasure_refusal,
    find_referee_retire_refusal,
    first_stamped,
)
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import (
    erase_many_from_db,
    insert_live,
    patch_many_in_db,
    patch_one_in_db,
    post_one_to_db,
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
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID
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
    """Create a referee. `inactive_since` is set to null here and is on no payload."""

    post_operation = await insert_live(
        collection=schiedsrichter_collection,
        document=schiedsrichter_data.model_dump(mode="json"),
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
    db: DBClient,
) -> FLPatchSchiedsrichterResponse:
    """
    Update a referee, then update the embedded name on every Spiel that uses them.

    Only the name. `payment` is NOT propagated: the fee on a match is what was agreed for it.

    The ghost answers 404 here as it does to every read: a name written onto it would appear on the
    fixtures of every referee already erased.
    """

    async def rename_and_fan_out(session: AsyncClientSession) -> FLPatchSchiedsrichterResponse:
        updated_document_raw = await patch_one_in_db(
            collection=schiedsrichter_collection,
            db_filter=build_referee_filter(schiedsrichter_id),
            update={"$set": schiedsrichter_data.model_dump(mode="json")},
            session=session,
        )
        updated_document = FLSchiedsrichter(**updated_document_raw)

        fan_out = await patch_many_in_db(
            collection=spiele_collection,
            db_filter=build_assignment_filter(updated_document.id),
            update={"$set": {"schiedsrichter.name": updated_document.name}},
            session=session,
        )

        return FLPatchSchiedsrichterResponse(updated_document=updated_document, fanned_out_to_spiele=fan_out.modified_count)

    # One transaction: a rename landing on the referee and not on their fixtures is the stale copy
    # the fan-out exists to prevent. `with_transaction` over a bare `start_transaction` -- the
    # callback derives both writes from the payload, so a retry is safe.
    async with db.start_session() as session:
        return await session.with_transaction(rename_and_fan_out)


@router.delete(by_id("schiedsrichter_id"), response_model=FLSchiedsrichterWriteResponse, summary="Deactivate a Schiedsrichter (soft delete)")
async def delete_schiedsrichter(
    schiedsrichter_id: CustomRouteObjectId,
    schiedsrichter_collection: SchiedsrichterCollection,
    spiele_collection: SpieleCollection,
    db: DBClient,
    today: str = Depends(get_german_date_str),
) -> FLSchiedsrichterWriteResponse:
    """Deactivate a referee. SOFT, for the same reason as venues: matches embed a copy."""

    async def retire_the_referee(session: AsyncClientSession) -> Mapping[str, Any]:
        """Judge the referee's unplayed fixtures, then stamp them. Everything judged is read in-session, so a retry re-judges it."""

        # The row FIRST: the ghost is not a referee this endpoint addresses, and judging its
        # fixtures before reading it would answer 409 for a row the API says is not there.
        stored = await pull_one_from_db(
            collection=schiedsrichter_collection,
            db_filter=build_referee_filter(schiedsrichter_id),
            projection={"inactive_since": 1},
            session=session,
        )

        assigned = await pull_many_from_db(
            collection=spiele_collection,
            db_filter=build_unplayed_assignment_filter(schiedsrichter_id),
            projection={"spiel_nr": 1},
            session=session,
        )
        refuse(find_referee_retire_refusal(upcoming_spiel_nrs=sorted(int(row["spiel_nr"]) for row in assigned)))

        return await set_inactive_since(
            collection=schiedsrichter_collection,
            db_filter=build_referee_filter(schiedsrichter_id),
            # `first_stamped` and never `today`: a second press would move the day they stopped
            # officiating, which is the day a fee is reconciled against.
            when=first_stamped(stored=stored, field="inactive_since", today=today),
            session=session,
        )

    # The stamp inside the judgement's transaction, so a booking committing after the read of the
    # fixtures conflicts on the referee it anchors rather than landing unseen
    # (`app/api/spiele/crud.py :: anchor_a_booked_referee`).
    async with db.start_session() as session:
        updated_document_raw = await session.with_transaction(retire_the_referee)

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
    """Clear `inactive_since`, putting the referee back into the picker and every default read.

    The ghost answers 404 here too: cleared on it, the picker would offer a bookable row with no
    person behind it.
    """

    updated_document_raw = await set_inactive_since(
        collection=schiedsrichter_collection,
        db_filter=build_referee_filter(schiedsrichter_id),
        when=None,
    )

    return FLSchiedsrichterWriteResponse(updated_document=FLSchiedsrichter(**updated_document_raw))


@router.post(
    f"{by_id('schiedsrichter_id')}/anonymisieren",
    response_model=FLSchiedsrichterWriteResponse,
    summary="Anonymise a Schiedsrichter",
)
async def anonymise_schiedsrichter(
    schiedsrichter_id: CustomRouteObjectId,
    schiedsrichter_collection: SchiedsrichterCollection,
    spiele_collection: SpieleCollection,
    aktionen_collection: AktionenCollection,
    db: DBClient,
    germany_now: datetime = Depends(get_germany_now),
) -> FLSchiedsrichterWriteResponse:
    """Delete the referee's document and repoint every fixture that named them at the ghost.

    The row does not survive, and nothing on it is nulled in place: the fixtures keep their own
    `payment` and read from then on as officiated by nobody. It cannot be undone, and an id already
    erased answers 404. Erasing the ghost itself is refused (`REQ-ANONYMISE-004`).

    **The response carries the ghost rather than the person**: the row the path named is gone, and
    answering an erasure with the name and contact details it just destroyed would serve them once
    more. `updated_document.id` is therefore the ghost's, which is what those fixtures now name.

    **The repointed fixtures inherit the ghost's retirement**, so one still to be played is reported
    by `GET /spiele/action_required` as a retired booking until somebody assigns a referee to it, and
    a save putting a played or called-off one back among those still to be played is refused it
    (`REQ-BOOKING-001`).
    """

    # Before the transaction: the ghost is refused whatever the database holds, and a read of it
    # inside the callback would answer 404 and hide the reason.
    refuse(find_ghost_erasure_refusal(schiedsrichter_id=schiedsrichter_id))

    async def erase_the_referee(session: AsyncClientSession) -> FLSchiedsrichterWriteResponse:
        # In-session, so the 404 for an id already erased is decided on the snapshot the delete
        # below writes, and a rival rename conflicts rather than landing between them. Projected
        # to the id: nothing here reads a value this call destroys.
        await pull_one_from_db(
            collection=schiedsrichter_collection,
            db_filter=build_referee_filter(schiedsrichter_id),
            projection={"_id": 1},
            session=session,
        )

        # Written here rather than at a deploy step, so an erasure can never repoint a fixture at a
        # row nothing holds -- which `REQ-BOOKING-001` would then read as an unknown referee and
        # `GET /spiele/action_required` would report as nothing at all.
        ghost = await schiedsrichter_collection.find_one({"_id": GHOST_SCHIEDSRICHTER_ID}, session=session)
        if ghost is None:
            ghost = build_ghost_schiedsrichter()
            await post_one_to_db(collection=schiedsrichter_collection, document=ghost, session=session)

        await patch_many_in_db(
            collection=spiele_collection,
            db_filter=build_assignment_filter(schiedsrichter_id),
            update=build_ghost_repoint(),
            session=session,
        )

        # `erase_many_from_db` and never `delete_many_from_db`: the second keeps every image, which
        # here would file the person's whole document into the log this call exists to clear
        # (`docs/backend/spec.md :: I48`).
        await erase_many_from_db(
            collection=schiedsrichter_collection,
            db_filter={"_id": schiedsrichter_id},
            session=session,
        )

        # ONE stamp for both passes, so a row cannot say which of the two reached it.
        stamp = log_stamp(germany_now)

        await patch_many_in_db(
            collection=aktionen_collection,
            db_filter=build_redaction_filter([(Collection.SCHIEDSRICHTER, [schiedsrichter_id])]),
            update=build_redaction_update(at=stamp),
            session=session,
        )

        # The `spiele` rows, which the pass above cannot reach: every fixture stores a COPY of the
        # name, so each edit to one filed an image carrying it, under that fixture's id rather than
        # the referee's.
        await patch_many_in_db(
            collection=aktionen_collection,
            db_filter=build_booked_image_filter(schiedsrichter_id),
            update=build_redaction_update(at=stamp),
            session=session,
        )

        return FLSchiedsrichterWriteResponse(updated_document=FLSchiedsrichter(**ghost))

    # ONE transaction over all of it (`docs/backend/spec.md :: I42`): a referee deleted while a
    # fixture still names them strands that fixture, and one deleted while the log still holds their
    # details reports an erasure that did not happen.
    async with db.start_session() as session:
        # `with_transaction` over a bare one -- the callback derives every write from the path id,
        # so a retry is safe.
        return await session.with_transaction(erase_the_referee)
