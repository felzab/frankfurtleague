from pymongo.asynchronous.database import AsyncDatabase

from app.core.collections import Collection
from app.core.recording import FLAction


async def acts_of(database: AsyncDatabase) -> list[tuple[str, str, str | None, object]]:
    """Every row of the action log, oldest first, as what was done, who did it, for which team and to which record."""

    rows = database[Collection.ACTION_LOG].find().sort("_id", 1)

    return [(row["action"], row["by"], row["team"], row["record_id"]) async for row in rows]


async def deletions_of(database: AsyncDatabase, action: FLAction) -> list[tuple[str, str | None, int | None, object]]:
    """One pass's nameless rows, oldest first, as who ran it, the season, how many went and the record, which none names."""

    rows = database[Collection.ACTION_LOG].find({"action": action}).sort("_id", 1)

    return [(row["by"], row["label"], row["count"], row["record_id"]) async for row in rows]
