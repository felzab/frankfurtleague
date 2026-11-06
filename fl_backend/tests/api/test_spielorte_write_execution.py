import asyncio
import functools
from typing import Any

import pytest
from bson import ObjectId
from fastapi import FastAPI
from httpx2 import Response
from pymongo import MongoClient

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
        database = a_clean_database_sync(client, mongo_replica_set_url, DATABASE_NAME)
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
