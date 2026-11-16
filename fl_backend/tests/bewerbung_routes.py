"""
TESTS · the routes a seat's link reaches, each called by its own function outside a request, every collection wired from one database

A collection a case hands in instead replaces the wired one by its parameter's name.
"""

import inspect
from collections.abc import Callable, Mapping
from datetime import datetime
from typing import Any

from pydantic import TypeAdapter
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.admin_router import resend_einwilligung
from app.api.bewerbungen.public_router import get_einwilligung_view, post_einwilligung
from app.api.bewerbungen.schemas import FLBewerbungEinwilligungAnswerPayload
from app.core.collections import Collection
from app.shared.schemas.confirmation import FLTokenPayload


def _collections(handler: Callable[..., Any], database: AsyncDatabase, replaced: Mapping[str, Any]) -> dict[str, Any]:
    """Every collection `handler` takes, read off its parameters, so a route gaining one is wired here without an edit."""

    handles = {
        name: database[Collection(name.removesuffix("_collection"))]
        for name in inspect.signature(handler).parameters
        if name.endswith("_collection")
    }
    return {**handles, **replaced}


async def answered(
    database: AsyncDatabase, client: AsyncMongoClient, body: Mapping[str, Any], *, today: str, germany_now: datetime, **replaced: Any
) -> Any:
    """`body` answered through a seat's link, a consent or a Widerspruch as its `answer` says."""

    return await post_einwilligung(
        answer_data=TypeAdapter(FLBewerbungEinwilligungAnswerPayload).validate_python(dict(body)),
        **_collections(post_einwilligung, database, replaced),
        db=client,
        today=today,
        germany_now=germany_now,
    )


async def viewed(database: AsyncDatabase, token: str, *, today: str) -> Any:
    """What a seat's link opens."""

    return await get_einwilligung_view(view_data=FLTokenPayload(token=token), **_collections(get_einwilligung_view, database, {}), today=today)


async def resent(database: AsyncDatabase, bewerbung_id: Any, seat: str, *, today: str, germany_now: datetime, **replaced: Any) -> Any:
    """A seat's link mailed again by an administrator."""

    return await resend_einwilligung(
        bewerbung_id=bewerbung_id,
        seat=seat,
        **_collections(resend_einwilligung, database, replaced),
        db=database.client,
        today=today,
        germany_now=germany_now,
    )
