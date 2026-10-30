from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.api.saisons.admin_router import swap_gruppen
from app.api.saisons.schemas import FLSwapGruppenPayload
from app.api.spiele.schemas import SONDEREREIGNIS_WITHOUT_A_RESULT
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError
from tests.database import DOCUMENT_VALIDATION_FAILED, a_clean_database, on_the_seed_loop
from tests.documents import saison_document, saison_team_document, spiel_document, team_document
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_swap_test")


SAISON_ID = "2026"
# Fixed rather than generated, so a failure names the same club every run.
ALPHA = ObjectId("6890a1b2c3d4e5f607210001")
BETA = ObjectId("6890a1b2c3d4e5f607210002")
OUTSIDER = ObjectId("6890a1b2c3d4e5f607210003")

# Group-mates: a rewritten fixture keeps an opponent that stays put, so the exchange shows on one side.
ALPHA_RIVAL = ObjectId("6890a1b2c3d4e5f60721000a")
BETA_RIVAL = ObjectId("6890a1b2c3d4e5f60721000b")

NAMES = {
    ALPHA: ("Alpha", "ALX"),
    BETA: ("Beta", "BEX"),
    ALPHA_RIVAL: ("Alpha-Rival", "ARX"),
    BETA_RIVAL: ("Beta-Rival", "BRX"),
}


def junction(team_id: ObjectId, gruppe: str) -> dict[str, Any]:
    """The season's own name and shorthand are read by nothing here: the rewrite composes a side's copies from `teams`."""

    name, shorthand = NAMES[team_id]

    return saison_team_document(SAISON_ID, team_id, name, shorthand, gruppe=gruppe)


# Only `datum` decides `REQ-SWAP-006`; the type and the reason are what a surface reports.
AUSTRITT = {"type": "disqualifikation", "grund": "Regelverstoss", "datum": "2026-04-01"}
# A day after `AUSTRITT`, so the date half is satisfied and the EVENT is what each case turns on.
AFTER_THE_EXIT = "2026-05-01"

# The German day the swap is judged on: before `AFTER_THE_EXIT`, so a fixture dated then leaves the season unstarted.
YESTERDAY, TODAY, TOMORROW = "2026-02-28", "2026-03-01", "2026-03-02"


async def record_an_austritt(database: AsyncDatabase, team_id: ObjectId) -> None:
    await database[Collection.SAISON_TEAMS].update_one({"saison_id": SAISON_ID, "team_id": team_id}, {"$set": {"austritt": AUSTRITT}})


def club(team_id: ObjectId) -> dict[str, Any]:
    """`name` and `shorthand` are what the rewrite projects, from `teams` and never from the season's junction row."""

    name, shorthand = NAMES[team_id]

    return team_document(team_id, name, shorthand)


def side(team_id: ObjectId, tore: int | None = None) -> dict[str, Any]:
    name, shorthand = NAMES[team_id]

    return {"team_id": team_id, "name": name, "shorthand": shorthand, "tore": tore}


# Sharing one matchday is what makes a `REQ-SWAP-005` clash reachable; the second is for cases needing two.
SPIELTAG = ObjectId("6890a1b2c3d4e5f6072100ff")
OTHER_SPIELTAG = ObjectId("6890a1b2c3d4e5f6072100fe")
# The bracket's own, so a knockout fixture shares a matchday with nothing unless a case says so.
KNOCKOUT_SPIELTAG = ObjectId("6890a1b2c3d4e5f6072100fd")

# Past the round robin's, `uniq_saison_id_spiel_nr` holding one number to one fixture per season.
KNOCKOUT_SPIEL_NR = 9


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
    return spiel_document(
        spiel_id=ObjectId(),
        saison_id=SAISON_ID,
        spiel_nr=spiel_nr,
        spieltag_id=spieltag_id,
        datum=datum,
        team1=side(home, tore[0]),
        team2=side(away, tore[1]),
        ergebnis=ergebnis,
        sonderereignis=sonderereignis,
    )


def knockout_fixture(
    *,
    ergebnis: str | None,
    sonderereignis: str | None = None,
    spieltag_id: ObjectId = KNOCKOUT_SPIELTAG,
    spiel_nr: int = KNOCKOUT_SPIEL_NR,
    datum: str | None = None,
) -> dict[str, Any]:
    """Its own matchday by default, which `_spieltag_clashes` finds no group fixture on: the clash cases name `SPIELTAG` themselves."""

    return spiel_document(
        spiel_id=ObjectId(),
        saison_id=SAISON_ID,
        spiel_nr=spiel_nr,
        spieltag_id=spieltag_id,
        saison_phase="viertelfinale",
        datum=datum,
        ergebnis=ergebnis,
        sonderereignis=sonderereignis,
    )


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_seeded_season(
    url: str,
    body: Body,
    *,
    spiele: list[dict[str, Any]] | None = None,
    saison_status: str = "active",
    mutates_schema: bool = False,
) -> Any:
    """`mutates_schema=True` where the body attaches a validator (`tests/database.py :: a_clean_database`)."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, mutates_schema=mutates_schema) as (client, database):
            # The swap reads the status alone.
            await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, saison_status))
            await database[Collection.SAISON_TEAMS].insert_many(
                [junction(ALPHA, "A"), junction(ALPHA_RIVAL, "A"), junction(BETA, "B"), junction(BETA_RIVAL, "B")]
            )
            await database[Collection.TEAMS].insert_many([club(team_id) for team_id in NAMES])
            if spiele:
                await database[Collection.SPIELE].insert_many(spiele)

            return await body(database, client)

    return on_the_seed_loop(_run())


async def call_swap(database: AsyncDatabase, client: AsyncMongoClient, team1_id: ObjectId, team2_id: ObjectId) -> Any:
    return await swap_gruppen(
        saison_id=SAISON_ID,
        swap_data=FLSwapGruppenPayload(team1_id=team1_id, team2_id=team2_id),
        saisons_collection=database[Collection.SAISONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        spiele_collection=database[Collection.SPIELE],
        teams_collection=database[Collection.TEAMS],
        db=client,
        today=TODAY,
    )


async def gruppen_now(database: AsyncDatabase) -> dict[ObjectId, str]:
    """Read outside any transaction — what a later request would see."""

    rows = await database[Collection.SAISON_TEAMS].find({"saison_id": SAISON_ID}).to_list(length=None)

    return {row["team_id"]: row["gruppe"] for row in rows}


async def sides_now(database: AsyncDatabase) -> dict[int, tuple[ObjectId | None, ObjectId | None]]:
    rows = await database[Collection.SPIELE].find({"saison_id": SAISON_ID}).to_list(length=None)

    return {row["spiel_nr"]: ((row["team1"] or {}).get("team_id"), (row["team2"] or {}).get("team_id")) for row in rows if "spiel_nr" in row}


async def spiele_now(database: AsyncDatabase) -> dict[int, dict[str, Any]]:
    rows = await database[Collection.SPIELE].find({"saison_id": SAISON_ID}).to_list(length=None)

    return {row["spiel_nr"]: row for row in rows if "spiel_nr" in row}


# Each drawn against their own group's rival, neither dated, so the season has not started.
DRAWN_ROUND_ROBIN = [gruppen_fixture(1, ALPHA, ALPHA_RIVAL), gruppen_fixture(2, BETA_RIVAL, BETA)]


class TestASwapCommitsBothRows:
    def test_the_two_clubs_end_in_each_others_groups(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await call_swap(database, client, ALPHA, BETA)
            return response, await gruppen_now(database)

        response, stored = on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN))

        assert stored == {ALPHA: "B", ALPHA_RIVAL: "A", BETA: "A", BETA_RIVAL: "B"}
        # The echo comes from the object the writes did, so it cannot describe another swap.
        assert (response.team1_id, response.team1_gruppe) == (ALPHA, "B")
        assert (response.team2_id, response.team2_gruppe) == (BETA, "A")

    def test_swapping_back_restores_the_season(self, mongo_replica_set_url: str):
        """The fixture assertion is the point: a rewrite over the clubs rather than a snapshot would swap a side twice, back to the start."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_swap(database, client, ALPHA, BETA)
            await call_swap(database, client, BETA, ALPHA)
            return await gruppen_now(database), await sides_now(database)

        stored, sides = on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN))

        assert stored == {ALPHA: "A", ALPHA_RIVAL: "A", BETA: "B", BETA_RIVAL: "B"}
        assert sides == {1: (ALPHA, ALPHA_RIVAL), 2: (BETA_RIVAL, BETA)}


class TestTheDrawnFixturesMoveWithTheClubs:
    def test_each_club_takes_over_the_others_fixtures(self, mongo_replica_set_url: str):
        """Both slots: a rewrite handling one would leave the other naming a club that has left."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await call_swap(database, client, ALPHA, BETA)
            return response.rewritten_spiele, await sides_now(database)

        rewritten, sides = on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN))

        assert sides == {1: (BETA, ALPHA_RIVAL), 2: (BETA_RIVAL, ALPHA)}
        assert rewritten == 2

    def test_the_display_copies_move_with_the_id(self, mongo_replica_set_url: str):
        """Rewriting `team_id` alone is silent: every card shows the old club's name over the new club's fixture."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_swap(database, client, ALPHA, BETA)
            return await spiele_now(database)

        spiele = on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN))

        assert spiele[1]["team1"] == {"team_id": BETA, "name": "Beta", "shorthand": "BEX", "tore": None}
        assert spiele[2]["team2"] == {"team_id": ALPHA, "name": "Alpha", "shorthand": "ALX", "tore": None}

    def test_the_opponent_and_the_slot_are_left_alone(self, mongo_replica_set_url: str):
        """The date, venue and matchday stay with the fixture, so each club inherits the other's schedule rather than carrying its own."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await spiele_now(database)
            await call_swap(database, client, ALPHA, BETA)
            return before, await spiele_now(database)

        before, after = on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN))

        assert after[1]["team2"] == before[1]["team2"], "the opponent was rewritten"
        assert after[1]["spieltag_id"] == before[1]["spieltag_id"]
        assert after[2]["team1"] == before[2]["team1"], "the opponent was rewritten"

    def test_a_fixture_of_neither_club_is_untouched(self, mongo_replica_set_url: str):
        """A rewrite filtered on the season rather than on the two clubs passes every assertion above and fails this."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
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

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await call_swap(database, client, ALPHA, BETA)
            return response.rewritten_spiele, await sides_now(database)

        rewritten, sides = on_a_seeded_season(mongo_replica_set_url, body, spiele=[*DRAWN_ROUND_ROBIN, knockout])

        assert sides[9] == (ALPHA, None)
        assert rewritten == 2

    def test_a_fixture_between_the_two_clubs_exchanges_both_sides(self, mongo_replica_set_url: str):
        """Both clubs in one fixture: the passes are disjoint, and the count is of fixtures moved, not writes landed."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await call_swap(database, client, ALPHA, BETA)
            return response.rewritten_spiele, await spiele_now(database)

        rewritten, spiele = on_a_seeded_season(mongo_replica_set_url, body, spiele=[gruppen_fixture(1, ALPHA, BETA)])

        assert spiele[1]["team1"] == {"team_id": BETA, "name": "Beta", "shorthand": "BEX", "tore": None}
        assert spiele[1]["team2"] == {"team_id": ALPHA, "name": "Alpha", "shorthand": "ALX", "tore": None}
        assert rewritten == 1, "one fixture fielding both clubs was counted twice"

    def test_a_club_with_no_drawn_fixture_leaves_the_other_unscheduled(self, mongo_replica_set_url: str):
        """Alpha arrives with nothing scheduled: the remaining draw is the admin's."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await call_swap(database, client, ALPHA, BETA)
            return response.rewritten_spiele, await sides_now(database)

        rewritten, sides = on_a_seeded_season(mongo_replica_set_url, body, spiele=[gruppen_fixture(1, ALPHA, ALPHA_RIVAL)])

        assert sides == {1: (BETA, ALPHA_RIVAL)}
        assert rewritten == 1

    def test_no_club_is_fielded_twice_on_one_matchday(self, mongo_replica_set_url: str):
        """Group fixtures only; a mixed Spieltag is `REQ-SWAP-005`'s. The before count is asserted so an illegal seed cannot pass."""

        async def occupancy(database: AsyncDatabase) -> int:
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

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await occupancy(database)
            await call_swap(database, client, ALPHA, BETA)
            return before, await occupancy(database)

        before, after = on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN))

        assert before == 1, "the seeded season already fielded a club twice on one matchday"
        assert after == 1


class TestAMidFlightFailureTakesBothWritesBack:
    def test_neither_row_moves_when_the_second_write_is_refused(self, mongo_replica_set_url: str):
        """A narrower `$jsonSchema` refuses group A, so the second write fails inside an already-changed transaction."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
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

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(APIError) as refusal:
                await call_swap(database, client, ALPHA, OUTSIDER)
            return refusal.value.error_code, await gruppen_now(database)

        code, stored = on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN))

        assert code == Code.SWAP_NOT_A_SWAP
        assert stored[ALPHA] == "A" and stored[BETA] == "B", "a refused swap wrote something"

    def test_a_past_season_is_refused(self, mongo_replica_set_url: str):
        """Nothing has been played, so the season being over is the only thing refusing this."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(APIError) as refusal:
                await call_swap(database, client, ALPHA, BETA)
            return refusal.value.error_code, await sides_now(database)

        code, sides = on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN), saison_status="past")

        assert code == Code.SWAP_SAISON_FINISHED
        assert sides == {1: (ALPHA, ALPHA_RIVAL), 2: (BETA_RIVAL, BETA)}, "a refused swap rewrote a fixture"

    def test_a_group_fixture_dated_today_closes_the_window(self, mongo_replica_set_url: str):
        """The season starts on its earliest group fixture's day, so a swap that day is refused and rewrites nothing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(APIError) as refusal:
                await call_swap(database, client, ALPHA, BETA)
            return refusal.value.error_code, await gruppen_now(database), await sides_now(database)

        code, stored, sides = on_a_seeded_season(
            mongo_replica_set_url,
            body,
            spiele=[gruppen_fixture(1, ALPHA, ALPHA_RIVAL, datum=TODAY), gruppen_fixture(2, BETA_RIVAL, BETA)],
        )

        assert code == Code.SWAP_KNOCKOUT_STARTED
        assert stored[ALPHA] == "A" and stored[BETA] == "B", "a refused swap moved a junction row"
        assert sides == {1: (ALPHA, ALPHA_RIVAL), 2: (BETA_RIVAL, BETA)}, "a refused swap rewrote a fixture"

    def test_a_group_fixture_dated_tomorrow_leaves_it_open(self, mongo_replica_set_url: str):
        """The day before the start, the swap still runs."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_swap(database, client, ALPHA, BETA)
            return await gruppen_now(database)

        stored = on_a_seeded_season(
            mongo_replica_set_url,
            body,
            spiele=[gruppen_fixture(1, ALPHA, ALPHA_RIVAL, datum=TOMORROW), gruppen_fixture(2, BETA_RIVAL, BETA)],
        )

        assert stored[ALPHA] == "B" and stored[BETA] == "A"

    def test_a_dated_knockout_fixture_does_not_start_the_season(self, mongo_replica_set_url: str):
        """Only the group phase starts a season, so a bracket fixture dated in the past leaves the swap open."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_swap(database, client, ALPHA, BETA)
            return await gruppen_now(database)

        stored = on_a_seeded_season(
            mongo_replica_set_url,
            body,
            spiele=[*DRAWN_ROUND_ROBIN, knockout_fixture(ergebnis=None, datum=YESTERDAY)],
        )

        assert stored[ALPHA] == "B" and stored[BETA] == "A"

    def test_a_swap_that_would_field_a_club_twice_on_one_matchday_is_refused(self, mongo_replica_set_url: str):
        """`REQ-SWAP-005`: the rewrite moves group sides only, so Alpha takes Beta's fixture and stands twice — what a swap could bypass."""

        manual_pick = {**knockout_fixture(ergebnis=None, spieltag_id=SPIELTAG), "spiel_nr": 9, "team1": side(ALPHA), "team2": None}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(APIError) as refusal:
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

        assert code == Code.SWAP_SPIELTAG_CLASH
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

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
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

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
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

    def test_a_swap_landing_a_departed_club_on_a_later_fixture_is_refused(self, mongo_replica_set_url: str):
        """`REQ-SWAP-006` against real documents: the junction read supplies the exit day and the projection the fixture's date."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await record_an_austritt(database, ALPHA)
            with pytest.raises(APIError) as refusal:
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

        assert code == Code.SWAP_FIELDS_DISQUALIFIED
        assert stored[ALPHA] == "A" and stored[BETA] == "B", "a refused swap moved a junction row"
        assert sides == {1: (ALPHA, ALPHA_RIVAL), 2: (BETA_RIVAL, BETA)}, "a refused swap rewrote a fixture"

    @pytest.mark.parametrize("sonderereignis", SONDEREREIGNIS_WITHOUT_A_RESULT)
    def test_a_fixture_awarding_nothing_takes_a_departed_club_anyway(self, mongo_replica_set_url: str, sonderereignis: str):
        """The case above but for the event: the eligibility rule takes a fixture awarding nothing, so the swap does too."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
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
