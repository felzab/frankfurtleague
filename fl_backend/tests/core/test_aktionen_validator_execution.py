import asyncio
from typing import Any, Awaitable, Callable, get_args

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorClientSession, AsyncIOMotorDatabase
from pymongo.errors import OperationFailure

from app.core.collections import Collection
from app.core.crud import delete_many_from_db, erase_many_from_db, patch_many_in_db, patch_one_in_db, post_many_to_db, post_one_to_db
from app.core.recording import Operation, build_redaction_filter, build_redaction_update
from tests.database import a_clean_database

pytestmark = pytest.mark.db

DATABASE_NAME = "fl_aktionen_validator_test"

# Asserted on rather than caught broadly, so an unrelated failure cannot pass as a rejection.
DOCUMENT_VALIDATION_FAILED = 121

TEAM_OID = ObjectId("6890a1b2c3d4e5f607600001")
# A second id, so a removal's images are the distinct documents a filter matched rather than one twice.
SECOND_TEAM_OID = ObjectId("6890a1b2c3d4e5f607600002")

SEEDED_NAME = "Lessing"
RENAMED = "Lessing-Gymnasium"
STADT = "Frankfurt am Main"

ACTOR = "admin@example.com"
RECORDED_AT = "2026-03-15T18:00:00+00:00"


def team_document() -> dict[str, Any]:
    """The `teams` validator is applied here too, so the collection whose writes are recorded has to be written legally."""

    return {
        "_id": TEAM_OID,
        "name": SEEDED_NAME,
        "shorthand": "LE",
        "description": "",
        "full_name": "Lessing-Gymnasium",
        "website_url": "https://lessing.example.de",
        "address": {"strasse": "Hanauer Landstraße", "hausnummer": "12a", "plz": "60314", "stadtteil": "Ostend", "stadt": STADT},
        "inactive_since": None,
    }


def bulk_team_document(shorthand: str) -> dict[str, Any]:
    """One member of a bulk create: no `_id`, which is what a generated document leaves to the driver."""

    return {key: value for key, value in team_document().items() if key != "_id"} | {"shorthand": shorthand}


def recorded_row(**overrides: Any) -> dict[str, Any]:
    """A row in the shape `app/core/recording.py :: record_write` builds, as the base each case below deviates from."""

    return {
        "at": RECORDED_AT,
        "actor": {"kind": "admin_session", "email": ACTOR},
        "correlation_id": "0123456789abcdef0123456789abcdef",
        "request": {"method": "PATCH", "path": "/api/v0/teams/{team_id}"},
        "collection": str(Collection.TEAMS),
        "operation": "patch_one",
        "document_id": TEAM_OID,
        "db_filter": None,
        "before": team_document(),
        "modified_count": None,
        "redacted_at": None,
        **overrides,
    }


Body = Callable[[AsyncIOMotorDatabase], Awaitable[Any]]


def on_a_database(container: Any, body: Body) -> Any:
    """One client and event loop per call: Motor binds to the loop it first runs on."""

    async def _run() -> Any:
        async with a_clean_database(container.get_connection_url(), DATABASE_NAME, constraints=True) as (_, database):
            return await body(database)

    return asyncio.run(_run())


ClientBody = Callable[[AsyncIOMotorDatabase, AsyncIOMotorClient], Awaitable[Any]]


def on_a_replica_set(url: str, body: ClientBody) -> Any:
    """`on_a_database` against a set: the client goes to the body too, a transaction needing a session only it can open.

    A standalone `mongod` refuses one, and the collections are made first because a transaction cannot create one.
    """

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            return await body(database, client)

    return asyncio.run(_run())


def insert_outcome(container: Any, row: dict[str, Any]) -> str:
    async def body(database: AsyncIOMotorDatabase) -> str:
        try:
            await database[Collection.AKTIONEN].insert_one(row)
        except OperationFailure as failure:
            assert failure.code == DOCUMENT_VALIDATION_FAILED, f"expected a validation failure, got {failure.code}: {failure}"
            return "rejected"
        return "accepted"

    return on_a_database(container, body)


def test_the_rows_every_real_write_builds_are_all_accepted(mongo_replica_set_url: str):
    """Row and `$jsonSchema` are hand-written from one shape, and a drift between them is a write refused in production and nowhere else."""

    async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> list[dict[str, Any]]:
        teams = database[Collection.TEAMS]

        async def write_one_of_every_operation(session: AsyncIOMotorClientSession) -> None:
            await post_one_to_db(collection=teams, document=team_document(), session=session)
            await patch_one_in_db(collection=teams, db_filter={"_id": TEAM_OID}, update={"$set": {"name": RENAMED}}, session=session)
            # A dotted key, which is what every reference fan-out matches on and what the row then stores.
            await patch_many_in_db(collection=teams, db_filter={"address.stadt": STADT}, update={"$set": {"description": "x"}}, session=session)
            # Ids left to the driver, and distinct shorthands so `uniq_shorthand` admits the pair.
            await post_many_to_db(collection=teams, documents=[bulk_team_document(code) for code in ("HE", "CS")], session=session)
            # The removals last, each taking one of the pair above: the writes before them still match
            # the documents their own counts are asserted on.
            await delete_many_from_db(collection=teams, db_filter={"shorthand": "HE"}, session=session)
            await erase_many_from_db(collection=teams, db_filter={"shorthand": "CS"}, session=session)

        # All six inside one, as a multi-write router runs it: the removals require a session, and a
        # retry is safe only because every write here carries it -- an abort takes back what a replay redoes.
        async with await client.start_session() as session:
            await session.with_transaction(write_one_of_every_operation)

        # Read after the commit -- what a later request sees, so nothing below is asserted on a row
        # the transaction was still holding.
        return [row async for row in database[Collection.AKTIONEN].find().sort("_id", 1)]

    rows = on_a_replica_set(mongo_replica_set_url, body)

    # Spelled in the body's order, so each helper answers for the operation it records, and checked
    # against the Literal, so a seventh member fails here rather than reaching a stored row that no
    # real write has ever built.
    assert [row["operation"] for row in rows] == ["insert", "patch_one", "patch_many", "insert_many", "delete_many", "erase_many"]
    assert {row["operation"] for row in rows} == set(get_args(Operation))

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
    assert [image["shorthand"] for image in rows[4]["before"]] == ["HE"]
    assert rows[4]["db_filter"] == {"shorthand": "HE"} and rows[4]["modified_count"] == 1
    # The removed ids beside the images, which is what lets an erasure's `(collection, document_id)`
    # filter select this row (`docs/backend/spec.md :: I42`).
    assert rows[4]["document_id"] == [image["_id"] for image in rows[4]["before"]]
    # The erasure's whole record: what it matched and how many it took, and none of what it erased.
    assert rows[5]["before"] is None
    assert rows[5]["db_filter"] == {"shorthand": "CS"} and rows[5]["modified_count"] == 1


def test_a_removals_row_is_selected_by_an_erasure_shaped_redaction(mongo_replica_set_url: str):
    """The erasure's own `(collection, document_id)` filter reaches it (`docs/backend/spec.md :: I42`).

    Selection both ways: naming one removed id empties that removal's image array and
    stamps the row, while the sibling removal's row keeps its image.
    """

    async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
        teams = database[Collection.TEAMS]

        async def remove_two_sets(session: AsyncIOMotorClientSession) -> None:
            await post_many_to_db(collection=teams, documents=[bulk_team_document(code) for code in ("HE", "CS")], session=session)
            # Two removals, so the redaction below has a row it must reach and one it must not.
            await delete_many_from_db(collection=teams, db_filter={"shorthand": "HE"}, session=session)
            await delete_many_from_db(collection=teams, db_filter={"shorthand": "CS"}, session=session)

        async with await client.start_session() as session:
            await session.with_transaction(remove_two_sets)

        target_row = await database[Collection.AKTIONEN].find_one({"db_filter.shorthand": "HE"})
        assert target_row is not None
        redacted = await patch_many_in_db(
            collection=database[Collection.AKTIONEN],
            db_filter=build_redaction_filter([(Collection.TEAMS, [target_row["document_id"][0]])]),
            update=build_redaction_update(at=RECORDED_AT),
        )

        return redacted.modified_count, [row async for row in database[Collection.AKTIONEN].find({"operation": "delete_many"}).sort("_id", 1)]

    modified, rows = on_a_replica_set(mongo_replica_set_url, body)

    assert modified == 1
    assert rows[0]["before"] is None and rows[0]["redacted_at"] == RECORDED_AT
    # The sibling removal's floor: a filter matching on `collection` alone would have swept it too.
    assert [image["shorthand"] for image in rows[1]["before"]] == ["CS"] and rows[1]["redacted_at"] is None


def test_the_base_row_every_rejection_below_deviates_from_is_accepted(mongo_container: Any):
    """A validator refusing everything enforces its rule perfectly and makes the log unwritable."""
    assert insert_outcome(mongo_container, recorded_row()) == "accepted"


@pytest.mark.parametrize(
    ("row", "why"),
    [
        # The log has no row of its own to record, so its name is not among the values `collection` takes.
        (recorded_row(collection=str(Collection.AKTIONEN)), "the log naming itself as the collection it recorded"),
        (recorded_row(collection="teamz"), "a collection this database does not hold"),
        (recorded_row(operation="delete"), "an operation outside the Literal"),
        (recorded_row(operation="update_many"), "the driver's spelling of an operation rather than this module's"),
        (recorded_row(operation="insert_one"), "the driver's spelling of the single create rather than this module's"),
        (recorded_row(actor={"kind": "admin", "email": ACTOR}), "an actor kind outside the Literal"),
        (recorded_row(actor={"email": ACTOR}), "an actor missing half its shape"),
        ({key: value for key, value in recorded_row().items() if key != "before"}, "a row carrying no `before` key at all"),
        (recorded_row(at=20260315), "a timestamp stored as a number"),
        (recorded_row(modified_count="40"), "a count stored as a string"),
        (recorded_row(request={"method": "PATCH"}), "a request missing the path half of the pair"),
    ],
    ids=lambda value: value if isinstance(value, str) else "",
)
def test_a_malformed_row_is_rejected(mongo_container: Any, row: dict[str, Any], why: str):
    assert insert_outcome(mongo_container, row) == "rejected", f"the validator let through {why}"


@pytest.mark.parametrize(
    ("row", "why"),
    [
        (recorded_row(collection=str(Collection.SAISONS), document_id="2026"), "a season, whose `_id` is the season string"),
        (
            recorded_row(operation="patch_many", document_id=None, db_filter={"address.stadt": STADT}, before=None, modified_count=40),
            "a fan-out",
        ),
        (recorded_row(actor={"kind": "system", "email": "SYSTEM"}, request=None, correlation_id="SYSTEM"), "a write made outside any request"),
        (recorded_row(redacted_at="2026-04-01", before=None), "a row whose values an erasure has already overwritten"),
        (
            recorded_row(operation="insert_many", document_id=None, db_filter=None, before=None, modified_count=75),
            "a bulk create, which carries its count and nothing else",
        ),
        (
            recorded_row(
                operation="delete_many",
                # The removed ids as an array, the shape `delete_many_from_db` records so a
                # redaction's `$in` can select the row (`docs/backend/spec.md :: I42`).
                document_id=[TEAM_OID, SECOND_TEAM_OID],
                db_filter={"inactive_since": "2024-01-01"},
                before=[team_document(), team_document() | {"_id": SECOND_TEAM_OID, "shorthand": "HE"}],
                modified_count=2,
            ),
            "a removal, whose images and removed ids are arrays rather than one document and one id",
        ),
        (
            recorded_row(operation="erase_many", document_id=None, db_filter={"_id": str(TEAM_OID)}, before=None, modified_count=1),
            "an erasure, which keeps its count and no image of what it took",
        ),
    ],
    ids=lambda value: value if isinstance(value, str) else "",
)
def test_every_shape_a_recorded_row_legitimately_takes_is_accepted(mongo_container: Any, row: dict[str, Any], why: str):
    """One validator covers every logged collection and every operation, so a shape it refuses is a write the application cannot record."""
    assert insert_outcome(mongo_container, row) == "accepted", f"the validator refused {why}"
