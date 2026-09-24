from collections.abc import Mapping
from typing import Any

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.saisons.cache import CURRENT_SAISON_CACHE_KEY, read_cached_saison, saison_cache_generation, store_cached_saison
from app.api.saisons.schemas import FLSaisonRules
from app.core.crud import pull_one_from_db
from app.core.exceptions import DocumentNotFoundException

CURRENT_SAISON_FILTER = {"status": "active"}


async def pull_current_saison(saisons_collection: AsyncCollection) -> Mapping[str, Any]:
    """The season marked `active`, from the cache when it holds one.

    Raises 404 when none is active rather than degrading to an unfiltered query, and the miss is
    not cached.
    """

    cached = read_cached_saison(CURRENT_SAISON_CACHE_KEY)
    if cached is not None:
        return cached

    # Read before the fetch is dispatched: a write dropping the cache while it is in flight must
    # beat the store below, not be undone by it.
    generation = saison_cache_generation()
    saison_raw = dict(await pull_one_from_db(collection=saisons_collection, db_filter=CURRENT_SAISON_FILTER))

    # Under its own id too: `/teams` naming the running season explicitly is a common read.
    store_cached_saison(CURRENT_SAISON_CACHE_KEY, saison_raw, generation=generation)
    store_cached_saison(str(saison_raw["_id"]), saison_raw, generation=generation)

    return saison_raw


async def pull_current_saison_id(saisons_collection: AsyncCollection) -> str:
    """The current season's id. The cached document already holds it, so this projects nothing."""

    saison_raw = await pull_current_saison(saisons_collection=saisons_collection)

    return str(saison_raw["_id"])


async def pull_massgebliche_saison_id(saisons_collection: AsyncCollection, session: AsyncClientSession | None = None) -> str | None:
    """The season a count of seasons is reckoned from: the running one.

    `None` rather than a 404 where none runs, so the caller decides what that means.
    """

    try:
        if session is None:
            return await pull_current_saison_id(saisons_collection=saisons_collection)

        # Past the cache: a rollover drops it only once it has committed, so it can answer a season
        # older than the snapshot the caller's transaction reads.
        running = await pull_one_from_db(collection=saisons_collection, db_filter=CURRENT_SAISON_FILTER, projection=["_id"], session=session)

        return str(running["_id"])
    except DocumentNotFoundException:
        # Never the newest `past` season instead: after the first activation no route leaves the
        # league without a running one (`docs/backend/spec.md :: I18`), and a ban counted from a
        # guessed season bars a person for the wrong five.
        return None


async def pull_saison_id_and_rules(
    saisons_collection: AsyncCollection,
    saison_id: str | None,
) -> tuple[str, FLSaisonRules]:
    """A season's id and its scoring rules, usually from the cache.

    `saison_id=None` means the current season; an explicit id naming none raises 404.
    """

    if saison_id is None:
        saison_raw = await pull_current_saison(saisons_collection=saisons_collection)
    else:
        cached = read_cached_saison(saison_id)
        if cached is not None:
            saison_raw = cached
        else:
            generation = saison_cache_generation()
            saison_raw = dict(await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}))
            store_cached_saison(saison_id, saison_raw, generation=generation)

    return str(saison_raw["_id"]), FLSaisonRules.model_validate(saison_raw["rules"])
