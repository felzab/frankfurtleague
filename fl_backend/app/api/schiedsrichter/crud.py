from collections.abc import Mapping, Sequence
from typing import Any

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.aktionen.crud import redact_images_in_session
from app.api.schiedsrichter.services import (
    ADRESSWECHSEL_FELD,
    adresswechsel_image_edits,
    booked_image_edits,
    build_assignment_filter,
    build_booked_image_filter,
    build_ghost_repoint,
    build_ghost_schiedsrichter,
    build_referee_filter,
)
from app.core.collections import Collection
from app.core.crud import erase_many_from_db, patch_many_in_db, patch_one_in_db, post_one_to_db, pull_one_from_db
from app.core.recording import build_redaction_filter, build_redaction_update
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID
from app.shared.folding import sign_in_identifier
from app.shared.schemas.custom import CustomObjectId


async def ensure_ghost_schiedsrichter(
    *,
    schiedsrichter_collection: AsyncCollection,
    # REQUIRED: written outside the erasure's transaction, the ghost would stand where the repoint it
    # exists for rolled back.
    session: AsyncClientSession,
) -> Mapping[str, Any]:
    """The ghost's document, written where none stands; called once before the first referee of a transaction goes."""

    # Written here rather than at a deploy step, so an erasure can never repoint a fixture at a
    # row nothing holds -- which `REQ-BOOKING-001` would then read as an unknown referee and
    # `GET /spiele/action_required` would report as nothing at all.
    ghost = await schiedsrichter_collection.find_one({"_id": GHOST_SCHIEDSRICHTER_ID}, session=session)
    if ghost is None:
        ghost = build_ghost_schiedsrichter()
        await post_one_to_db(collection=schiedsrichter_collection, document=ghost, session=session)

    return ghost


async def erase_referee_in_session(
    *,
    schiedsrichter_collection: AsyncCollection,
    spiele_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    schiedsrichter_id: CustomObjectId,
    # ONE stamp for both passes below, so a row cannot say which of the two reached it; the caller's,
    # so several erasures in one transaction redact under one instant.
    stamp: str,
    # REQUIRED, so a caller forgetting it is a TypeError rather than writes committing one by one
    # (`docs/backend/spec.md :: I52`).
    session: AsyncClientSession,
) -> int:
    """Delete the referee, repoint their fixtures at the ghost and redact the log, answering how many fixtures moved.

    The ghost must stand already: `ensure_ghost_schiedsrichter` writes it once per transaction, ahead of every referee.
    """

    # In-session, so the 404 for an id already erased is decided on the snapshot the delete
    # below writes, and a rival rename conflicts rather than landing between them. Projected
    # to the id: nothing here reads a value this call destroys.
    await pull_one_from_db(
        collection=schiedsrichter_collection,
        db_filter=build_referee_filter(schiedsrichter_id),
        projection={"_id": 1},
        session=session,
    )

    repointed = await patch_many_in_db(
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

    await patch_many_in_db(
        collection=aktionen_collection,
        db_filter=build_redaction_filter([(Collection.SCHIEDSRICHTER, [schiedsrichter_id])]),
        update=build_redaction_update(at=stamp),
        session=session,
    )

    # The `spiele` rows, which the pass above cannot reach: every fixture stores a COPY of the
    # name, so each edit filed an image carrying it under the fixture's id. The booking alone goes;
    # each image keeps its result.
    await redact_images_in_session(
        aktionen_collection=aktionen_collection,
        db_filter=build_booked_image_filter(schiedsrichter_id),
        judge=lambda image: booked_image_edits(image, schiedsrichter_id),
        stamp=stamp,
        session=session,
    )

    return repointed.modified_count


async def remove_pending_addresses_in_session(
    *,
    schiedsrichter_collection: AsyncCollection,
    # Rows whose pending block names the erased address and whose stored address does not: each is the
    # old address's person's until the change is confirmed, so the block alone goes.
    schiedsrichter_ids: Sequence[CustomObjectId],
    # REQUIRED, so a caller forgetting it is a TypeError rather than writes committing one by one
    # (`docs/backend/spec.md :: I52`).
    session: AsyncClientSession,
) -> int:
    """Remove each row's pending address change, answering how many.

    The row's log images still carry the address: the erasure's pass over other documents' images, run after this, takes it out of them.
    """

    # No write for none: a fan-out matching nothing still files a log row.
    if not schiedsrichter_ids:
        return 0

    # A fan-out and by ids alone: it files no image of the block it removes, and its filter, kept as
    # text, names nobody (`docs/backend/spec.md :: I48`).
    removed = await patch_many_in_db(
        collection=schiedsrichter_collection,
        db_filter={"_id": {"$in": list(schiedsrichter_ids)}},
        update={"$unset": {ADRESSWECHSEL_FELD: ""}},
        session=session,
    )

    return removed.modified_count


async def discard_adresswechsel_in_session(
    *,
    schiedsrichter_collection: AsyncCollection,
    aktionen_collection: AsyncCollection,
    # The judgement: a referee it matches not is a miss, `DocumentNotFoundException`, before any write.
    db_filter: Mapping[str, Any],
    stamp: str,
    return_document: bool,
    # REQUIRED, so the address judged in the images is the one this transaction removes.
    session: AsyncClientSession,
) -> Mapping[str, Any]:
    """Remove the pending change, and its address from every log image of that referee, the rest of each image standing.

    The administrator's discard and the lapse's clock both run this body (`docs/backend/spec.md :: I562`, `:: I693`).
    """

    stored = await pull_one_from_db(
        collection=schiedsrichter_collection, db_filter=db_filter, projection={f"{ADRESSWECHSEL_FELD}.email": 1}, session=session
    )
    updated = await patch_one_in_db(
        collection=schiedsrichter_collection,
        db_filter=db_filter,
        update={"$unset": {ADRESSWECHSEL_FELD: ""}},
        session=session,
        return_document=return_document,
    )

    # LAST, for the contact's Widerspruch's reason: it reaches the pre-image the patch above just
    # filed, which still holds the discarded address.
    discarded = sign_in_identifier(str(stored[ADRESSWECHSEL_FELD]["email"]))
    await redact_images_in_session(
        aktionen_collection=aktionen_collection,
        db_filter=build_redaction_filter([(Collection.SCHIEDSRICHTER, [stored["_id"]])]),
        judge=lambda image: adresswechsel_image_edits(image, discarded),
        stamp=stamp,
        session=session,
    )

    return updated
