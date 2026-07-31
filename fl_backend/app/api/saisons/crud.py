from motor.motor_asyncio import AsyncIOMotorCollection

from app.core.crud import pull_one_from_db

CURRENT_SAISON_FILTER = {"status": "active"}


async def pull_current_saison_id(saisons_collection: AsyncIOMotorCollection) -> str:
    """
    The id of the season marked `active`.

    Single source for "which season is current": `/saisons/current` and the `saison_id` default on
    `/spiele`, `/spieltage` and `/teams` all resolve it through here, so they can never disagree.

    Projects `_id` only — the caller wants an id, and the full document carries `rules` and both
    dates. Raises `DocumentNotFoundException` (404) when no season is active rather than degrading
    to an unfiltered query: with the default in place, "no current season" would otherwise return
    every season's data at once, which is the failure this default exists to prevent.
    """

    saison_raw = await pull_one_from_db(
        collection=saisons_collection,
        db_filter=CURRENT_SAISON_FILTER,
        projection={"_id": 1},
    )

    return str(saison_raw["_id"])
