from datetime import UTC, datetime

from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.outbox.schemas import FLOutboxHandout, FLOutboxResultPayload
from app.api.outbox.services import RETENTION
from app.api.outbox.system_router import post_handout, post_result
from app.core.collections import Collection
from tests.bans import ban_list

# The clock a case owes and drains its mails under, a century ahead of the real one: the TTL monitor deletes a row whose
# delete date has passed, under a case still reading it.
MAIL_NOW = datetime(2126, 4, 16, 12, 30, tzinfo=UTC)


def claimable(now: datetime) -> datetime:
    """`now`, for a claim of owed mail, refused where it lies more than a retention behind the real clock.

    A claim hands out only rows whose deadline lies after it, and the TTL monitor erases an ordinary row a retention past
    that deadline, so a claim no further behind meets every row it could hand out. Under an older clock the row a case
    owes may be erased first: the monitor passes once a minute, and the case fails only on the run whose pass falls
    between the write owing the mail and its claim.
    """

    assert now + RETENTION > datetime.now(UTC), (
        f"a claim at {now.isoformat()} meets mail the TTL monitor may erase first; owe and claim it ahead of the real clock"
    )
    return now


async def drained(database: AsyncDatabase, client: AsyncMongoClient, *, now: datetime = MAIL_NOW) -> list[FLOutboxHandout]:
    """Every mail owed now, handed out and reported sent, oldest first, as one drain of the frontend's settles them."""

    mails: list[FLOutboxHandout] = []
    while True:
        answer = await post_handout(
            outbox_collection=database[Collection.OUTBOX], sperrliste=ban_list(database), db=database, db_client=client, now=claimable(now)
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
