from collections.abc import Iterable, Mapping
from datetime import datetime
from typing import Any

from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.outbox.schemas import FLBewerbungReceivedData, FLOutboxReference
from app.api.outbox.services import OwedMail, enqueue_mails, row_of
from app.core.collections import Collection
from app.shared.schemas.literals import FLKontaktRolle
from tests.outbox import MAIL_NOW


def _bouncing_mail(*, bewerbung_id: Any, seat: FLKontaktRolle, to: str) -> OwedMail:
    return OwedMail(
        key=f"{Collection.BEWERBUNGEN}/{bewerbung_id}/seeded-bounce/{seat}",
        to=to,
        data=FLBewerbungReceivedData(kind="bewerbung_received", saison_id="2026", rollen=["ansprechperson"], pending=[], deadline="2026-04-15"),
        reference=FLOutboxReference(collection=Collection.BEWERBUNGEN, id=bewerbung_id, seat=seat),
    )


def _reported_undeliverable(now: datetime) -> dict[str, Any]:
    return {"state": "sent", "delivery": {"state": "undeliverable", "reason": "NoEmail", "at": now}}


async def a_mail_that_bounced(
    database: AsyncDatabase, client: AsyncMongoClient, *, bewerbung_id: Any, seat: FLKontaktRolle, to: str, now: datetime = MAIL_NOW
) -> None:
    """One mail about an application's seat, owed, sent and then reported undeliverable, as the drain and the provider leave it."""

    mail = _bouncing_mail(bewerbung_id=bewerbung_id, seat=seat, to=to)
    async with client.start_session() as session:
        await enqueue_mails(outbox_collection=database[Collection.OUTBOX], session=session, mails=[mail], now=now)
    await database[Collection.OUTBOX].update_one({"key": mail.key}, {"$set": _reported_undeliverable(now)})


async def mails_that_bounced(
    database: AsyncDatabase, *, bewerbung_ids: Iterable[Any], seats: Mapping[FLKontaktRolle, str], now: datetime = MAIL_NOW
) -> None:
    """`a_mail_that_bounced` for these seats, each at its address, of every one of these applications, in one write for a page of them."""

    await database[Collection.OUTBOX].insert_many(
        [
            {
                **row_of(_bouncing_mail(bewerbung_id=bewerbung_id, seat=seat, to=to), now=now, secret=None, valid_until=None),
                **_reported_undeliverable(now),
            }
            for bewerbung_id in bewerbung_ids
            for seat, to in seats.items()
        ]
    )
