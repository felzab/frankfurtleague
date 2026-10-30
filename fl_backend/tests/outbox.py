from datetime import UTC, datetime

from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.outbox.schemas import FLOutboxHandout, FLOutboxResultPayload
from app.api.outbox.system_router import post_handout, post_result
from app.core.collections import Collection
from tests.bans import ban_list

# The clock a case owes and drains its mails under, a century ahead of the real one: the TTL monitor deletes a row whose
# delete date has passed, under a case still reading it.
MAIL_NOW = datetime(2126, 4, 16, 12, 30, tzinfo=UTC)


async def drained(database: AsyncDatabase, client: AsyncMongoClient, *, now: datetime = MAIL_NOW) -> list[FLOutboxHandout]:
    """Every mail owed now, handed out and reported sent, oldest first, as one drain of the frontend's settles them."""

    mails: list[FLOutboxHandout] = []
    while True:
        answer = await post_handout(
            outbox_collection=database[Collection.OUTBOX], sperrliste=ban_list(database), db=database, db_client=client, now=now
        )
        if answer.lease is None:
            return mails

        for mail in answer.mails:
            await post_result(
                result_data=FLOutboxResultPayload(lease=answer.lease, id=mail.id, result="sent", message_id=None, grund=None),
                outbox_collection=database[Collection.OUTBOX],
                now=now,
            )
        mails += answer.mails
