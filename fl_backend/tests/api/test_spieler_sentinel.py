import time
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.schiedsrichter.services import build_ghost_schiedsrichter, build_real_referees_filter
from app.api.spieler.admin_router import delete_spieler, get_spieler_memberships, patch_spieler, post_saison_spieler, reactivate_spieler
from app.api.spieler.public_router import get_spieler, get_spieler_by_id
from app.api.spieler.schemas import FLPatchSpielerPayload, FLPostSaisonSpielerPayload, FLSpielerFilterParams
from app.api.spieler.services import build_ghost_spieler, build_real_spieler_filter
from app.core.collections import Collection
from app.core.exceptions import DocumentNotFoundError
from app.core.sentinels import GHOST_INACTIVE_SINCE, GHOST_SCHIEDSRICHTER_ID, GHOST_SPIELER_ID
from tests import documents
from tests.config import ADMINISTRATORS
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

# Seeded by the cases needing a row the `$in` below does not name.
OTHER_PERSON_OID = ObjectId("6890a1b2c3d4e5f608310003")
REFEREE_OIDS = (ObjectId("6890a1b2c3d4e5f608310004"), ObjectId("6890a1b2c3d4e5f608310005"))

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Body) -> Any:
    """The SHIPPED validators, so seeding the sentinel is itself the case that its document is storable."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active", rules=documents.rules_document()))
            await database[Collection.SAISON_TEAMS].insert_one(documents.saison_team_document(SAISON_ID, TEAM_OID, "Zorbanax", "ZOX"))
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
            spieler_data=FLPatchSpielerPayload(vorname="Lysander", nachname="Quell", geburtsdatum="2009-05-04"),
            spieler_collection=collection,
            db=client,
        )
    if route == "delete":
        return await delete_spieler(spieler_id=spieler_id, spieler_collection=collection, db=client, today=TODAY)
    if route == "reactivate":
        return await reactivate_spieler(spieler_id=spieler_id, spieler_collection=collection, db=client)

    return await post_saison_spieler(
        spieler_id=spieler_id,
        saison_spieler_data=FLPostSaisonSpielerPayload(
            saison_id=SAISON_ID, team_id=TEAM_OID, nummer=None, position=None, stufe=None, rolle=None
        ),
        spieler_collection=collection,
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spieltage_collection=database[Collection.SPIELTAGE],
        db=client,
        today=TODAY,
    )


ROUTES = ["read", "patch", "delete", "reactivate", "squad entry"]


@pytest.mark.parametrize("route", ROUTES)
def test_every_route_by_id_answers_not_found_for_the_sentinel_and_writes_nothing(mongo_replica_set_url: str, route: str):
    """Each route composes the exclusion itself, so one missing it is the defect no other case shows."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        with pytest.raises(DocumentNotFoundError):
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


def test_an_id_nobody_holds_gets_no_squad_row(mongo_replica_set_url: str):
    """A squad row naming nobody resolves to no person on any read of the squad, and nothing would ever remove it."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        with pytest.raises(DocumentNotFoundError):
            await press(database, client, "squad entry", ObjectId())

        return await database[Collection.SAISON_SPIELER].count_documents({})

    assert on_a_league(mongo_replica_set_url, body) == 0


def test_neither_collection_read_serves_the_sentinel_and_a_person_holding_no_squad_row_is_still_served(mongo_replica_set_url: str):
    """Unnarrowed, both reads keep a person holding no squad row, which is exactly the shape the sentinel has."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        listed = await get_spieler(
            spieler_collection=database[Collection.SPIELER], saisons_collection=database[Collection.SAISONS], filters=FLSpielerFilterParams()
        )
        memberships = await get_spieler_memberships(
            spieler_collection=database[Collection.SPIELER],
            berechtigungen_collection=database[Collection.BERECHTIGUNGEN],
            berechtigungen_angekuendigt_collection=database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT],
            operator=ADMINISTRATORS[0],
            auth_time=int(time.time()),
        )

        # By forename on the public list, which serves no record id (`READ-PUPIL-005`): the person's
        # record publishes theirs, and the sentinel stores none.
        return [row.vorname for row in listed.spieler], [row.id for row in memberships.spieler]

    listed, memberships = on_a_league(mongo_replica_set_url, body)

    assert listed == ["Quillhilde"]
    assert memberships == [PERSON_OID]


def _referees() -> list[dict[str, Any]]:
    return [
        build_ghost_schiedsrichter(),
        *(
            documents.schiedsrichter_document(oid, email=f"referee{n}@example.com", name=f"Referee {n}", default_payment=20, einwilligung=None)
            for n, oid in enumerate(REFEREE_OIDS)
        ),
    ]


@pytest.mark.parametrize(
    ("collection", "exclusion", "rows", "named", "found"),
    [
        pytest.param(
            Collection.SPIELER,
            build_real_spieler_filter,
            [documents.spieler_document(OTHER_PERSON_OID, "Lysander", "Quell")],
            [PERSON_OID, GHOST_SPIELER_ID],
            [PERSON_OID],
            id="spieler",
        ),
        pytest.param(
            Collection.SCHIEDSRICHTER,
            build_real_referees_filter,
            _referees(),
            [REFEREE_OIDS[0], GHOST_SCHIEDSRICHTER_ID],
            [REFEREE_OIDS[0]],
            id="schiedsrichter",
        ),
    ],
)
def test_each_exclusion_keeps_the_callers_own_id_term(
    mongo_replica_set_url: str, collection: str, exclusion: Any, rows: list[dict[str, Any]], named: list[ObjectId], found: list[ObjectId]
):
    """Spread over a caller's `_id` term, the exclusion replaces its `$in` and serves every row but the sentinel.

    The row the `$in` does not name is the control: a dropped `$in` serves it.
    """

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await database[collection].insert_many(rows)

        return [row["_id"] async for row in database[collection].find(exclusion({"_id": {"$in": named}})).sort("_id", 1)]

    assert on_a_league(mongo_replica_set_url, body) == found
