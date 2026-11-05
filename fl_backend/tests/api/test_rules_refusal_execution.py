from collections.abc import Awaitable, Callable, Mapping
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.admin_router import patch_saison
from app.api.saisons.schemas import FLPatchSaisonPayload, FLSaisonRules
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_rules_refusal_test")

SAISON_ID = "2026"
PRIOR_SAISON_ID = "2025"
# The day the season starts, which every drawn fixture and the one matchday are dated on too.
SAISON_START = "2026-03-15"
SAISON_END = "2026-06-30"

# 4 groups of 4, which is 8 Gruppenphase fixtures a matchday. Widening the group is the edit under
# test, so the seeded matchday stays under whatever the wider rules imply.
STORED_PER_GROUP = 4
WIDER_PER_GROUP = 6
DRAWN_FIXTURES = 8

# Far above every cap a case below patches to, so a refusal can only be about the squad.
STORED_KADER = 18

LIVE_SQUAD = 3
# Each is a count that must NOT answer for the cap, and each is larger than `PERMITTED_KADER`, so a
# case reaching one of them refuses where the correct reading permits.
RETIRED_ROWS = 4
OTHER_TEAMS_SQUAD = 2
PRIOR_SAISONS_SQUAD = 9

# Above the live squad and under every decoy, which is what makes one call discriminate between them.
PERMITTED_KADER = 4
REFUSED_KADER = 2

# Fixed rather than generated, so a failure names the same rows every run.
TEAM_OID = ObjectId("6890a1b2c3d4e5f607240001")
OTHER_TEAM_OID = ObjectId("6890a1b2c3d4e5f607240002")
SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f6072400a1")
MEMBERSHIP_ID = "6890a1b2c3d4e5f60724{:04d}"
SPIEL_ID = "6890a1b2c3d4e5f60725{:04d}"


def rules_document(**overrides: Any) -> dict[str, Any]:
    return documents.rules_document(**{"teams_per_gruppe": STORED_PER_GROUP, "max_kadergroesse": STORED_KADER, **overrides})


def saison_document() -> dict[str, Any]:
    return documents.saison_document(SAISON_ID, "active", start_date=SAISON_START, end_date=SAISON_END, rules=rules_document())


def spieltag_document() -> dict[str, Any]:
    """Inside the season's span, so the matchday the fixtures hang on cannot be what a refusal is about."""

    return {
        "_id": SPIELTAG_OID,
        "beginn": "2026-03-15",
        "ende": "2026-03-15",
        "position": 1,
        "saison_phase": "gruppenphase",
        "saison_id": SAISON_ID,
    }


def squad_row(index: int, *, saison_id: str, team_id: ObjectId, inactive_since: str | None) -> dict[str, Any]:
    return documents.saison_spieler_document(
        ObjectId(MEMBERSHIP_ID.format(500 + index)),
        saison_id,
        team_id,
        _id=ObjectId(MEMBERSHIP_ID.format(index)),
        nummer=str(index),
        inactive_since=inactive_since,
    )


def squad_rows() -> list[dict[str, Any]]:
    """The live squad plus three counts that must not answer for it.

    A retired row of the same squad, another club's squad in the same season, and the same club's
    squad in the season before -- one for each stage of the aggregation `patch_saison` runs.
    """

    rows = [squad_row(index, saison_id=SAISON_ID, team_id=TEAM_OID, inactive_since=None) for index in range(LIVE_SQUAD)]
    rows += [squad_row(100 + index, saison_id=SAISON_ID, team_id=TEAM_OID, inactive_since="2026-02-01") for index in range(RETIRED_ROWS)]
    rows += [squad_row(200 + index, saison_id=SAISON_ID, team_id=OTHER_TEAM_OID, inactive_since=None) for index in range(OTHER_TEAMS_SQUAD)]
    rows += [squad_row(300 + index, saison_id=PRIOR_SAISON_ID, team_id=TEAM_OID, inactive_since=None) for index in range(PRIOR_SAISONS_SQUAD)]

    return rows


def spiel_document(*, spiel_nr: int, **overrides: Any) -> dict[str, Any]:
    return {**documents.spiel_document(spiel_id=ObjectId(), saison_id=SAISON_ID, spiel_nr=spiel_nr, spieltag_id=SPIELTAG_OID), **overrides}


# The day every drawn fixture is dated, which is the season's start, the day before it, and a later start.
FIRST_FIXTURE_DAY = SAISON_START
THE_DAY_BEFORE = "2026-03-14"
A_WEEK_LATER = "2026-03-22"


def drawn_spiele() -> list[dict[str, Any]]:
    """One matchday's fixtures. A null `quelle` on either side, so nothing here can be read as a wired placing."""

    return [spiel_document(_id=ObjectId(SPIEL_ID.format(nr)), spiel_nr=nr, datum=FIRST_FIXTURE_DAY) for nr in range(1, DRAWN_FIXTURES + 1)]


Body = Callable[[AsyncDatabase], Awaitable[Any]]


def on_a_database(
    url: str,
    body: Body,
    *,
    spiele: list[dict[str, Any]] | None = None,
    spieltage: list[dict[str, Any]] | None = None,
) -> Any:
    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME) as (_, database):
            await database[Collection.SAISONS].insert_one(saison_document())
            await database[Collection.SAISON_SPIELER].insert_many(squad_rows())
            await database[Collection.SPIELTAGE].insert_many([spieltag_document(), *(spieltage or [])])
            if spiele:
                await database[Collection.SPIELE].insert_many(spiele)

            return await body(database)

    return on_the_seed_loop(_run())


async def date_the_matchday(database: AsyncDatabase, day: str) -> None:
    """What precedes a moved start: `saison_span_below_spieltage` keeps every dated matchday inside the season."""

    await database[Collection.SPIELTAGE].update_one({"_id": SPIELTAG_OID}, {"$set": {"beginn": day, "ende": day}})


async def stored_season(database: AsyncDatabase) -> Mapping[str, Any]:
    """The season as a later request reads it."""

    stored = await database[Collection.SAISONS].find_one({"_id": SAISON_ID})
    assert stored is not None

    return stored


async def saved_rules(database: AsyncDatabase) -> Mapping[str, Any]:
    """The rules the season holds after a save, which answers 204 and none."""

    stored = await database[Collection.SAISONS].find_one({"_id": SAISON_ID})
    assert stored is not None

    return stored["rules"]


async def patch_the_rules(database: AsyncDatabase, *, today: str = THE_DAY_BEFORE, start_date: str = SAISON_START, **overrides: Any) -> Any:
    """The whole rules object every time, `rules` being required on the patch, so a case names only the value it changes."""

    return await patch_saison(
        saison_id=SAISON_ID,
        saison_data=FLPatchSaisonPayload(
            start_date=start_date,
            end_date=SAISON_END,
            rules=FLSaisonRules.model_validate(rules_document(**overrides)),
            # Stated rather than omitted: the payload replaces the season wholesale, so neither
            # window carries a default and this helper is about neither of them.
            bewerbung=None,
            registrierung=None,
            version=(await database[Collection.SAISONS].find_one({"_id": SAISON_ID}, {"version": 1}) or {})["version"],
        ),
        saisons_collection=database[Collection.SAISONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        spiele_collection=database[Collection.SPIELE],
        spieltage_collection=database[Collection.SPIELTAGE],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        db=database.client,
        today=today,
    )


class TestTheSquadCapIsJudgedAgainstTheSeasonsOwnLiveRows:
    """`rules_kader_below_use` over the aggregation that produces its figure.

    Every other case hands `largest_squad` in already counted, so the `inactive_since` match, the
    season match and the grouping by team reach nothing without a database behind them.
    """

    def test_the_decoy_rows_hold_no_cap_up(self, mongo_replica_set_url: str):
        """One call for the three: each decoy is larger than this cap, so any of them reaching the figure refuses instead."""

        async def body(database: AsyncDatabase) -> Any:
            await patch_the_rules(database, max_kadergroesse=PERMITTED_KADER)
            return await saved_rules(database)

        assert on_a_database(mongo_replica_set_url, body)["max_kadergroesse"] == PERMITTED_KADER

    def test_a_cap_below_the_live_squad_is_refused(self, mongo_replica_set_url: str):
        """The control: without it the case above would also pass on an aggregation that answered nothing at all."""

        async def body(database: AsyncDatabase) -> APIError:
            with pytest.raises(APIError) as refusal:
                await patch_the_rules(database, max_kadergroesse=REFUSED_KADER)

            return refusal.value

        refusal = on_a_database(mongo_replica_set_url, body)

        assert refusal.error_code == Code.RULES_KADER_BELOW_USE


class TestTheDrawItselfIsWhatFreezesTheShape:
    """`rules_shape_after_spielplan` through the endpoint, whose count of the season's fixtures is the whole of what the rule turns on."""

    def test_widening_a_group_after_the_draw_is_refused(self, mongo_replica_set_url: str):
        """A widening crosses no other bound: `rules_capacity_below_use` reads the narrowing direction, and the matchday stays under it."""

        async def body(database: AsyncDatabase) -> APIError:
            with pytest.raises(APIError) as refusal:
                await patch_the_rules(database, teams_per_gruppe=WIDER_PER_GROUP)

            return refusal.value

        refusal = on_a_database(mongo_replica_set_url, body, spiele=drawn_spiele())

        assert refusal.error_code == Code.RULES_SHAPE_AFTER_SPIELPLAN

    def test_the_same_edit_goes_through_while_nothing_is_drawn(self, mongo_replica_set_url: str):
        """The same season and the same matchday, minus its fixtures: a season still being set up widens freely."""

        async def body(database: AsyncDatabase) -> Any:
            await patch_the_rules(database, teams_per_gruppe=WIDER_PER_GROUP)
            return await saved_rules(database)

        assert on_a_database(mongo_replica_set_url, body)["teams_per_gruppe"] == WIDER_PER_GROUP


class TestTheStartIsWhatFreezesTheScoring:
    """`rules_saison_started` through the endpoint, whose read of the season's STORED start is what the rule turns on."""

    def test_the_points_freeze_on_the_start_date(self, mongo_replica_set_url: str):
        """The table is derived, so a scoring change on a season under way would rewrite standings already played."""

        async def body(database: AsyncDatabase) -> APIError:
            with pytest.raises(APIError) as refusal:
                await patch_the_rules(database, today=FIRST_FIXTURE_DAY, win_points=2)

            return refusal.value

        refusal = on_a_database(mongo_replica_set_url, body, spiele=drawn_spiele())

        assert refusal.error_code == Code.RULES_SAISON_STARTED

    def test_the_same_edit_goes_through_the_day_before(self, mongo_replica_set_url: str):
        """The boundary: an activated season waiting for its first fixture still takes a corrected rule."""

        async def body(database: AsyncDatabase) -> Any:
            await patch_the_rules(database, today=THE_DAY_BEFORE, win_points=2)
            return await saved_rules(database)

        assert on_a_database(mongo_replica_set_url, body, spiele=drawn_spiele())["win_points"] == 2

    def test_a_save_moving_the_start_cannot_lift_its_own_freeze(self, mongo_replica_set_url: str):
        """The freeze reads the stored start: a payload carrying a later start and new points in one is still refused."""

        async def body(database: AsyncDatabase) -> tuple[Code, Mapping[str, Any]]:
            with pytest.raises(APIError) as refusal:
                await patch_the_rules(database, today=FIRST_FIXTURE_DAY, start_date=A_WEEK_LATER, win_points=2)

            return refusal.value.error_code, await stored_season(database)

        code, stored = on_a_database(mongo_replica_set_url, body, spiele=drawn_spiele())

        assert code == Code.RULES_SAISON_STARTED
        assert (stored["start_date"], stored["rules"]["win_points"]) == (SAISON_START, 3), "a refused save wrote something"

    def test_moving_the_start_before_any_match_unlocks_the_next_save(self, mongo_replica_set_url: str):
        """The way out of a season started too early: one save moves the start, the next changes the points."""

        async def body(database: AsyncDatabase) -> Mapping[str, Any]:
            await date_the_matchday(database, A_WEEK_LATER)
            await patch_the_rules(database, today=FIRST_FIXTURE_DAY, start_date=A_WEEK_LATER)
            await patch_the_rules(database, today=FIRST_FIXTURE_DAY, start_date=A_WEEK_LATER, win_points=2)
            return await stored_season(database)

        stored = on_a_database(mongo_replica_set_url, body, spiele=drawn_spiele())

        assert (stored["start_date"], stored["rules"]["win_points"]) == (A_WEEK_LATER, 2)


class TestTheStartIsFixedOnceAFixtureHasTakenPlace:
    """`saison_start_taken_place` through the endpoint, over the in-session read of every fixture of the season."""

    def test_a_moved_start_on_a_played_season_is_refused(self, mongo_replica_set_url: str):
        """One fixture holding a result fixes the start, and the refusal writes nothing."""

        played = [*drawn_spiele()[1:], spiel_document(spiel_nr=1, datum=FIRST_FIXTURE_DAY, ergebnis="1:0")]

        async def body(database: AsyncDatabase) -> tuple[Code, Mapping[str, Any]]:
            await date_the_matchday(database, A_WEEK_LATER)
            with pytest.raises(APIError) as refusal:
                await patch_the_rules(database, today=THE_DAY_BEFORE, start_date=A_WEEK_LATER)

            return refusal.value.error_code, await stored_season(database)

        code, stored = on_a_database(mongo_replica_set_url, body, spiele=played)

        assert code == Code.SAISON_START_TAKEN_PLACE
        assert stored["start_date"] == SAISON_START, "a refused save moved the start"

    def test_a_called_off_fixture_leaves_the_start_movable(self, mongo_replica_set_url: str):
        """`has_taken_place`'s line: a fixture called off left no record, so the season has not been played."""

        called_off = [*drawn_spiele()[1:], spiel_document(spiel_nr=1, datum=FIRST_FIXTURE_DAY, sonderereignis="ausgefallen")]

        async def body(database: AsyncDatabase) -> Mapping[str, Any]:
            await date_the_matchday(database, A_WEEK_LATER)
            await patch_the_rules(database, today=THE_DAY_BEFORE, start_date=A_WEEK_LATER)
            return await stored_season(database)

        assert on_a_database(mongo_replica_set_url, body, spiele=called_off)["start_date"] == A_WEEK_LATER
