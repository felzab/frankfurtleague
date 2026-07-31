from typing import Any, Mapping

from motor.motor_asyncio import AsyncIOMotorCollection

from app.core.crud import pull_one_from_db

CURRENT_SAISON_FILTER = {"status": "active"}


async def pull_current_saison(
    saisons_collection: AsyncIOMotorCollection,
    projection: Mapping[str, Any] | None = None,
) -> Mapping[str, Any]:
    """
    The season marked `active`.

    The single definition of "which season is current". `/saisons/current` and the `saison_id` default
    on `/spiele`, `/spieltage` and `/teams` all go through this function, so they cannot answer the
    question differently.

    Raises `DocumentNotFoundException` (404) when no season is active rather than degrading to an
    unfiltered query: with the default in place, "no current season" would otherwise mean "every
    season's data at once", which is the failure the default exists to prevent.

    **Assumes exactly one active season.** Nothing in the schema or an index enforces that today, and
    `find_one` takes whichever document Mongo returns first — so with two, this is arbitrary but at
    least consistently arbitrary across all four endpoints, which is the point of routing them here.
    """

    return await pull_one_from_db(
        collection=saisons_collection,
        db_filter=CURRENT_SAISON_FILTER,
        projection=projection,
    )


async def pull_current_saison_id(saisons_collection: AsyncIOMotorCollection) -> str:
    """The current season's id. Projects `_id` only — callers filtering by season want nothing else."""

    saison_raw = await pull_current_saison(saisons_collection=saisons_collection, projection={"_id": 1})

    return str(saison_raw["_id"])
