import asyncio
from typing import Any, Mapping

import pytest
from bson import ObjectId
from httpx2 import ASGITransport, AsyncClient, Response
from pymongo import AsyncMongoClient, MongoClient

from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.security import ACTOR_HEADER
from app.main import create_app
from tests.config import ADMIN_AUTH, TEST_BASE_URL
from tests.database import a_clean_database_sync
from tests.worker import worker_database

from .conftest import config_for

# Module level, as `tests/api/test_bewerbung_triage_execution.py` marks its suite: every case below
# reaches a real mongod.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_spielorte_write_test")

SPIELORTE = f"/api/v{API_VERSION}/spielorte"

# The write router binds an actor and refuses a write carrying none (`docs/backend/spec.md :: I41`).
ACTOR = "spielorte.admin@example.com"

# What `app/core/exception_handlers.py` answers a refused unique index with, and what the venue
# slice's mapper lands on the name box.
DUPLICATE_KEY = "DB-COMMON-002"

# Fixed rather than generated, so a failure names the same row every run.
STANDING_OID = ObjectId("6890a1b2c3d4e5f607450001")
RETIRED_OID = ObjectId("6890a1b2c3d4e5f607450002")

STANDING_NAME = "Sportplatz Ost"
# An umlaut, so a duplicate outside ASCII is refused too.
RETIRED_NAME = "Sportplatz Süd"
FREE_NAME = "Sportplatz West"

RETIRED_SINCE = "2026-03-01"

ADDRESS = {
    "strasse": "Hanauer Landstraße",
    "hausnummer": "12a",
    "plz": "60314",
    "stadtteil": "Ostend",
    "stadt": "Frankfurt am Main",
}

MIETPREIS = 80


def venue_document(spielort_id: ObjectId, name: str, *, inactive_since: str | None = None) -> dict[str, Any]:
    """Every key the shipped `spielorte` validator requires, so the seed is a shape production stores."""

    return {
        "_id": spielort_id,
        "name": name,
        "address": dict(ADDRESS),
        "maps_link": f"{name}, Hanauer Landstraße 12a, 60314 Ostend Frankfurt am Main, Deutschland",
        "default_mietpreis": MIETPREIS,
        "inactive_since": inactive_since,
    }


def payload(name: str) -> dict[str, Any]:
    """What both write payloads take: the create's and the edit's field sets are one shape."""

    return {"name": name, "address": dict(ADDRESS), "default_mietpreis": MIETPREIS}


def served(url: str, path: str, body: Mapping[str, Any], *, method: str = "POST") -> Response:
    """One venue write as a REAL request, exception handlers included.

    Called directly instead, the write raises the driver's own error and says nothing about what an
    administrator is answered. One client and one loop per request
    (`tests/api/test_reference_admin_read.py :: answered`).
    """

    async def _served() -> Response:
        app = create_app(config_for(DATABASE_NAME))
        app.state.db_client = AsyncMongoClient(url)

        try:
            transport = ASGITransport(app=app, raise_app_exceptions=False)
            async with AsyncClient(transport=transport, base_url=TEST_BASE_URL) as http:
                return await http.request(method, path, json=dict(body), headers={**ADMIN_AUTH, ACTOR_HEADER: ACTOR})
        finally:
            await app.state.db_client.close()

    return asyncio.run(_served())


def stored_names(url: str) -> list[str]:
    """What the collection holds, read past the API: a list read narrows on `inactive_since`, so it could hide a stored row."""

    client = MongoClient(url)
    try:
        return sorted(str(row["name"]) for row in client[DATABASE_NAME][Collection.SPIELORTE].find({}, {"name": 1}))
    finally:
        client.close()


@pytest.fixture
def seeded_url(mongo_replica_set_url: str) -> str:
    """One standing venue and one retired one, on the shipped validators and indexes.

    The transactional server, because the edit below fans its rename out inside a transaction.
    """

    client = MongoClient(mongo_replica_set_url)
    try:
        database = a_clean_database_sync(client, mongo_replica_set_url, DATABASE_NAME)
        database[Collection.SPIELORTE].insert_many(
            [
                venue_document(STANDING_OID, STANDING_NAME),
                venue_document(RETIRED_OID, RETIRED_NAME, inactive_since=RETIRED_SINCE),
            ]
        )

        return mongo_replica_set_url
    finally:
        client.close()


class TestACreateUnderATakenVenueNameIsRefused:
    """`uniq_spielort_name` refuses the insert; what the administrator is answered is the code the venue slice maps onto the name box."""

    def test_the_name_a_standing_venue_holds_is_answered_409(self, seeded_url: str):
        response = served(seeded_url, SPIELORTE, payload(STANDING_NAME))

        assert (response.status_code, response.json()["error_code"]) == (409, DUPLICATE_KEY)

    def test_the_name_a_retired_venue_holds_is_refused_the_same_way(self, seeded_url: str):
        """Nothing merges two venues, so a retired row keeps its name; the index carries no `partial_filter`, unlike the referee's."""

        response = served(seeded_url, SPIELORTE, payload(RETIRED_NAME))

        assert (response.status_code, response.json()["error_code"]) == (409, DUPLICATE_KEY)

    def test_the_refused_create_leaves_the_collection_as_it_was(self, seeded_url: str):
        served(seeded_url, SPIELORTE, payload(STANDING_NAME))

        assert stored_names(seeded_url) == sorted([STANDING_NAME, RETIRED_NAME])

    def test_a_free_name_is_created(self, seeded_url: str):
        """The control: without it every refusal above would pass on a create failing for any reason at all."""

        response = served(seeded_url, SPIELORTE, payload(FREE_NAME))

        assert response.status_code == 201, response.json()
        assert stored_names(seeded_url) == sorted([STANDING_NAME, RETIRED_NAME, FREE_NAME])


class TestAnEditOntoATakenVenueNameIsRefused:
    """The other write that sends a name, and the mapper answers both.

    Its `$set` runs inside the fan-out's transaction, so the refusal has to survive
    `with_transaction` to reach the same 409 the create is answered with.
    """

    def test_the_edit_is_answered_409(self, seeded_url: str):
        response = served(seeded_url, f"{SPIELORTE}/{RETIRED_OID}", payload(STANDING_NAME), method="PATCH")

        assert (response.status_code, response.json()["error_code"]) == (409, DUPLICATE_KEY)

    def test_the_refused_edit_leaves_both_venues_named_as_they_were(self, seeded_url: str):
        served(seeded_url, f"{SPIELORTE}/{RETIRED_OID}", payload(STANDING_NAME), method="PATCH")

        assert stored_names(seeded_url) == sorted([STANDING_NAME, RETIRED_NAME])

    def test_a_free_name_is_accepted(self, seeded_url: str):
        response = served(seeded_url, f"{SPIELORTE}/{RETIRED_OID}", payload(FREE_NAME), method="PATCH")

        assert response.status_code == 200, response.json()
        assert stored_names(seeded_url) == sorted([STANDING_NAME, FREE_NAME])
