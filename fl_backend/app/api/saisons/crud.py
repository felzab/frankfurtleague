from collections.abc import Mapping, Sequence
from typing import Any

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.saisons.schemas import FLSaisonRules
from app.core.crud import pull_one_from_db
from app.core.exceptions import DocumentNotFoundError

CURRENT_SAISON_FILTER = {"status": "active"}


async def pull_active_saison(saisons_collection: AsyncCollection) -> Mapping[str, Any]:
    """The season marked `active`.

    Raises 404 when none is active rather than degrading to an unfiltered query.
    """

    return await pull_one_from_db(collection=saisons_collection, db_filter=CURRENT_SAISON_FILTER)


async def pull_active_saison_id(saisons_collection: AsyncCollection) -> str:
    """The current season's id."""

    saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter=CURRENT_SAISON_FILTER, projection=["_id"])

    return str(saison_raw["_id"])


async def pull_massgebliche_saison_id(saisons_collection: AsyncCollection, session: AsyncClientSession | None = None) -> str | None:
    """The season a count of seasons is reckoned from: the running one.

    `None` rather than a 404 where none runs, so the caller decides what that means.
    """

    try:
        running = await pull_one_from_db(collection=saisons_collection, db_filter=CURRENT_SAISON_FILTER, projection=["_id"], session=session)
    except DocumentNotFoundError:
        # Never the newest `past` season instead: after the first activation no route leaves the
        # league without a running one, and a ban counted from a
        # guessed season bars a person for the wrong five.
        return None

    return str(running["_id"])


async def has_started(*, spiele_collection: AsyncCollection, saison_id: str, today: str, session: AsyncClientSession | None = None) -> bool:
    """Whether this season has started: from the German day of its earliest group-phase fixture, never while none is dated.

    The one predicate every start lock reads. Some fixture is dated today or earlier exactly when the
    earliest one is, so no sort is needed.
    """

    started = await spiele_collection.find_one(_started(saison_id, today), {"_id": 1}, session=session)

    return started is not None


async def started_saison_ids(*, spiele_collection: AsyncCollection, saison_ids: Sequence[str], today: str) -> set[str]:
    """The seasons among `saison_ids` that `has_started` answers true for, in one round trip rather than one per season."""

    return set(await spiele_collection.distinct("saison_id", _started({"$in": list(saison_ids)}, today)))


def _started(saison_id: str | Mapping[str, Any], today: str) -> Mapping[str, Any]:
    """The fixtures that start a season, of the season or seasons `saison_id` matches."""

    # `$type` beside `$lte`, so an undated fixture's null is never compared.
    return {"saison_id": saison_id, "saison_phase": "gruppenphase", "datum": {"$type": "string", "$lte": today}}


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
