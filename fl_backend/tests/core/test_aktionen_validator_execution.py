import asyncio
from typing import Any, Awaitable, Callable

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo.errors import OperationFailure

from app.core.collections import Collection
from app.core.constraints import apply_constraints
from app.core.crud import patch_many_in_db, patch_one_in_db, post_many_to_db, post_one_to_db

pytestmark = pytest.mark.db

DATABASE_NAME = "fl_aktionen_validator_test"

# Asserted on rather than caught broadly, so an unrelated failure cannot pass as a rejection.
DOCUMENT_VALIDATION_FAILED = 121

TEAM_OID = ObjectId("6890a1b2c3d4e5f607600001")

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
        client = AsyncIOMotorClient(container.get_connection_url())
        try:
            await client.drop_database(DATABASE_NAME)
            database = client[DATABASE_NAME]
            await apply_constraints(database)
            return await body(database)
        finally:
            await client.drop_database(DATABASE_NAME)
            client.close()

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


def test_the_rows_four_real_writes_build_are_all_accepted(mongo_container: Any):
    """Row and `$jsonSchema` are hand-written from one shape, and a drift between them is a write refused in production and nowhere else."""

    async def body(database: AsyncIOMotorDatabase) -> list[dict[str, Any]]:
        teams = database[Collection.TEAMS]

        await post_one_to_db(collection=teams, document=team_document())
        await patch_one_in_db(collection=teams, db_filter={"_id": TEAM_OID}, update={"$set": {"name": RENAMED}})
        # A dotted key, which is what every reference fan-out matches on and what the row then stores.
        await patch_many_in_db(collection=teams, db_filter={"address.stadt": STADT}, update={"$set": {"description": "x"}})
        # Ids left to the driver, and distinct shorthands so `uniq_shorthand` admits the pair.
        await post_many_to_db(collection=teams, documents=[bulk_team_document(code) for code in ("HE", "CS")])

        return [row async for row in database[Collection.AKTIONEN].find().sort("_id", 1)]

    rows = on_a_database(mongo_container, body)

    assert [row["operation"] for row in rows] == ["insert", "patch_one", "patch_many", "insert_many"]
    assert rows[0]["document_id"] == TEAM_OID
    # The image the write replaced, which is the whole of what a restore would replay.
    assert rows[1]["before"]["name"] == SEEDED_NAME
    assert rows[2]["db_filter"] == {"address.stadt": STADT}
    assert rows[2]["modified_count"] == 1
    # The count and nothing else: the bulk create named no document and replaced none.
    assert rows[3]["modified_count"] == 2
    assert rows[3]["document_id"] is None and rows[3]["before"] is None and rows[3]["db_filter"] is None


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
    ],
    ids=lambda value: value if isinstance(value, str) else "",
)
def test_every_shape_a_recorded_row_legitimately_takes_is_accepted(mongo_container: Any, row: dict[str, Any], why: str):
    """One validator covers nine collections and four operations, and a shape it refuses is a write the application cannot record."""
    assert insert_outcome(mongo_container, row) == "accepted", f"the validator refused {why}"
