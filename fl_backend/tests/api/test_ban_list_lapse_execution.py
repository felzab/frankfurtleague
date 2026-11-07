"""
API · a ban's five-season bound, from the season the write counts it from to the activation that removes the row

The boundary is pinned on BOTH sides: a sweep that always deletes passes one of them, and one that
never does the other.
"""

from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.admin_router import activate_saison
from app.api.saisons.crud import pull_governing_saison_id
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError
from tests import documents
from tests.bans import ban_through_the_route
from tests.config import grants_for_the_suite
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_ban_list_lapse_test")

TODAY = "2026-04-01"

ADMIN = "admin@frankfurtleague.de"

BANNED = "Zorbanax@Beispielschule.de"
OTHER = "quillhilde@beispielschule.de"

BAN_REASON = "Falsches Geburtsdatum bei der Anmeldung"

# The season a ban entered under 2026 covers through, and the one after it. Spelled rather than
# computed: a case reading the arithmetic it exists to pin would follow the code wherever it went.
ENTERED_UNDER = "2026"
LAST_COVERED = "2031"
FIRST_CLEAR = "2032"

TEAM_ID = ObjectId("6890a1b2c3d4e5f607250001")
# A drawn fixture names a matchday whether or not one is seeded; nothing checks that the row exists.
SPIELTAG_ID = ObjectId("6890a1b2c3d4e5f6072500a1")

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def saison_document(saison_id: str, status: str) -> dict[str, Any]:
    """The span and the rules are what the season's record model requires; `status` is what this suite varies."""

    return documents.saison_document(saison_id, status, rules=documents.rules_document(number_of_gruppen=2, allowed_stufen=["E1"]))


async def a_drawn_target(database: AsyncDatabase, saison_id: str) -> None:
    """A `future` season and the one fixture that makes it activatable at all.

    `activate_target_undrawn` refuses an undrawn target before the rollover writes anything, and no matchday
    row is seeded, a season holding none owing no date (`activate_spieltage_undated`).
    """

    await database[Collection.SAISONS].insert_one(saison_document(saison_id, "future"))
    await database[Collection.SPIELE].insert_one(
        documents.spiel_document(
            spiel_id=ObjectId(),
            saison_id=saison_id,
            spiel_nr=1,
            spieltag_id=SPIELTAG_ID,
            team1={"team_id": TEAM_ID, "tore": None},
        )
    )


def on_a_league(url: str, seasons: list[dict[str, Any]], body: Body) -> Any:
    """The shipped unique index, so a duplicate production would refuse fails here too."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            # The ban re-judges its actor's grant inside its transaction.
            await database[Collection.GRANTS].insert_many(grants_for_the_suite())
            if seasons:
                await database[Collection.SAISONS].insert_many(seasons)

            return await body(database, client)

    return on_the_seed_loop(_run())


async def ban(database: AsyncDatabase, client: AsyncMongoClient, *, email: str = BANNED) -> Any:
    return await ban_through_the_route(database, client, email=email, ban_reason=BAN_REASON, by=ADMIN, today=TODAY)


async def activate(database: AsyncDatabase, client: AsyncMongoClient, saison_id: str) -> Any:
    return await activate_saison(
        saison_id=saison_id,
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        spieltage_collection=database[Collection.SPIELTAGE],
        ban_list_collection=database[Collection.BAN_LIST],
        db=client,
    )


class TestWhatTheWriteRecords:
    def test_the_row_and_the_response_name_the_same_last_covered_season(self, mongo_replica_set_url: str):
        """Computed on the SERVER and answered once: the action builds the person's mail from this, and a second read would race the sweep."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, Any]:
            created = await ban(database, client)
            stored = await database[Collection.BAN_LIST].find_one({})

            assert stored is not None
            return str(stored["barred_until_saison_id"]), created.barred_until_saison_id

        assert on_a_league(mongo_replica_set_url, [saison_document(ENTERED_UNDER, "active")], body) == (LAST_COVERED, LAST_COVERED)


class TestTheSeasonTheBanIsCountedFrom:
    def test_a_league_holding_only_ended_seasons_answers_nothing(self, mongo_replica_set_url: str):
        """A status set by hand, the rollover promoting in the transaction that demotes.

        The newest ended season sorts first, so a helper guessing it answers `ENTERED_UNDER` here.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str | None:
            return await pull_governing_saison_id(saisons_collection=database[Collection.SAISONS])

        seasons = [saison_document("2025", "past"), saison_document(ENTERED_UNDER, "past"), saison_document("2027", "future")]

        assert on_a_league(mongo_replica_set_url, seasons, body) is None

    def test_a_league_holding_only_a_future_season_answers_nothing(self, mongo_replica_set_url: str):
        """A planned season has been played under by nobody, so counting five from it would bar a person five seasons early."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str | None:
            return await pull_governing_saison_id(saisons_collection=database[Collection.SAISONS])

        assert on_a_league(mongo_replica_set_url, [saison_document("2027", "future")], body) is None

    def test_the_running_season_is_read_through_the_session(self, mongo_replica_set_url: str):
        """A season the transaction wrote is seen through its session alone, so the helper answers it only when handed that session."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str | None, str | None]:
            saisons = database[Collection.SAISONS]

            async def write_then_read(session: AsyncClientSession) -> tuple[str | None, str | None]:
                await saisons.insert_one(saison_document("2028", "active"), session=session)

                return (
                    await pull_governing_saison_id(saisons_collection=saisons, session=session),
                    await pull_governing_saison_id(saisons_collection=saisons),
                )

            async with client.start_session() as session:
                return await session.with_transaction(write_then_read)

        seasons = [saison_document(ENTERED_UNDER, "past"), saison_document("2027", "future")]

        assert on_a_league(mongo_replica_set_url, seasons, body) == ("2028", None)


class TestALeagueWithNoSeasonRunning:
    @pytest.mark.parametrize(
        "seasons",
        [
            pytest.param([saison_document("2027", "future")], id="before its first activation"),
            pytest.param([saison_document(ENTERED_UNDER, "past")], id="holding only an ended season"),
        ],
    )
    def test_the_ban_is_refused_and_nothing_is_written(self, mongo_replica_set_url: str, seasons: list[dict[str, Any]]):
        """Driven through the endpoint, so the refusal is shown to stand before the insert rather than beside it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> int:
            with pytest.raises(APIError) as raised:
                await ban(database, client)

            assert raised.value.error_code == Code.BAN_LIST_NO_SAISON

            return await database[Collection.BAN_LIST].count_documents({})

        assert on_a_league(mongo_replica_set_url, seasons, body) == 0


class TestTheSweepAtAnActivation:
    def test_a_lapsed_ban_goes_and_a_covered_one_stands(self, mongo_replica_set_url: str):
        """Both rows through one activation: a sweep taking the collection passes a case asserting only that the lapsed row went."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[str]:
            await ban(database, client)
            await a_drawn_target(database, FIRST_CLEAR)
            # Counted from the running season like the row above, then moved to the season the
            # activation reaches, which covers it.
            await ban(database, client, email=OTHER)
            await database[Collection.BAN_LIST].update_one(
                {"address": OTHER},
                {"$set": {"barred_until_saison_id": FIRST_CLEAR}},
            )

            await activate(database, client, FIRST_CLEAR)

            return [str(row["barred_until_saison_id"]) async for row in database[Collection.BAN_LIST].find()]

        assert on_a_league(mongo_replica_set_url, [saison_document(ENTERED_UNDER, "active")], body) == [FIRST_CLEAR]

    def test_the_season_a_row_names_is_the_last_one_that_bars(self, mongo_replica_set_url: str):
        """The off-by-one, driven rather than argued: activating the last covered season leaves the row. That is what `$lt` buys over `$lte`."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> int:
            await ban(database, client)
            await a_drawn_target(database, LAST_COVERED)
            await activate(database, client, LAST_COVERED)

            return await database[Collection.BAN_LIST].count_documents({})

        assert on_a_league(mongo_replica_set_url, [saison_document(ENTERED_UNDER, "active")], body) == 1

    def test_a_year_nobody_activated_is_still_swept(self, mongo_replica_set_url: str):
        """Activation is not sequential, so an equality filter would strand every ban whose own season was skipped."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> int:
            await ban(database, client)
            await a_drawn_target(database, "2040")
            await activate(database, client, "2040")

            return await database[Collection.BAN_LIST].count_documents({})

        assert on_a_league(mongo_replica_set_url, [saison_document(ENTERED_UNDER, "active")], body) == 0

    @pytest.mark.parametrize(
        ("target", "recorded"),
        [
            pytest.param("2040", [("system", "2040", 2, None)], id="a lapse"),
            pytest.param(LAST_COVERED, [], id="an activation lapsing nothing"),
        ],
    )
    def test_a_lapse_writes_one_nameless_row_counting_what_it_took(self, mongo_replica_set_url: str, target: str, recorded: list[Any]):
        """No deletion stands without its row, and the row names no one."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[Any]:
            await ban(database, client)
            await ban(database, client, email=OTHER)
            await a_drawn_target(database, target)
            await activate(database, client, target)

            rows = database[Collection.ACTION_LOG].find({"action": "retention.bans"})

            return [(row["by"], row["label"], row["count"], row["record_id"]) async for row in rows]

        assert on_a_league(mongo_replica_set_url, [saison_document(ENTERED_UNDER, "active")], body) == recorded
