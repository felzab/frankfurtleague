from typing import Any, Mapping, Sequence

from motor.motor_asyncio import AsyncIOMotorClientSession, AsyncIOMotorCollection
from pymongo import ReturnDocument
from pymongo.results import UpdateResult


async def pull_from_db(
    collection: AsyncIOMotorCollection,
    filter: Mapping[str, Any],
    projection: Mapping[str, Any] | list[str] | None = None,
    sort_by: Sequence[tuple[str, int]] | None = None,
    limit: int = 1024,
) -> list[Mapping[str, Any]]:

    cursor = collection.find(filter=filter, projection=projection or {})

    if sort_by is not None:
        cursor = cursor.sort(sort_by)

    return await cursor.limit(limit).to_list(length=limit)


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


async def patch_many_in_db(
    collection: AsyncIOMotorCollection,
    filter: Mapping[str, Any],
    update: Mapping[str, Any],
    session: AsyncIOMotorClientSession | None = None,
) -> UpdateResult:

    return await collection.update_many(filter=filter, update=update, session=session)


async def patch_one_in_db(
    collection: AsyncIOMotorCollection,
    filter: Mapping[str, Any],
    update: Mapping[str, Any],
    session: AsyncIOMotorClientSession | None = None,
    return_document: bool = ReturnDocument.BEFORE,
) -> Mapping[str, Any] | None:

    return await collection.find_one_and_update(filter=filter, update=update, session=session, return_document=return_document)
