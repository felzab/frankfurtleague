from datetime import datetime
from typing import Any

from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.postausgang.schemas import FLBewerbungReceivedData, FLPostausgangBezug
from app.api.postausgang.services import OwedMail, enqueue_mails
from app.core.collections import Collection
from app.shared.schemas.literals import FLKontaktRolle
from tests.postausgang import MAIL_NOW


async def a_mail_that_bounced(
    database: AsyncDatabase, client: AsyncMongoClient, *, bewerbung_id: Any, seat: FLKontaktRolle, an: str, now: datetime = MAIL_NOW
) -> None:
    """One mail about an application's seat, owed, sent and then reported undeliverable, as the drain and the provider leave it."""

    schluessel = f"{Collection.BEWERBUNGEN}/{bewerbung_id}/seeded-bounce/{seat}"
    async with client.start_session() as session:
        await enqueue_mails(
            postausgang_collection=database[Collection.POSTAUSGANG],
            session=session,
            mails=[
                OwedMail(
                    key=schluessel,
                    an=an,
                    data=FLBewerbungReceivedData(
                        art="bewerbung_received", saison_id="2026", rollen=["ansprechperson"], pending=[], frist="2026-04-15"
                    ),
                    reference=FLPostausgangBezug(collection=Collection.BEWERBUNGEN, id=bewerbung_id, seat=seat),
                )
            ],
            now=now,
        )
    await database[Collection.POSTAUSGANG].update_one(
        {"key": schluessel},
        {"$set": {"stand": "sent", "delivery": {"stand": "undeliverable", "grund": "NoEmail", "am": now}}},
    )
