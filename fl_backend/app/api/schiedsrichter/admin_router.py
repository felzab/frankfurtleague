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
    ANONYMISED_SCHIEDSRICHTER,
    ANONYMISIERT_AM,
    build_booked_image_filter,
    build_unplayed_assignment_filter,
    find_anonymisation_refusal,
    find_anonymisation_undo_refusal,
    find_reactivation_refusal,
    find_referee_retire_refusal,
    first_stamped,
    holds_an_anonymisable_value,
)
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
    """Create a referee. `inactive_since` and `anonymisiert_am` are set to null here and are on no payload."""

    # `insert_live` stamps `inactive_since` for every collection that has one; this second date is
    # the referee's alone, so the row it is required on is the one that writes it.
    post_operation = await insert_live(
        collection=schiedsrichter_collection,
        document={**schiedsrichter_data.model_dump(mode="json"), ANONYMISIERT_AM: None},
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

    A save reaching a referee whose data were erased is refused (`REQ-ANONYMISE-002`): the payload
    carries a name on every field it edits, so an erased row takes no edit at all.
    """

    async def rename_and_fan_out(session: AsyncClientSession) -> FLPatchSchiedsrichterResponse:
        patched = schiedsrichter_data.model_dump(mode="json")

        # Read THROUGH the session, where the anonymisation's own guard reads outside one: this `$set`
        # moves the row, so a rival erasure conflicts on the write set and the retry re-reads (I53).
        refuse(
            find_anonymisation_undo_refusal(
                stored=await pull_one_from_db(
                    collection=schiedsrichter_collection,
                    db_filter={"_id": schiedsrichter_id},
                    projection={"kontakt": 1, "name": 1, ANONYMISIERT_AM: 1},
                    session=session,
                ),
            )
        )

        updated_document_raw = await patch_one_in_db(
            collection=schiedsrichter_collection,
            db_filter={"_id": schiedsrichter_id},
            update={"$set": patched},
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
    async with db.start_session() as session:
        return await session.with_transaction(rename_and_fan_out)


@router.delete(by_id("schiedsrichter_id"), response_model=FLSchiedsrichterWriteResponse, summary="Deactivate a Schiedsrichter (soft delete)")
async def delete_schiedsrichter(
    schiedsrichter_id: CustomRouteObjectId,
    schiedsrichter_collection: SchiedsrichterCollection,
    spiele_collection: SpieleCollection,
    today: str = Depends(get_german_date_str),
) -> FLSchiedsrichterWriteResponse:
    """Deactivate a referee. SOFT, for the same reason as venues: matches embed a copy."""

    assigned = await pull_many_from_db(
        collection=spiele_collection,
        db_filter=build_unplayed_assignment_filter(schiedsrichter_id),
        projection={"spiel_nr": 1},
    )
    refuse(find_referee_retire_refusal(upcoming_spiel_nrs=sorted(int(row["spiel_nr"]) for row in assigned)))

    stored = await pull_one_from_db(
        collection=schiedsrichter_collection,
        db_filter={"_id": schiedsrichter_id},
        projection={"inactive_since": 1},
    )

    updated_document_raw = await set_inactive_since(
        collection=schiedsrichter_collection,
        db_filter={"_id": schiedsrichter_id},
        # `first_stamped` and never `today`: a second press would move the day they stopped
        # officiating, which is the day a fee is reconciled against.
        when=first_stamped(stored=stored, field="inactive_since", today=today),
    )

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

    A referee whose data were erased is refused (`REQ-ANONYMISE-003`): the erasure retires them, and
    bringing them back would offer a nameless row for a new fixture, which is fresh personal data
    about the person who asked to be left out.
    """

    # Outside a transaction, unlike the anonymisation's own guard: this refusal reads a field this
    # write does not touch, so there is no write set for a rival erasure to conflict on.
    refuse(
        find_reactivation_refusal(
            anonymisiert_am=(
                await pull_one_from_db(
                    collection=schiedsrichter_collection,
                    db_filter={"_id": schiedsrichter_id},
                    projection={ANONYMISIERT_AM: 1},
                )
            ).get(ANONYMISIERT_AM)
        )
    )

    updated_document_raw = await set_inactive_since(collection=schiedsrichter_collection, db_filter={"_id": schiedsrichter_id}, when=None)

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
    today: str = Depends(get_german_date_str),
) -> FLSchiedsrichterWriteResponse:
    """Null the referee's name, school, telephone number and email address, and stamp the day it was done.

    Written to the row, to every Spiel they officiated and to the log, in one transaction. The row
    itself stays: every Spiel embeds its id, so a removal would strand references. A re-entry under
    the erasure is refused (`REQ-ANONYMISE-001`).

    **It also retires the referee and unassigns them from every fixture with no result**, so they take
    no NEW fixture (`REQ-BOOKING-001`), hold none of the fixtures still to be played, and cannot be
    brought back (`REQ-ANONYMISE-003`): a booking of any kind would create fresh personal data about the
    person who asked to be left out. Such a fixture loses the whole `schiedsrichter` block, the fee
    agreed for it included, and answers `GET /spiele/action_required` until somebody assigns a referee
    to it. A retirement already stamped keeps its own day. What a reader is shown in place of the
    nulled name is the frontend's word, so no endpoint answers one.
    """

    async def clear_the_details_and_the_record(session: AsyncClientSession) -> FLSchiedsrichterWriteResponse:
        async def stored_referee(read_session: AsyncClientSession | None) -> Mapping[str, Any]:
            """The fields the erasure judges itself by, read either through the transaction or outside it.

            A `schiedsrichter_id` naming nobody raises the 404 here, before anything is written.
            """

            return await pull_one_from_db(
                collection=schiedsrichter_collection,
                db_filter={"_id": schiedsrichter_id},
                projection={"kontakt": 1, "name": 1, "schule": 1, "inactive_since": 1, ANONYMISIERT_AM: 1},
                session=read_session,
            )

        # BEFORE the write, which is what makes the guard below reachable: a row this snapshot reads
        # as cleared AND stamped is `$set` to what it holds.
        stored = await stored_referee(session)
        rewrites_nothing = not holds_an_anonymisable_value(stored) and stored.get(ANONYMISIERT_AM) is not None

        # Not `set_inactive_since` for the retirement: its own `patch_one_in_db` would file a second
        # log row holding the values this write is clearing. ONE `$set` describes the state the row is
        # left in.
        updated_document_raw = await patch_one_in_db(
            collection=schiedsrichter_collection,
            db_filter={"_id": schiedsrichter_id},
            update={
                "$set": {
                    **ANONYMISED_SCHIEDSRICHTER,
                    "inactive_since": first_stamped(stored=stored, field="inactive_since", today=today),
                    ANONYMISIERT_AM: first_stamped(stored=stored, field=ANONYMISIERT_AM, today=today),
                }
            },
            session=session,
        )

        # The fee goes with the block: nothing was earned on a match still to be played, and a
        # reassignment writes the next referee's own default compensation.
        await patch_many_in_db(
            collection=spiele_collection,
            db_filter=build_unplayed_assignment_filter(schiedsrichter_id),
            # Null rather than `$unset`: `spiele` requires the key, so a removed one fails the
            # collection validator on the row's next write.
            update={"$set": {"schiedsrichter": None}},
            session=session,
        )

        # The embedded copies, in this same transaction: a fixture stores the name rather than a
        # reference the row could redirect, so an erasure reaching the row alone leaves the person
        # named on every match they officiated.
        await patch_many_in_db(
            collection=spiele_collection,
            db_filter={"schiedsrichter.schiedsrichter_id": schiedsrichter_id},
            update={"$set": {"schiedsrichter.name": None}},
            session=session,
        )

        # The fan-out above needs no arm of its own: `patch_many_in_db` records a filter and a count
        # and no pre-image, so its row names nobody (`docs/backend/spec.md :: I40`).

        # ONE stamp for both passes, so a row cannot say which of the two reached it.
        stamp = log_stamp(germany_now)

        # AFTER the referee patch, so it reaches the row that patch itself just wrote -- the one
        # holding the values being cleared. Redacting first would leave exactly that copy behind.
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

        # Only on the no-op path: a `$set` rewriting nothing joins no write set, so a re-entry
        # outside the API raises no conflict to retry on.
        if rewrites_nothing:
            # Read OUTSIDE the session, where that re-entry is visible and this write is not (I53).
            refuse(find_anonymisation_refusal(re_entered=holds_an_anonymisable_value(await stored_referee(None))))

        return FLSchiedsrichterWriteResponse(updated_document=FLSchiedsrichter(**updated_document_raw))

    # ONE transaction over both (`docs/backend/spec.md :: I42`): a referee cleared while the log
    # still holds their details reports an anonymisation that did not happen.
    async with db.start_session() as session:
        # `with_transaction` over a bare one -- the callback derives both writes from the path id,
        # so a retry is safe.
        return await session.with_transaction(clear_the_details_and_the_record)
