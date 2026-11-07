from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.ban_list.admin_router import post_ban_list_entry
from app.api.ban_list.schemas import FLPostBanListEntryPayload, FLPostBanListEntryResponse
from app.core.collections import Collection
from app.core.recording import actor_var


async def ban_through_the_route(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    *,
    email: str,
    ban_reason: str,
    by: str,
    today: str,
    saisons: Any = None,
    grants: Any = None,
    notify: bool = False,
) -> FLPostBanListEntryResponse:
    """A ban as an administrator enters it: its own transaction and the anchors it writes, where `ban_document` seeds the row alone."""

    # The administrator `bind_actor` would bind: `record_act` reads who acted off the request.
    token = actor_var.set(by)
    try:
        return await post_ban_list_entry(
            ban_list_data=FLPostBanListEntryPayload(email=email, ban_reason=ban_reason, notify=notify),
            ban_list_collection=database[Collection.BAN_LIST],
            saisons_collection=database[Collection.SAISONS] if saisons is None else saisons,
            grants_collection=database[Collection.GRANTS] if grants is None else grants,
            address_changes_collection=database[Collection.ADDRESS_CHANGES],
            outbox_collection=database[Collection.OUTBOX],
            db=client,
            created_by=by,
            today=today,
            now=datetime.fromisoformat(today).replace(hour=12, tzinfo=ZoneInfo("Europe/Berlin")),
        )
    finally:
        actor_var.reset(token)
