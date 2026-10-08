from collections.abc import Mapping
from typing import Any

from pymongo.asynchronous.database import AsyncDatabase

from app.api.identitaet.lookup import RecordCollections
from app.core.collections import Collection


def record_collections(database: AsyncDatabase | Mapping[Collection, Any], **replaced: Any) -> RecordCollections:
    """The lookup as a request holds it, over one database or a mapping of stand-ins, any handle replaced by name."""

    handles = {
        "saison_teams_collection": database[Collection.SAISON_TEAMS],
        "saisons_collection": database[Collection.SAISONS],
        "spieler_collection": database[Collection.SPIELER],
        "schiedsrichter_collection": database[Collection.SCHIEDSRICHTER],
        "bewerbungen_collection": database[Collection.BEWERBUNGEN],
        "registrierungen_collection": database[Collection.REGISTRIERUNGEN],
    }

    return RecordCollections(**{**handles, **replaced})
