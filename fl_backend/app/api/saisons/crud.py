"""
SAISONS · current-season resolution

Where "which season is current" is decided, once — stated in full at
`pull_current_saison`, which every endpoint defaulting an omitted `saison_id` routes through.

Invariants:
- A missing active season raises — degrading to an unfiltered query would mean "every season".
- `rules` is live: `/teams` scores its derived table with it (ADR-0019), so an edit is behaviour.
- Misses fetch the full document, never a projection — the cache stores one shape (ADR-0056).
"""

from typing import Any, Mapping

from motor.motor_asyncio import AsyncIOMotorCollection

from app.api.saisons.cache import CURRENT_SAISON_CACHE_KEY, read_cached_saison, store_cached_saison
from app.api.saisons.schemas import FLSaisonRules
from app.core.crud import pull_one_from_db

CURRENT_SAISON_FILTER = {"status": "active"}


async def pull_current_saison(saisons_collection: AsyncIOMotorCollection) -> Mapping[str, Any]:
    """
    The season marked `active`, from the cache when it holds one (ADR-0056).

    The single definition of "which season is current". `/saisons/current`, and every endpoint that
    defaults an omitted `saison_id` (ADR-0002), goes through this function, so none of them can answer
    the question differently.

    Raises `DocumentNotFoundException` (404) when no season is active rather than degrading to an
    unfiltered query: with the default in place, "no current season" would otherwise mean "every
    season's data at once", which is the failure the default exists to prevent. That miss is never
    cached — every retry asks the database again.

    **Assumes exactly one active season.** Nothing in the schema or an index enforces that today, and
    `find_one` takes whichever document Mongo returns first — so with two, this is arbitrary but at
    least consistently arbitrary across every caller, which is the point of routing them here.
    """

    cached = read_cached_saison(CURRENT_SAISON_CACHE_KEY)
    if cached is not None:
        return cached

    saison_raw = dict(await pull_one_from_db(collection=saisons_collection, db_filter=CURRENT_SAISON_FILTER))

    # Under its own id too: the current season answers by-id reads exactly as well, and `/teams`
    # naming the running season explicitly is the common shape of that read.
    store_cached_saison(CURRENT_SAISON_CACHE_KEY, saison_raw)
    store_cached_saison(str(saison_raw["_id"]), saison_raw)

    return saison_raw


async def pull_current_saison_id(saisons_collection: AsyncIOMotorCollection) -> str:
    """The current season's id. The cached document already holds it, so this projects nothing."""

    saison_raw = await pull_current_saison(saisons_collection=saisons_collection)

    return str(saison_raw["_id"])


async def pull_saison_id_and_rules(
    saisons_collection: AsyncIOMotorCollection,
    saison_id: str | None,
) -> tuple[str, FLSaisonRules]:
    """
    A season's id and its scoring rules, in one read — and usually in none, from the cache.

    `saison_id=None` means the current season (ADR-0002), so this resolves the default too — `/teams`
    needs both halves and would otherwise read the collection twice for one answer.

    An explicit id naming no season raises `DocumentNotFoundException` (404) rather than answering with
    an empty list -- an unknown season is a wrong request, not a season with nothing in it.
    """

    if saison_id is None:
        saison_raw = await pull_current_saison(saisons_collection=saisons_collection)
    else:
        cached = read_cached_saison(saison_id)
        if cached is not None:
            saison_raw = cached
        else:
            saison_raw = dict(await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}))
            store_cached_saison(saison_id, saison_raw)

    return str(saison_raw["_id"]), FLSaisonRules.model_validate(saison_raw["rules"])
