from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.spieler.admin_router import get_spieler_saison
from app.core.collections import Collection
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import rules_document, saison_document, saison_spieler_document, saison_team_document, spieler_document
from tests.worker import worker_database

DATABASE_NAME = worker_database("fl_spieler_admin_read_test")

SAISON_ID = "2026"
OTHER_SAISON_ID = "2025"

TEAM_OID = ObjectId("6890a1b2c3d4e5f608410001")
OTHER_TEAM_OID = ObjectId("6890a1b2c3d4e5f608410002")
# A club a replacement took out of the season, which a row of its own can still name.
GONE_TEAM_OID = ObjectId("6890a1b2c3d4e5f608410003")

ANNA_OID = ObjectId("6890a1b2c3d4e5f608410011")
BEN_OID = ObjectId("6890a1b2c3d4e5f608410012")
CARL_OID = ObjectId("6890a1b2c3d4e5f608410013")
DORA_OID = ObjectId("6890a1b2c3d4e5f608410014")

ADDRESS = "anna@beispielschule.de"

Body = Callable[[AsyncDatabase], Awaitable[Any]]


def on_a_league(url: str, body: Body) -> Any:
    """A season of two clubs: Anna and Ben one squad, Carl the other's, Dora ausgetragen and of a club gone from the season."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_, database):
            await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, "active", rules=rules_document()))
            await database[Collection.SAISONS].insert_one(saison_document(OTHER_SAISON_ID, "past", rules=rules_document()))
            await database[Collection.SAISON_TEAMS].insert_many(
                [
                    saison_team_document(SAISON_ID, TEAM_OID, "Adler", "ADX"),
                    saison_team_document(SAISON_ID, OTHER_TEAM_OID, "Bieber", "BIX", gruppe="B"),
                ]
            )
            await database[Collection.SPIELER].insert_many(
                [
                    spieler_document(ANNA_OID, "Anna", "Arndt", email=ADDRESS),
                    spieler_document(BEN_OID, "Ben", "Berg", email="ben@beispielschule.de"),
                    spieler_document(CARL_OID, "Carl", "Cramer", email="carl@beispielschule.de"),
                    spieler_document(DORA_OID, "Dora", "Dorn", email="dora@beispielschule.de"),
                ]
            )
            await database[Collection.SAISON_SPIELER].insert_many(
                [
                    saison_spieler_document(ANNA_OID, SAISON_ID, TEAM_OID, nummer="7", rolle="co_kapitaen"),
                    saison_spieler_document(BEN_OID, SAISON_ID, TEAM_OID, nummer="7", rolle="kapitaen"),
                    # The same shirt in another squad: no double.
                    saison_spieler_document(CARL_OID, SAISON_ID, OTHER_TEAM_OID, nummer="7", rolle="kapitaen", is_nachnominiert=True),
                    saison_spieler_document(DORA_OID, SAISON_ID, GONE_TEAM_OID, nummer="7", inactive_since="2026-03-01"),
                    # Another season's row, which the read names no part of.
                    saison_spieler_document(ANNA_OID, OTHER_SAISON_ID, TEAM_OID, nummer="9"),
                ]
            )

            return await body(database)

    return on_the_seed_loop(_run())


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
    def test_it_stands_on_the_season_s_row(self, mongo_replica_set_url: str):
        """Anna holds a row in two seasons, each its own number."""

        async def body(database: AsyncDatabase) -> Any:
            return await the_editor(database, ANNA_OID), await the_editor(database, ANNA_OID, OTHER_SAISON_ID)

        current, former = on_a_league(mongo_replica_set_url, body)

        assert (current.kader.nummer, former.kader.nummer) == ("7", "9")
