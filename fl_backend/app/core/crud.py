"""
CORE · database access, the query one list read runs, and the conventions a write keeps

One contract across the module, so no caller needs a `None` branch to reach a 404: a `*_one_*`
helper raises `DocumentNotFoundException` on a miss and never returns `None`, and a `*_many_*`
helper returns the empty result and never raises for absence.

Every write here also appends to the action log (`app/core/recording.py`). Recording at the one
chokepoint every write already passes through is what makes the log complete by construction; a
router that forgets to record cannot exist, because no WRITE reaches the driver outside this module.
Reads are a different matter -- several routers call `find`, `find_one` and `count_documents`
directly -- and a write shaped like one of those would escape the log.
"""

from typing import AbstractSet, Any, Mapping, Sequence

from motor.motor_asyncio import AsyncIOMotorClientSession, AsyncIOMotorCollection
from pydantic import BaseModel
from pymongo import ReturnDocument
from pymongo.errors import BulkWriteError
from pymongo.results import DeleteResult, InsertManyResult, InsertOneResult, UpdateResult

from app.core.exceptions import DOCUMENT_NOT_FOUND, DocumentConflictException, DocumentNotFoundException, WriteRefusal
from app.core.recording import record_write
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT

# Section 1, the driver. Keyword-only throughout, so no call site can bind `db_filter` to `update`
# by position, and `db_filter` is the one name a filter has here and at every caller.


async def pull_one_from_db(
    *,
    collection: AsyncIOMotorCollection,
    db_filter: Mapping[str, Any],
    projection: Mapping[str, Any] | list[str] | None = None,
    session: AsyncIOMotorClientSession | None = None,
) -> Mapping[str, Any]:
    """`session` is what makes a read inside a transaction see that transaction's own writes."""

    doc = await collection.find_one(filter=db_filter, projection=projection or {}, session=session)
    if doc is None:
        raise DocumentNotFoundException(filter=db_filter, error_code=DOCUMENT_NOT_FOUND)

    return doc


async def pull_many_from_db(
    *,
    collection: AsyncIOMotorCollection,
    db_filter: Mapping[str, Any],
    limit: int = LIST_LIMIT_DEFAULT,
    sort_by: Sequence[tuple[str, int]] | None = None,
    projection: Mapping[str, Any] | list[str] | None = None,
    session: AsyncIOMotorClientSession | None = None,
) -> list[Mapping[str, Any]]:
    """`limit` is a real ceiling here -- `cursor.limit()` -- unlike `aggregate_many_from_db`'s, which caps iteration alone."""

    cursor = collection.find(filter=db_filter, projection=projection or {}, session=session)

    if sort_by is not None:
        cursor = cursor.sort(sort_by)

    return await cursor.limit(limit).to_list(length=limit)


async def patch_one_in_db(
    *,
    collection: AsyncIOMotorCollection,
    db_filter: Mapping[str, Any],
    update: Mapping[str, Any],
    session: AsyncIOMotorClientSession | None = None,
    return_document: bool = ReturnDocument.AFTER,
) -> Mapping[str, Any]:
    """`AFTER` by default: a caller echoing the pre-image would answer with the state the write just replaced.

    The driver yields ONE image, and the log takes the atomic one (`docs/backend/spec.md :: I39`).
    """

    # The update itself carries the pre-image, so nothing can land between reading it and replacing
    # it. The echo is re-read after, where a racing write costs a stale response rather than a log
    # row naming a document this write never touched.
    before = await collection.find_one_and_update(filter=db_filter, update=update, session=session, return_document=ReturnDocument.BEFORE)
    if before is None:
        raise DocumentNotFoundException(filter=db_filter, error_code=DOCUMENT_NOT_FOUND)

    await record_write(
        collection=collection,
        operation="patch_one",
        document_id=before.get("_id"),
        before=before,
        session=session,
    )

    if return_document is ReturnDocument.BEFORE:
        return before

    after = await collection.find_one(filter={"_id": before["_id"]}, projection=None, session=session)
    if after is None:
        raise DocumentNotFoundException(filter=db_filter, error_code=DOCUMENT_NOT_FOUND)

    return after


async def patch_many_in_db(
    *,
    collection: AsyncIOMotorCollection,
    db_filter: Mapping[str, Any],
    update: Mapping[str, Any],
    session: AsyncIOMotorClientSession | None = None,
) -> UpdateResult:
    """The driver's result, unwrapped: `modified_count` is reported on the wire, so nothing here may swallow it.

    One log row with the filter and the count, never pre-images (`docs/backend/spec.md :: I40`).
    """

    result = await collection.update_many(filter=db_filter, update=update, session=session)

    await record_write(
        collection=collection,
        operation="patch_many",
        db_filter=db_filter,
        modified_count=result.modified_count,
        session=session,
    )

    return result


async def post_one_to_db(
    *,
    collection: AsyncIOMotorCollection,
    document: Mapping[str, Any],
    session: AsyncIOMotorClientSession | None = None,
) -> InsertOneResult:
    """The driver's result, unwrapped: every create answers with `inserted_id` and `acknowledged`."""

    result = await collection.insert_one(document=document, session=session)

    # No `before`: a create replaced nothing, and a null there is what tells the page this row offers
    # a deletion to undo rather than a restore.
    await record_write(collection=collection, operation="insert", document_id=result.inserted_id, session=session)

    return result


async def post_many_to_db(
    *,
    collection: AsyncIOMotorCollection,
    documents: Sequence[Mapping[str, Any]],
    session: AsyncIOMotorClientSession | None = None,
) -> InsertManyResult:
    """The driver's result, unwrapped: `inserted_ids` is in input order, so a caller can pair an id back to what it sent.

    One log row carrying the count, never one per document: a generated season is a single action,
    and a row per document would bury it.
    """

    try:
        result = await collection.insert_many(documents=documents, session=session)
    except BulkWriteError as failure:
        # `insert_many` is ORDERED and not atomic: a duplicate key partway through leaves everything
        # before it written, unlogged unless recorded here. Not under a session, where the abort takes
        # them back and a second write would mask this error with its own.
        landed = int((failure.details or {}).get("nInserted", 0))
        if session is None and landed:
            await record_write(collection=collection, operation="insert_many", modified_count=landed)
        raise

    # Neither an id nor a `before`: the call named no single document, and a create replaced nothing.
    # The count goes where a fan-out puts its own, so one field answers "how many did this touch".
    await record_write(collection=collection, operation="insert_many", modified_count=len(result.inserted_ids), session=session)

    return result


async def delete_many_from_db(
    *,
    collection: AsyncIOMotorCollection,
    db_filter: Mapping[str, Any],
    session: AsyncIOMotorClientSession,
) -> DeleteResult:
    """Remove a set and keep every image, in one log row (`docs/backend/spec.md :: I48`).

    Read first and unbounded: a cap would log fewer documents than the delete took, and the
    shortfall would read as a smaller action rather than a lost record.
    """

    # `session` carries no default, unlike the helpers above: the read and the delete are two
    # statements, so outside a transaction they see different sets and the images would then name a
    # document this call never removed.
    before = await collection.find(filter=db_filter, session=session).to_list(length=None)

    result = await collection.delete_many(filter=db_filter, session=session)

    if result.deleted_count != len(before):
        # Unreachable under snapshot isolation, which is what makes the pair safe. Kept because the
        # cost of it being wrong is a log row nobody can trust, and the count is free to compare.
        raise RuntimeError(f"{collection.name}: removed {result.deleted_count} documents against {len(before)} images")

    await record_write(
        collection=collection,
        operation="delete_many",
        # The removed ids, so a person's erasure can select this row: its `(collection,
        # document_id)` filter matches an array field on its members (`docs/backend/spec.md :: I42`).
        document_id=[document["_id"] for document in before],
        db_filter=db_filter,
        before=before,
        modified_count=result.deleted_count,
        session=session,
    )

    return result


async def erase_many_from_db(
    *,
    collection: AsyncIOMotorCollection,
    db_filter: Mapping[str, Any],
    session: AsyncIOMotorClientSession,
) -> DeleteResult:
    """Remove a set and keep NO image, the values themselves being what an erasure destroys.

    Filter on IDS alone: the log stores a filter's values as text, so one naming a person would
    preserve what this call destroys (`docs/backend/spec.md :: I48`).
    """

    # `session` carries no default here for its own reason: an erasure is one transaction over the
    # person, their squad rows and the log, and any one of the three alone leaves it defeated.
    result = await collection.delete_many(filter=db_filter, session=session)

    await record_write(
        collection=collection,
        operation="erase_many",
        db_filter=db_filter,
        modified_count=result.deleted_count,
        session=session,
    )

    return result


async def aggregate_many_from_db(
    *,
    collection: AsyncIOMotorCollection,
    pipeline: Sequence[Mapping[str, Any]],
    session: AsyncIOMotorClientSession | None = None,
    limit: int | None = None,
) -> list[Mapping[str, Any]]:
    """`limit` caps cursor iteration only; sorting and limiting belong in the pipeline.

    Unbounded by default: a number here drops documents in silence, and the reads carrying no
    `$limit` of their own are those whose answer needs the whole collection.
    """

    cursor = collection.aggregate(pipeline, session=session)

    return await cursor.to_list(length=limit)


# Section 2, the query behind a list read. One builder for every resource, because a term each
# resource translated for itself is a term one of them translates differently.


def build_query(
    filters: BaseModel,
    *,
    terms: AbstractSet[str],
    include_inactive: bool | None = None,
    compiled: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """`keep_oid` is unconditional: an ObjectId term dumped to its string matches no document, and matching nothing looks empty, not wrong."""

    query: dict[str, Any] = filters.model_dump(include=set(terms), exclude_none=True, context={"keep_oid": True})

    # Translated, never dumped: its False means "add a term", so a dump by value would write the
    # switch itself into the query as a field to match on.
    if include_inactive is False:
        query["inactive_since"] = None

    # Last, so a term needing translation -- a phase widened to `$ne`, a boolean read as a record
    # check -- replaces the raw value the dump wrote for it.
    if compiled:
        query.update(compiled)

    return query


def build_sort(*, sort_by: str, order: str, chain: Sequence[tuple[str, int]] = ()) -> list[tuple[str, int]]:
    """The requested key, then the tie-break chain, each entry in the direction it names.

    A chain entry equal to `sort_by` is skipped: pymongo builds a dict from this list, so a
    repeated key would overwrite the requested direction.
    """

    direction = 1 if order == "asc" else -1

    return [(sort_by, direction), *((field, tie_direction) for field, tie_direction in chain if field != sort_by)]


# Section 3, what a write does beyond the driver call: a refusal becomes the 409 it means, and a
# retirement is a date on `inactive_since` rather than a state of its own (`docs/backend/spec.md :: I12`).


def refuse(refusal: WriteRefusal | None) -> None:
    """One refusal, never varargs.

    Varargs would run every check even after one has refused, and several call sites document the
    order theirs are asked in.
    """

    if refusal is not None:
        raise DocumentConflictException.from_refusal(refusal)


async def set_inactive_since(
    *,
    collection: AsyncIOMotorCollection,
    db_filter: Mapping[str, Any],
    when: str | None,
    session: AsyncIOMotorClientSession | None = None,
) -> Mapping[str, Any]:
    """Retire and revive in one helper: `inactive_since` is one nullable date, so they are one write in two directions.

    `session` is carried, not dropped: a transactional caller would otherwise have the write and its
    log row land outside the transaction.
    """

    return await patch_one_in_db(collection=collection, db_filter=db_filter, update={"$set": {"inactive_since": when}}, session=session)


async def insert_live(
    *,
    collection: AsyncIOMotorCollection,
    document: Mapping[str, Any],
    session: AsyncIOMotorClientSession | None = None,
) -> InsertOneResult:
    """`inactive_since` is on no create payload, so a create states it here rather than in each router."""

    return await post_one_to_db(collection=collection, document={**document, "inactive_since": None}, session=session)
