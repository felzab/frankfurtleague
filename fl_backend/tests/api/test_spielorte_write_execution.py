import asyncio
import functools
from collections.abc import Mapping
from typing import Any

import pytest
from bson import ObjectId
from fastapi import FastAPI
from httpx2 import Response
from pymongo import MongoClient

from app.core.codes import Code
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.main import create_app
from tests.app_client import app_client
from tests.config import ADMIN_KEY, grants_for_the_suite
from tests.database import a_clean_database_sync
from tests.session_headers import StampedHeaders
from tests.worker import worker_database

from .conftest import config_for

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

# `ADDRESS` as a `maps_link` spells it.
ADDRESS_LINE = "Hanauer Landstraße 12a, 60314 Ostend Frankfurt am Main"

NEW_NAME = "Halle Nord"


def venue_document() -> dict[str, Any]:
    """Every key `FLSpielort` requires, so the seed is a shape the venue reads serve."""

    return {
        "_id": RETIRED_OID,
        "name": RETIRED_NAME,
        "address": dict(ADDRESS),
        "maps_link": f"{RETIRED_NAME}, Hanauer Landstraße 12a, 60314 Ostend Frankfurt am Main, Deutschland",
        "default_mietpreis": 80,
        "inactive_since": RETIRED_SINCE,
        # As the create stamps it.
        "version": 0,
    }


@functools.cache
def _served() -> FastAPI:
    """One app for every case serving through it: building one costs more than the request a case sends through it.

    Built on first use rather than at import, which every xdist worker pays at collection.
    """

    return create_app(config_for(DATABASE_NAME))


def retire(url: str) -> Response:
    """The retire as a REAL request, exception handlers included."""

    async def _answered() -> Response:
        async with app_client(url, app=_served()) as http:
            return await http.delete(f"{SPIELORTE}/{RETIRED_OID}", headers=StampedHeaders(ACTOR, ADMIN_KEY))

    return asyncio.run(_answered())


@pytest.fixture
def seeded_url(mongo_replica_set_url: str) -> str:
    """One retired venue, on the shipped indexes.

    The transactional server, because the retire judges and stamps inside a transaction.
    """

    client = MongoClient(mongo_replica_set_url)
    try:
        with a_clean_database_sync(client, mongo_replica_set_url, DATABASE_NAME) as database:
            database[Collection.GRANTS].insert_many(grants_for_the_suite())
            database[Collection.SPIELORTE].insert_one(venue_document())

            return mongo_replica_set_url
    finally:
        client.close()


class TestASecondRetireKeepsTheDayTheVenueLeft:
    """`inactive_since` is the day the record left, so a retire repeated from a second open tab moves nothing."""

    def test_the_stamp_stays_and_the_retire_answers_success(self, seeded_url: str):
        response = retire(seeded_url)

        assert response.status_code == 204

        client = MongoClient(seeded_url)
        try:
            stored = client[DATABASE_NAME][Collection.SPIELORTE].find_one({"_id": RETIRED_OID}, {"inactive_since": 1})
        finally:
            client.close()

        assert stored is not None and stored["inactive_since"] == RETIRED_SINCE


def venue_payload(name: str, **fields: Any) -> dict[str, Any]:
    return {"name": name, "address": dict(ADDRESS), "default_mietpreis": 120, **fields}


def sent(url: str, method: str, path: str, payload: Mapping[str, Any]) -> Response:
    """One write as a REAL request, so the refusal's body is the one its page words."""

    async def _answered() -> Response:
        async with app_client(url, app=_served()) as http:
            return await http.request(method, path, json=dict(payload), headers=StampedHeaders(ACTOR, ADMIN_KEY))

    return asyncio.run(_answered())


def stored_with_its_acts(url: str, spielort_id: ObjectId) -> tuple[Mapping[str, Any], list[tuple[str, str, str | None]]]:
    client = MongoClient(url)
    try:
        database = client[DATABASE_NAME]
        stored = database[Collection.SPIELORTE].find_one({"_id": spielort_id})
        rows = database[Collection.ACTION_LOG].find({"record_id": spielort_id}, sort=[("_id", 1)])
        assert stored is not None

        return stored, [(row["action"], row["by"], row["label"]) for row in rows]
    finally:
        client.close()


def refusal_of(response: Response) -> tuple[int, str, list[Any]]:
    """Its status, its code and the box it names: the unique index answers a taken name too, naming none."""

    answered = response.json()

    return response.status_code, answered["error_code"], [error["path"] for error in answered["fields"]]


class TestAVenuesWrites:
    def test_a_new_venue_stores_the_link_it_builds_and_records_its_act(self, seeded_url: str):
        """The client never sends `maps_link`, which every fixture at this ground publishes as the address."""

        refused = sent(seeded_url, "POST", SPIELORTE, venue_payload(RETIRED_NAME))
        created = sent(seeded_url, "POST", SPIELORTE, venue_payload(f"  {NEW_NAME} "))
        stored, acts = stored_with_its_acts(seeded_url, ObjectId(created.json()["created_id"]))

        assert refusal_of(refused) == (409, Code.DUPLICATE_KEY, [["name"]])
        assert created.status_code == 201
        assert (stored["name"], stored["maps_link"], stored["default_mietpreis"], stored["inactive_since"]) == (
            NEW_NAME,
            f"{NEW_NAME}, {ADDRESS_LINE}, Deutschland",
            120,
            None,
        )
        assert acts == [("spielort.created", ACTOR, NEW_NAME)]

    def test_a_save_rewrites_the_link_on_the_version_served_and_records_its_act(self, seeded_url: str):
        """A venue saved under its own name is no duplicate of itself, and a save on an older version overwrites nothing."""

        sent(seeded_url, "POST", SPIELORTE, venue_payload(NEW_NAME))
        path = f"{SPIELORTE}/{RETIRED_OID}"
        taken = sent(seeded_url, "PATCH", path, venue_payload(NEW_NAME, version=0))
        kept = sent(seeded_url, "PATCH", path, venue_payload(RETIRED_NAME, version=0))
        moved = sent(seeded_url, "PATCH", path, venue_payload("Halle Süd", version=1))
        stale = sent(seeded_url, "PATCH", path, venue_payload("Halle West", version=1))
        stored, acts = stored_with_its_acts(seeded_url, RETIRED_OID)

        assert refusal_of(taken) == (409, Code.DUPLICATE_KEY, [["name"]])
        assert (kept.status_code, kept.json()["version"], moved.json()["version"]) == (200, 1, 2)
        assert (stale.status_code, stale.json()["error_code"]) == (409, Code.VERSION_STALE)
        assert (stored["name"], stored["maps_link"], stored["default_mietpreis"], stored["version"]) == (
            "Halle Süd",
            f"Halle Süd, {ADDRESS_LINE}, Deutschland",
            120,
            2,
        )
        assert acts == [("spielort.changed", ACTOR, RETIRED_NAME), ("spielort.changed", ACTOR, "Halle Süd")]
