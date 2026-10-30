from datetime import datetime
from typing import Any

from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.postausgang.schemas import FLBewerbungEingangDaten, FLPostausgangBezug
from app.api.postausgang.services import OwedMail, enqueue_mails
from app.core.collections import Collection
from app.shared.schemas.literals import FLKontaktRolle
from tests.postausgang import MAIL_NOW


async def a_mail_that_bounced(
    database: AsyncDatabase, client: AsyncMongoClient, *, bewerbung_id: Any, sitz: FLKontaktRolle, an: str, now: datetime = MAIL_NOW
) -> None:
    """One mail about an application's seat, owed, sent and then reported undeliverable, as the drain and the provider leave it."""

    schluessel = f"{Collection.BEWERBUNGEN}/{bewerbung_id}/seeded-bounce/{sitz}"
    async with client.start_session() as session:
        await enqueue_mails(
            postausgang_collection=database[Collection.POSTAUSGANG],
            session=session,
            mails=[
                OwedMail(
                    schluessel=schluessel,
                    an=an,
                    daten=FLBewerbungEingangDaten(
                        art="bewerbung_eingang", saison_id="2026", rollen=["ansprechperson"], ausstehend=[], frist="2026-04-15"
                    ),
                    bezug=FLPostausgangBezug(sammlung=Collection.BEWERBUNGEN, id=bewerbung_id, sitz=sitz),
                )
            ],
            now=now,
        )
    await database[Collection.POSTAUSGANG].update_one(
        {"schluessel": schluessel},
        {"$set": {"stand": "gesendet", "zustellung": {"stand": "unzustellbar", "grund": "NoEmail", "am": now}}},
    )
