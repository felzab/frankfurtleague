"""
API · an administrator revoked while their write runs, the revoke landing inside it, through the served application

The actor check runs before the handler and reads outside its transaction, so a revoke committing
after it is met only by the judge `transaction_session` runs in each attempt. Each case lands the
revoke through the served route once the write's attempt has judged its actor and before it
commits, and only the judge's anchor on the actor's own grant makes the two conflict. A handler
called directly binds no judge, which is why nothing here calls one.
"""

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from typing import Any, cast

import pytest
from bson import ObjectId
from fastapi import FastAPI
from httpx2 import AsyncClient
from pymongo import MongoClient
from pymongo.asynchronous.collection import AsyncCollection

from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.db import get_spielorte_collection
from app.core.security import ACTOR_NOT_ADMIN
from app.main import create_app
from tests.actor_tokens import SignedActor
from tests.app_client import app_client
from tests.config import ADMIN_KEY, ADMINISTRATORS, grants_for_the_suite
from tests.database import a_clean_database_sync
from tests.isolation import InterleavedCollection
from tests.worker import worker_database

from .conftest import config_for

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_actor_judgement_isolation_test")

SPIELORTE = f"/api/v{API_VERSION}/spielorte"
BERECHTIGUNGEN = f"/api/v{API_VERSION}/berechtigungen"

# The revoke is made by the suite's `owner` grant; the actor is an administrator whose revoke leaves the floor of two standing.
OWNER, ACTOR = ADMINISTRATORS[0], ADMINISTRATORS[2]
ACTOR_GRANT_ID = next(row["_id"] for row in grants_for_the_suite() if row["adresse"] == ACTOR)

VENUE_OID = ObjectId("6890a1b2c3d4e5f607470001")
VENUE_NAME = "Sportplatz Ost"
RENAMED = "Sportplatz Nord"

ADDRESS = {"strasse": "Hanauer Landstraße", "hausnummer": "12a", "plz": "60314", "stadtteil": "Ostend", "stadt": "Frankfurt am Main"}


def venue_payload(name: str) -> dict[str, Any]:
    return {"name": name, "address": dict(ADDRESS), "default_mietpreis": 80}


class VenuesRunningARivalBeforeTheirWrite(InterleavedCollection):
    """The venues a write reaches, a rival run once ahead of the write itself: after the attempt's judge read, before its anchor."""

    async def insert_one(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()
        return await self._collection.insert_one(*args, **kwargs)

    async def find_one_and_update(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()
        return await self._collection.find_one_and_update(*args, **kwargs)


def seeded(url: str) -> str:
    """The suite's grants and one standing venue, on the shipped validators and indexes."""

    client = MongoClient(url)
    try:
        database = a_clean_database_sync(client, url, DATABASE_NAME)
        database[Collection.BERECHTIGUNGEN].insert_many(grants_for_the_suite())
        database[Collection.SPIELORTE].insert_one(
            {
                "_id": VENUE_OID,
                "name": VENUE_NAME,
                "address": dict(ADDRESS),
                "maps_link": f"{VENUE_NAME}, Deutschland",
                "default_mietpreis": 80,
                "inactive_since": None,
            }
        )

        return url
    finally:
        client.close()


def stored(url: str) -> tuple[list[str], bool]:
    """The venues' names and whether the actor still holds a grant, read past the API."""

    client = MongoClient(url)
    try:
        database = client[DATABASE_NAME]
        names = sorted(str(row["name"]) for row in database[Collection.SPIELORTE].find({}, {"name": 1}))
        return names, database[Collection.BERECHTIGUNGEN].count_documents({"_id": ACTOR_GRANT_ID}) == 1
    finally:
        client.close()


Write = Callable[[AsyncClient], Awaitable[Any]]


def race(url: str, write: Write, *, rival: bool) -> tuple[int, str | None, list[int], int]:
    """`write` sent as the actor, a revoke of the actor's grant landing inside it where `rival` is set.

    Answers the write's status and code, the revoke's statuses, and how often the write reached its own write.
    """

    served: FastAPI = create_app(config_for(DATABASE_NAME))
    revokes: list[int] = []

    async def body() -> tuple[int, str | None, list[int], int]:
        async with app_client(url, app=served) as http:

            async def revoke() -> None:
                answered = await http.delete(f"{BERECHTIGUNGEN}/{ACTOR_GRANT_ID}", headers=SignedActor(OWNER, ADMIN_KEY))
                revokes.append(answered.status_code)

            racing: list[VenuesRunningARivalBeforeTheirWrite] = []

            def venues(collection: AsyncCollection) -> AsyncCollection:
                interleaved = VenuesRunningARivalBeforeTheirWrite(collection, revoke if rival else _nothing)
                racing.append(interleaved)
                # Not a subclass of the driver's collection, which the driver builds off a database handle.
                return cast(AsyncCollection, interleaved)

            async def wrapped_venues() -> AsyncCollection:
                return venues(served.state.db_client[DATABASE_NAME][Collection.SPIELORTE])

            # Only the venues: the actor check, the judge and the revoke each read the grants unwrapped.
            served.dependency_overrides[get_spielorte_collection] = wrapped_venues
            answered = await write(http)

        passes = sum(collection.passes for collection in racing)
        return answered.status_code, answered.json().get("error_code"), revokes, passes

    return asyncio.run(body())


async def _nothing() -> None:
    return None


def create(http: AsyncClient) -> Awaitable[Any]:
    return http.post(SPIELORTE, json=venue_payload(RENAMED), headers=SignedActor(ACTOR, ADMIN_KEY))


def rename(http: AsyncClient) -> Awaitable[Any]:
    return http.patch(f"{SPIELORTE}/{VENUE_OID}", json=venue_payload(RENAMED), headers=SignedActor(ACTOR, ADMIN_KEY))


WRITES: Mapping[str, Write] = {
    "a single write made a transaction (POST /spielorte)": create,
    "a transaction's write (PATCH /spielorte)": rename,
}


class TestAnAdministratorRevokedMidWriteWritesNothing:
    """`docs/backend/spec.md :: I921`, where the actor check before the handler admitted the actor."""

    @pytest.mark.parametrize("write", WRITES.values(), ids=WRITES.keys())
    def test_the_revoke_landing_inside_refuses_the_write_and_stores_nothing(self, mongo_replica_set_url: str, write: Write):
        """Remove the anchor in `app/core/security.py :: admin_judge` and both commit: the attempt's read alone never sees the revoke.

        Two arrivals at the write: the first meets the rival, the retry the conflict forced is refused before writing again.
        """

        url = seeded(mongo_replica_set_url)

        status, code, revokes, passes = race(url, write, rival=True)

        assert (status, code, revokes) == (403, ACTOR_NOT_ADMIN, [200])
        assert passes == 1, "the retry reached the write again, so its judge admitted a revoked actor"
        assert stored(url) == ([VENUE_NAME], False)

    @pytest.mark.parametrize("write", WRITES.values(), ids=WRITES.keys())
    def test_the_same_write_with_no_revoke_stores(self, mongo_replica_set_url: str, write: Write):
        """The control: a refusal for any other reason would pass the case above."""

        url = seeded(mongo_replica_set_url)

        status, _, revokes, passes = race(url, write, rival=False)

        assert (status in (200, 201), revokes, passes) == (True, [], 1)
        assert stored(url) == ([RENAMED] if write is rename else sorted([RENAMED, VENUE_NAME]), True)
