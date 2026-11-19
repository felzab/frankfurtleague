from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.spieler.admin_router import get_spieler_saison
from app.core.collections import Collection
from tests.database import a_clean_database
from tests.documents import rules_document, saison_document, saison_spieler_document, spieler_document
from tests.worker import worker_database

DATABASE_NAME = worker_database("fl_spieler_admin_read_test")

SAISON_ID = "2026"
OTHER_SAISON_ID = "2025"

TEAM_OID = ObjectId("6890a1b2c3d4e5f608410001")

ANNA_OID = ObjectId("6890a1b2c3d4e5f608410011")

Body = Callable[[AsyncDatabase], Awaitable[Any]]


async def on_a_league(url: str, body: Body) -> Any:
    """Anna in one club's squad of two seasons, each row its own number."""

    async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_, database):
        await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, "active", rules=rules_document()))
        await database[Collection.SAISONS].insert_one(saison_document(OTHER_SAISON_ID, "past", rules=rules_document()))
        await database[Collection.SPIELER].insert_one(spieler_document(ANNA_OID, "Anna", "Arndt", email="anna@beispielschule.example.org"))
        await database[Collection.SAISON_SPIELER].insert_many(
            [
                saison_spieler_document(ANNA_OID, SAISON_ID, TEAM_OID, nummer="7"),
                saison_spieler_document(ANNA_OID, OTHER_SAISON_ID, TEAM_OID, nummer="9"),
            ]
        )

        return await body(database)


async def the_editor(database: AsyncDatabase, spieler_id: ObjectId, saison_id: str = SAISON_ID) -> Any:
    return await get_spieler_saison(
        spieler_id=spieler_id,
        saison_id=saison_id,
        spieler_collection=database[Collection.SPIELER],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
    )


@pytest.mark.db
class TestTheEditor:
    async def test_it_stands_on_the_season_s_row(self, mongo_replica_set_url: str):
        """Anna holds a row in two seasons, each its own number."""

        async def body(database: AsyncDatabase) -> Any:
            return await the_editor(database, ANNA_OID), await the_editor(database, ANNA_OID, OTHER_SAISON_ID)

        current, former = await on_a_league(mongo_replica_set_url, body)

        assert (current.kader.nummer, former.kader.nummer) == ("7", "9")
