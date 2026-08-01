"""
CORE · database access helpers

Every raw MongoDB call in the application goes through one of these six functions. Nothing else calls
Motor directly, which is what keeps session and transaction handling in one place.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • `patch_one_in_db` returns the document as it was BEFORE the update (ReturnDocument.BEFORE). The
    Spiel write path derives its statistics deltas from that. Changing the default silently corrupts
    every team's table -- no error is raised.
  • The two read helpers cap results at 1024 documents. `aggregate_many_from_db` caps the cursor only;
    a pipeline should carry its own `$limit`.

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/backend/spec.md -- invariant I2
"""

from typing import Any, Mapping, Sequence

from motor.motor_asyncio import AsyncIOMotorClientSession, AsyncIOMotorCollection
from pymongo import ReturnDocument
from pymongo.results import InsertOneResult, UpdateResult

from app.core.exceptions import DocumentNotFoundException


async def pull_one_from_db(
    collection: AsyncIOMotorCollection,
    db_filter: Mapping[str, Any],
    projection: Mapping[str, Any] | list[str] | None = None,
) -> Mapping[str, Any]:

    doc = await collection.find_one(filter=db_filter, projection=projection or {})
    if doc is None:
        raise DocumentNotFoundException(filter=db_filter, error_code="DB-COMMON-1")

    return doc


async def pull_many_from_db(
    collection: AsyncIOMotorCollection,
    db_filter: Mapping[str, Any],
    limit: int = 1024,
    sort_by: Sequence[tuple[str, int]] | None = None,
    projection: Mapping[str, Any] | list[str] | None = None,
) -> list[Mapping[str, Any]]:

    cursor = collection.find(filter=db_filter, projection=projection or {})

    if sort_by is not None:
        cursor = cursor.sort(sort_by)

    return await cursor.limit(limit).to_list(length=limit)


async def patch_one_in_db(
    collection: AsyncIOMotorCollection,
    filter: Mapping[str, Any],
    update: Mapping[str, Any],
    session: AsyncIOMotorClientSession | None = None,
    return_document: bool = ReturnDocument.BEFORE,
) -> Mapping[str, Any] | None:

    return await collection.find_one_and_update(filter=filter, update=update, session=session, return_document=return_document)


async def patch_many_in_db(
    collection: AsyncIOMotorCollection,
    filter: Mapping[str, Any],
    update: Mapping[str, Any],
    session: AsyncIOMotorClientSession | None = None,
) -> UpdateResult:

    return await collection.update_many(filter=filter, update=update, session=session)


async def post_one_to_db(
    collection: AsyncIOMotorCollection,
    document: Mapping[str, Any],
    session: AsyncIOMotorClientSession | None = None,
) -> InsertOneResult:
    return await collection.insert_one(document=document, session=session)


async def aggregate_many_from_db(
    collection: AsyncIOMotorCollection,
    pipeline: Sequence[Mapping[str, Any]],
    session: AsyncIOMotorClientSession | None = None,
    length: int = 1024,
) -> list[Mapping[str, Any]]:
    """
    Executes a MongoDB aggregation pipeline to retrieve multiple documents.

    Note: Sorting and limiting should generally be handled as `$sort` and `$limit`
    stages within the pipeline itself. The `length` parameter serves as a safety
    cap for the Motor cursor iteration.
    """
    cursor = collection.aggregate(pipeline, session=session)

    # Passing length=None instructs Motor to fetch all documents yielded by the pipeline.
    # If your pipeline lacks a $limit stage, you can enforce a driver-level cap here.
    return await cursor.to_list(length=length)
