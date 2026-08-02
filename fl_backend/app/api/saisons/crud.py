"""
SAISONS · current-season resolution

The single definition of "which season is current". `/saisons/current` and the `saison_id` default on
`/spiele`, `/spieltage` and `/teams` all route through here, so four endpoints cannot answer the
question differently.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • Exactly one season is assumed to carry `status: "active"`. Nothing in the schema or an index
    enforces it -- see the note on `pull_current_saison`.
  • A missing active season RAISES rather than degrading to an unfiltered query. With the season
    default in place, "no current season" would otherwise silently mean "every season at once".
  • `rules` is live, not decorative: `/teams` scores its derived table with it (ADR-0026), so a
    season's win and draw points reach the league table and a change to them is a behaviour change.
"""

from typing import Any, Mapping

from motor.motor_asyncio import AsyncIOMotorCollection

from app.api.saisons.schemas import FLSaisonRules
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


async def pull_saison_id_and_rules(
    saisons_collection: AsyncIOMotorCollection,
    saison_id: str | None,
) -> tuple[str, FLSaisonRules]:
    """
    A season's id and its scoring rules, in one query.

    `saison_id=None` means the current season (ADR-0002), so this resolves the default too — `/teams`
    needs both halves and would otherwise read the collection twice for one answer.

    An explicit id naming no season now raises `DocumentNotFoundException` (404). That is a change in
    kind, not degree: while the table was stored, an unknown season produced an empty list instead,
    because the strict junction join simply matched nothing.
    """

    projection = {"rules": 1}

    if saison_id is None:
        saison_raw = await pull_current_saison(saisons_collection=saisons_collection, projection=projection)
    else:
        saison_raw = await pull_one_from_db(collection=saisons_collection, db_filter={"_id": saison_id}, projection=projection)

    return str(saison_raw["_id"]), FLSaisonRules.model_validate(saison_raw["rules"])
