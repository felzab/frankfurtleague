from datetime import datetime
from typing import Any

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.outbox.schemas import FLOutboxLink, FLOutboxReference, FLSchiedsrichterConfirmationData
from app.api.outbox.services import OwedMail, enqueue_mails
from app.api.schiedsrichter.services import ADDRESS_PATH, TOKEN_HASHES_PATH, build_assignment_filter
from app.api.spielbestaetigungen.services import build_referee_rows_filter
from app.api.teams.services import is_played
from app.core.collections import Collection
from app.core.crud import aggregate_many_from_db, delete_many_from_db, patch_many_in_db, pull_one_from_db
from app.shared.schemas.custom import CustomObjectId


async def owe_the_confirmation(
    *,
    outbox_collection: AsyncCollection,
    schiedsrichter_id: Any,
    email: str,
    deadline: str,
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
                to=email,
                data=FLSchiedsrichterConfirmationData(kind="schiedsrichter_confirmation", deadline=deadline),
                reference=FLOutboxReference(collection=Collection.SCHIEDSRICHTER, id=schiedsrichter_id, seat=None),
                link=FLOutboxLink(paths=[TOKEN_HASHES_PATH], addresses=[ADDRESS_PATH], replaced=True),
            )
        ],
        now=now,
    )


async def erase_referee_in_session(
    *,
    schiedsrichter_collection: AsyncCollection,
    spiele_collection: AsyncCollection,
    spielbestaetigungen_collection: AsyncCollection,
    schiedsrichter_id: CustomObjectId,
    # The erasing request's clock, which judges each fixture played or still to come.
    now: datetime,
    # REQUIRED, so a caller forgetting it is a TypeError rather than writes committing one by one.
    session: AsyncClientSession,
) -> None:
    """Delete the referee, every confirmation row they are the party of, and their bookings of fixtures still to come.

    A played fixture's booking stands naming nobody, its `payment` kept: it records what that match agreed. Judged once,
    here, by `app/api/teams/services.py :: is_played`. One function for an erasure on request, by the season rule and by
    the sweep alike.
    """

    # In-session, so the 404 for an id already erased is decided on the snapshot the delete
    # below writes, and a rival rename conflicts rather than landing between them. Projected
    # to the id: nothing here reads a value this call destroys.
    await pull_one_from_db(
        collection=schiedsrichter_collection,
        db_filter={"_id": schiedsrichter_id},
        projection={"_id": 1},
        session=session,
    )

    # Removed rather than emptied: a row asks its party, and nobody can answer.
    await delete_many_from_db(
        collection=spielbestaetigungen_collection, db_filter=build_referee_rows_filter([schiedsrichter_id]), session=session
    )

    booked = await aggregate_many_from_db(
        collection=spiele_collection,
        pipeline=[{"$match": build_assignment_filter(schiedsrichter_id)}, {"$project": {"_id": 1, "date": 1, "time": 1}}],
        session=session,
    )
    played = sorted((spiel["_id"] for spiel in booked if is_played(date=spiel.get("date"), time=spiel.get("time"), now=now)), key=str)
    to_come = sorted((spiel["_id"] for spiel in booked if spiel["_id"] not in played), key=str)

    # No write for none: most referees are erased holding no booking.
    if played:
        await patch_many_in_db(
            collection=spiele_collection,
            db_filter={"_id": {"$in": played}},
            update={"$set": {"schiedsrichter.schiedsrichter_id": None}},
            session=session,
        )
    if to_come:
        await patch_many_in_db(
            collection=spiele_collection,
            db_filter={"_id": {"$in": to_come}},
            update={"$set": {"schiedsrichter": None}},
            session=session,
        )

    await delete_many_from_db(
        collection=schiedsrichter_collection,
        db_filter={"_id": schiedsrichter_id},
        session=session,
    )
