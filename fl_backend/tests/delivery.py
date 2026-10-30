from datetime import datetime
from typing import Any

from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.outbox.schemas import FLBewerbungReceivedData, FLOutboxReference
from app.api.outbox.services import OwedMail, enqueue_mails
from app.core.collections import Collection
from app.shared.schemas.literals import FLKontaktRolle
from tests.outbox import MAIL_NOW


async def a_mail_that_bounced(
    database: AsyncDatabase, client: AsyncMongoClient, *, bewerbung_id: Any, seat: FLKontaktRolle, an: str, now: datetime = MAIL_NOW
) -> None:
    """One mail about an application's seat, owed, sent and then reported undeliverable, as the drain and the provider leave it."""

    key = f"{Collection.BEWERBUNGEN}/{bewerbung_id}/seeded-bounce/{seat}"
    async with client.start_session() as session:
        await enqueue_mails(
            outbox_collection=database[Collection.OUTBOX],
            session=session,
            mails=[
                OwedMail(
                    key=key,
                    an=an,
                    data=FLBewerbungReceivedData(
                        art="bewerbung_received", saison_id="2026", rollen=["ansprechperson"], pending=[], frist="2026-04-15"
                    ),
                    reference=FLOutboxReference(collection=Collection.BEWERBUNGEN, id=bewerbung_id, seat=seat),
                )
            ],
            now=now,
        )
    await database[Collection.OUTBOX].update_one(
        {"key": key},
        {"$set": {"stand": "sent", "delivery": {"stand": "undeliverable", "grund": "NoEmail", "am": now}}},
    )
