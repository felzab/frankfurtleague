from typing import Any

import pytest
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.admin_router import get_saisons_admin, post_saison
from app.api.saisons.schemas import FIRST_SAISON_RULES, FIRST_SAISON_YEAR, FLPostSaisonPayload
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_saison_create_test")

TODAY = "2026-03-15"


def _payload() -> FLPostSaisonPayload:
    stored = documents.saison_document("2026", "active")

    return FLPostSaisonPayload.model_validate({"start_date": stored["start_date"], "end_date": stored["end_date"]})


async def _create(database: AsyncDatabase) -> Any:
    return await post_saison(saison_data=_payload(), saisons_collection=database[Collection.SAISONS], db=database.client)


async def _listed(database: AsyncDatabase) -> Any:
    return await get_saisons_admin(
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        today=TODAY,
    )


async def _seasons(database: AsyncDatabase) -> list[tuple[str, str]]:
    return [(row["_id"], row["status"]) async for row in database[Collection.SAISONS].find({}, {"status": 1}).sort("_id", 1)]


def _on(url: str, stored: list[tuple[str, str]], body: Any, **fields: Any) -> Any:
    async def _run() -> Any:
        # A row whose id is longer than a year is a hand edit the read-back refuses, stored so the create is seen to step past it.
        refused = None if all(len(saison_id) == 4 for saison_id, _ in stored) else "a season row whose id is longer than a year"
        async with a_clean_database(url, DATABASE_NAME, stores_a_refused_shape=refused) as (_, database):
            for saison_id, status in stored:
                # A row whose id is no year is a hand edit no record model reads, laid over a season's own: it still carries
                # real days, so the list reads it as it reads any season.
                season = documents.saison_document(saison_id if saison_id.isdigit() else "2025", status, **fields)
                await database[Collection.SAISONS].insert_one({**season, "_id": saison_id})

            return await body(database)

    return on_the_seed_loop(_run())


class TestTheCreateMakesTheNextSeason:
    @pytest.mark.parametrize(
        ("stored", "minted"),
        [
            pytest.param([], str(FIRST_SAISON_YEAR), id="the-league's-first"),
            pytest.param([("2026", "past"), ("2027", "active")], "2028", id="the-year-after-the-newest"),
            # Sorted after every year by string order, so a create reading it as the newest answers 500.
            pytest.param([("2027", "active"), ("abcd", "past")], "2028", id="the-year-after-the-newest-past-an-odd-row"),
            # Of another length too, so a list holding the row to the id's length answers 500.
            pytest.param([("2027", "active"), ("2027-alt", "past")], "2028", id="the-year-after-the-newest-past-a-longer-row"),
        ],
    )
    def test_the_list_serves_the_id_the_create_mints(self, mongo_replica_set_url: str, stored: list[tuple[str, str]], minted: str):
        """The page names the season its press makes from the list; a list and a create counting apart name a season never made."""

        async def body(database: AsyncDatabase) -> Any:
            listed = await _listed(database)
            created = await _create(database)

            return listed.next_saison_id, listed.refusals.create, created.created_id, await _seasons(database)

        listed_id, refusal, created_id, seasons = _on(mongo_replica_set_url, stored, body)

        assert (listed_id, refusal, created_id) == (minted, None, minted)
        assert seasons == sorted([*stored, (minted, "future")])

    @pytest.mark.parametrize(
        ("stored", "carried"),
        [
            pytest.param([], FIRST_SAISON_RULES.model_dump(mode="json"), id="the-league's-first-starting-rules"),
            pytest.param([("2026", "past"), ("2027", "active")], {**documents.rules_document(), "win_points": 4}, id="the-newest's-rules"),
        ],
    )
    def test_the_new_season_carries_on_the_newest_seasons_rules(
        self, mongo_replica_set_url: str, stored: list[tuple[str, str]], carried: dict[str, Any]
    ):
        """An older season's rules handed on, or a first season's starting rules lost, would stand on the new season unremarked."""

        async def body(database: AsyncDatabase) -> Any:
            # The older season's rules apart from the newest's, so a create reading the wrong one is caught.
            await database[Collection.SAISONS].update_one({"_id": "2027"}, {"$set": {"rules.win_points": 4}})
            created = await _create(database)

            return await database[Collection.SAISONS].find_one({"_id": created.created_id})

        new = _on(mongo_replica_set_url, stored, body)

        assert (new["rules"], new["bewerbung"], new["registrierung"]) == (carried, None, None)

    def test_a_planned_season_standing_refuses_the_create_and_the_list_says_so(self, mongo_replica_set_url: str):
        """A second planned season would be one created out of turn; the list naming no refusal offers a press the write refuses."""

        async def body(database: AsyncDatabase) -> Any:
            listed = await _listed(database)
            with pytest.raises(APIError) as refused:
                await _create(database)

            return listed.refusals.create, refused.value, await _seasons(database)

        listed_refusal, refusal, seasons = _on(mongo_replica_set_url, [("2026", "active"), ("2027", "future")], body)

        assert listed_refusal == Code.CREATE_SAISON_FUTURE_STANDS
        assert (refusal.status_code, refusal.error_code, refusal.fields) == (409, Code.CREATE_SAISON_FUTURE_STANDS, ())
        assert seasons == [("2026", "active"), ("2027", "future")]
