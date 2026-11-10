"""
API · a line-up's document written under its unique key and its version, against the shipped indexes

One document per club per fixture: a club's two seats saving at once meet on it, and the other club's save never does.
"""

from collections.abc import Awaitable, Callable, Mapping
from typing import Any

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.database import AsyncDatabase

from app.api.aufstellungen.crud import write_aufstellung
from app.api.aufstellungen.schemas import FLAufstellungEntry
from app.core.codes import Code
from app.core.collections import Collection
from app.core.recording import ACT_BY_KONTAKT
from app.core.transactions import transaction_session
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import saison_document
from tests.isolation import COMMITTED, InterleavedCollection, outcome_of
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_aufstellung_test")

SAISON_ID = "2027"
SPIEL = ObjectId("6890a1b2c3d4e5f607f10011")
HOME = ObjectId("6890a1b2c3d4e5f607f10001")
AWAY = ObjectId("6890a1b2c3d4e5f607f10002")
LINA = ObjectId("6890a1b2c3d4e5f607f10051")
OLE = ObjectId("6890a1b2c3d4e5f607f10052")

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_season(url: str, body: Body) -> Any:
    """The shipped indexes and the season a first save anchors."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME) as (client, database):
            await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, "active"))
            return await body(database, client)

    return on_the_seed_loop(_run())


async def save(
    database: AsyncDatabase, client: AsyncMongoClient, team_id: ObjectId, starter: ObjectId, *, version: int | None, aufstellungen: Any = None
) -> Mapping[str, Any]:
    """One seat's save of its club's line-up, in a transaction of its own as the route runs it."""

    async def write(session: AsyncClientSession) -> Mapping[str, Any]:
        return await write_aufstellung(
            aufstellungen_collection=database[Collection.AUFSTELLUNGEN] if aufstellungen is None else aufstellungen,
            saisons_collection=database[Collection.SAISONS],
            saison_id=SAISON_ID,
            spiel_id=SPIEL,
            team_id=team_id,
            spieler=[FLAufstellungEntry(spieler_id=starter, starts=True)],
            version=version,
            by=ACT_BY_KONTAKT,
            team="Adler",
            label=f"{SAISON_ID} / 1",
            session=session,
        )

    async with transaction_session(client) as session:
        return await session.with_transaction(write)


async def named(database: AsyncDatabase) -> list[tuple[ObjectId, list[ObjectId], int]]:
    """Every stored line-up of the fixture: its club, whom it names and its count, in the order written."""

    rows = await database[Collection.AUFSTELLUNGEN].find({"spiel_id": SPIEL}).sort("_id").to_list(length=None)

    return [(row["team_id"], [entry["spieler_id"] for entry in row["spieler"]], row["version"]) for row in rows]


class LineUpsRunningARivalBeforeTheirInsert(InterleavedCollection):
    """An `aufstellungen` stand-in running one rival after the save read no line-up and before it inserts its own."""

    async def insert_one(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()

        return await self._collection.insert_one(*args, **kwargs)


def test_a_clubs_second_first_save_meets_the_first_on_the_unique_key(mongo_replica_set_url: str):
    """Two seats of one club open the empty screen and both save: the later one is told the page is stale, and one line-up stands.

    Without `uniq_aufstellung_spiel_id_team_id` both insert, and the fixture's page reads whichever the join finds.
    """

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        async def the_other_seat_saves() -> None:
            await save(database, client, HOME, OLE, version=None)

        aufstellungen = LineUpsRunningARivalBeforeTheirInsert(database[Collection.AUFSTELLUNGEN], the_other_seat_saves)
        outcome = await outcome_of(save(database, client, HOME, LINA, version=None, aufstellungen=aufstellungen))
        # Committed before it, the rival is met at the read and the save never reaches its insert.
        aufstellungen.assert_landed_inside(serially=0)

        return outcome, await named(database)

    outcome, stored = on_a_season(mongo_replica_set_url, body)

    assert (outcome, stored) == (Code.VERSION_STALE, [(HOME, [OLE], 0)])


def test_a_save_on_a_count_another_save_raised_is_refused(mongo_replica_set_url: str):
    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        first = await save(database, client, HOME, LINA, version=None)
        await save(database, client, HOME, OLE, version=first["version"])
        outcome = await outcome_of(save(database, client, HOME, LINA, version=first["version"]))

        return outcome, await named(database)

    outcome, stored = on_a_season(mongo_replica_set_url, body)

    assert (outcome, stored) == (Code.VERSION_STALE, [(HOME, [OLE], 1)])


def test_the_other_clubs_first_save_for_the_same_fixture_stands_beside_it(mongo_replica_set_url: str):
    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await save(database, client, HOME, LINA, version=None)
        outcome = await outcome_of(save(database, client, AWAY, OLE, version=None))

        return outcome, await named(database)

    outcome, stored = on_a_season(mongo_replica_set_url, body)

    assert (outcome, stored) == (COMMITTED, [(HOME, [LINA], 0), (AWAY, [OLE], 0)])
