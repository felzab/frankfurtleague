"""
SAISONS · the group swap against a real MongoDB (ADR-0062, ADR-0023)

The one claim about `swap_gruppen` that no unit test can make: both `saison_teams` rows move
together, or neither moves. `test_gruppe_swap_refusal.py` proves what the rule decides; this
proves what the database does with the decision, and the two are different failures — the rule
can be right while the write leaves one group a club short.

Every test is marked `db` and runs against the single-node replica set in `tests/conftest.py`,
because a standalone `mongod` refuses a transaction outright.

Invariants:
- The handler is called directly: its parameters are plain types, so no HTTP client is needed.
- The mid-flight failure is the database's own validator, never a patched production symbol.
"""

import asyncio
from typing import Any, Awaitable, Callable

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo.errors import OperationFailure

from app.api.saisons.admin_router import swap_gruppen
from app.api.saisons.schemas import FLSwapGruppenPayload
from app.api.teams.services import SWAP_KNOCKOUT_STARTED, SWAP_NOT_A_SWAP
from app.core.collections import Collection
from app.core.exceptions import DocumentConflictException

pytestmark = pytest.mark.db

DATABASE_NAME = "fl_swap_test"

# The server's code for "this write failed the collection's validator", as `test_constraints_execution.py`
# also asserts on. Named rather than caught broadly, so a transaction that failed for some other reason
# cannot be read as the rollback this suite is proving.
DOCUMENT_VALIDATION_FAILED = 121

SAISON_ID = "2026"
# Fixed rather than generated, so a failure names the same club every run.
ALPHA = ObjectId("6890a1b2c3d4e5f607210001")
BETA = ObjectId("6890a1b2c3d4e5f607210002")
OUTSIDER = ObjectId("6890a1b2c3d4e5f607210003")


def junction(team_id: ObjectId, gruppe: str) -> dict[str, Any]:
    """One `saison_teams` row. A dict rather than a model: this junction has no model of the row."""

    return {"saison_id": SAISON_ID, "team_id": team_id, "gruppe": gruppe, "disqualifikation": None}


def knockout_fixture(*, ergebnis: str | None) -> dict[str, Any]:
    """
    A Viertelfinale fixture, with or without a result.

    Only the three fields the count reads are set. The rest of `FLSpiel` is beside the point here and
    seeding it would make this document look like something the endpoint validates, which it is not.
    """

    return {"saison_id": SAISON_ID, "saison_phase": "viertelfinale", "ergebnis": ergebnis}


Body = Callable[[AsyncIOMotorDatabase, AsyncIOMotorClient], Awaitable[Any]]


def on_a_seeded_season(url: str, body: Body, *, spiele: list[dict[str, Any]] | None = None) -> Any:
    """
    Run `body` against a season holding Alpha in group A, Beta in group B and an outsider in no season.

    One client and one event loop per call, for the reason `tests/core/test_constraints_execution.py`
    states: Motor binds to the loop it first ran on, and a shared client across `asyncio.run` calls
    works right up until it does not.

    Every collection the handler touches is created BEFORE the transaction opens. A transaction may not
    create one, so a season with no `spiele` at all would otherwise fail for a reason that has nothing
    to do with the swap.
    """

    async def _run() -> Any:
        client = AsyncIOMotorClient(url)
        try:
            await client.drop_database(DATABASE_NAME)
            database = client[DATABASE_NAME]

            await database[Collection.SAISONS].insert_one({"_id": SAISON_ID, "status": "active"})
            await database[Collection.SAISON_TEAMS].insert_many([junction(ALPHA, "A"), junction(BETA, "B")])
            await database.create_collection(Collection.SPIELE)
            if spiele:
                await database[Collection.SPIELE].insert_many(spiele)

            return await body(database, client)
        finally:
            await client.drop_database(DATABASE_NAME)
            client.close()

    return asyncio.run(_run())


async def call_swap(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient, team1_id: ObjectId, team2_id: ObjectId) -> Any:
    """The endpoint itself, with the collections FastAPI would have injected."""

    return await swap_gruppen(
        saison_id=SAISON_ID,
        swap_data=FLSwapGruppenPayload(team1_id=team1_id, team2_id=team2_id),
        saisons_collection=database[Collection.SAISONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        spiele_collection=database[Collection.SPIELE],
        db=client,
    )


async def gruppen_now(database: AsyncIOMotorDatabase) -> dict[ObjectId, str]:
    """Each club's stored group, read outside any transaction — what a later request would see."""

    rows = await database[Collection.SAISON_TEAMS].find({"saison_id": SAISON_ID}).to_list(length=None)

    return {row["team_id"]: row["gruppe"] for row in rows}


class TestASwapCommitsBothRows:
    def test_the_two_clubs_end_in_each_others_groups(self, mongo_replica_set_url: str):
        """The whole operation, end to end: what is stored after a swap is the exchange and nothing else."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            response = await call_swap(database, client, ALPHA, BETA)
            return response, await gruppen_now(database)

        response, stored = on_a_seeded_season(mongo_replica_set_url, body)

        assert stored == {ALPHA: "B", BETA: "A"}
        # The echo is the same object the writes were taken from, so this also pins that it cannot
        # describe a swap other than the one that landed.
        assert (response.team1_id, response.team1_gruppe) == (ALPHA, "B")
        assert (response.team2_id, response.team2_gruppe) == (BETA, "A")

    def test_swapping_back_restores_the_season(self, mongo_replica_set_url: str):
        """
        A swap is its own inverse, which is what makes it safe to offer without an undo window.

        Asserted rather than assumed: the handler reads each club's target off the OTHER row, so a
        version that read its own would pass the test above and fail this one.
        """

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            await call_swap(database, client, ALPHA, BETA)
            await call_swap(database, client, BETA, ALPHA)
            return await gruppen_now(database)

        assert on_a_seeded_season(mongo_replica_set_url, body) == {ALPHA: "A", BETA: "B"}


class TestAMidFlightFailureTakesBothWritesBack:
    def test_neither_row_moves_when_the_second_write_is_refused(self, mongo_replica_set_url: str):
        """
        The claim the whole transaction exists for, and the one a green suite otherwise cannot make.

        **The failure is the database's own, not a patched symbol.** A `$jsonSchema` narrower than
        production's is attached to `saison_teams` for this test alone and refuses group A. The swap then
        writes Alpha into B — which the validator allows — and is refused on Beta into A, exactly one
        write into a transaction that has already changed a row.

        What that stands in for is every way a second write fails for real: a write conflict, a primary
        stepping down, the process dying. The abort path is the same for all of them, so proving it once
        at a refusal proves the property, and a validator is the only one of them a test can cause on
        purpose.
        """

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            await database.command(
                "collMod",
                Collection.SAISON_TEAMS.value,
                validator={"$jsonSchema": {"bsonType": "object", "properties": {"gruppe": {"enum": ["B", "C", "D"]}}}},
                validationLevel="strict",
            )

            with pytest.raises(OperationFailure) as failure:
                await call_swap(database, client, ALPHA, BETA)

            return failure.value.code, await gruppen_now(database)

        code, stored = on_a_seeded_season(mongo_replica_set_url, body)

        # Asserted on the CODE, so the test cannot pass because something else in the transaction failed
        # before either write — which would prove nothing about a rollback.
        assert code == DOCUMENT_VALIDATION_FAILED, f"expected the validator to refuse the second write, got code {code}"
        # The point of the whole endpoint: the FIRST write is gone as well, so no group is a club short.
        # The validator admits B, so Alpha reading A here can only mean that write was taken back.
        assert stored == {ALPHA: "A", BETA: "B"}


class TestTheRefusalsReadTheRealDocuments:
    def test_a_club_with_no_junction_row_is_refused(self, mongo_replica_set_url: str):
        """
        `REQ-SWAP-001` against a real read: the rule sees `None` only if the query actually finds nothing.

        The unit test hands the rule a `None`; this is what proves the handler produces one, which is a
        property of the `$in` filter and the projection rather than of the rule.
        """

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            with pytest.raises(DocumentConflictException) as refusal:
                await call_swap(database, client, ALPHA, OUTSIDER)
            return refusal.value.error_code, await gruppen_now(database)

        code, stored = on_a_seeded_season(mongo_replica_set_url, body)

        assert code == SWAP_NOT_A_SWAP
        assert stored == {ALPHA: "A", BETA: "B"}, "a refused swap wrote something"

    def test_a_played_knockout_fixture_closes_the_window(self, mongo_replica_set_url: str):
        """
        `REQ-SWAP-002` against a real count, which is where the filter can be wrong while the rule is right.

        Two fixtures are seeded and only one carries a result, so a filter that forgot `ergebnis` would
        still refuse — and the count in the message is what separates the two.
        """

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            with pytest.raises(DocumentConflictException) as refusal:
                await call_swap(database, client, ALPHA, BETA)
            return refusal.value.error_code, refusal.value.error_detail["message"], await gruppen_now(database)

        code, message, stored = on_a_seeded_season(
            mongo_replica_set_url,
            body,
            spiele=[knockout_fixture(ergebnis="2:1"), knockout_fixture(ergebnis=None)],
        )

        assert code == SWAP_KNOCKOUT_STARTED
        assert "1 knockout fixture" in message, f"the unplayed fixture was counted too: {message}"
        assert stored == {ALPHA: "A", BETA: "B"}

    def test_a_group_fixture_with_a_result_leaves_the_window_open(self, mongo_replica_set_url: str):
        """
        The half a phase-blind count would get wrong: a played GROUP match is the ordinary running season.

        This is the case the rule exists to permit — a swap is worth having precisely while the group
        phase is under way — so a filter that counted every result would refuse every real swap.
        """

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            await call_swap(database, client, ALPHA, BETA)
            return await gruppen_now(database)

        stored = on_a_seeded_season(
            mongo_replica_set_url,
            body,
            spiele=[{"saison_id": SAISON_ID, "saison_phase": "gruppenphase", "ergebnis": "3:0"}],
        )

        assert stored == {ALPHA: "B", BETA: "A"}
