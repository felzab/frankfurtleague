from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from bson import ObjectId
from pydantic import ValidationError
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.api.saisons.admin_router import swap_gruppen
from app.api.saisons.schemas import FLSwapGruppenPayload
from app.core.codes import Code
from app.core.collections import Collection
from tests.app_client import app_client, app_under_test
from tests.config import ADMIN_AUTH, grants_for_the_suite
from tests.database import DOCUMENT_VALIDATION_FAILED, a_clean_database
from tests.documents import saison_document, saison_team_document, spiel_document
from tests.isolation import COMMITTED, InterleavedCollection, outcome_of, refused_code
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_swap_test")


SAISON_ID = "2026"
# Fixed rather than generated, so a failure names the same club every run.
ALPHA = ObjectId("6890a1b2c3d4e5f607210001")
BETA = ObjectId("6890a1b2c3d4e5f607210002")

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
    """The season's own name and shorthand, which every read joins a side's name from and the swap never copies."""

    name, shorthand = NAMES[team_id]

    return saison_team_document(SAISON_ID, team_id, name, shorthand, gruppe=gruppe)


# The German day the swap is judged on; every season here starts the day after unless a case says so.
TODAY, TOMORROW = "2026-03-01", "2026-03-02"


def side(team_id: ObjectId) -> dict[str, Any]:
    """A side as `spiele` stores it before any result: the club and no goals, the name joined at read."""

    return {"team_id": team_id, "tore": None}


# The matchday every group fixture here hangs on.
SPIELTAG = ObjectId("6890a1b2c3d4e5f6072100ff")
# The bracket's own, so a knockout fixture shares a matchday with nothing.
KNOCKOUT_SPIELTAG = ObjectId("6890a1b2c3d4e5f6072100fd")

# Past the round robin's, `uniq_saison_id_spiel_nr` holding one number to one fixture per season.
KNOCKOUT_SPIEL_NR = 9


def gruppen_spiel(spiel_nr: int, home: ObjectId, away: ObjectId, *, date: str | None = None) -> dict[str, Any]:
    return spiel_document(
        spiel_id=ObjectId(),
        saison_id=SAISON_ID,
        spiel_nr=spiel_nr,
        spieltag_id=SPIELTAG,
        date=date,
        team1=side(home),
        team2=side(away),
    )


def knockout_spiel(*, ergebnis: str | None) -> dict[str, Any]:
    """On its own matchday, so a knockout fixture shares a matchday with no group fixture."""

    return spiel_document(
        spiel_id=ObjectId(),
        saison_id=SAISON_ID,
        spiel_nr=KNOCKOUT_SPIEL_NR,
        spieltag_id=KNOCKOUT_SPIELTAG,
        saison_phase="viertelfinale",
        ergebnis=ergebnis,
    )


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


async def on_a_seeded_season(
    url: str,
    body: Body,
    *,
    spiele: list[dict[str, Any]] | None = None,
    saison_status: str = "active",
    start_date: str = TOMORROW,
    mutates_schema: bool = False,
    stores_a_refused_shape: str | None = None,
) -> Any:
    """`mutates_schema=True` where the body attaches a validator (`tests/database.py :: a_clean_database`)."""

    async with a_clean_database(url, DATABASE_NAME, mutates_schema=mutates_schema, stores_a_refused_shape=stores_a_refused_shape) as (
        client,
        database,
    ):
        # The swap reads the status and the start alone.
        await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, saison_status, start_date=start_date))
        await database[Collection.SAISON_TEAMS].insert_many(
            [junction(ALPHA, "A"), junction(ALPHA_RIVAL, "A"), junction(BETA, "B"), junction(BETA_RIVAL, "B")]
        )
        if spiele:
            await database[Collection.SPIELE].insert_many(spiele)

        return await body(database, client)


async def call_swap(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    team1_id: ObjectId,
    team2_id: ObjectId,
    *,
    saisons_collection: Any = None,
    saison_id: str = SAISON_ID,
) -> None:
    """`saisons_collection` is overridable so a case can hand the endpoint a stand-in and nothing else."""

    await swap_gruppen(
        saison_id=saison_id,
        swap_data=FLSwapGruppenPayload(team1_id=team1_id, team2_id=team2_id),
        saisons_collection=saisons_collection if saisons_collection is not None else database[Collection.SAISONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        spiele_collection=database[Collection.SPIELE],
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


async def league_now(database: AsyncDatabase) -> dict[str, list[Any]]:
    """The season, its clubs' rows, its fixtures and the action log, each as it stands."""

    names = (Collection.SAISONS, Collection.SAISON_TEAMS, Collection.SPIELE, Collection.ACTION_LOG)

    return {name: await database[name].find().sort("_id", 1).to_list(length=None) for name in names}


async def everything_now(database: AsyncDatabase) -> dict[str, list[Any]]:
    """Every collection as it stands, the action log and each document's version included, so "wrote nothing" means nothing."""

    return {name: await database[name].find().sort("_id", 1).to_list(length=None) for name in sorted(await database.list_collection_names())}


# Each drawn against their own group's rival, neither dated, so the season has not started.
DRAWN_ROUND_ROBIN = [gruppen_spiel(1, ALPHA, ALPHA_RIVAL), gruppen_spiel(2, BETA_RIVAL, BETA)]


class TestASwapCommitsBothRows:
    async def test_the_two_teams_end_in_each_others_groups(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_swap(database, client, ALPHA, BETA)
            return await gruppen_now(database)

        stored = await on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN))

        assert stored == {ALPHA: "B", ALPHA_RIVAL: "A", BETA: "A", BETA_RIVAL: "B"}


class TestWhatTheSwapJudgesBeforeItsFirstWrite:
    async def test_a_malformed_season_id_is_a_404_and_writes_nothing(self, mongo_replica_set_url: str):
        """Posted over the wire, so the route's own path parameter is judged too: a width constraint there would answer 422.

        A path id of another width names no season, so the season read refuses it before the swap writes anything.
        """

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            await database[Collection.GRANTS].insert_many(grants_for_the_suite())
            before = await league_now(database)
            async with app_client(mongo_replica_set_url, app=app_under_test(DATABASE_NAME)) as http:
                response = await http.post(
                    f"/api/saisons/{SAISON_ID}0/gruppen/swap", json={"team1_id": str(ALPHA), "team2_id": str(BETA)}, headers=dict(ADMIN_AUTH)
                )

            return (response.status_code, response.json()["error_code"]), before, await league_now(database)

        answer, before, after = await on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN))

        assert answer == (404, Code.DOCUMENT_NOT_FOUND)
        assert after == before

    async def test_a_stored_group_outside_the_closed_set_aborts_the_exchange_before_any_write(self, mongo_replica_set_url: str):
        """Written onto the other club, such a group would put it in a group no draw holds and the fixtures it plays nowhere."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISON_TEAMS].update_one({"saison_id": SAISON_ID, "team_id": ALPHA}, {"$set": {"gruppe": "Z"}})
            before = await everything_now(database)
            with pytest.raises(ValidationError):
                await call_swap(database, client, ALPHA, BETA)

            return before, await everything_now(database)

        before, after = await on_a_seeded_season(
            mongo_replica_set_url,
            body,
            spiele=list(DRAWN_ROUND_ROBIN),
            stores_a_refused_shape="a group outside the closed set, which the swap must refuse to carry",
        )

        assert after == before


class TestTheDrawnSpieleMoveWithTheTeams:
    async def test_each_team_takes_over_the_others_spiele(self, mongo_replica_set_url: str):
        """Both slots: a rewrite handling one would leave the other naming a club that has left."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_swap(database, client, ALPHA, BETA)
            return await sides_now(database)

        sides = await on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN))

        assert sides == {1: (BETA, ALPHA_RIVAL), 2: (BETA_RIVAL, ALPHA)}

    async def test_a_booked_venue_and_referee_hold_no_swap_back_and_stay_on_their_spiel(self, mongo_replica_set_url: str):
        """Grounds and referees are booked before a season starts, and the start is the swap's one lock."""

        spiele = [
            {
                **spiel,
                "spielort": {"spielort_id": ObjectId(), "mietpreis": 80},
                "schiedsrichter": {"schiedsrichter_id": ObjectId(), "payment": 20},
            }
            for spiel in DRAWN_ROUND_ROBIN
        ]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_swap(database, client, ALPHA, BETA)
            return await spiele_now(database)

        after = await on_a_seeded_season(mongo_replica_set_url, body, spiele=spiele)

        assert (after[1]["team1"], after[2]["team2"]) == (side(BETA), side(ALPHA))
        assert [(after[spiel["spiel_nr"]]["spielort"], after[spiel["spiel_nr"]]["schiedsrichter"]) for spiel in spiele] == [
            (spiel["spielort"], spiel["schiedsrichter"]) for spiel in spiele
        ]

    async def test_the_opponent_and_the_slot_are_left_alone(self, mongo_replica_set_url: str):
        """The date, venue and matchday stay with the fixture, so each club inherits the other's schedule rather than carrying its own."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await spiele_now(database)
            await call_swap(database, client, ALPHA, BETA)
            return before, await spiele_now(database)

        before, after = await on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN))

        assert after[1]["team2"] == before[1]["team2"], "the opponent was rewritten"
        assert after[1]["spieltag_id"] == before[1]["spieltag_id"]
        assert after[2]["team1"] == before[2]["team1"], "the opponent was rewritten"

    async def test_a_spiel_of_neither_team_is_untouched(self, mongo_replica_set_url: str):
        """A rewrite filtered on the season rather than on the two clubs passes every assertion above and fails this."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_swap(database, client, ALPHA, BETA)
            return await sides_now(database)

        sides = await on_a_seeded_season(
            mongo_replica_set_url,
            body,
            spiele=[*DRAWN_ROUND_ROBIN, gruppen_spiel(3, ALPHA_RIVAL, BETA_RIVAL)],
        )

        assert sides == {1: (BETA, ALPHA_RIVAL), 2: (BETA_RIVAL, ALPHA), 3: (ALPHA_RIVAL, BETA_RIVAL)}, (
            "a fixture fielding neither club was rewritten"
        )

    async def test_a_knockout_spiel_naming_a_team_is_untouched(self, mongo_replica_set_url: str):
        """A bracket side is the resolution's or an admin's pick — a statement about the club, not its group."""

        knockout = {**knockout_spiel(ergebnis=None), "spiel_nr": 9, "team1": side(ALPHA), "team2": None}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_swap(database, client, ALPHA, BETA)
            return await sides_now(database)

        sides = await on_a_seeded_season(mongo_replica_set_url, body, spiele=[*DRAWN_ROUND_ROBIN, knockout])

        assert sides == {1: (BETA, ALPHA_RIVAL), 2: (BETA_RIVAL, ALPHA), 9: (ALPHA, None)}

    async def test_a_spiel_between_the_two_teams_exchanges_both_sides(self, mongo_replica_set_url: str):
        """Both clubs in one fixture: the passes are disjoint, so the second never swaps back what the first wrote."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_swap(database, client, ALPHA, BETA)
            return await spiele_now(database)

        spiele = await on_a_seeded_season(mongo_replica_set_url, body, spiele=[gruppen_spiel(1, ALPHA, BETA)])

        assert spiele[1]["team1"] == side(BETA)
        assert spiele[1]["team2"] == side(ALPHA)

    async def test_a_team_with_no_drawn_spiel_leaves_the_other_unscheduled(self, mongo_replica_set_url: str):
        """Alpha arrives with nothing scheduled: the remaining draw is the admin's."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_swap(database, client, ALPHA, BETA)
            return await sides_now(database)

        sides = await on_a_seeded_season(mongo_replica_set_url, body, spiele=[gruppen_spiel(1, ALPHA, ALPHA_RIVAL)])

        assert sides == {1: (BETA, ALPHA_RIVAL)}


class TestAMidFlightFailureTakesBothWritesBack:
    async def test_neither_row_moves_when_the_second_write_is_refused(self, mongo_replica_set_url: str):
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

        code, stored, sides = await on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN), mutates_schema=True)

        # Asserted on the code, so this cannot pass because something else failed before either write.
        assert code == DOCUMENT_VALIDATION_FAILED, f"expected the validator to refuse the second write, got code {code}"
        # The validator admits B, so Alpha reading A can only mean the first write was taken back.
        assert stored == {ALPHA: "A", ALPHA_RIVAL: "A", BETA: "B", BETA_RIVAL: "B"}
        # The rewrite runs before either junction write, so it has stood longest when the abort arrives.
        assert sides == {1: (ALPHA, ALPHA_RIVAL), 2: (BETA_RIVAL, BETA)}, "the fixture rewrite survived a rolled-back swap"


class TestTheRefusalsReadTheRealDocuments:
    async def test_a_past_season_is_refused(self, mongo_replica_set_url: str):
        """Nothing has been played, so the season being over is the only thing refusing this."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await refused_code(call_swap(database, client, ALPHA, BETA)), await sides_now(database)

        code, sides = await on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN), saison_status="past")

        assert code == Code.SAISON_PAST
        assert sides == {1: (ALPHA, ALPHA_RIVAL), 2: (BETA_RIVAL, BETA)}, "a refused swap rewrote a fixture"

    async def test_a_season_starting_today_closes_the_window(self, mongo_replica_set_url: str):
        """The start lock, the swap's one: a swap on the season's first day would hand a club's fixtures to another as they are played.

        The season starts on its `start_date`, so a swap that day is refused and rewrites nothing.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await refused_code(call_swap(database, client, ALPHA, BETA)), await gruppen_now(database), await sides_now(database)

        code, stored, sides = await on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN), start_date=TODAY)

        assert code == Code.SWAP_SAISON_STARTED
        assert stored[ALPHA] == "A" and stored[BETA] == "B", "a refused swap moved a junction row"
        assert sides == {1: (ALPHA, ALPHA_RIVAL), 2: (BETA_RIVAL, BETA)}, "a refused swap rewrote a fixture"

    async def test_a_spiel_dated_today_does_not_start_the_season(self, mongo_replica_set_url: str):
        """The start is the season's date and never a match's: the day before it, the swap runs whatever is dated.

        `docs/decisions.md`'s swap line names everything that refuses a swap, and a dated fixture is none of it.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_swap(database, client, ALPHA, BETA)
            return await gruppen_now(database)

        stored = await on_a_seeded_season(
            mongo_replica_set_url,
            body,
            spiele=[gruppen_spiel(1, ALPHA, ALPHA_RIVAL, date=TODAY), gruppen_spiel(2, BETA_RIVAL, BETA)],
        )

        assert stored[ALPHA] == "B" and stored[BETA] == "A"


class SeasonsRunningARivalAfterTheSessionRead(InterleavedCollection):
    """A `saisons` stand-in running its rival once, just after the first read made inside a transaction.

    The read before the transaction is the 404 check, so a rival there would land before any snapshot.
    """

    async def find_one(self, *args: Any, **kwargs: Any) -> Any:
        found = await self._collection.find_one(*args, **kwargs)
        if kwargs.get("session") is not None:
            await self.run_the_rival()

        return found


class TestAStartMovedUnderTheSwapIsJudgedAgain:
    """The season has not started when the swap judges, and has when it writes: `PATCH /saisons` moved its start."""

    async def test_the_swap_is_refused_on_the_start_moved_under_it(self, mongo_replica_set_url: str):
        """Drop the season's anchor from `swap_gruppen` and this fails: the swap reads the start and writes only the clubs' rows."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def move_the_start_to_today() -> None:
                # The season patch's own write, the one document both share.
                await database[Collection.SAISONS].update_one({"_id": SAISON_ID}, {"$set": {"start_date": TODAY}})

            seasons = SeasonsRunningARivalAfterTheSessionRead(database[Collection.SAISONS], move_the_start_to_today)
            outcome = await outcome_of(call_swap(database, client, ALPHA, BETA, saisons_collection=seasons))

            return outcome, seasons.passes, await gruppen_now(database)

        outcome, passes, stored = await on_a_seeded_season(mongo_replica_set_url, body, spiele=list(DRAWN_ROUND_ROBIN))

        assert outcome != COMMITTED, "the swap committed on a start it judged before the patch moved it"
        assert outcome == Code.SWAP_SAISON_STARTED
        assert stored == {ALPHA: "A", ALPHA_RIVAL: "A", BETA: "B", BETA_RIVAL: "B"}
        # The judgement's read and the retry's: the swap conflicted on the anchor rather than committing.
        assert passes == 2
