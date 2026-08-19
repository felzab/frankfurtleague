from typing import Any, Mapping, Sequence

from motor.motor_asyncio import AsyncIOMotorClientSession, AsyncIOMotorCollection
from pymongo import ReturnDocument
from pymongo.results import InsertOneResult, UpdateResult

from app.core.exceptions import DOCUMENT_NOT_FOUND, DocumentNotFoundException


async def pull_one_from_db(
    collection: AsyncIOMotorCollection,
    db_filter: Mapping[str, Any],
    projection: Mapping[str, Any] | list[str] | None = None,
) -> Mapping[str, Any]:

    doc = await collection.find_one(filter=db_filter, projection=projection or {})
    if doc is None:
        raise DocumentNotFoundException(filter=db_filter, error_code=DOCUMENT_NOT_FOUND)

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
    """Returns the PRE-write document by default (`docs/backend/spec.md :: I2`), or `None` on a miss."""

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
