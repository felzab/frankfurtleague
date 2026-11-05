from datetime import datetime
from typing import Any

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.aktionen.crud import redact_images_in_session
from app.api.outbox.schemas import FLOutboxLink, FLOutboxReference, FLSchiedsrichterConfirmationData
from app.api.outbox.services import OwedMail, enqueue_mails
from app.api.schiedsrichter.services import (
    ADDRESS_PATH,
    TOKEN_HASHES_PATH,
    booked_image_edits,
    build_assignment_filter,
    build_booked_image_filter,
    build_ghost_repoint,
    build_ghost_schiedsrichter,
    build_referee_filter,
)
from app.core.collections import Collection
from app.core.crud import ensure_one_in_db, erase_many_from_db, patch_many_in_db, pull_one_from_db, redact_log_rows_in_db
from app.shared.schemas.custom import CustomObjectId


async def owe_the_bestaetigung(
    *,
    outbox_collection: AsyncCollection,
    schiedsrichter_id: Any,
    email: str,
    frist: str,
    # The referee's `version` after the write owing the mail: the same on a retry of that write, another on every other.
    version: int,
    now: datetime,
    # REQUIRED: the mail is owed by the write that minted the block, and stands or falls with it.
    session: AsyncClientSession,
) -> None:
    """Owe the referee their confirmation link at the address the write left them, the link minted when it is handed out.

    The fresh link replaces every earlier one, and is minted only while the record still holds this address: a
    correction since stops the mail rather than sending a live link to the replaced mailbox.
    """

    await enqueue_mails(
        outbox_collection=outbox_collection,
        session=session,
        mails=[
            OwedMail(
                key=f"schiedsrichter/{schiedsrichter_id}/confirmation/{version}",
                an=email,
                data=FLSchiedsrichterConfirmationData(kind="schiedsrichter_confirmation", frist=frist),
                reference=FLOutboxReference(collection=Collection.SCHIEDSRICHTER, id=schiedsrichter_id, seat=None),
                link=FLOutboxLink(paths=[TOKEN_HASHES_PATH], addresses=[ADDRESS_PATH], replaced=True),
            )
        ],
        now=now,
    )


async def ensure_ghost_schiedsrichter(
    *,
    schiedsrichter_collection: AsyncCollection,
    # REQUIRED: written outside the erasure's transaction, the ghost would stand where the repoint it
    # exists for rolled back.
    session: AsyncClientSession,
) -> None:
    """Write the ghost where none stands; called once before the first referee of a transaction goes.

    One upsert inside the erasure's transaction, on a collection the boot's index build has already made
    (`app/core/db.py`); an upsert creating one there is a write a sharded transaction would refuse.
    """

    # Written here rather than at a deploy step, so an erasure can never repoint a fixture at a
    # row nothing holds -- which `booking_unknown_resource` would then read as an unknown referee and
    # `GET /spiele/action_required` would report as nothing at all.
    await ensure_one_in_db(collection=schiedsrichter_collection, document=build_ghost_schiedsrichter(), session=session)


async def loeschen_referee_in_session(
    *,
    schiedsrichter_collection: AsyncCollection,
    spiele_collection: AsyncCollection,
    action_log_collection: AsyncCollection,
    schiedsrichter_id: CustomObjectId,
    # ONE stamp for both passes below, so a row cannot say which of the two reached it; the caller's,
    # so several erasures in one transaction redact under one instant.
    stamp: str,
    # REQUIRED, so a caller forgetting it is a TypeError rather than writes committing one by one.
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
    # here would file the person's whole document into the log this call exists to clear.
    await erase_many_from_db(
        collection=schiedsrichter_collection,
        db_filter={"_id": schiedsrichter_id},
        session=session,
    )

    await redact_log_rows_in_db(
        action_log_collection=action_log_collection, targets=[(Collection.SCHIEDSRICHTER, [schiedsrichter_id])], at=stamp, session=session
    )

    # The `spiele` rows, which the pass above cannot reach: every fixture stores a COPY of the
    # name, so each edit filed an image carrying it under the fixture's id. The booking alone goes;
    # each image keeps its result.
    await redact_images_in_session(
        action_log_collection=action_log_collection,
        db_filter=build_booked_image_filter(schiedsrichter_id),
        judge=lambda image: booked_image_edits(image, schiedsrichter_id),
        stamp=stamp,
        session=session,
    )

    return repointed.modified_count
