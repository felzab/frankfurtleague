from collections.abc import Mapping
from typing import Any

from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.sperrliste.admin_router import post_sperrliste_eintrag
from app.api.sperrliste.lookup import BanList
from app.api.sperrliste.schemas import FLPostSperrlistePayload, FLPostSperrlisteResponse
from app.core.collections import Collection
from tests.config import build_test_config

_CONFIG = build_test_config()


def ban_list(database: AsyncDatabase | Mapping[Collection, Any], *, saisons: Any = None) -> BanList:
    """The list under the suite's own key, which is the one `tests/documents.py :: ban_document` hashes a seeded ban under."""

    return BanList(
        database[Collection.SPERRLISTE],
        database[Collection.SAISONS] if saisons is None else saisons,
        _CONFIG.sperrliste_schluessel,
    )


async def ban_through_the_route(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    *,
    email: str,
    grund: str,
    von: str,
    today: str,
    saisons: Any = None,
    berechtigungen: Any = None,
) -> FLPostSperrlisteResponse:
    """A ban as an administrator enters it: its own transaction and the anchors it writes, where `ban_document` seeds the row alone."""

    return await post_sperrliste_eintrag(
        sperrliste_data=FLPostSperrlistePayload(email=email, grund=grund),
        sperrliste_collection=database[Collection.SPERRLISTE],
        sperrliste=ban_list(database, saisons=saisons),
        saisons_collection=database[Collection.SAISONS] if saisons is None else saisons,
        berechtigungen_collection=database[Collection.BERECHTIGUNGEN] if berechtigungen is None else berechtigungen,
        berechtigungen_postausgang_collection=database[Collection.BERECHTIGUNGEN_POSTAUSGANG],
        db=client,
        config=_CONFIG,
        erstellt_von=von,
        today=today,
    )
