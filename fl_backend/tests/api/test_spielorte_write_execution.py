from collections.abc import Awaitable, Callable, Mapping
from typing import Any

import pytest
from bson import ObjectId
from httpx2 import Response
from pymongo.asynchronous.database import AsyncDatabase

from app.core.codes import Code
from app.core.collections import Collection
from app.core.config import API_VERSION
from tests.app_client import app_client, app_under_test
from tests.config import ADMIN_KEY, grants_for_the_suite
from tests.database import a_clean_database
from tests.session_headers import StampedHeaders
from tests.worker import worker_database

# Module level, as `tests/api/test_bewerbung_triage_execution.py` marks its suite: every case below
# reaches a real mongod.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_spielorte_write_test")

SPIELORTE = f"/api/v{API_VERSION}/spielorte"

# The write router binds an actor and refuses a write carrying none.
ACTOR = "spielorte.admin@example.com"

# Fixed rather than generated, so a failure names the same row every run.
RETIRED_OID = ObjectId("6890a1b2c3d4e5f607450002")

RETIRED_NAME = "Sportplatz Süd"

RETIRED_SINCE = "2026-03-01"

ADDRESS = {
    "street": "Hanauer Landstraße",
    "house_number": "12a",
    "postcode": "60314",
    "district": "Ostend",
    "city": "Frankfurt am Main",
}

# `ADDRESS` as a `maps_query` spells it.
ADDRESS_LINE = "Hanauer Landstraße 12a, 60314 Ostend Frankfurt am Main"

NEW_NAME = "Halle Nord"


def venue_document() -> dict[str, Any]:
    """Every key `FLSpielort` requires, so the seed is a shape the venue reads serve."""

    return {
        "_id": RETIRED_OID,
        "name": RETIRED_NAME,
        "address": dict(ADDRESS),
        "maps_query": f"{RETIRED_NAME}, Hanauer Landstraße 12a, 60314 Ostend Frankfurt am Main, Deutschland",
        "default_mietpreis": 80,
        "inactive_since": RETIRED_SINCE,
        # As the create stamps it.
        "version": 0,
    }


async def retire(url: str) -> Response:
    """The retire as a REAL request, exception handlers included."""

    async with app_client(url, app=app_under_test(DATABASE_NAME)) as http:
        return await http.delete(f"{SPIELORTE}/{RETIRED_OID}", headers=StampedHeaders(ACTOR, ADMIN_KEY))


async def on_a_league[T](url: str, body: Callable[[AsyncDatabase], Awaitable[T]]) -> T:
    """`body` over one retired venue, on the shipped indexes, inside the clean database, so its checks judge what the writes stored.

    The transactional server, because the retire judges and stamps inside a transaction.
    """

    async with a_clean_database(url, DATABASE_NAME) as (_, database):
        await database[Collection.GRANTS].insert_many(grants_for_the_suite())
        await database[Collection.SPIELORTE].insert_one(venue_document())

        return await body(database)


class TestASecondRetireKeepsTheDayTheVenueLeft:
    """`inactive_since` is the day the record left, so a retire repeated from a second open tab moves nothing."""

    async def test_the_stamp_stays_and_the_retire_answers_success(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> tuple[Response, Mapping[str, Any] | None]:
            response = await retire(mongo_replica_set_url)

            return response, await database[Collection.SPIELORTE].find_one({"_id": RETIRED_OID}, {"inactive_since": 1})

        response, stored = await on_a_league(mongo_replica_set_url, body)

        assert response.status_code == 204
        assert stored is not None and stored["inactive_since"] == RETIRED_SINCE


def venue_payload(name: str, **fields: Any) -> dict[str, Any]:
    return {"name": name, "address": dict(ADDRESS), "default_mietpreis": 120, **fields}


async def sent(url: str, method: str, path: str, payload: Mapping[str, Any]) -> Response:
    """One write as a REAL request, so the refusal's body is the one its page words."""

    async with app_client(url, app=app_under_test(DATABASE_NAME)) as http:
        return await http.request(method, path, json=dict(payload), headers=StampedHeaders(ACTOR, ADMIN_KEY))


async def stored_with_its_acts(database: AsyncDatabase, spielort_id: ObjectId) -> tuple[Mapping[str, Any], list[tuple[str, str, str | None]]]:
    stored = await database[Collection.SPIELORTE].find_one({"_id": spielort_id})
    rows = await database[Collection.ACTION_LOG].find({"record_id": spielort_id}, sort=[("_id", 1)]).to_list(length=None)
    assert stored is not None

    return stored, [(row["action"], row["by"], row["label"]) for row in rows]


def refusal_of(response: Response) -> tuple[int, str]:
    """Its status and its code, which the unique index answers for a taken name too."""

    return response.status_code, response.json()["error_code"]


class TestAVenuesWrites:
    async def test_a_new_venue_stores_the_link_it_builds_and_records_its_act(self, mongo_replica_set_url: str):
        """The client never sends `maps_query`, which every fixture at this ground publishes as the address."""

        async def body(database: AsyncDatabase) -> Any:
            refused = await sent(mongo_replica_set_url, "POST", SPIELORTE, venue_payload(RETIRED_NAME))
            created = await sent(mongo_replica_set_url, "POST", SPIELORTE, venue_payload(f"  {NEW_NAME} "))

            return refused, created, *await stored_with_its_acts(database, ObjectId(created.json()["created_id"]))

        refused, created, stored, acts = await on_a_league(mongo_replica_set_url, body)

        assert refusal_of(refused) == (409, Code.DUPLICATE_KEY)
        assert created.status_code == 201
        assert (stored["name"], stored["maps_query"], stored["default_mietpreis"], stored["inactive_since"]) == (
            NEW_NAME,
            f"{NEW_NAME}, {ADDRESS_LINE}, Deutschland",
            120,
            None,
        )
        assert acts == [("spielort.created", ACTOR, NEW_NAME)]

    async def test_a_save_rewrites_the_link_on_the_version_served_and_records_its_act(self, mongo_replica_set_url: str):
        """A venue saved under its own name is no duplicate of itself, and a save on an older version overwrites nothing."""

        path = f"{SPIELORTE}/{RETIRED_OID}"

        async def body(database: AsyncDatabase) -> Any:
            await sent(mongo_replica_set_url, "POST", SPIELORTE, venue_payload(NEW_NAME))
            taken = await sent(mongo_replica_set_url, "PATCH", path, venue_payload(NEW_NAME, version=0))
            kept = await sent(mongo_replica_set_url, "PATCH", path, venue_payload(RETIRED_NAME, version=0))
            moved = await sent(mongo_replica_set_url, "PATCH", path, venue_payload("Halle Süd", version=1))
            stale = await sent(mongo_replica_set_url, "PATCH", path, venue_payload("Halle West", version=1))

            return taken, kept, moved, stale, *await stored_with_its_acts(database, RETIRED_OID)

        taken, kept, moved, stale, stored, acts = await on_a_league(mongo_replica_set_url, body)

        assert refusal_of(taken) == (409, Code.DUPLICATE_KEY)
        assert (kept.status_code, kept.json()["version"], moved.json()["version"]) == (200, 1, 2)
        assert (stale.status_code, stale.json()["error_code"]) == (409, Code.VERSION_STALE)
        assert (stored["name"], stored["maps_query"], stored["default_mietpreis"], stored["version"]) == (
            "Halle Süd",
            f"Halle Süd, {ADDRESS_LINE}, Deutschland",
            120,
            2,
        )
        assert acts == [("spielort.changed", ACTOR, RETIRED_NAME), ("spielort.changed", ACTOR, "Halle Süd")]
