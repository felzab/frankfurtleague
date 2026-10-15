from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.identitaet.services import build_pupil_pipeline
from app.api.spieler.admin_router import delete_spieler, get_spieler_memberships, patch_spieler, reactivate_spieler
from app.api.spieler.router import get_spieler, get_spieler_by_id
from app.api.spieler.schemas import FLPatchSpielerPayload, FLSpielerFilterParams
from app.api.spieler.services import build_ghost_spieler
from app.core.collections import Collection
from app.core.crud import aggregate_many_from_db
from app.core.exceptions import DocumentNotFoundException
from app.core.sentinels import GHOST_INACTIVE_SINCE, GHOST_SPIELER_ID
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_spieler_sentinel_test")

SAISON_ID = "2026"
TODAY = "2026-04-01"
TEAM_OID = ObjectId("6890a1b2c3d4e5f608310001")

# Retired and holding no squad row: the person every exclusion below must still serve, so a filter
# matching nothing fails the controls rather than passing every case.
PERSON_OID = ObjectId("6890a1b2c3d4e5f608310002")
RETIRED_ON = "2026-02-01"

SIGN_IN = "quillhilde@example.com"

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Body) -> Any:
    """The SHIPPED validators, so seeding the sentinel is itself the case that its document is storable."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active", rules=documents.rules_document()))
            await database[Collection.SAISON_TEAMS].insert_one(documents.saison_team_document(SAISON_ID, TEAM_OID, "Zorbanax", "ZO"))
            await database[Collection.SPIELER].insert_many(
                [build_ghost_spieler(), documents.spieler_document(PERSON_OID, "Quillhilde", "Brackenmoor", inactive_since=RETIRED_ON)]
            )

            return await body(database, client)

    return on_the_seed_loop(_run())


async def stored(database: AsyncDatabase, spieler_id: ObjectId) -> Any:
    return await database[Collection.SPIELER].find_one({"_id": spieler_id})


def test_the_sentinel_is_stored_nameless_and_without_a_consent_record(mongo_replica_set_url: str):
    """A name here is published on every erased pupil's surviving entry, and a record is counted as somebody's consent."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        return await stored(database, GHOST_SPIELER_ID)

    sentinel = on_a_league(mongo_replica_set_url, body)

    assert (sentinel["vorname"], sentinel["nachname"], sentinel["einwilligung"]) == (None, None, None)
    assert sentinel["inactive_since"] == GHOST_INACTIVE_SINCE


async def press(database: AsyncDatabase, client: AsyncMongoClient, route: str, spieler_id: ObjectId) -> Any:
    """Every route addressing a `spieler` row by the id in its path."""

    collection = database[Collection.SPIELER]

    if route == "read":
        return await get_spieler_by_id(spieler_id=spieler_id, spieler_collection=collection)
    if route == "patch":
        return await patch_spieler(
            spieler_id=spieler_id,
            spieler_data=FLPatchSpielerPayload(vorname="Lysander", nachname="Quell", geburtsdatum=None),
            spieler_collection=collection,
            db=client,
        )
    if route == "delete":
        return await delete_spieler(spieler_id=spieler_id, spieler_collection=collection, db=client, today=TODAY)

    return await reactivate_spieler(spieler_id=spieler_id, spieler_collection=collection, db=client)


ROUTES = ["read", "patch", "delete", "reactivate"]


@pytest.mark.parametrize("route", ROUTES)
def test_every_route_by_id_answers_not_found_for_the_sentinel_and_writes_nothing(mongo_replica_set_url: str, route: str):
    """Each route composes the exclusion itself, so one missing it is the defect no other case shows."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        with pytest.raises(DocumentNotFoundException):
            await press(database, client, route, GHOST_SPIELER_ID)

        return await stored(database, GHOST_SPIELER_ID), await database[Collection.SAISON_SPIELER].count_documents({})

    sentinel, squad_rows = on_a_league(mongo_replica_set_url, body)

    assert sentinel == build_ghost_spieler()
    assert squad_rows == 0


@pytest.mark.parametrize("route", ROUTES)
def test_every_route_by_id_still_reaches_a_person(mongo_replica_set_url: str, route: str):
    """The control on the case above, which a filter matching nothing would pass."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        return await press(database, client, route, PERSON_OID)

    assert on_a_league(mongo_replica_set_url, body) is not None


def test_neither_collection_read_serves_the_sentinel_and_a_person_holding_no_squad_row_is_still_served(mongo_replica_set_url: str):
    """Unnarrowed, both reads keep a person holding no squad row, which is exactly the shape the sentinel has."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        listed = await get_spieler(
            spieler_collection=database[Collection.SPIELER], saisons_collection=database[Collection.SAISONS], filters=FLSpielerFilterParams()
        )
        memberships = await get_spieler_memberships(spieler_collection=database[Collection.SPIELER])

        return [row.id for row in listed.spieler], [row.id for row in memberships.spieler]

    listed, memberships = on_a_league(mongo_replica_set_url, body)

    assert listed == [PERSON_OID]
    assert memberships == [PERSON_OID]


def test_the_sign_in_lookup_never_resolves_the_sentinel_whatever_a_hand_edit_gives_it(mongo_replica_set_url: str):
    """By its id rather than its missing address: an address is a value a hand edit can write, the id the one thing naming the row as nobody."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        confirmed = documents.eigene_einwilligung_document(text_version="2026-09", bestaetigt_am=TODAY)
        await database[Collection.SPIELER].update_one({"_id": GHOST_SPIELER_ID}, {"$set": {"email": SIGN_IN, "einwilligung": confirmed}})
        sentinel_answer = await aggregate_many_from_db(collection=database[Collection.SPIELER], pipeline=build_pupil_pipeline(SIGN_IN))

        # The control: the same address and record on a person, which the lookup does resolve.
        await database[Collection.SPIELER].update_one({"_id": GHOST_SPIELER_ID}, {"$unset": {"email": ""}})
        await database[Collection.SPIELER].update_one({"_id": PERSON_OID}, {"$set": {"email": SIGN_IN, "einwilligung": confirmed}})
        person_answer = await aggregate_many_from_db(collection=database[Collection.SPIELER], pipeline=build_pupil_pipeline(SIGN_IN))

        return [row["_id"] for row in sentinel_answer], [row["_id"] for row in person_answer]

    assert on_a_league(mongo_replica_set_url, body) == ([], [PERSON_OID])
