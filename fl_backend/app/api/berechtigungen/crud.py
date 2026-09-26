"""
API · every read and write of the grants that reaches a collection

The anchor lives here beside the read it protects, so no caller can judge the list without writing
every row of it (`docs/backend/spec.md :: I53`).
"""

from collections.abc import Mapping, Sequence
from typing import Any

from pymongo import ASCENDING, DESCENDING
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.berechtigungen.schemas import FLVerwaltung
from app.core.collections import Collection
from app.core.crud import aggregate_many_from_db, patch_many_in_db, pull_many_from_db

# Which recorded operation made each kind of change, so the log row read for an addition is its insert
# and never the anchor's fan-out, which names no document at all.
_OPERATION_OF: Mapping[str, str] = {"erteilt": "insert", "entzogen": "delete_many", "geaendert": "patch_one"}


async def read_berechtigungen(
    *, berechtigungen_collection: AsyncCollection, session: AsyncClientSession | None = None
) -> list[Mapping[str, Any]]:
    """Every grant, by address, and unbounded: the floor and the recipients are both judged over the whole list."""

    return await aggregate_many_from_db(collection=berechtigungen_collection, pipeline=[{"$sort": {"adresse": ASCENDING}}], session=session)


async def pull_the_list_to_judge(
    *,
    berechtigungen_collection: AsyncCollection,
    # REQUIRED: the anchor is what closes the race, so forgetting the session has to be a TypeError
    # at the call rather than a silent reopening of it.
    session: AsyncClientSession,
) -> list[Mapping[str, Any]]:
    """Read every grant, then write each one, in the caller's transaction (`docs/backend/spec.md :: I438`).

    A snapshot re-validates no read: a rival judging the list writes the same rows, so whichever
    lands second meets a write conflict and retries.
    """

    grants = await read_berechtigungen(berechtigungen_collection=berechtigungen_collection, session=session)

    # Exactly the rows the read returned, each named: the rows judged are the rows a rival must meet.
    await patch_many_in_db(
        collection=berechtigungen_collection,
        db_filter={"_id": {"$in": [grant["_id"] for grant in grants]}},
        update={"$inc": {"bounded_writes": 1}},
        session=session,
    )

    return grants


async def verwaltung_of(*, berechtigungen_collection: AsyncCollection, adresse: str) -> FLVerwaltung | None:
    """The tier this folded address holds, or `None`: one equality `uniq_berechtigung_adresse` serves."""

    found = await pull_many_from_db(collection=berechtigungen_collection, db_filter={"adresse": adresse}, limit=1, projection=["verwaltung"])

    return found[0]["verwaltung"] if found else None


async def read_the_announced(*, berechtigungen_angekuendigt_collection: AsyncCollection) -> list[Mapping[str, Any]]:
    """Every announced row: the whole record is the other half of every comparison."""

    return await aggregate_many_from_db(collection=berechtigungen_angekuendigt_collection, pipeline=[{"$sort": {"_id": ASCENDING}}])


async def read_who_changed(
    *, aktionen_collection: AsyncCollection, changes: Sequence[tuple[Any, str]]
) -> dict[tuple[Any, str], Mapping[str, Any]]:
    """For each `(grant id, kind of change)`, the newest log row an administrator's write left for it.

    None means the change was made outside the application. A removal's row names its ids in an
    array, which `$in` matches by member.
    """

    if not changes:
        return {}

    rows = await aggregate_many_from_db(
        collection=aktionen_collection,
        pipeline=[
            {
                "$match": {
                    "collection": str(Collection.BERECHTIGUNGEN),
                    "document_id": {"$in": sorted({berechtigung_id for berechtigung_id, _ in changes})},
                    "operation": {"$in": sorted({_OPERATION_OF[art] for _, art in changes})},
                    # An administrator's alone: a SYSTEM row is the reconciliation's own, and a grant
                    # the paste made has none at all.
                    "actor.kind": "admin_session",
                }
            },
            {"$sort": {"at": DESCENDING, "_id": DESCENDING}},
            {"$project": {"document_id": 1, "operation": 1, "actor.email": 1, "at": 1}},
        ],
    )

    found: dict[tuple[Any, str], Mapping[str, Any]] = {}
    for berechtigung_id, art in changes:
        for row in rows:
            named = row["document_id"] if isinstance(row["document_id"], list) else [row["document_id"]]
            if row["operation"] == _OPERATION_OF[art] and berechtigung_id in named:
                found[(berechtigung_id, art)] = row
                break

    return found
