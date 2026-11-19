"""
API · a write keeping a person's seat while that person's erasure runs, against the shipped indexes and the whole database

Each case runs one write to its commit inside the erasure, after the erasure's first read, and asks the whole
database what holds the address once the erasure has answered.
"""

from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.core.collections import Collection
from app.shared.folding import sign_in_identifier
from tests.database import a_clean_database
from tests.documents import kontakte_document, saison_document, saison_team_document, team_document
from tests.erasure import erased
from tests.isolation import COMMITTED, InterleavedCollection, outcome_of
from tests.outbox import MAIL_NOW
from tests.stored import the_row
from tests.team_writes import save_the_team, write_the_block
from tests.whole_database import where_folded_to
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_erasure_isolation_test")

NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
TODAY = "2026-04-01"
SAISON_ID = "2026"

# Typed as a visitor types it, and the fold every record stores: the fold, never the spelling, says whose a record is.
TYPED = "Zorbanax.Quillfeather@Example.org"
IDENTIFIER = sign_in_identifier(TYPED)

TEAM_OID = ObjectId("6890a1b2c3d4e5f607e10001")

PHONE = "+49 69 90009202"

Rival = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


class GrantsReadThenRival(InterleavedCollection):
    """The grants, running the rival to its commit after the erasure's first read: its snapshot is open, and it has written nothing."""

    async def aggregate(self, *args: Any, **kwargs: Any) -> Any:
        cursor = await self._collection.aggregate(*args, **kwargs)
        await self.run_the_rival()
        return cursor


async def a_league(database: AsyncDatabase) -> None:
    """A running season and a club entered seatless: nothing here holds the erased address, so what the case's writer commits is all of it."""

    await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, "active"))
    await database[Collection.TEAMS].insert_one(team_document(TEAM_OID, "Lindenschule", "LSX"))
    await database[Collection.SAISON_TEAMS].insert_one(saison_team_document(SAISON_ID, TEAM_OID, "Lindenschule", "LSX", kontakte=None))


async def on_a_league(url: str, body: Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]) -> Any:
    async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
        await a_league(database)

        return await body(database, client)


# The erased person in the club's trainer seat, and somebody a save seats beside them, each as the editor sends a seat.
SEATED = {
    "first_name": "Zorbanax",
    "last_name": "Quillfeather",
    "email": TYPED,
    "phone": PHONE,
    "einwilligung": {"scope": "kontakt_data", "date": "2026-03-01"},
}
BESIDE = {**SEATED, "first_name": "Ottilie", "last_name": "Andere", "email": "ottilie.andere@example.com", "phone": "+49 69 90009404"}


async def junction_row(database: AsyncDatabase) -> Mapping[str, Any]:
    return await the_row(database, Collection.SAISON_TEAMS, {"team_id": TEAM_OID, "saison_id": SAISON_ID}, "the seeded row is gone")


async def contacts_saved(database: AsyncDatabase, client: AsyncMongoClient, kontakte: Any, version: int) -> Any:
    return await write_the_block(database, kontakte, team_id=TEAM_OID, saison_id=SAISON_ID, version=version, today=TODAY, germany_now=MAIL_NOW)


async def junction_patched(database: AsyncDatabase, client: AsyncMongoClient, values: dict[str, Any]) -> Any:
    return await save_the_team(database, team_id=TEAM_OID, saison_id=SAISON_ID, **values)


def junction_values(row: Mapping[str, Any], **changed: Any) -> dict[str, Any]:
    return {"gruppe": row["gruppe"], "trikot_farbe": row.get("trikot_farbe"), **changed}


async def the_block_it_was_served(database: AsyncDatabase, client: AsyncMongoClient) -> Rival:
    version = (await junction_row(database))["version"]

    return lambda database, client: contacts_saved(database, client, kontakte_document(trainer=SEATED), version)


async def another_seat_filled(database: AsyncDatabase, client: AsyncMongoClient) -> Rival:
    version = (await junction_row(database))["version"]

    return lambda database, client: contacts_saved(database, client, kontakte_document(trainer=SEATED, ansprechperson=BESIDE), version)


async def the_row_as_it_stands(database: AsyncDatabase, client: AsyncMongoClient) -> Rival:
    # Sent once ahead, so the row already holds what the same save writes.
    await junction_patched(database, client, junction_values(await junction_row(database)))
    values = junction_values(await junction_row(database))

    return lambda database, client: junction_patched(database, client, values)


async def another_kit_colour(database: AsyncDatabase, client: AsyncMongoClient) -> Rival:
    values = junction_values(await junction_row(database), trikot_farbe="gruen")

    return lambda database, client: junction_patched(database, client, values)


# Each write an administrator can make to the club's row keeping the erased person's seat.
KEEPING_WRITES: dict[str, Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Rival]]] = {
    "a contacts save sending the block it was served": the_block_it_was_served,
    "a contacts save filling another seat": another_seat_filled,
    "a team save sending the row as it stands": the_row_as_it_stands,
    "a team save changing the kit colour": another_kit_colour,
}


class TestAWriteKeepingTheirSeatInsideTheErasureLeavesNothing:
    """The row is what the erasure writes, so a write changing it meets the erasure there and one of the two runs again.

    A write leaving the row unchanged writes nothing the erasure writes.
    """

    @pytest.mark.parametrize("write", list(KEEPING_WRITES))
    async def test_nothing_holds_the_address(self, mongo_replica_set_url: str, write: str):
        prepare = KEEPING_WRITES[write]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            # Saved twice, the first minting the person's link, so the stored block is what a later send of it composes.
            await contacts_saved(database, client, kontakte_document(trainer=SEATED), 0)
            await contacts_saved(database, client, kontakte_document(trainer=SEATED), (await junction_row(database))["version"])
            keeping = await prepare(database, client)
            written: list[str] = []

            async def keep_the_seat() -> None:
                written.append(await outcome_of(keeping(database, client)))

            grants = GrantsReadThenRival(database[Collection.GRANTS], keep_the_seat)
            outcome = await outcome_of(erased(database, client, TYPED, germany_now=NOW, grants_collection=grants))

            return outcome, written, (await junction_row(database))["kontakte"]["trainer"], await where_folded_to(database, IDENTIFIER)

        outcome, written, trainer, held = await on_a_league(mongo_replica_set_url, body)

        assert (outcome, written) == (COMMITTED, [COMMITTED]), "the write or the erasure never committed, so this case proves nothing"
        assert trainer is None, "the erased person's seat stands"
        assert held == [], f"{held} still hold the address the erasure answered for"
