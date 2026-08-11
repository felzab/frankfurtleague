"""
SAISONS · the group swap against a real MongoDB (ADR-0062, ADR-0023)

The claims about `swap_gruppen` that no unit test can make: both `saison_teams` rows move together
with every fixture the two clubs are drawn into, or none of them moves.
`test_gruppe_swap_refusal.py` proves what the rule decides; this proves what the database does with
the decision, and the two are different failures — the rule can be right while the write leaves one
group a club short, or leaves a club scheduled against the group it left.

Every test is marked `db` and runs against the single-node replica set in `tests/conftest.py`,
because a standalone `mongod` refuses a transaction outright.

Invariants:
- The handler is called directly: its parameters are plain types, so no HTTP client is needed.
- The mid-flight failure is the database's own validator, never a patched production symbol.
- A rewritten side takes `team_id`, `name` and `shorthand`; `tore` stays with the fixture.
"""

import asyncio
from typing import Any, Awaitable, Callable

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo.errors import OperationFailure

from app.api.saisons.admin_router import swap_gruppen
from app.api.saisons.schemas import FLSwapGruppenPayload
from app.api.teams.services import SWAP_GRUPPENPHASE_PLAYED, SWAP_KNOCKOUT_STARTED, SWAP_NOT_A_SWAP, SWAP_SAISON_FINISHED
from app.core.collections import Collection
from app.core.exceptions import DocumentConflictException

pytestmark = pytest.mark.db

DATABASE_NAME = "fl_swap_test"

# The server's code for "this write failed the collection's validator", which
# `test_constraints_execution.py` also asserts on. Named rather than caught broadly, so a transaction
# failing for another reason cannot read as the rollback this suite proves.
DOCUMENT_VALIDATION_FAILED = 121

SAISON_ID = "2026"
# Fixed rather than generated, so a failure names the same club every run.
ALPHA = ObjectId("6890a1b2c3d4e5f607210001")
BETA = ObjectId("6890a1b2c3d4e5f607210002")
OUTSIDER = ObjectId("6890a1b2c3d4e5f607210003")

# Alpha's group-mate and Beta's, so a rewritten fixture has an opponent that does NOT move and the
# exchange is visible as a change to one side rather than to the whole document.
ALPHA_RIVAL = ObjectId("6890a1b2c3d4e5f60721000a")
BETA_RIVAL = ObjectId("6890a1b2c3d4e5f60721000b")

NAMES = {
    ALPHA: ("Alpha", "AL"),
    BETA: ("Beta", "BE"),
    ALPHA_RIVAL: ("Alpha-Rival", "AR"),
    BETA_RIVAL: ("Beta-Rival", "BR"),
}


def junction(team_id: ObjectId, gruppe: str) -> dict[str, Any]:
    """One `saison_teams` row. A dict rather than a model: this junction has no model of the row."""

    return {"saison_id": SAISON_ID, "team_id": team_id, "gruppe": gruppe, "disqualifikation": None}


def club(team_id: ObjectId) -> dict[str, Any]:
    """
    One `teams` document, carrying only the two fields the rewrite reads from it.

    Those two are where `PATCH /teams/{team_id}` fans the display copies out FROM (ADR-0021 rule 3), so
    a rewrite sourcing them anywhere else would be copying a copy.
    """

    name, shorthand = NAMES[team_id]

    return {"_id": team_id, "name": name, "shorthand": shorthand}


def side(team_id: ObjectId, tore: int | None = None) -> dict[str, Any]:
    """One embedded team field, in the shape `spiele` stores (ADR-0021)."""

    name, shorthand = NAMES[team_id]

    return {"team_id": team_id, "name": name, "shorthand": shorthand, "tore": tore}


def gruppen_fixture(
    spiel_nr: int,
    home: ObjectId,
    away: ObjectId,
    *,
    ergebnis: str | None = None,
    is_canceled: bool = False,
    tore: tuple[int | None, int | None] = (None, None),
) -> dict[str, Any]:
    """One Gruppenphase fixture between two clubs, unplayed unless told otherwise."""

    return {
        "saison_id": SAISON_ID,
        "saison_phase": "gruppenphase",
        "spiel_nr": spiel_nr,
        "spieltag_id": ObjectId("6890a1b2c3d4e5f6072100ff"),
        "team1": side(home, tore[0]),
        "team2": side(away, tore[1]),
        "ergebnis": ergebnis,
        "is_canceled": is_canceled,
    }


def knockout_fixture(*, ergebnis: str | None, is_canceled: bool = False) -> dict[str, Any]:
    """
    A Viertelfinale fixture, with or without a result and with or without having been called off.

    Only the four fields the count reads are set. The rest of `FLSpiel` is beside the point here and
    seeding it would make this document look like something the endpoint validates, which it is not.
    """

    return {"saison_id": SAISON_ID, "saison_phase": "viertelfinale", "ergebnis": ergebnis, "is_canceled": is_canceled}


Body = Callable[[AsyncIOMotorDatabase, AsyncIOMotorClient], Awaitable[Any]]


def on_a_seeded_season(
    url: str,
    body: Body,
    *,
    spiele: list[dict[str, Any]] | None = None,
    saison_status: str = "active",
) -> Any:
    """
    Run `body` against a season holding Alpha and a rival in group A, Beta and a rival in B.

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

            await database[Collection.SAISONS].insert_one({"_id": SAISON_ID, "status": saison_status})
            await database[Collection.SAISON_TEAMS].insert_many(
                [junction(ALPHA, "A"), junction(ALPHA_RIVAL, "A"), junction(BETA, "B"), junction(BETA_RIVAL, "B")]
            )
            await database[Collection.TEAMS].insert_many([club(team_id) for team_id in NAMES])
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
        teams_collection=database[Collection.TEAMS],
        db=client,
    )


async def gruppen_now(database: AsyncIOMotorDatabase) -> dict[ObjectId, str]:
    """Each club's stored group, read outside any transaction — what a later request would see."""

    rows = await database[Collection.SAISON_TEAMS].find({"saison_id": SAISON_ID}).to_list(length=None)

    return {row["team_id"]: row["gruppe"] for row in rows}


async def sides_now(database: AsyncIOMotorDatabase) -> dict[int, tuple[ObjectId | None, ObjectId | None]]:
    """Who each fixture fields, by `spiel_nr` — the half of the swap the junction rows do not carry."""

    rows = await database[Collection.SPIELE].find({"saison_id": SAISON_ID}).to_list(length=None)

    return {row["spiel_nr"]: ((row["team1"] or {}).get("team_id"), (row["team2"] or {}).get("team_id")) for row in rows if "spiel_nr" in row}


async def spiele_now(database: AsyncIOMotorDatabase) -> dict[int, dict[str, Any]]:
    """Every seeded fixture whole, by `spiel_nr`, for the assertions that read a side's other keys."""

    rows = await database[Collection.SPIELE].find({"saison_id": SAISON_ID}).to_list(length=None)

    return {row["spiel_nr"]: row for row in rows if "spiel_nr" in row}


# Alpha and Beta each drawn against their own group's rival, neither played. The state every swap this
# suite performs starts from, and the one `REQ-SWAP-004` leaves open.
DRAWN_ROUND_ROBIN = [gruppen_fixture(1, ALPHA, ALPHA_RIVAL), gruppen_fixture(2, BETA_RIVAL, BETA)]


class TestASwapCommitsBothRows:
    def test_the_two_clubs_end_in_each_others_groups(self, mongo_replica_set_url: str):
        """The whole operation, end to end: what is stored after a swap is the exchange and nothing else."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            response = await call_swap(database, client, ALPHA, BETA)
            return response, await gruppen_now(database)

        response, stored = on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN))

        assert stored == {ALPHA: "B", ALPHA_RIVAL: "A", BETA: "A", BETA_RIVAL: "B"}
        # The echo is the same object the writes were taken from, so this also pins that it cannot
        # describe a swap other than the one that landed.
        assert (response.team1_id, response.team1_gruppe) == (ALPHA, "B")
        assert (response.team2_id, response.team2_gruppe) == (BETA, "A")

    def test_swapping_back_restores_the_season(self, mongo_replica_set_url: str):
        """
        A swap is its own inverse, which is what makes it safe to offer without an undo window.

        Asserted rather than assumed: the handler reads each club's target off the OTHER row, so a
        version that read its own would pass the test above and fail this one. The fixtures are asserted
        too — a rewrite expressed as two updates over the clubs rather than over a snapshot would swap a
        side and swap it straight back, and would pass this test on the junction rows alone.
        """

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            await call_swap(database, client, ALPHA, BETA)
            await call_swap(database, client, BETA, ALPHA)
            return await gruppen_now(database), await sides_now(database)

        stored, sides = on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN))

        assert stored == {ALPHA: "A", ALPHA_RIVAL: "A", BETA: "B", BETA_RIVAL: "B"}
        assert sides == {1: (ALPHA, ALPHA_RIVAL), 2: (BETA_RIVAL, BETA)}


class TestTheDrawnFixturesMoveWithTheClubs:
    """The second half of the write (ADR-0062): each club inherits the fixtures the other was drawn into."""

    def test_each_club_takes_over_the_others_fixtures(self, mongo_replica_set_url: str):
        """
        The rule read literally — as if the one club had become the other.

        Both slots are exercised: Alpha stands in `team1` of its fixture and Beta in `team2` of its own,
        so a rewrite that handled one slot would leave the other naming a club that has left the group.
        """

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            response = await call_swap(database, client, ALPHA, BETA)
            return response.rewritten_spiele, await sides_now(database)

        rewritten, sides = on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN))

        assert sides == {1: (BETA, ALPHA_RIVAL), 2: (BETA_RIVAL, ALPHA)}
        assert rewritten == 2

    def test_the_display_copies_move_with_the_id(self, mongo_replica_set_url: str):
        """
        A side carries three copies of the club and all three have to agree (ADR-0021 rule 3).

        Rewriting `team_id` alone is the failure this catches, and it is silent: every card would show
        the old club's name over the new club's fixture, and nothing in the type system objects.
        """

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            await call_swap(database, client, ALPHA, BETA)
            return await spiele_now(database)

        spiele = on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN))

        assert spiele[1]["team1"] == {"team_id": BETA, "name": "Beta", "shorthand": "BE", "tore": None}
        assert spiele[2]["team2"] == {"team_id": ALPHA, "name": "Alpha", "shorthand": "AL", "tore": None}

    def test_the_opponent_and_the_slot_are_left_alone(self, mongo_replica_set_url: str):
        """
        Only the moving club's side is written, which is what keeps each fixture its own.

        The date, the venue and the matchday stay with the fixture, so each club inherits the other's
        schedule rather than carrying its own across — the literal reading of the rule, and the one the
        ADR records as a consequence.
        """

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            before = await spiele_now(database)
            await call_swap(database, client, ALPHA, BETA)
            return before, await spiele_now(database)

        before, after = on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN))

        assert after[1]["team2"] == before[1]["team2"], "the opponent was rewritten"
        assert after[1]["spieltag_id"] == before[1]["spieltag_id"]
        assert after[2]["team1"] == before[2]["team1"], "the opponent was rewritten"

    def test_a_fixture_of_neither_club_is_untouched(self, mongo_replica_set_url: str):
        """
        The two rivals play each other, and that fixture is nobody's business here.

        A rewrite filtered on the season rather than on the two clubs would still pass every assertion
        above; this is the one it fails.
        """

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            response = await call_swap(database, client, ALPHA, BETA)
            return response.rewritten_spiele, await sides_now(database)

        rewritten, sides = on_a_seeded_season(
            mongo_replica_set_url,
            body,
            spiele=[*DRAWN_ROUND_ROBIN, gruppen_fixture(3, ALPHA_RIVAL, BETA_RIVAL)],
        )

        assert sides[3] == (ALPHA_RIVAL, BETA_RIVAL)
        assert rewritten == 2, "a fixture fielding neither club was rewritten"

    def test_a_knockout_fixture_naming_a_club_is_untouched(self, mongo_replica_set_url: str):
        """
        The rewrite is the group phase's, and a bracket slot is not a group fixture.

        A knockout side is either the resolution's, which re-derives it from the standing on the next
        pass (ADR-0034), or an admin's own manual pick, which is a statement about that club rather than
        about its group. Neither is something a group swap may rewrite.
        """

        knockout = {**knockout_fixture(ergebnis=None), "spiel_nr": 9, "team1": side(ALPHA), "team2": None}

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            response = await call_swap(database, client, ALPHA, BETA)
            return response.rewritten_spiele, await sides_now(database)

        rewritten, sides = on_a_seeded_season(mongo_replica_set_url, body, spiele=[*DRAWN_ROUND_ROBIN, knockout])

        assert sides[9] == (ALPHA, None)
        assert rewritten == 2

    def test_a_club_with_no_drawn_fixture_leaves_the_other_unscheduled(self, mongo_replica_set_url: str):
        """
        The asymmetric case, asserted because it is a real outcome rather than an oversight.

        Only Alpha is drawn into anything, so Beta inherits that fixture and Alpha arrives in group B
        with nothing scheduled. That is what the rule produces and there is nothing to invent in its
        place — the season's remaining draw is the admin's to make.
        """

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            response = await call_swap(database, client, ALPHA, BETA)
            return response.rewritten_spiele, await sides_now(database)

        rewritten, sides = on_a_seeded_season(mongo_replica_set_url, body, spiele=[gruppen_fixture(1, ALPHA, ALPHA_RIVAL)])

        assert sides == {1: (BETA, ALPHA_RIVAL)}
        assert rewritten == 1

    def test_no_club_is_fielded_twice_on_one_matchday(self, mongo_replica_set_url: str):
        """
        ADR-0042's occupancy invariant survives the rewrite, which follows from it being a bijection.

        Each club's count on a given matchday becomes exactly what the other's was, and both were at
        most one — so both still are. Both fixtures share a `spieltag_id`, which is the arrangement
        where a rewrite moving one club without moving the other would put a club in two matches of one
        matchday. The count BEFORE is asserted too, so a seed that was already illegal cannot make this
        pass by having nothing left to break.
        """

        async def occupancy(database: AsyncIOMotorDatabase) -> int:
            """The most matches any one club is fielded in on a single matchday."""

            rows = await database[Collection.SPIELE].find({"saison_id": SAISON_ID}).to_list(length=None)
            counts: dict[tuple[Any, Any], int] = {}
            for row in rows:
                for slot in ("team1", "team2"):
                    occupant = (row.get(slot) or {}).get("team_id")
                    if occupant is not None:
                        key = (row["spieltag_id"], occupant)
                        counts[key] = counts.get(key, 0) + 1
            return max(counts.values(), default=0)

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            before = await occupancy(database)
            await call_swap(database, client, ALPHA, BETA)
            return before, await occupancy(database)

        before, after = on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN))

        assert before == 1, "the seeded season already fielded a club twice on one matchday"
        assert after == 1


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

            return failure.value.code, await gruppen_now(database), await sides_now(database)

        code, stored, sides = on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN))

        # Asserted on the CODE, so the test cannot pass because something else in the transaction failed
        # before either write — which would prove nothing about a rollback.
        assert code == DOCUMENT_VALIDATION_FAILED, f"expected the validator to refuse the second write, got code {code}"
        # The point of the whole endpoint: the FIRST write is gone as well, so no group is a club short.
        # The validator admits B, so Alpha reading A here can only mean that write was taken back.
        assert stored == {ALPHA: "A", ALPHA_RIVAL: "A", BETA: "B", BETA_RIVAL: "B"}
        # And the schedule with it. The rewrite runs BEFORE either junction write, so it has stood
        # longest when the abort arrives — and a half-rewritten schedule corrupts who plays whom.
        assert sides == {1: (ALPHA, ALPHA_RIVAL), 2: (BETA_RIVAL, BETA)}, "the fixture rewrite survived a rolled-back swap"


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

        code, stored = on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN))

        assert code == SWAP_NOT_A_SWAP
        assert stored[ALPHA] == "A" and stored[BETA] == "B", "a refused swap wrote something"

    def test_a_past_season_is_refused(self, mongo_replica_set_url: str):
        """
        `REQ-SWAP-003` against the stored `status`, which the handler reads inside its own transaction.

        Nothing has been played, so both windows inside the season are open — the season being over is
        the only thing refusing this, which is what makes it the rule under test rather than a bystander.
        """

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            with pytest.raises(DocumentConflictException) as refusal:
                await call_swap(database, client, ALPHA, BETA)
            return refusal.value.error_code, await sides_now(database)

        code, sides = on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN), saison_status="past")

        assert code == SWAP_SAISON_FINISHED
        assert sides == {1: (ALPHA, ALPHA_RIVAL), 2: (BETA_RIVAL, BETA)}, "a refused swap rewrote a fixture"

    def test_a_played_knockout_fixture_closes_the_window(self, mongo_replica_set_url: str):
        """
        `REQ-SWAP-002` against a real count, which is where the filter can be wrong while the rule is right.

        Two fixtures are seeded and only one has taken place, so a filter matching every knockout
        document would still refuse — and the count in the message is what separates the two.
        """

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            with pytest.raises(DocumentConflictException) as refusal:
                await call_swap(database, client, ALPHA, BETA)
            return refusal.value.error_code, refusal.value.error_detail["message"], await gruppen_now(database)

        code, message, stored = on_a_seeded_season(
            mongo_replica_set_url,
            body,
            spiele=[*DRAWN_ROUND_ROBIN, knockout_fixture(ergebnis="2:1"), knockout_fixture(ergebnis=None)],
        )

        assert code == SWAP_KNOCKOUT_STARTED
        assert "1 knockout fixture" in message, f"the fixture still to be played was counted too: {message}"
        assert stored[ALPHA] == "A" and stored[BETA] == "B"

    def test_a_called_off_knockout_fixture_closes_the_window_too(self, mongo_replica_set_url: str):
        """
        The same reading of "played" the group phase applies, on the other side of the bracket.

        A knockout slot is filled from a group placing before the match is played, so calling the match
        off does not un-fill it — the seeding was consumed either way, and the fixture is a forfeit
        rather than one that never happened. The two clubs have taken part in no round robin here, so
        `REQ-SWAP-004` does not cover this and the knockout window is what refuses it.
        """

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            with pytest.raises(DocumentConflictException) as refusal:
                await call_swap(database, client, ALPHA, BETA)
            return refusal.value.error_code

        code = on_a_seeded_season(
            mongo_replica_set_url,
            body,
            spiele=[*DRAWN_ROUND_ROBIN, knockout_fixture(ergebnis=None, is_canceled=True)],
        )

        assert code == SWAP_KNOCKOUT_STARTED

    def test_a_knockout_fixture_still_to_be_played_leaves_it_open(self, mongo_replica_set_url: str):
        """
        A drawn bracket is not a begun one, which is the whole reason this rule reads fixtures and not dates.

        A season with its knockout matchdays scheduled and nothing played in them is exactly when a swap
        is still worth making, so a count over every knockout document would close the window early.
        """

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            await call_swap(database, client, ALPHA, BETA)
            return await gruppen_now(database)

        stored = on_a_seeded_season(
            mongo_replica_set_url,
            body,
            spiele=[*DRAWN_ROUND_ROBIN, knockout_fixture(ergebnis=None)],
        )

        assert stored[ALPHA] == "B" and stored[BETA] == "A"

    def test_a_played_group_fixture_closes_the_window(self, mongo_replica_set_url: str):
        """
        `REQ-SWAP-004` against a real read: one result inside a round robin ends the swap for good.

        The damage this prevents is not a visibly broken season but a plausible wrong one. Alpha would
        carry the points it won in group A into group B's table, because the statistics never read a
        group — while `_spiele_by_gruppe` attributed its played fixtures to neither group and flagged
        nothing, since its fall-through marks only an unplayed fixture.
        """

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            with pytest.raises(DocumentConflictException) as refusal:
                await call_swap(database, client, ALPHA, BETA)
            return refusal.value.error_code, await sides_now(database)

        code, sides = on_a_seeded_season(
            mongo_replica_set_url,
            body,
            spiele=[gruppen_fixture(1, ALPHA, ALPHA_RIVAL, ergebnis="3:0", tore=(3, 0)), gruppen_fixture(2, BETA_RIVAL, BETA)],
        )

        assert code == SWAP_GRUPPENPHASE_PLAYED
        assert sides == {1: (ALPHA, ALPHA_RIVAL), 2: (BETA_RIVAL, BETA)}, "a refused swap rewrote a fixture"

    def test_a_called_off_group_fixture_closes_the_window_too(self, mongo_replica_set_url: str):
        """
        A cancellation counts as a real game played, which is the league's own reading of one.

        Every cancelled match in this competition so far has been a forfeit, and a forfeit is a result
        the round robin holds. So the club has taken part in its group whether or not the document ever
        gained an `ergebnis`, and the swap is as impossible as it is after a scoreline.
        """

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            with pytest.raises(DocumentConflictException) as refusal:
                await call_swap(database, client, ALPHA, BETA)
            return refusal.value.error_code

        code = on_a_seeded_season(
            mongo_replica_set_url,
            body,
            spiele=[gruppen_fixture(1, ALPHA, ALPHA_RIVAL, is_canceled=True), gruppen_fixture(2, BETA_RIVAL, BETA)],
        )

        assert code == SWAP_GRUPPENPHASE_PLAYED

    def test_a_played_group_fixture_between_two_other_clubs_leaves_it_open(self, mongo_replica_set_url: str):
        """
        The half a club-blind count would get wrong, and it is the ordinary running season.

        The two rivals have played each other; neither club being swapped has. `REQ-SWAP-004` is about
        the two clubs' own round-robin participation, so a count over the whole group phase would refuse
        every swap worth making.
        """

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            await call_swap(database, client, ALPHA, BETA)
            return await gruppen_now(database)

        stored = on_a_seeded_season(
            mongo_replica_set_url,
            body,
            spiele=[*DRAWN_ROUND_ROBIN, gruppen_fixture(3, ALPHA_RIVAL, BETA_RIVAL, ergebnis="1:1", tore=(1, 1))],
        )

        assert stored[ALPHA] == "B" and stored[BETA] == "A"
