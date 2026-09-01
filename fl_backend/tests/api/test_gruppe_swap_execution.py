from typing import Any, Awaitable, Callable

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo.errors import OperationFailure

from app.api.saisons.admin_router import swap_gruppen
from app.api.saisons.schemas import FLSwapGruppenPayload
from app.api.spiele.schemas import SONDEREREIGNIS_PRODUCING_A_RECORD, SONDEREREIGNIS_WITHOUT_A_RESULT
from app.api.teams.services import (
    SWAP_FIELDS_DISQUALIFIED,
    SWAP_GRUPPENPHASE_PLAYED,
    SWAP_KNOCKOUT_STARTED,
    SWAP_NOT_A_SWAP,
    SWAP_SAISON_FINISHED,
    SWAP_SPIELTAG_CLASH,
)
from app.core.collections import Collection
from app.core.exceptions import DocumentConflictException
from tests.database import a_clean_database, on_the_seed_loop

pytestmark = pytest.mark.db

DATABASE_NAME = "fl_swap_test"

# Named rather than caught broadly: another failure must not read as the rollback this suite proves.
DOCUMENT_VALIDATION_FAILED = 121

SAISON_ID = "2026"
# Fixed rather than generated, so a failure names the same club every run.
ALPHA = ObjectId("6890a1b2c3d4e5f607210001")
BETA = ObjectId("6890a1b2c3d4e5f607210002")
OUTSIDER = ObjectId("6890a1b2c3d4e5f607210003")

# Group-mates: a rewritten fixture keeps an opponent that stays put, so the exchange shows on one side.
ALPHA_RIVAL = ObjectId("6890a1b2c3d4e5f60721000a")
BETA_RIVAL = ObjectId("6890a1b2c3d4e5f60721000b")

NAMES = {
    ALPHA: ("Alpha", "AL"),
    BETA: ("Beta", "BE"),
    ALPHA_RIVAL: ("Alpha-Rival", "AR"),
    BETA_RIVAL: ("Beta-Rival", "BR"),
}


def junction(team_id: ObjectId, gruppe: str) -> dict[str, Any]:
    """A dict rather than a model: `saison_teams` has no model of the row."""

    return {"saison_id": SAISON_ID, "team_id": team_id, "gruppe": gruppe, "austritt": None}


# Only `datum` decides `REQ-SWAP-006`; the type and the reason are what a surface reports.
AUSTRITT = {"type": "disqualifikation", "grund": "Regelverstoss", "datum": "2026-04-01"}
# A day after `AUSTRITT`, so the date half is satisfied and the EVENT is what each case turns on.
AFTER_THE_EXIT = "2026-05-01"


async def record_an_austritt(database: AsyncIOMotorDatabase, team_id: ObjectId) -> None:
    await database[Collection.SAISON_TEAMS].update_one({"saison_id": SAISON_ID, "team_id": team_id}, {"$set": {"austritt": AUSTRITT}})


def club(team_id: ObjectId) -> dict[str, Any]:
    """Only what the rewrite projects: it composes a side's `name` and `shorthand` from `teams`, not from the season's junction row."""

    name, shorthand = NAMES[team_id]

    return {"_id": team_id, "name": name, "shorthand": shorthand}


def side(team_id: ObjectId, tore: int | None = None) -> dict[str, Any]:
    name, shorthand = NAMES[team_id]

    return {"team_id": team_id, "name": name, "shorthand": shorthand, "tore": tore}


# Sharing one matchday is what makes a `REQ-SWAP-005` clash reachable; the second is for cases needing two.
SPIELTAG = ObjectId("6890a1b2c3d4e5f6072100ff")
OTHER_SPIELTAG = ObjectId("6890a1b2c3d4e5f6072100fe")


def gruppen_fixture(
    spiel_nr: int,
    home: ObjectId,
    away: ObjectId,
    *,
    ergebnis: str | None = None,
    sonderereignis: str | None = None,
    tore: tuple[int | None, int | None] = (None, None),
    spieltag_id: ObjectId = SPIELTAG,
    datum: str | None = None,
) -> dict[str, Any]:
    return {
        "saison_id": SAISON_ID,
        "saison_phase": "gruppenphase",
        "spiel_nr": spiel_nr,
        "spieltag_id": spieltag_id,
        # Null rather than absent, which is what a drawn fixture stores until somebody schedules it.
        "datum": datum,
        "team1": side(home, tore[0]),
        "team2": side(away, tore[1]),
        "ergebnis": ergebnis,
        "sonderereignis": sonderereignis,
    }


def knockout_fixture(*, ergebnis: str | None, sonderereignis: str | None = None, spieltag_id: ObjectId | None = None) -> dict[str, Any]:
    """`spieltag_id` is absent rather than null when none is given — the state `_spieltag_clashes` skips."""

    fixture = {"saison_id": SAISON_ID, "saison_phase": "viertelfinale", "ergebnis": ergebnis, "sonderereignis": sonderereignis}

    return fixture if spieltag_id is None else {**fixture, "spieltag_id": spieltag_id}


Body = Callable[[AsyncIOMotorDatabase, AsyncIOMotorClient], Awaitable[Any]]


def on_a_seeded_season(
    url: str,
    body: Body,
    *,
    spiele: list[dict[str, Any]] | None = None,
    saison_status: str = "active",
    mutates_schema: bool = False,
) -> Any:
    """`spiele` by hand, a transaction being unable to create a collection.

    `mutates_schema=True` where the body attaches a validator: `tests/database.py` then keeps the
    change off every later test.
    """

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, collections=(Collection.SPIELE,), mutates_schema=mutates_schema) as (client, database):
            await database[Collection.SAISONS].insert_one({"_id": SAISON_ID, "status": saison_status})
            await database[Collection.SAISON_TEAMS].insert_many(
                [junction(ALPHA, "A"), junction(ALPHA_RIVAL, "A"), junction(BETA, "B"), junction(BETA_RIVAL, "B")]
            )
            await database[Collection.TEAMS].insert_many([club(team_id) for team_id in NAMES])
            if spiele:
                await database[Collection.SPIELE].insert_many(spiele)

            return await body(database, client)

    return on_the_seed_loop(_run())


async def call_swap(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient, team1_id: ObjectId, team2_id: ObjectId) -> Any:
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
    """Read outside any transaction — what a later request would see."""

    rows = await database[Collection.SAISON_TEAMS].find({"saison_id": SAISON_ID}).to_list(length=None)

    return {row["team_id"]: row["gruppe"] for row in rows}


async def sides_now(database: AsyncIOMotorDatabase) -> dict[int, tuple[ObjectId | None, ObjectId | None]]:
    rows = await database[Collection.SPIELE].find({"saison_id": SAISON_ID}).to_list(length=None)

    return {row["spiel_nr"]: ((row["team1"] or {}).get("team_id"), (row["team2"] or {}).get("team_id")) for row in rows if "spiel_nr" in row}


async def spiele_now(database: AsyncIOMotorDatabase) -> dict[int, dict[str, Any]]:
    rows = await database[Collection.SPIELE].find({"saison_id": SAISON_ID}).to_list(length=None)

    return {row["spiel_nr"]: row for row in rows if "spiel_nr" in row}


# Each drawn against their own group's rival, neither played — the state `REQ-SWAP-004` leaves open.
DRAWN_ROUND_ROBIN = [gruppen_fixture(1, ALPHA, ALPHA_RIVAL), gruppen_fixture(2, BETA_RIVAL, BETA)]


class TestASwapCommitsBothRows:
    def test_the_two_clubs_end_in_each_others_groups(self, mongo_replica_set_url: str):
        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            response = await call_swap(database, client, ALPHA, BETA)
            return response, await gruppen_now(database)

        response, stored = on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN))

        assert stored == {ALPHA: "B", ALPHA_RIVAL: "A", BETA: "A", BETA_RIVAL: "B"}
        # The echo comes from the object the writes did, so it cannot describe another swap.
        assert (response.team1_id, response.team1_gruppe) == (ALPHA, "B")
        assert (response.team2_id, response.team2_gruppe) == (BETA, "A")

    def test_swapping_back_restores_the_season(self, mongo_replica_set_url: str):
        """The fixture assertion is the point: a rewrite over the clubs rather than a snapshot would swap a side twice, back to the start."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            await call_swap(database, client, ALPHA, BETA)
            await call_swap(database, client, BETA, ALPHA)
            return await gruppen_now(database), await sides_now(database)

        stored, sides = on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN))

        assert stored == {ALPHA: "A", ALPHA_RIVAL: "A", BETA: "B", BETA_RIVAL: "B"}
        assert sides == {1: (ALPHA, ALPHA_RIVAL), 2: (BETA_RIVAL, BETA)}


class TestTheDrawnFixturesMoveWithTheClubs:
    def test_each_club_takes_over_the_others_fixtures(self, mongo_replica_set_url: str):
        """Both slots: a rewrite handling one would leave the other naming a club that has left."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            response = await call_swap(database, client, ALPHA, BETA)
            return response.rewritten_spiele, await sides_now(database)

        rewritten, sides = on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN))

        assert sides == {1: (BETA, ALPHA_RIVAL), 2: (BETA_RIVAL, ALPHA)}
        assert rewritten == 2

    def test_the_display_copies_move_with_the_id(self, mongo_replica_set_url: str):
        """Rewriting `team_id` alone is silent: every card shows the old club's name over the new club's fixture."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            await call_swap(database, client, ALPHA, BETA)
            return await spiele_now(database)

        spiele = on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN))

        assert spiele[1]["team1"] == {"team_id": BETA, "name": "Beta", "shorthand": "BE", "tore": None}
        assert spiele[2]["team2"] == {"team_id": ALPHA, "name": "Alpha", "shorthand": "AL", "tore": None}

    def test_the_opponent_and_the_slot_are_left_alone(self, mongo_replica_set_url: str):
        """The date, venue and matchday stay with the fixture, so each club inherits the other's schedule rather than carrying its own."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            before = await spiele_now(database)
            await call_swap(database, client, ALPHA, BETA)
            return before, await spiele_now(database)

        before, after = on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN))

        assert after[1]["team2"] == before[1]["team2"], "the opponent was rewritten"
        assert after[1]["spieltag_id"] == before[1]["spieltag_id"]
        assert after[2]["team1"] == before[2]["team1"], "the opponent was rewritten"

    def test_a_fixture_of_neither_club_is_untouched(self, mongo_replica_set_url: str):
        """A rewrite filtered on the season rather than on the two clubs passes every assertion above and fails this."""

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
        """A bracket side is the resolution's or an admin's pick — a statement about the club, not its group."""

        knockout = {**knockout_fixture(ergebnis=None), "spiel_nr": 9, "team1": side(ALPHA), "team2": None}

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            response = await call_swap(database, client, ALPHA, BETA)
            return response.rewritten_spiele, await sides_now(database)

        rewritten, sides = on_a_seeded_season(mongo_replica_set_url, body, spiele=[*DRAWN_ROUND_ROBIN, knockout])

        assert sides[9] == (ALPHA, None)
        assert rewritten == 2

    def test_a_fixture_between_the_two_clubs_exchanges_both_sides(self, mongo_replica_set_url: str):
        """Both clubs in one fixture: the passes are disjoint, and the count is of fixtures moved, not writes landed."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            response = await call_swap(database, client, ALPHA, BETA)
            return response.rewritten_spiele, await spiele_now(database)

        rewritten, spiele = on_a_seeded_season(mongo_replica_set_url, body, spiele=[gruppen_fixture(1, ALPHA, BETA)])

        assert spiele[1]["team1"] == {"team_id": BETA, "name": "Beta", "shorthand": "BE", "tore": None}
        assert spiele[1]["team2"] == {"team_id": ALPHA, "name": "Alpha", "shorthand": "AL", "tore": None}
        assert rewritten == 1, "one fixture fielding both clubs was counted twice"

    def test_a_club_with_no_drawn_fixture_leaves_the_other_unscheduled(self, mongo_replica_set_url: str):
        """Alpha arrives with nothing scheduled: the remaining draw is the admin's."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            response = await call_swap(database, client, ALPHA, BETA)
            return response.rewritten_spiele, await sides_now(database)

        rewritten, sides = on_a_seeded_season(mongo_replica_set_url, body, spiele=[gruppen_fixture(1, ALPHA, ALPHA_RIVAL)])

        assert sides == {1: (BETA, ALPHA_RIVAL)}
        assert rewritten == 1

    def test_no_club_is_fielded_twice_on_one_matchday(self, mongo_replica_set_url: str):
        """Group fixtures only; a mixed Spieltag is `REQ-SWAP-005`'s. The before count is asserted so an illegal seed cannot pass."""

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
        """A narrower `$jsonSchema` refuses group A, so the second write fails inside an already-changed transaction."""

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

        code, stored, sides = on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN), mutates_schema=True)

        # Asserted on the code, so this cannot pass because something else failed before either write.
        assert code == DOCUMENT_VALIDATION_FAILED, f"expected the validator to refuse the second write, got code {code}"
        # The validator admits B, so Alpha reading A can only mean the first write was taken back.
        assert stored == {ALPHA: "A", ALPHA_RIVAL: "A", BETA: "B", BETA_RIVAL: "B"}
        # The rewrite runs before either junction write, so it has stood longest when the abort arrives.
        assert sides == {1: (ALPHA, ALPHA_RIVAL), 2: (BETA_RIVAL, BETA)}, "the fixture rewrite survived a rolled-back swap"


class TestTheRefusalsReadTheRealDocuments:
    def test_a_club_with_no_junction_row_is_refused(self, mongo_replica_set_url: str):
        """The unit test hands the rule a `None`; this proves the handler produces one from its filter and projection."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            with pytest.raises(DocumentConflictException) as refusal:
                await call_swap(database, client, ALPHA, OUTSIDER)
            return refusal.value.error_code, await gruppen_now(database)

        code, stored = on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN))

        assert code == SWAP_NOT_A_SWAP
        assert stored[ALPHA] == "A" and stored[BETA] == "B", "a refused swap wrote something"

    def test_a_past_season_is_refused(self, mongo_replica_set_url: str):
        """Nothing has been played, so the season being over is the only thing refusing this."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            with pytest.raises(DocumentConflictException) as refusal:
                await call_swap(database, client, ALPHA, BETA)
            return refusal.value.error_code, await sides_now(database)

        code, sides = on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN), saison_status="past")

        assert code == SWAP_SAISON_FINISHED
        assert sides == {1: (ALPHA, ALPHA_RIVAL), 2: (BETA_RIVAL, BETA)}, "a refused swap rewrote a fixture"

    def test_a_played_knockout_fixture_closes_the_window(self, mongo_replica_set_url: str):
        """Two fixtures seeded and one taken place: a filter matching every knockout document would still refuse."""

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

    @pytest.mark.parametrize("sonderereignis", SONDEREREIGNIS_PRODUCING_A_RECORD)
    def test_a_knockout_fixture_that_left_a_record_closes_the_window_too(self, mongo_replica_set_url: str, sonderereignis: str):
        """An abandonment and a no-show each happened, so the bracket already stands on these groups even with no `ergebnis`."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            with pytest.raises(DocumentConflictException) as refusal:
                await call_swap(database, client, ALPHA, BETA)
            return refusal.value.error_code

        code = on_a_seeded_season(
            mongo_replica_set_url,
            body,
            spiele=[*DRAWN_ROUND_ROBIN, knockout_fixture(ergebnis=None, sonderereignis=sonderereignis)],
        )

        assert code == SWAP_KNOCKOUT_STARTED

    def test_a_knockout_fixture_called_off_before_it_happened_leaves_it_open(self, mongo_replica_set_url: str):
        """The distinction the boolean hid: nothing took place, so there is no history the exchange would rewrite."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            await call_swap(database, client, ALPHA, BETA)
            return await gruppen_now(database)

        stored = on_a_seeded_season(
            mongo_replica_set_url,
            body,
            spiele=[*DRAWN_ROUND_ROBIN, knockout_fixture(ergebnis=None, sonderereignis="ausgefallen")],
        )

        assert stored[ALPHA] == "B" and stored[BETA] == "A"

    def test_a_knockout_fixture_still_to_be_played_leaves_it_open(self, mongo_replica_set_url: str):
        """A drawn bracket is not a begun one: a count over every knockout document would close the window early."""

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
        """The damage: Alpha would carry group A's points into group B's table, because the statistics never read a group."""

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

    @pytest.mark.parametrize("sonderereignis", SONDEREREIGNIS_PRODUCING_A_RECORD)
    def test_a_group_fixture_that_left_a_record_closes_the_window_too(self, mongo_replica_set_url: str, sonderereignis: str):
        """A no-show is a forfeit and an abandonment is a match that happened; either is a round-robin entry Alpha would carry away."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            with pytest.raises(DocumentConflictException) as refusal:
                await call_swap(database, client, ALPHA, BETA)
            return refusal.value.error_code

        code = on_a_seeded_season(
            mongo_replica_set_url,
            body,
            spiele=[gruppen_fixture(1, ALPHA, ALPHA_RIVAL, sonderereignis=sonderereignis), gruppen_fixture(2, BETA_RIVAL, BETA)],
        )

        assert code == SWAP_GRUPPENPHASE_PLAYED

    @pytest.mark.parametrize("sonderereignis", ["ausgefallen", "annulliert"])
    def test_a_group_fixture_that_left_no_record_leaves_the_window_open(self, mongo_replica_set_url: str, sonderereignis: str):
        """The distinction the boolean hid: neither club took part, so both sides are still free to move."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            await call_swap(database, client, ALPHA, BETA)
            return await gruppen_now(database)

        stored = on_a_seeded_season(
            mongo_replica_set_url,
            body,
            spiele=[gruppen_fixture(1, ALPHA, ALPHA_RIVAL, sonderereignis=sonderereignis), gruppen_fixture(2, BETA_RIVAL, BETA)],
        )

        assert stored[ALPHA] == "B" and stored[BETA] == "A"

    def test_a_group_fixture_holding_one_goal_count_closes_the_window(self, mongo_replica_set_url: str):
        """Reachable because `apply_payload_to_spiel` strips goals only where a side is absent; the rewrite would leave them for Beta."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            with pytest.raises(DocumentConflictException) as refusal:
                await call_swap(database, client, ALPHA, BETA)
            return refusal.value.error_code, await spiele_now(database)

        code, spiele = on_a_seeded_season(
            mongo_replica_set_url,
            body,
            spiele=[gruppen_fixture(1, ALPHA, ALPHA_RIVAL, tore=(3, None)), gruppen_fixture(2, BETA_RIVAL, BETA)],
        )

        assert code == SWAP_GRUPPENPHASE_PLAYED
        # Read back rather than trusted: a seed the database rewrote would be a different state.
        assert (spiele[1]["ergebnis"], spiele[1]["team1"]["tore"], spiele[1]["team2"]["tore"]) == (None, 3, None)
        assert spiele[1]["team1"]["team_id"] == ALPHA, "a refused swap rewrote the side holding the goals"

    def test_a_knockout_fixture_holding_one_goal_count_closes_the_window_too(self, mongo_replica_set_url: str):
        """A count against a bracket fixture says it was played."""

        scored_knockout = {**knockout_fixture(ergebnis=None), "spiel_nr": 9, "team1": side(ALPHA_RIVAL, 2), "team2": side(BETA_RIVAL)}

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            with pytest.raises(DocumentConflictException) as refusal:
                await call_swap(database, client, ALPHA, BETA)
            return refusal.value.error_code

        code = on_a_seeded_season(mongo_replica_set_url, body, spiele=[*DRAWN_ROUND_ROBIN, scored_knockout])

        assert code == SWAP_KNOCKOUT_STARTED

    def test_a_swap_that_would_field_a_club_twice_on_one_matchday_is_refused(self, mongo_replica_set_url: str):
        """`REQ-SWAP-005`: the rewrite moves group sides only, so Alpha takes Beta's fixture and stands twice — what a swap could bypass."""

        manual_pick = {**knockout_fixture(ergebnis=None, spieltag_id=SPIELTAG), "spiel_nr": 9, "team1": side(ALPHA), "team2": None}

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            with pytest.raises(DocumentConflictException) as refusal:
                await call_swap(database, client, ALPHA, BETA)
            return refusal.value.error_code, await gruppen_now(database), await sides_now(database)

        code, stored, sides = on_a_seeded_season(
            mongo_replica_set_url,
            body,
            spiele=[
                gruppen_fixture(1, ALPHA, ALPHA_RIVAL, spieltag_id=OTHER_SPIELTAG),
                gruppen_fixture(2, BETA_RIVAL, BETA, spieltag_id=SPIELTAG),
                manual_pick,
            ],
        )

        assert code == SWAP_SPIELTAG_CLASH
        assert stored[ALPHA] == "A" and stored[BETA] == "B", "a refused swap moved a junction row"
        assert sides[2] == (BETA_RIVAL, BETA), "a refused swap rewrote a fixture"

    def test_the_same_bracket_pick_on_its_own_matchday_leaves_it_open(self, mongo_replica_set_url: str):
        """Identical but for the bracket fixture's matchday: a guard not keying by Spieltag would refuse most swaps."""

        manual_pick = {
            **knockout_fixture(ergebnis=None, spieltag_id=OTHER_SPIELTAG),
            "spiel_nr": 9,
            "team1": side(ALPHA),
            "team2": None,
        }

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            await call_swap(database, client, ALPHA, BETA)
            return await gruppen_now(database), await sides_now(database)

        stored, sides = on_a_seeded_season(
            mongo_replica_set_url,
            body,
            spiele=[
                gruppen_fixture(1, ALPHA, ALPHA_RIVAL, spieltag_id=SPIELTAG),
                gruppen_fixture(2, BETA_RIVAL, BETA, spieltag_id=SPIELTAG),
                manual_pick,
            ],
        )

        assert stored[ALPHA] == "B" and stored[BETA] == "A"
        assert sides[9] == (ALPHA, None), "the bracket side was rewritten"

    def test_a_matchday_already_holding_a_club_twice_does_not_refuse_the_swap(self, mongo_replica_set_url: str):
        """Only a Spieltag the exchange breaks is counted: the stored breach here is one the swap in fact resolves."""

        manual_pick = {**knockout_fixture(ergebnis=None, spieltag_id=SPIELTAG), "spiel_nr": 9, "team1": side(ALPHA), "team2": None}

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            await call_swap(database, client, ALPHA, BETA)
            return await gruppen_now(database), await sides_now(database)

        stored, sides = on_a_seeded_season(
            mongo_replica_set_url,
            body,
            spiele=[
                gruppen_fixture(1, ALPHA, ALPHA_RIVAL, spieltag_id=SPIELTAG),
                gruppen_fixture(2, BETA_RIVAL, BETA, spieltag_id=OTHER_SPIELTAG),
                manual_pick,
            ],
        )

        assert stored[ALPHA] == "B" and stored[BETA] == "A"
        assert sides[1] == (BETA, ALPHA_RIVAL), "the fixture that made the matchday legal again did not move"

    def test_a_played_group_fixture_between_two_other_clubs_leaves_it_open(self, mongo_replica_set_url: str):
        """`REQ-SWAP-004` is about the two clubs' own participation: a count over the whole phase would refuse every swap."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            await call_swap(database, client, ALPHA, BETA)
            return await gruppen_now(database)

        stored = on_a_seeded_season(
            mongo_replica_set_url,
            body,
            spiele=[*DRAWN_ROUND_ROBIN, gruppen_fixture(3, ALPHA_RIVAL, BETA_RIVAL, ergebnis="1:1", tore=(1, 1))],
        )

        assert stored[ALPHA] == "B" and stored[BETA] == "A"

    def test_a_swap_landing_a_departed_club_on_a_later_fixture_is_refused(self, mongo_replica_set_url: str):
        """`REQ-SWAP-006` against real documents: the junction read supplies the exit day and the projection the fixture's date."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            await record_an_austritt(database, ALPHA)
            with pytest.raises(DocumentConflictException) as refusal:
                await call_swap(database, client, ALPHA, BETA)
            return refusal.value.error_code, await gruppen_now(database), await sides_now(database)

        code, stored, sides = on_a_seeded_season(
            mongo_replica_set_url,
            body,
            spiele=[
                gruppen_fixture(1, ALPHA, ALPHA_RIVAL, datum=AFTER_THE_EXIT),
                gruppen_fixture(2, BETA_RIVAL, BETA, datum=AFTER_THE_EXIT),
            ],
        )

        assert code == SWAP_FIELDS_DISQUALIFIED
        assert stored[ALPHA] == "A" and stored[BETA] == "B", "a refused swap moved a junction row"
        assert sides == {1: (ALPHA, ALPHA_RIVAL), 2: (BETA_RIVAL, BETA)}, "a refused swap rewrote a fixture"

    @pytest.mark.parametrize("sonderereignis", SONDEREREIGNIS_WITHOUT_A_RESULT)
    def test_a_fixture_awarding_nothing_takes_a_departed_club_anyway(self, mongo_replica_set_url: str, sonderereignis: str):
        """The case above but for the event: `REQ-SWAP-004` leaves these two open, so refusing here would make one page disagree with itself."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            await record_an_austritt(database, ALPHA)
            await call_swap(database, client, ALPHA, BETA)
            return await gruppen_now(database), await sides_now(database)

        stored, sides = on_a_seeded_season(
            mongo_replica_set_url,
            body,
            spiele=[
                gruppen_fixture(1, ALPHA, ALPHA_RIVAL, datum=AFTER_THE_EXIT),
                gruppen_fixture(2, BETA_RIVAL, BETA, datum=AFTER_THE_EXIT, sonderereignis=sonderereignis),
            ],
        )

        assert stored[ALPHA] == "B" and stored[BETA] == "A"
        assert sides == {1: (BETA, ALPHA_RIVAL), 2: (BETA_RIVAL, ALPHA)}
