from collections.abc import Mapping
from datetime import datetime
from typing import Any

from pymongo.asynchronous.database import AsyncDatabase

from app.api.identity.lookup import RecordCollections
from app.api.identity.schemas import FLSignInResponse, FLSubjectPayload
from app.api.identity.system_router import get_sign_in
from app.core.collections import Collection
from tests.handles import wired


def record_collections(database: AsyncDatabase | Mapping[Collection, Any], **replaced: Any) -> RecordCollections:
    """The lookup as a request holds it, over one database or a mapping of stand-ins, any handle replaced by name."""

    return RecordCollections(**wired(RecordCollections, database, **replaced))


async def call_sign_in(database: AsyncDatabase, email: str, *, germany_now: datetime) -> FLSignInResponse:
    """The sign-in's read of `email` outside a request, on the one snapshot a request reads it on."""

    async with database.client.start_session(snapshot=True) as session:
        return await get_sign_in(
            sign_in_data=FLSubjectPayload(email=email),
            records=record_collections(database),
            **wired(get_sign_in, database),
            session=session,
            germany_now=germany_now,
        )
