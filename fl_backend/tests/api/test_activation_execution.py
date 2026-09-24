from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.api.saisons.admin_router import activate_saison
from app.api.saisons.services import ACTIVATE_SAISON_UNFINISHED, ACTIVATE_SPIELTAGE_UNDATED, ACTIVATE_TARGET_PAST
from app.core.collections import Collection
from app.core.exceptions import DocumentConflictException, DocumentNotFoundException
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import saison_document, spiel_document
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_activation_test")

# Named rather than caught broadly: another failure must not read as the rollback this suite proves.
DOCUMENT_VALIDATION_FAILED = 121

# Two incumbents, because two seasons holding `active` is an UNENFORCED state
# (`fl_backend/app/core/domain.py :: UNENFORCED`) and the rollover is what repairs it.
ARCHIVED = "2023"
FIRST_INCUMBENT = "2024"
SECOND_INCUMBENT = "2025"
TARGET = "2026"

SPIELTAG_ID = ObjectId("6890a1b2c3d4e5f6072300a1")
TEAM_ID = ObjectId("6890a1b2c3d4e5f607230001")
# At most one fixture per season, so deriving its id from the season's names the same document in every failure.
SPIEL_IDS = {
    ARCHIVED: ObjectId("6890a1b2c3d4e5f607230011"),
    FIRST_INCUMBENT: ObjectId("6890a1b2c3d4e5f607230012"),
    SECOND_INCUMBENT: ObjectId("6890a1b2c3d4e5f607230013"),
    TARGET: ObjectId("6890a1b2c3d4e5f607230014"),
}


def fixture(saison_id: str, *, ergebnis: str | None) -> dict[str, Any]:
    return spiel_document(
        spiel_id=SPIEL_IDS[saison_id],
        saison_id=saison_id,
        spiel_nr=1,
        spieltag_id=SPIELTAG_ID,
        team1={"team_id": TEAM_ID, "name": "Alpha", "shorthand": "AL", "tore": None},
        datum=f"{saison_id}-03-15",
        uhrzeit="18:00:00",
        ergebnis=ergebnis,
    )


def spieltag_document(saison_id: str, position: int, *, beginn: str | None) -> dict[str, Any]:
    """Every validator-required key stated, `ende` moving with `beginn`: no write here produces a half-dated matchday."""

    return {
        "_id": ObjectId(f"6890a1b2c3d4e5f60724{position:04d}"),
        "saison_id": saison_id,
        "saison_phase": "gruppenphase",
        "position": position,
        "beginn": beginn,
        "ende": None if beginn is None else f"{saison_id}-03-02",
    }


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(
    url: str,
    body: Body,
    *,
    saisons: list[dict[str, Any]],
    spiele: list[dict[str, Any]] | None = None,
    spieltage: list[dict[str, Any]] | None = None,
    mutates_schema: bool = False,
) -> Any:
    """`mutates_schema=True` where the body attaches a validator (`tests/database.py :: a_clean_database`)."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, mutates_schema=mutates_schema) as (client, database):
            await database[Collection.SAISONS].insert_many(saisons)
            if spiele:
                await database[Collection.SPIELE].insert_many(spiele)
            # Absent on every case but `REQ-ACTIVATE-004`'s: a season holding no matchday row owes no
            # date, which is the state each of the older cases here is about.
            if spieltage:
                await database[Collection.SPIELTAGE].insert_many(spieltage)

            return await body(database, client)

    return on_the_seed_loop(_run())


async def call_activate(database: AsyncDatabase, client: AsyncMongoClient, saison_id: str) -> Any:
    return await activate_saison(
        saison_id=saison_id,
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        spieltage_collection=database[Collection.SPIELTAGE],
        sperrliste_collection=database[Collection.SPERRLISTE],
        db=client,
    )


async def statuses_now(database: AsyncDatabase) -> dict[str, str]:
    """Read outside any transaction -- what a later request would see."""

    rows = await database[Collection.SAISONS].find({}).to_list(length=None)

    return {row["_id"]: row["status"] for row in rows}


class TestTheRolloverLeavesExactlyOneActiveSeason:
    def test_every_incumbent_is_demoted_and_the_target_promoted(self, mongo_replica_set_url: str):
        """Two seasons seeded active, a state no validator refuses: the `update_many` repairs it rather than demoting one of them."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await call_activate(database, client, TARGET)

            return response, await statuses_now(database)

        response, statuses = on_a_league(
            mongo_replica_set_url,
            body,
            saisons=[
                saison_document(ARCHIVED, "past"),
                saison_document(FIRST_INCUMBENT, "active"),
                saison_document(SECOND_INCUMBENT, "active"),
                saison_document(TARGET, "future"),
            ],
            spiele=[fixture(TARGET, ergebnis=None)],
        )

        active = [saison_id for saison_id, status in statuses.items() if status == "active"]
        assert active == [TARGET], "the rollover left the league with something other than one active season"
        assert statuses == {ARCHIVED: "past", FIRST_INCUMBENT: "past", SECOND_INCUMBENT: "past", TARGET: "active"}
        # A season already `past` is not counted, so this is the number of seasons the rollover moved.
        assert response.deactivated == 2
        assert (response.updated_document.id, response.updated_document.status) == (TARGET, "active")

    def test_reactivating_the_incumbent_demotes_nobody(self, mongo_replica_set_url: str):
        """The `$ne` on the target: its own unplayed fixture is seeded, and only a rule reading it as outgoing would refuse this."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await call_activate(database, client, TARGET)

            return response, await statuses_now(database)

        response, statuses = on_a_league(
            mongo_replica_set_url,
            body,
            saisons=[saison_document(ARCHIVED, "past"), saison_document(TARGET, "active")],
            spiele=[fixture(TARGET, ergebnis=None)],
        )

        assert statuses == {ARCHIVED: "past", TARGET: "active"}
        assert response.deactivated == 0


class TestARefusedRolloverWritesNothing:
    def test_an_unfinished_incumbent_keeps_the_target_where_it_is(self, mongo_replica_set_url: str):
        """The outgoing season's fixture has no result and is not cancelled, which is what `unplayed_spiel_nrs` counts."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentConflictException) as refusal:
                await call_activate(database, client, TARGET)

            return refusal.value.error_code, await statuses_now(database)

        code, statuses = on_a_league(
            mongo_replica_set_url,
            body,
            saisons=[saison_document(FIRST_INCUMBENT, "active"), saison_document(TARGET, "future")],
            # The target is drawn so the unfinished incumbent is what refuses it, not the undrawn-target guard ahead of it.
            spiele=[fixture(FIRST_INCUMBENT, ergebnis=None), fixture(TARGET, ergebnis=None)],
        )

        assert code == ACTIVATE_SAISON_UNFINISHED
        assert statuses == {FIRST_INCUMBENT: "active", TARGET: "future"}

    def test_an_unknown_season_demotes_nobody(self, mongo_replica_set_url: str):
        """The read before the transaction: without it the league would be left with no active season at all."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentNotFoundException):
                await call_activate(database, client, "2099")

            return await statuses_now(database)

        statuses = on_a_league(
            mongo_replica_set_url,
            body,
            saisons=[saison_document(FIRST_INCUMBENT, "active"), saison_document(TARGET, "future")],
        )

        assert statuses == {FIRST_INCUMBENT: "active", TARGET: "future"}


class TestAMidFlightFailureTakesTheDemotionBack:
    def test_a_refused_promotion_leaves_the_incumbent_active(self, mongo_replica_set_url: str):
        """A validator refusing `active` lets the demotion land and stops the promotion -- the half-rollover the transaction exists for."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database.command(
                "collMod",
                Collection.SAISONS.value,
                validator={"$jsonSchema": {"bsonType": "object", "properties": {"status": {"enum": ["past", "future"]}}}},
                validationLevel="strict",
            )

            with pytest.raises(OperationFailure) as failure:
                await call_activate(database, client, TARGET)

            return failure.value.code, await statuses_now(database)

        code, statuses = on_a_league(
            mongo_replica_set_url,
            body,
            saisons=[saison_document(FIRST_INCUMBENT, "active"), saison_document(TARGET, "future")],
            spiele=[fixture(TARGET, ergebnis=None)],
            mutates_schema=True,
        )

        # Asserted on the code, so this cannot pass because something failed before the demotion.
        assert code == DOCUMENT_VALIDATION_FAILED, f"expected the validator to refuse the promotion, got code {code}"
        # The validator admits `past`, so the incumbent reading `active` can only mean the demotion was taken back.
        assert statuses == {FIRST_INCUMBENT: "active", TARGET: "future"}, "the league was left with no active season"


class TestTheRolloverRefusesAFinishedTarget:
    """`REQ-ACTIVATE-002` through the route, which is the only thing that proves the target's own status is read.

    The read before the transaction was there for the 404 alone, and a status it discards refuses
    nothing.
    """

    def test_a_past_target_is_refused_with_no_incumbent_to_answer_for_it(self, mongo_replica_set_url: str):
        """Nothing holds `active`, so `REQ-ACTIVATE-001` has an empty list and only the target can be the reason."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentConflictException) as refusal:
                await call_activate(database, client, ARCHIVED)

            return refusal.value.error_code, await statuses_now(database)

        code, statuses = on_a_league(mongo_replica_set_url, body, saisons=[saison_document(ARCHIVED, "past")])

        assert code == ACTIVATE_TARGET_PAST
        assert statuses == {ARCHIVED: "past"}

    def test_the_incumbent_keeps_running(self, mongo_replica_set_url: str):
        """The incumbent is finished, so the rollover would otherwise land: the demotion is what a missed refusal costs."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentConflictException) as refusal:
                await call_activate(database, client, ARCHIVED)

            return refusal.value.error_code, await statuses_now(database)

        code, statuses = on_a_league(
            mongo_replica_set_url,
            body,
            saisons=[saison_document(ARCHIVED, "past"), saison_document(FIRST_INCUMBENT, "active")],
            spiele=[fixture(FIRST_INCUMBENT, ergebnis="2:1")],
        )

        assert code == ACTIVATE_TARGET_PAST
        assert statuses == {ARCHIVED: "past", FIRST_INCUMBENT: "active"}


class TestTheRolloverRefusesAnUndatedMatchday:
    """`REQ-ACTIVATE-004` through the route, the only thing proving the matchdays are counted.

    The demotion shares the promotion's transaction, so a refusal ordered after it would leave the
    league with no active season.
    """

    def test_the_last_undated_matchday_refuses_the_rollover(self, mongo_replica_set_url: str):
        """One dated matchday beside it, so the count is what refuses rather than the collection being empty."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentConflictException) as refusal:
                await call_activate(database, client, TARGET)

            return refusal.value.error_code, await statuses_now(database)

        code, statuses = on_a_league(
            mongo_replica_set_url,
            body,
            saisons=[saison_document(FIRST_INCUMBENT, "active"), saison_document(TARGET, "future")],
            spiele=[fixture(TARGET, ergebnis=None), fixture(FIRST_INCUMBENT, ergebnis="2:1")],
            spieltage=[
                spieltag_document(TARGET, 1, beginn=f"{TARGET}-03-01"),
                spieltag_document(TARGET, 2, beginn=None),
            ],
        )

        assert code == ACTIVATE_SPIELTAGE_UNDATED
        assert statuses == {FIRST_INCUMBENT: "active", TARGET: "future"}, "the incumbent was demoted by a refused rollover"

    def test_an_undated_matchday_of_another_season_leaves_this_rollover_open(self, mongo_replica_set_url: str):
        """The count's season filter: a query reading the whole collection refuses every league holding one undated row anywhere."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await call_activate(database, client, TARGET)

            return response, await statuses_now(database)

        response, statuses = on_a_league(
            mongo_replica_set_url,
            body,
            saisons=[saison_document(FIRST_INCUMBENT, "active"), saison_document(TARGET, "future")],
            spiele=[fixture(TARGET, ergebnis=None), fixture(FIRST_INCUMBENT, ergebnis="2:1")],
            spieltage=[
                spieltag_document(TARGET, 1, beginn=f"{TARGET}-03-01"),
                spieltag_document(FIRST_INCUMBENT, 2, beginn=None),
            ],
        )

        assert statuses == {FIRST_INCUMBENT: "past", TARGET: "active"}
        assert response.deactivated == 1

    def test_dating_that_matchday_lets_the_same_request_through(self, mongo_replica_set_url: str):
        """The repair the refusal names, driven: without it the case above would pass on an endpoint that refused every rollover."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELTAGE].update_one(
                {"saison_id": TARGET, "beginn": None}, {"$set": {"beginn": f"{TARGET}-03-08", "ende": f"{TARGET}-03-09"}}
            )

            response = await call_activate(database, client, TARGET)

            return response, await statuses_now(database)

        response, statuses = on_a_league(
            mongo_replica_set_url,
            body,
            saisons=[saison_document(FIRST_INCUMBENT, "active"), saison_document(TARGET, "future")],
            spiele=[fixture(TARGET, ergebnis=None), fixture(FIRST_INCUMBENT, ergebnis="2:1")],
            spieltage=[
                spieltag_document(TARGET, 1, beginn=f"{TARGET}-03-01"),
                spieltag_document(TARGET, 2, beginn=None),
            ],
        )

        assert statuses == {FIRST_INCUMBENT: "past", TARGET: "active"}
        assert response.deactivated == 1
