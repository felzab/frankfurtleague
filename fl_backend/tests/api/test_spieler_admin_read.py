from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.spieler.admin_router import get_spieler_admin, get_spieler_saison
from app.api.spieler.services import mark_shared_nummern_per_squad
from app.core.collections import Collection
from app.core.exceptions import DocumentNotFoundError
from app.core.sentinels import GHOST_SPIELER_ID
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


async def the_list(database: AsyncDatabase, saison_id: str = SAISON_ID) -> Any:
    return await get_spieler_admin(
        saison_id=saison_id,
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
    )


async def the_editor(database: AsyncDatabase, spieler_id: ObjectId, saison_id: str = SAISON_ID) -> Any:
    return await get_spieler_saison(
        spieler_id=spieler_id,
        saison_id=saison_id,
        spieler_collection=database[Collection.SPIELER],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
    )


class TestTheShirtMarker:
    """Judged per squad, though the list reads every team's rows at once."""

    def test_a_number_two_clubs_share_is_no_double(self):
        """Judged over the whole list, every club's number 7 would carry a chip nobody can clear."""

        rows = [
            {"team_id": TEAM_OID, "nummer": "7", "inactive_since": None},
            {"team_id": OTHER_TEAM_OID, "nummer": "7", "inactive_since": None},
        ]

        assert [row["nummer_double"] for row in mark_shared_nummern_per_squad(rows)] == [False, False]

    def test_an_ausgetragen_row_neither_doubles_nor_is_marked(self):
        rows = [
            {"team_id": TEAM_OID, "nummer": "7", "inactive_since": None},
            {"team_id": TEAM_OID, "nummer": "7", "inactive_since": "2026-03-01"},
        ]

        assert [row["nummer_double"] for row in mark_shared_nummern_per_squad(rows)] == [False, False]


@pytest.mark.db
class TestTheList:
    def test_it_serves_the_season_s_rows_of_every_team_by_name(self, mongo_replica_set_url: str):
        """An ausgetragen row among them, the one way to its reactivation."""

        async def body(database: AsyncDatabase) -> Any:
            return await the_list(database)

        answer = on_a_league(mongo_replica_set_url, body)

        assert [row.first_name for row in answer.spieler] == ["Anna", "Ben", "Carl", "Dora"]

    def test_each_row_carries_its_club_s_season_name_and_its_shirt_marker(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            return await the_list(database)

        answer = on_a_league(mongo_replica_set_url, body)
        by_name = {row.first_name: row for row in answer.spieler}

        assert by_name["Anna"].team_name == "Adler"
        assert by_name["Dora"].team_name is None
        assert (by_name["Anna"].nummer_double, by_name["Ben"].nummer_double) == (True, True)
        assert (by_name["Carl"].nummer_double, by_name["Dora"].nummer_double) == (False, False)
        assert by_name["Carl"].is_nachnominiert is True

    def test_no_address_reaches_the_answer(self, mongo_replica_set_url: str):
        """A squad list shows none, and the join is where one would ride along."""

        async def body(database: AsyncDatabase) -> Any:
            return await the_list(database)

        assert ADDRESS not in on_a_league(mongo_replica_set_url, body).model_dump_json()

    def test_a_season_no_id_names_is_not_found(self, mongo_replica_set_url: str):
        """Rather than an empty list, which an address typed wrong would read as a squad-less season."""

        async def body(database: AsyncDatabase) -> Any:
            return await the_list(database, "1999")

        with pytest.raises(DocumentNotFoundError):
            on_a_league(mongo_replica_set_url, body)


@pytest.mark.db
class TestTheEditor:
    def test_the_count_is_the_two_documents_added(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            await database[Collection.SPIELER].update_one({"_id": ANNA_OID}, {"$set": {"version": 3}})
            await database[Collection.SAISON_SPIELER].update_one({"spieler_id": ANNA_OID, "saison_id": SAISON_ID}, {"$set": {"version": 4}})
            return await the_editor(database, ANNA_OID)

        assert on_a_league(mongo_replica_set_url, body).version == 7

    def test_it_stands_on_the_season_s_row(self, mongo_replica_set_url: str):
        """Anna holds a row in two seasons, each its own number."""

        async def body(database: AsyncDatabase) -> Any:
            return await the_editor(database, ANNA_OID), await the_editor(database, ANNA_OID, OTHER_SAISON_ID)

        current, former = on_a_league(mongo_replica_set_url, body)

        assert (current.kader.nummer, former.kader.nummer) == ("7", "9")

    def test_the_taken_roles_are_the_squad_s_others(self, mongo_replica_set_url: str):
        """Their own role stays open to a person, and another club's captain takes nothing from this squad."""

        async def body(database: AsyncDatabase) -> Any:
            return await the_editor(database, ANNA_OID)

        assert on_a_league(mongo_replica_set_url, body).taken_rollen == ["kapitaen"]

    def test_a_retired_holder_takes_no_role(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            await database[Collection.SAISON_SPIELER].update_one(
                {"spieler_id": BEN_OID, "saison_id": SAISON_ID}, {"$set": {"inactive_since": "2026-03-01"}}
            )
            return await the_editor(database, ANNA_OID)

        assert on_a_league(mongo_replica_set_url, body).taken_rollen == []

    @pytest.mark.parametrize("spieler_id", [DORA_OID, GHOST_SPIELER_ID], ids=["no row of that season", "the sentinel"])
    def test_a_person_out_of_the_season_is_not_found(self, mongo_replica_set_url: str, spieler_id: ObjectId):
        async def body(database: AsyncDatabase) -> Any:
            return await the_editor(database, spieler_id, OTHER_SAISON_ID)

        with pytest.raises(DocumentNotFoundError):
            on_a_league(mongo_replica_set_url, body)
