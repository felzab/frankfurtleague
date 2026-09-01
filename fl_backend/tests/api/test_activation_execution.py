import asyncio
from typing import Any, Awaitable, Callable

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.api.saisons.admin_router import activate_saison
from app.api.saisons.cache import invalidate_saison_cache
from app.api.saisons.services import ACTIVATE_SAISON_UNFINISHED, ACTIVATE_TARGET_PAST
from app.core.collections import Collection
from app.core.exceptions import DocumentConflictException, DocumentNotFoundException
from tests.database import a_clean_database

pytestmark = pytest.mark.db

DATABASE_NAME = "fl_activation_test"

# Named rather than caught broadly: another failure must not read as the rollback this suite proves.
DOCUMENT_VALIDATION_FAILED = 121

# Two incumbents, because "exactly one active season" is an UNENFORCED state
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


def saison_document(saison_id: str, status: str) -> dict[str, Any]:
    """Complete, because the promoted document is validated as `FLSaison` on the way back out."""

    return {
        "_id": saison_id,
        "start_date": f"{saison_id}-01-01",
        "end_date": f"{saison_id}-06-30",
        "status": status,
        "rules": {
            "win_points": 3,
            "draw_points": 1,
            "qualifiers_per_group": 2,
            "number_of_groups": 4,
            "teams_per_group": 4,
            "tiebreak_order": "tordifferenz",
            "max_kadergroesse": 18,
            "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
            "erlaubte_stufen": ["E1", "Q1", "Q2", "Q3", "Q4"],
        },
    }


def spiel_document(saison_id: str, *, ergebnis: str | None) -> dict[str, Any]:
    """Every key spelled out: the outgoing season's fixtures are validated as `FLSpiel` before the rollover is judged."""

    return {
        "_id": SPIEL_IDS[saison_id],
        "spiel_nr": 1,
        "saison_id": saison_id,
        "saison_phase": "gruppenphase",
        "spieltag_id": SPIELTAG_ID,
        "team1": {"team_id": TEAM_ID, "name": "Alpha", "shorthand": "AL", "tore": None},
        "team2": None,
        "team1_quelle": None,
        "team2_quelle": None,
        "datum": f"{saison_id}-03-15",
        "uhrzeit": "18:00:00",
        "ort": None,
        "schiedsrichter": None,
        "ergebnis": ergebnis,
        "elfmeterschiessen": None,
        "sonderereignis": None,
        "notiz": None,
    }


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(
    url: str, body: Body, *, saisons: list[dict[str, Any]], spiele: list[dict[str, Any]] | None = None, mutates_schema: bool = False
) -> Any:
    """`saisons` by hand, a transaction being unable to create a collection.

    `mutates_schema=True` where the body attaches a validator: `tests/database.py` then keeps the
    change off every later test.
    """

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, collections=(Collection.SAISONS,), mutates_schema=mutates_schema) as (client, database):
            # Process-global and keyed by season id, so an entry another module left would answer for this one.
            invalidate_saison_cache()

            await database[Collection.SAISONS].insert_many(saisons)
            if spiele:
                await database[Collection.SPIELE].insert_many(spiele)

            return await body(database, client)

    return asyncio.run(_run())


async def call_activate(database: AsyncDatabase, client: AsyncMongoClient, saison_id: str) -> Any:
    return await activate_saison(
        saison_id=saison_id,
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
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
            spiele=[spiel_document(TARGET, ergebnis=None)],
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
            spiele=[spiel_document(TARGET, ergebnis=None)],
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
            spiele=[spiel_document(FIRST_INCUMBENT, ergebnis=None), spiel_document(TARGET, ergebnis=None)],
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
            spiele=[spiel_document(TARGET, ergebnis=None)],
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
            spiele=[spiel_document(FIRST_INCUMBENT, ergebnis="2:1")],
        )

        assert code == ACTIVATE_TARGET_PAST
        assert statuses == {ARCHIVED: "past", FIRST_INCUMBENT: "active"}
