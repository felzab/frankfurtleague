"""
CORE · database access helpers

Every document write goes through one of these functions, which is what keeps session and
transaction handling in one place. A read they cannot express — a count, or a `find_one` that needs
the caller's session, which `pull_one_from_db` does not take — calls Motor in the handler instead.

Invariants:
- `patch_one_in_db` returns the document as it was before the update (`ReturnDocument.BEFORE`).
- The read helpers cap results at 1024 documents; a pipeline carries its own `$limit`.
- A read inside a transaction takes that transaction's session, or it sees the pre-write snapshot.

See:
- docs/backend/spec.md — invariant I2
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
        raise DocumentNotFoundException(filter=db_filter, error_code="DB-COMMON-001")

    return doc


async def pull_many_from_db(
    collection: AsyncIOMotorCollection,
    db_filter: Mapping[str, Any],
    limit: int = 1024,
    sort_by: Sequence[tuple[str, int]] | None = None,
    projection: Mapping[str, Any] | list[str] | None = None,
    session: AsyncIOMotorClientSession | None = None,
) -> list[Mapping[str, Any]]:

    cursor = collection.find(filter=db_filter, projection=projection or {}, session=session)

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
    """`length` is the driver-level safety cap on cursor iteration; sorting and limiting belong in the pipeline."""
    cursor = collection.aggregate(pipeline, session=session)

    return await cursor.to_list(length=length)
