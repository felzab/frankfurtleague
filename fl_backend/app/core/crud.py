"""
Database access, the query one list read runs, and the conventions a write keeps.

One contract across the module, so no caller needs a `None` branch to reach a 404: a `*_one_*`
helper raises `DocumentNotFoundError` on a miss and never returns `None`, and a `*_many_*`
helper returns the empty result and never raises for absence.

A write reaches the driver in this module alone. No helper here records anything: an act records itself, one line inside
its own transaction.
"""

import re
from collections.abc import Mapping, Sequence
from datetime import datetime
from http import HTTPStatus
from typing import Any, Final

from pydantic import BaseModel, Field
from pymongo import ReturnDocument, UpdateOne
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import BulkWriteError, DuplicateKeyError
from pymongo.results import DeleteResult, InsertManyResult, InsertOneResult, UpdateResult

from app.core.codes import Code
from app.core.collections import EDITED_COLLECTIONS
from app.core.exceptions import APIError, DocumentNotFoundError, WriteRefusal
from app.core.readonly import ReadCollection
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT

# Keyword-only throughout, so no call site can bind `db_filter` to `update` by position, and
# `db_filter` is the one name a filter has here and at every caller.

# What orders a name: „Ö“ sits beside „O“ and a lower-case initial beside its capital, where Mongo's
# binary default puts each after „Z“. Per read rather than a default: a collated operation cannot
# use a simple-collation index on a string bound.
GERMAN_COLLATION: Mapping[str, Any] = {"locale": "de"}


async def pull_one_from_db(
    *,
    collection: ReadCollection,
    db_filter: Mapping[str, Any],
    projection: Mapping[str, Any] | list[str] | None = None,
    session: AsyncClientSession | None = None,
) -> Mapping[str, Any]:
    """`session` is what makes a read inside a transaction see that transaction's own writes."""

    doc = await collection.find_one(filter=db_filter, projection=projection or {}, session=session)
    if doc is None:
        raise DocumentNotFoundError()

    return doc


async def pull_many_from_db(
    *,
    collection: ReadCollection,
    db_filter: Mapping[str, Any],
    limit: int = LIST_LIMIT_DEFAULT,
    sort_by: Sequence[tuple[str, int]] | None = None,
    projection: Mapping[str, Any] | list[str] | None = None,
    collation: Mapping[str, Any] | None = None,
    session: AsyncClientSession | None = None,
) -> list[Mapping[str, Any]]:
    """`limit` is a real ceiling here -- `cursor.limit()` -- unlike `aggregate_many_from_db`'s, which caps iteration alone.

    `collation` governs the whole read, `sort_by` included: `GERMAN_COLLATION` is what a name list passes.
    """

    cursor = collection.find(filter=db_filter, projection=projection or {}, collation=collation, session=session)

    if sort_by is not None:
        cursor = cursor.sort(sort_by)

    return await cursor.limit(limit).to_list(length=limit)


async def pull_whole_from_db(
    *,
    collection: ReadCollection,
    db_filter: Mapping[str, Any],
    # What the read is, for the error alone: "season 2025's fixtures".
    what: str,
    sort_by: Sequence[tuple[str, int]] | None = None,
    projection: Mapping[str, Any] | list[str] | None = None,
    collation: Mapping[str, Any] | None = None,
    session: AsyncClientSession | None = None,
) -> list[Mapping[str, Any]]:
    """Every document `db_filter` matches, for a judgement that must see them all, or a `ValueError`.

    Read one over the cap, so a set past it is detected rather than judged on the page that fits: a dropped fixture or
    row would read as one that is not there, and a rule judged without it answers wrongly in silence.
    """

    documents = await pull_many_from_db(
        collection=collection,
        db_filter=db_filter,
        limit=LIST_LIMIT_DEFAULT + 1,
        sort_by=sort_by,
        projection=projection,
        collation=collation,
        session=session,
    )
    if len(documents) > LIST_LIMIT_DEFAULT:
        raise ValueError(f"{what} number more than {LIST_LIMIT_DEFAULT}, which is more than one read can judge whole")

    return documents


# Every document of an `EDITED_COLLECTIONS` member carries this count: 0 when created, and raised by every update
# through the two patch helpers below. A save passes the count its form was read at as `expected_version`, and matches
# only while the count stands there: MongoDB's documented pattern, "include the expected current value in the update
# filter" (the manual's write-operations atomicity page), Mongoose's `optimisticConcurrency`.
#
# The count is scoped by field, as that option is with `exclude`: it counts the writes to what a form shows and saves.
# A write to a field no form saves goes through `patch_past_the_version_in_db` and leaves the count standing, so it
# refuses no save of a form read before it.
VERSION_FIELD: Final = "version"


def composite_version(*documents: Mapping[str, Any]) -> int:
    """The one count an editor saving two documents reads and saves on: theirs added.

    Each only ever rises, so their sum stands exactly where none has moved, and a page holds one number for its one
    save.
    """

    return sum(int(document[VERSION_FIELD]) for document in documents)


def find_stale_save_refusal(*documents: Mapping[str, Any], version: int) -> WriteRefusal | None:
    """`version_stale`: one of the documents an editor saves together has moved since it read them."""

    if composite_version(*documents) == version:
        return None

    return WriteRefusal(error_code=Code.VERSION_STALE, status=HTTPStatus.CONFLICT)


def find_stale_first_save_refusal(saved: Mapping[str, Any] | None, *, version: int | None) -> WriteRefusal | None:
    """`version_stale` for the save of a document its form's first save creates.

    A null `version` says the form showed no document, and matches only absence: a first save committed since refuses
    it, as a number refuses once the document moved or went.
    """

    if (None if saved is None else int(saved[VERSION_FIELD])) == version:
        return None

    return WriteRefusal(error_code=Code.VERSION_STALE, status=HTTPStatus.CONFLICT)


def _versioned(collection: AsyncCollection, update: Mapping[str, Any]) -> Mapping[str, Any]:
    """`update` raising the version, on a collection whose documents count their writes."""

    if collection.name not in EDITED_COLLECTIONS:
        return update

    return {**update, "$inc": {**update.get("$inc", {}), VERSION_FIELD: 1}}


async def patch_one_in_db(
    *,
    collection: AsyncCollection,
    db_filter: Mapping[str, Any],
    update: Mapping[str, Any],
    expected_version: int | None,
    session: AsyncClientSession | None = None,
    return_document: bool,
) -> Mapping[str, Any]:
    """`expected_version` and `return_document` have no default, so a caller weighs whether it checks a version and which state it answers.

    `BEFORE` answers the state the write just replaced, `AFTER` the state it left, both from the one command. An
    `expected_version` is refused `version_stale` once another write has raised the count; `None` checks nothing.
    """

    if expected_version is not None:
        if collection.name not in EDITED_COLLECTIONS:
            raise ValueError(f"{collection.name} is in no EDITED_COLLECTIONS, so a write to it checks no {VERSION_FIELD}")
        db_filter = {**db_filter, VERSION_FIELD: expected_version}

    document = await collection.find_one_and_update(
        filter=db_filter, update=_versioned(collection, update), session=session, return_document=return_document
    )
    if document is None:
        # A removed document reads as a changed one, as no second read tells the two apart.
        raise DocumentNotFoundError() if expected_version is None else APIError(HTTPStatus.CONFLICT, Code.VERSION_STALE)

    return document


def _changed_by(db_filter: Mapping[str, Any], update: Mapping[str, Any]) -> Mapping[str, Any]:
    """`db_filter` narrowed to the documents `update` changes, where a `$set` of plain paths alone says which.

    Without it the version's own `$inc` would change every document matched, and a fan-out repeated
    would count and raise each again. Any other update keeps the filter it was given.
    """

    fields = update.get("$set")
    if set(update) != {"$set"} or not fields or any("$" in path for path in fields):
        return db_filter

    return {"$and": [db_filter, {"$or": [{path: {"$ne": value}} for path, value in fields.items()]}]}


async def patch_many_in_db(
    *,
    collection: AsyncCollection,
    db_filter: Mapping[str, Any],
    update: Mapping[str, Any],
    # The conditions `$[<identifier>]` paths in `update` select array elements by (the manual's
    # "$[<identifier>]" page). Such an update keeps the caller's filter unnarrowed, so that filter
    # has to match only the documents holding an element to change.
    array_filters: Sequence[Mapping[str, Any]] | None = None,
    session: AsyncClientSession | None = None,
) -> UpdateResult:
    """The driver's result, unwrapped: `modified_count` is reported on the wire, so nothing here may swallow it.

    On an edited collection a document the update would leave as it stands is not matched, so its version stays.
    """

    matched = _changed_by(db_filter, update) if collection.name in EDITED_COLLECTIONS else db_filter

    return await collection.update_many(filter=matched, update=_versioned(collection, update), array_filters=array_filters, session=session)


# The one field every anchor advances: one rather than one per rule, so a further rule decided on the
# same document takes it with no decision, and two writers contending on it is a retry.
ANCHOR_FIELD: Final = "bounded_writes"


class Anchored(BaseModel):
    """The stored field of every collection `anchor_in_db` writes, which that collection's record model inherits.

    Absent until the first anchor, and withheld from every answer: it changes nothing a reader sees.
    """

    anchors: int = Field(default=0, validation_alias=ANCHOR_FIELD, exclude=True)


async def is_held_elsewhere(
    *,
    collection: AsyncCollection,
    key: str,
    value: Any,
    # The document the write saves, whose own value is no other's; `None` for a create.
    own_id: Any,
    # Required: asked in the write's transaction, so a retry asks it again.
    session: AsyncClientSession,
) -> bool:
    """Whether another document holds `value` at `key`, a retired one included, as a unique index on it compares.

    So a create or a save is refused on the field a person typed before its write meets the index, which answers only
    a race between two writes, as `duplicate_key` with no field.
    """

    db_filter: dict[str, Any] = {key: value} if own_id is None else {key: value, "_id": {"$ne": own_id}}

    return await collection.find_one(db_filter, projection={"_id": 1}, session=session) is not None


async def patch_past_the_version_in_db(
    *,
    collection: AsyncCollection,
    db_filter: Mapping[str, Any],
    update: Mapping[str, Any],
    # Required: the write's own transaction, in which its caller read what it judged, so two such writes to one
    # document conflict and the later is judged again.
    session: AsyncClientSession,
) -> int:
    """Write fields no form saves onto the documents the filter names, each one's `version` left standing, and answer how many it matched.

    The one way past the count, for four kinds of write: an anchor, which changes nothing a reader sees; a link's
    hash, minted when its mail is handed out; a person's own press on their own block, a consent moved or a seat
    confirmed; and a job writing only bookkeeping no form saves, a reminder stamped or a chase closed or opened, so no
    administrator's save is refused over mail bookkeeping. A press names the state it moves in `db_filter`, or judges
    it on a read inside `session`, so a second press finds it moved: the count is not what holds a press.

    Never for a field a form saves: a save read before such a write would then put the old value back unrefused. A
    job or a fan-out changing what a form shows goes through `patch_one_in_db` or `patch_many_in_db`, which raise the
    count.
    """

    return (await collection.update_many(filter=db_filter, update=update, session=session)).matched_count


async def anchor_in_db(
    *,
    collection: AsyncCollection,
    db_filter: Mapping[str, Any],
    # Required: committed on its own, an anchor conflicts with nobody.
    session: AsyncClientSession,
) -> None:
    """Write the documents a judgement inside this transaction is scoped by, so a rival writing them conflicts.

    It changes nothing a reader sees, and the transaction's other writes are the action.
    """

    # `$inc`, never a `$set` of a constant, which rewrites nothing the second time and joins no write set.
    await patch_past_the_version_in_db(collection=collection, db_filter=db_filter, update={"$inc": {ANCHOR_FIELD: 1}}, session=session)


async def anchor_mailboxes_in_db(
    *,
    collection: AsyncCollection,
    ids: Sequence[str],
    at: datetime,
    # Required, as `anchor_in_db`'s is.
    session: AsyncClientSession,
) -> None:
    """`anchor_in_db` over documents nothing else creates: a press makes its own, and each lapses by the `at` last written."""

    if not ids:
        return

    # One command, so a press naming three mailboxes pays one round trip.
    await collection.bulk_write(
        [UpdateOne({"_id": anchor_id}, {"$inc": {ANCHOR_FIELD: 1}, "$set": {"anchored_at": at}}, upsert=True) for anchor_id in ids],
        session=session,
    )


async def post_one_to_db(
    *,
    collection: AsyncCollection,
    document: Mapping[str, Any],
    session: AsyncClientSession | None = None,
) -> InsertOneResult:
    """The driver's result, unwrapped: every create answers with `inserted_id` and `acknowledged`."""

    return await collection.insert_one(document=_created(collection, document), session=session)


async def post_many_to_db(
    *,
    collection: AsyncCollection,
    documents: Sequence[Mapping[str, Any]],
    session: AsyncClientSession | None = None,
) -> InsertManyResult:
    """The driver's result, unwrapped: `inserted_ids` is in input order, so a caller can pair an id back to what it sent."""

    try:
        return await collection.insert_many(documents=[_created(collection, document) for document in documents], session=session)
    except BulkWriteError as failure:
        # `insert_many` is ordered and not atomic: a refused document leaves every one before it written, which a
        # 409 would deny. Inside a transaction its abort takes them back.
        landed = int((failure.details or {}).get("nInserted", 0))
        stands = landed > 0 and not (session is not None and session.in_transaction)
        if not stands and (refusal := _duplicate_key_of(failure)) is not None:
            raise refusal from failure
        raise


def _created(collection: AsyncCollection, document: Mapping[str, Any]) -> Mapping[str, Any]:
    """`document` with its version at 0 where its collection is edited, so its first read serves one."""

    return {**document, VERSION_FIELD: 0} if collection.name in EDITED_COLLECTIONS else document


# The server's code for a unique index's refusal: the driver exports no name for it and compares the number itself.
DUPLICATE_KEY_ERROR = 11000


def _duplicate_key_of(failure: BulkWriteError) -> DuplicateKeyError | None:
    """So a batch answers 409 `duplicate_key` as one insert does, asked only where nothing the batch wrote stands.

    A refusal says nothing was written. A write-concern error beside the refusals keeps the batch's own
    failure, which says more.
    """

    report = failure.details or {}
    errors = report.get("writeErrors") or []
    if not errors or report.get("writeConcernErrors") or any(error.get("code") != DUPLICATE_KEY_ERROR for error in errors):
        return None

    # Built as the driver builds a single write's, so the handler finds the index name in `errmsg`
    # where it looks for one.
    first = errors[0]

    return DuplicateKeyError(first.get("errmsg", ""), DUPLICATE_KEY_ERROR, first)


async def delete_many_from_db(
    *,
    collection: AsyncCollection,
    db_filter: Mapping[str, Any],
    # Required: a removal is one half of what the caller does in its transaction.
    session: AsyncClientSession,
) -> DeleteResult:
    """The driver's result, unwrapped: a caller recording a pass's removal reads `deleted_count`."""

    return await collection.delete_many(filter=db_filter, session=session)


async def aggregate_many_from_db(
    *,
    collection: ReadCollection,
    pipeline: Sequence[Mapping[str, Any]],
    collation: Mapping[str, Any] | None = None,
    session: AsyncClientSession | None = None,
    limit: int | None = None,
) -> list[Mapping[str, Any]]:
    """`limit` caps cursor iteration only; sorting and limiting belong in the pipeline.

    Unbounded by default: a number here drops documents in silence, and the reads carrying no
    `$limit` of their own are those whose answer needs the whole collection.
    """

    cursor = await collection.aggregate(pipeline, collation=collation, session=session)

    return await cursor.to_list(length=limit)


def literal_pattern(value: str) -> str:
    """`value` as a `$regex` fragment matching exactly it.

    `re.escape` leaves a NUL raw, and the server refuses a pattern holding one: a 500 where the lookup
    owes an empty match.
    """

    return re.escape(value).replace("\x00", r"\x00")


def refuse(refusal: WriteRefusal | None) -> None:
    """One refusal, never varargs.

    Varargs would run every check even after one has refused, and several call sites document the
    order theirs are asked in.
    """

    if refusal is not None:
        raise refusal.error()


async def set_inactive_since(
    *,
    collection: AsyncCollection,
    db_filter: Mapping[str, Any],
    when: str | None,
    session: AsyncClientSession | None = None,
) -> Mapping[str, Any] | None:
    """Retire and revive in one helper: `inactive_since` is one nullable date, so they are one write in two directions.

    Answers the row it moved, and `None` where the row already stood so, for which a caller records nothing: a press
    that changes nothing is no act. A row that is not there is a 404 either way.

    `session` is carried, not dropped: a transactional caller would otherwise have the write land outside it.
    """

    # The write matches a row it would move alone: the stamp is the day the row left, so a second retire, from a second
    # open tab say, keeps that day and raises no version.
    try:
        return await patch_one_in_db(
            collection=collection,
            db_filter={**db_filter, "inactive_since": {"$ne": None} if when is None else None},
            update={"$set": {"inactive_since": when}},
            session=session,
            expected_version=None,
            return_document=ReturnDocument.AFTER,
        )
    except DocumentNotFoundError:
        await pull_one_from_db(collection=collection, db_filter=db_filter, projection=["_id"], session=session)
        return None


async def insert_live(
    *,
    collection: AsyncCollection,
    document: Mapping[str, Any],
    session: AsyncClientSession | None = None,
) -> InsertOneResult:
    """`inactive_since` is on no create payload, so a create states it here rather than in each router."""

    return await post_one_to_db(collection=collection, document={**document, "inactive_since": None}, session=session)
