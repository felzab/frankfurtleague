from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any, get_args

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.database import AsyncDatabase

from app.api.aktionen.schemas import FLAktionRecord
from app.core.collections import Collection
from app.core.crud import delete_many_from_db, erase_many_from_db, patch_many_in_db, patch_one_in_db, post_many_to_db, post_one_to_db
from app.core.recording import Operation, build_redaction_filter, build_redaction_update, log_stamp
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_aktionen_rows_test")


TEAM_OID = ObjectId("6890a1b2c3d4e5f607600001")

SEEDED_NAME = "Lessing"
RENAMED = "Lessing-Gymnasium"
STADT = "Frankfurt am Main"

RECORDED_AT = "2026-03-15T18:00:00+00:00"


def team_document() -> dict[str, Any]:
    return documents.team_document(TEAM_OID, SEEDED_NAME, "LEX", full_name="Lessing-Gymnasium", address={**documents.ADDRESS, "stadt": STADT})


def bulk_team_document(shorthand: str) -> dict[str, Any]:
    """One member of a bulk create: no `_id`, which is what a generated document leaves to the driver."""

    return {key: value for key, value in team_document().items() if key != "_id"} | {"shorthand": shorthand}


ClientBody = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_replica_set(url: str, body: ClientBody) -> Any:
    """The client goes to the body too, a transaction needing a session only it can open; a standalone `mongod` refuses one."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            return await body(database, client)

    return on_the_seed_loop(_run())


def test_the_rows_every_real_write_builds_are_the_stored_shape(mongo_replica_set_url: str):
    """Row and record model are hand-written from one shape, and a drift between them is a log page that cannot read its rows."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[dict[str, Any]]:
        teams = database[Collection.TEAMS]

        async def write_one_of_every_operation(session: AsyncClientSession) -> None:
            await post_one_to_db(collection=teams, document=team_document(), session=session)
            await patch_one_in_db(
                collection=teams,
                db_filter={"_id": TEAM_OID},
                update={"$set": {"name": RENAMED}},
                session=session,
                return_document=ReturnDocument.BEFORE,
            )
            # A dotted key, which is what every reference fan-out matches on and what the row then stores.
            await patch_many_in_db(collection=teams, db_filter={"address.stadt": STADT}, update={"$set": {"description": "x"}}, session=session)
            # Ids left to the driver, and distinct shorthands so `uniq_shorthand` admits the pair.
            await post_many_to_db(collection=teams, documents=[bulk_team_document(code) for code in ("HEX", "CSX")], session=session)
            # The removals last, each taking one of the pair above: the writes before them still match
            # the documents their own counts are asserted on.
            await delete_many_from_db(collection=teams, db_filter={"shorthand": "HEX"}, session=session)
            await erase_many_from_db(collection=teams, db_filter={"shorthand": "CSX"}, session=session)

        # All six inside one, as a multi-write router runs it: the removals require a session, and a
        # retry is safe only because every write here carries it -- an abort takes back what a replay redoes.
        async with client.start_session() as session:
            await session.with_transaction(write_one_of_every_operation)

        # Read after the commit -- what a later request sees, so nothing below is asserted on a row
        # the transaction was still holding.
        return [row async for row in database[Collection.ACTION_LOG].find().sort("_id", 1)]

    rows = on_a_replica_set(mongo_replica_set_url, body)

    # Spelled in the body's order, so each helper answers for the operation it records, and checked
    # against the Literal, so a seventh member fails here rather than reaching a stored row that no
    # real write has ever built.
    assert [row["operation"] for row in rows] == ["insert", "patch_one", "patch_many", "insert_many", "delete_many", "erase_many"]
    assert {row["operation"] for row in rows} == set(get_args(Operation))
    for row in rows:
        FLAktionRecord.model_validate(row, extra="forbid")

    # Typed rather than merely present: a TTL index over a string builds and then expires nothing.
    # The driver reads a BSON date back naive, so UTC is attached for the comparison against `at`.
    assert all(isinstance(row["at_date"], datetime) for row in rows)
    assert [log_stamp(row["at_date"].replace(tzinfo=UTC)) for row in rows] == [row["at"] for row in rows]

    assert rows[0]["document_id"] == TEAM_OID
    # The image the write replaced, which is the whole of what a restore would replay.
    assert rows[1]["before"]["name"] == SEEDED_NAME
    assert rows[2]["db_filter"] == {"address.stadt": STADT}
    assert rows[2]["modified_count"] == 1
    # The count and nothing else: the bulk create named no document and replaced none.
    assert rows[3]["modified_count"] == 2
    assert rows[3]["document_id"] is None and rows[3]["before"] is None and rows[3]["db_filter"] is None
    # An array from one removal of one document: what makes it a list is the call taking a set, never
    # how many the set held.
    assert [image["shorthand"] for image in rows[4]["before"]] == ["HEX"]
    assert rows[4]["db_filter"] == {"shorthand": "HEX"} and rows[4]["modified_count"] == 1
    # The removed ids beside the images, which is what lets an erasure's `(collection, document_id)`
    # filter select this row.
    assert rows[4]["document_id"] == [image["_id"] for image in rows[4]["before"]]
    # The erasure's whole record: what it matched and how many it took, and none of what it erased.
    assert rows[5]["before"] is None
    assert rows[5]["db_filter"] == {"shorthand": "CSX"} and rows[5]["modified_count"] == 1


def test_a_removals_row_is_selected_by_an_erasure_shaped_redaction(mongo_replica_set_url: str):
    """The erasure's own `(collection, document_id)` filter reaches it.

    Selection both ways: naming one removed id empties that removal's image array and
    stamps the row, while the sibling removal's row keeps its image.
    """

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        teams = database[Collection.TEAMS]

        async def remove_two_sets(session: AsyncClientSession) -> None:
            await post_many_to_db(collection=teams, documents=[bulk_team_document(code) for code in ("HEX", "CSX")], session=session)
            # Two removals, so the redaction below has a row it must reach and one it must not.
            await delete_many_from_db(collection=teams, db_filter={"shorthand": "HEX"}, session=session)
            await delete_many_from_db(collection=teams, db_filter={"shorthand": "CSX"}, session=session)

        async with client.start_session() as session:
            await session.with_transaction(remove_two_sets)

        target_row = await database[Collection.ACTION_LOG].find_one({"db_filter.shorthand": "HEX"})
        assert target_row is not None
        redacted = await patch_many_in_db(
            collection=database[Collection.ACTION_LOG],
            db_filter=build_redaction_filter([(Collection.TEAMS, [target_row["document_id"][0]])]),
            update=build_redaction_update(at=RECORDED_AT),
        )

        return redacted.modified_count, [row async for row in database[Collection.ACTION_LOG].find({"operation": "delete_many"}).sort("_id", 1)]

    modified, rows = on_a_replica_set(mongo_replica_set_url, body)

    assert modified == 1
    assert rows[0]["before"] is None and rows[0]["redacted_at"] == RECORDED_AT
    # The sibling removal's floor: a filter matching on `collection` alone would have swept it too.
    assert [image["shorthand"] for image in rows[1]["before"]] == ["CSX"] and rows[1]["redacted_at"] is None
