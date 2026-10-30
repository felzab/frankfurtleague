from datetime import UTC, datetime

from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.postausgang.schemas import FLPostausgangAusgabe, FLPostausgangErgebnisPayload
from app.api.postausgang.system_router import post_ausgabe, post_ergebnis
from app.core.collections import Collection
from tests.bans import ban_list

# The clock a case owes and drains its mails under, a century ahead of the real one: the TTL monitor deletes a row whose
# delete date has passed, under a case still reading it.
MAIL_NOW = datetime(2126, 4, 16, 12, 30, tzinfo=UTC)


async def drained(database: AsyncDatabase, client: AsyncMongoClient, *, now: datetime = MAIL_NOW) -> list[FLPostausgangAusgabe]:
    """Every mail owed now, handed out and reported sent, oldest first, as one drain of the frontend's settles them."""

    mails: list[FLPostausgangAusgabe] = []
    while True:
        answer = await post_ausgabe(
            postausgang_collection=database[Collection.POSTAUSGANG], sperrliste=ban_list(database), db=database, db_client=client, now=now
        )
        if answer.beanspruchung is None:
            return mails

        for mail in answer.mails:
            await post_ergebnis(
                ergebnis_data=FLPostausgangErgebnisPayload(
                    beanspruchung=answer.beanspruchung, id=mail.id, ergebnis="gesendet", nachricht_id=None
                ),
                postausgang_collection=database[Collection.POSTAUSGANG],
                now=now,
            )
        mails += answer.mails
