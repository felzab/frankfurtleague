from collections.abc import Mapping
from typing import Any

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.saisons.schemas import FLSaisonRules
from app.core.crud import pull_one_from_db
from app.core.exceptions import DocumentNotFoundException

CURRENT_SAISON_FILTER = {"status": "active"}


async def pull_current_saison(saisons_collection: AsyncCollection) -> Mapping[str, Any]:
    """The season marked `active`.

    Raises 404 when none is active rather than degrading to an unfiltered query.
    """

    return await pull_one_from_db(collection=saisons_collection, db_filter=CURRENT_SAISON_FILTER)


async def pull_current_saison_id(saisons_collection: AsyncCollection) -> str:
    """The current season's id."""

    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter=CURRENT_SAISON_FILTER, projection=["_id"])

    return str(saison_raw["_id"])


async def pull_massgebliche_saison_id(saisons_collection: AsyncCollection, session: AsyncClientSession | None = None) -> str | None:
    """The season a count of seasons is reckoned from: the running one.

    `None` rather than a 404 where none runs, so the caller decides what that means.
    """

    try:
        running = await pull_one_from_db(collection=saisons_collection, db_filter=CURRENT_SAISON_FILTER, projection=["_id"], session=session)
    except DocumentNotFoundException:
        # Never the newest `past` season instead: after the first activation no route leaves the
        # league without a running one, and a ban counted from a
        # guessed season bars a person for the wrong five.
        return None

    return str(running["_id"])


async def pull_saison_id_and_rules(
    saisons_collection: AsyncCollection,
    saison_id: str | None,
) -> tuple[str, FLSaisonRules]:
    """A season's id and its scoring rules.

    `saison_id=None` means the current season; an explicit id naming none raises 404.
    """

    db_filter = CURRENT_SAISON_FILTER if saison_id is None else {"_id": saison_id}
    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter=db_filter, projection=["_id", "rules"])

    return str(saison_raw["_id"]), FLSaisonRules.model_validate(saison_raw["rules"])
