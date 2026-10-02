"""
API · a grant's row and its announced record, read while the comparison commits a change to both

The two are one aggregation, a `$lookup` joining the record to the row; nothing but a snapshot read
holds that join to the instant the row was read. The rival is held inside the read by a server
failpoint, so the commit lands between the row and its record rather than near them.
"""

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient, monitoring
from pymongo.asynchronous.database import AsyncDatabase

from app.api.berechtigungen.crud import live_unbarred_grant_since, verwaltung_of
from app.core.collections import Collection
from tests.bans import ban_list
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_berechtigungen_isolation_test")

GRANT_ID = ObjectId("6890a1b2c3d4e5f607930001")
BEFORE = "alt.admin@frankfurtleague.de"
AFTER = "neu.admin@frankfurtleague.de"

TYPED = datetime(2026, 1, 1, tzinfo=UTC)
FOUND = datetime(2026, 4, 1, 10, 30, tzinfo=UTC)

# Holds an aggregation's cursor before it loads a batch from the namespace the data names: the
# `$lookup` opens its own cursor on the record's collection, after the row's has been read.
HOLD = "hangBeforeDocumentSourceCursorLoadBatch"
# Bounds the wait for the read to reach the hold, so a read that never reaches it fails the case
# rather than stalling the run.
REACH_TIMEOUT_MS = 20_000


async def repointed_before_the_comparison(database: AsyncDatabase) -> None:
    """A grant whose address was changed in place, which no comparison has found: its record still names the address before."""

    await database[Collection.BERECHTIGUNGEN].insert_one(
        {"_id": GRANT_ID, "adresse": AFTER, "verwaltung": "administration", "erteilt_von": "PLAYGROUND", "erteilt_am": TYPED}
    )
    await database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT].insert_one(
        {"_id": GRANT_ID, "adresse": BEFORE, "verwaltung": "administration", "angekuendigt_am": TYPED}
    )


async def the_comparison_finds_it(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    """The two writes the comparison commits for a grant it finds, in one transaction: the row's find and its record moved."""

    async def callback(session: Any) -> None:
        await database[Collection.BERECHTIGUNGEN].update_one({"_id": GRANT_ID}, {"$set": {"gefunden_am": FOUND}}, session=session)
        await database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT].replace_one(
            {"_id": GRANT_ID}, {"adresse": AFTER, "verwaltung": "administration", "angekuendigt_am": FOUND}, session=session
        )

    async with client.start_session() as session:
        await session.with_transaction(callback)


def on_a_league(url: str, body: Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]) -> Any:
    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await repointed_before_the_comparison(database)

            return await body(database, client)

    return on_the_seed_loop(_run())


class _ReadConcerns(monitoring.CommandListener):
    """The read concern every aggregation over the grants was sent with."""

    def __init__(self) -> None:
        self.sent: list[Any] = []

    def started(self, event: monitoring.CommandStartedEvent) -> None:
        if event.command_name == "aggregate" and event.command["aggregate"] == Collection.BERECHTIGUNGEN:
            self.sent.append(event.command.get("readConcern"))

    def succeeded(self, event: monitoring.CommandSucceededEvent) -> None:
        """Required by the listener interface; the concern is judged as the command is sent."""

    def failed(self, event: monitoring.CommandFailedEvent) -> None:
        """Required by the listener interface; a failed read was still sent with its concern."""


# Both readers of a grant's date: the actor check, and the subject lookup the frontend's guard reads.
READERS: dict[str, Callable[[AsyncDatabase], Awaitable[Any]]] = {
    "the actor check": lambda database: live_unbarred_grant_since(
        AFTER, berechtigungen_collection=database[Collection.BERECHTIGUNGEN], sperrliste=ban_list(database)
    ),
    "the subject lookup": lambda database: verwaltung_of(berechtigungen_collection=database[Collection.BERECHTIGUNGEN], adresse=AFTER),
}


class TestTheRowAndItsRecordAreReadAtOneInstant:
    @pytest.mark.parametrize("reader", READERS.values(), ids=READERS.keys())
    def test_the_join_is_sent_as_a_snapshot_read(self, mongo_replica_set_url: str, reader: Callable[[AsyncDatabase], Awaitable[Any]]):
        """On the wire: the case below needs a server built to hold a read, and this one holds whichever server runs it."""

        spy = _ReadConcerns()

        async def body(_database: AsyncDatabase, _client: AsyncMongoClient) -> list[Any]:
            # A client of this case's own, so the spy sees the reader's commands and none of the seeding.
            watched = AsyncMongoClient(mongo_replica_set_url, event_listeners=[spy])
            try:
                await reader(watched[DATABASE_NAME])
            finally:
                await watched.close()

            return spy.sent

        assert on_a_league(mongo_replica_set_url, body) == [{"level": "snapshot"}]

    def test_a_comparison_committing_between_the_row_and_its_record_hands_the_check_neither_half_of_it(self, mongo_replica_set_url: str):
        """Read apart, the row before the find meets the record after it.

        The two addresses then agree, so the typed date admits sessions older than the find.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[Any, Any]:
            held = f"{DATABASE_NAME}.{Collection.BERECHTIGUNGEN_ANGEKUENDIGT}"
            entered = (await client.admin.command("configureFailPoint", HOLD, mode="alwaysOn", data={"nss": held}))["count"]
            try:
                check = asyncio.ensure_future(READERS["the actor check"](database))
                await client.admin.command("waitForFailPoint", HOLD, timesEntered=entered + 1, maxTimeMS=REACH_TIMEOUT_MS)
                await the_comparison_finds_it(database, client)
            finally:
                await client.admin.command("configureFailPoint", HOLD, mode="off")

            during = await check
            # The control: a rival that never landed leaves the check answering the state before it alone.
            after = await READERS["the actor check"](database)

            return during, after

        during, after = on_a_league(mongo_replica_set_url, body)

        assert after == FOUND
        assert during is None, "the check joined the row before the find to the record after it"
