import asyncio
from typing import Any, Awaitable, Callable

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.saisons.admin_router import patch_saison
from app.api.saisons.cache import invalidate_saison_cache
from app.api.saisons.schemas import FLPatchSaisonPayload, FLSaisonRules
from app.api.saisons.services import RULES_KADER_BELOW_USE, RULES_SHAPE_AFTER_DRAW, RULES_TIEBREAK_AFTER_KNOCKOUT
from app.core.collections import Collection
from app.core.exceptions import DocumentConflictException
from tests.database import a_clean_database

pytestmark = pytest.mark.db

DATABASE_NAME = "fl_rules_refusal_test"

SAISON_ID = "2026"
PRIOR_SAISON_ID = "2025"
SAISON_START = "2026-01-01"
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

# The other value of the closed set, so a case moves `tiebreak_order` to something the model accepts.
OTHER_TIEBREAK = "direkter_vergleich"

# 4 groups x 2 qualifiers is 8, which the ladder enters at the Viertelfinale: 4 fixtures.
KNOCKOUT_FIXTURES = 4
PLAYED_KNOCKOUT_FIXTURES = 1

# Fixed rather than generated, so a failure names the same rows every run.
TEAM_OID = ObjectId("6890a1b2c3d4e5f607240001")
OTHER_TEAM_OID = ObjectId("6890a1b2c3d4e5f607240002")
SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f6072400a1")
KNOCKOUT_SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f6072400a2")
MEMBERSHIP_ID = "6890a1b2c3d4e5f60724{:04d}"
SPIEL_ID = "6890a1b2c3d4e5f60725{:04d}"


def rules_document(**overrides: Any) -> dict[str, Any]:
    """Every key spelled out, so a key added to the model fails here rather than taking a default nobody picked."""

    return {
        "win_points": 3,
        "draw_points": 1,
        "qualifiers_per_group": 2,
        "number_of_groups": 4,
        "teams_per_group": STORED_PER_GROUP,
        "tiebreak_order": "tordifferenz",
        "max_kadergroesse": STORED_KADER,
        "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
        "erlaubte_stufen": ["E1", "Q1", "Q2", "Q3", "Q4"],
        **overrides,
    }


def saison_document() -> dict[str, Any]:
    """`schedule` is derived on read and on no document."""

    return {"_id": SAISON_ID, "start_date": SAISON_START, "end_date": SAISON_END, "status": "active", "rules": rules_document()}


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
    """One `saison_spieler` row. A live one carries an explicit `None`, which is the shape a write leaves and what the `$match` reads."""

    return {
        "_id": ObjectId(MEMBERSHIP_ID.format(index)),
        "spieler_id": ObjectId(MEMBERSHIP_ID.format(500 + index)),
        "saison_id": saison_id,
        "team_id": team_id,
        "is_nachgetragen": False,
        "rolle": None,
        "stufe": "Q2",
        "position": "Angriff",
        "nummer": str(index),
        "inactive_since": inactive_since,
    }


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


def drawn_spiele() -> list[dict[str, Any]]:
    """One matchday's fixtures. No `quelle` on either side, so nothing here can be read as a wired placing."""

    return [
        {
            "_id": ObjectId(SPIEL_ID.format(nr)),
            "spiel_nr": nr,
            "saison_id": SAISON_ID,
            "saison_phase": "gruppenphase",
            "spieltag_id": SPIELTAG_OID,
            "datum": "2026-03-15",
        }
        for nr in range(1, DRAWN_FIXTURES + 1)
    ]


def knockout_spieltag_document() -> dict[str, Any]:
    """The season's first bracket matchday, inside its span and after the group matchday above."""

    return {
        "_id": KNOCKOUT_SPIELTAG_OID,
        "beginn": "2026-04-15",
        "ende": "2026-04-15",
        "position": 1,
        "saison_phase": "viertelfinale",
        "saison_id": SAISON_ID,
    }


def knockout_spiele(*, played: int = 0) -> list[dict[str, Any]]:
    """The bracket's first round, `played` of them carrying a result.

    A RESULT and nothing else, so what closes the window is the fact `has_taken_place` reads rather
    than a side, a date or a booking any of the other rules could answer for.
    """

    return [
        {
            "_id": ObjectId(SPIEL_ID.format(100 + nr)),
            "spiel_nr": DRAWN_FIXTURES + nr,
            "saison_id": SAISON_ID,
            "saison_phase": "viertelfinale",
            "spieltag_id": KNOCKOUT_SPIELTAG_OID,
            "datum": "2026-04-15",
            **({"ergebnis": "3:1"} if nr <= played else {}),
        }
        for nr in range(1, KNOCKOUT_FIXTURES + 1)
    ]


Body = Callable[[AsyncIOMotorDatabase], Awaitable[Any]]


def on_a_database(
    url: str,
    body: Body,
    *,
    spiele: list[dict[str, Any]] | None = None,
    spieltage: list[dict[str, Any]] | None = None,
) -> Any:
    """One client and event loop per call: Motor binds to the loop it first runs on."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME) as (_, database):
            # Process-global and keyed by season id, so an entry another module left would answer for this one.
            invalidate_saison_cache()

            await database[Collection.SAISONS].insert_one(saison_document())
            await database[Collection.SAISON_SPIELER].insert_many(squad_rows())
            await database[Collection.SPIELTAGE].insert_many([spieltag_document(), *(spieltage or [])])
            if spiele:
                await database[Collection.SPIELE].insert_many(spiele)

            return await body(database)

    return asyncio.run(_run())


async def patch_the_rules(database: AsyncIOMotorDatabase, **overrides: Any) -> Any:
    """The whole rules object every time, `rules` being required on the patch, so a case names only the value it changes."""

    return await patch_saison(
        saison_id=SAISON_ID,
        saison_data=FLPatchSaisonPayload(
            start_date=SAISON_START,
            end_date=SAISON_END,
            rules=FLSaisonRules.model_validate(rules_document(**overrides)),
            # Stated rather than omitted: the payload replaces the season wholesale, so `bewerbung`
            # carries no default and this helper is not about the application window.
            bewerbung=None,
        ),
        saisons_collection=database[Collection.SAISONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        spiele_collection=database[Collection.SPIELE],
        spieltage_collection=database[Collection.SPIELTAGE],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        db=database.client,
    )


class TestTheSquadCapIsJudgedAgainstTheSeasonsOwnLiveRows:
    """`REQ-RULES-009` over the aggregation that produces its figure.

    Every other case hands `largest_squad` in already counted, so the `inactive_since` match, the
    season match and the grouping by team reach nothing without a database behind them.
    """

    def test_the_decoy_rows_hold_no_cap_up(self, mongo_replica_set_url: str):
        """One call for the three: each decoy is larger than this cap, so any of them reaching the figure refuses instead."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            return await patch_the_rules(database, max_kadergroesse=PERMITTED_KADER)

        response = on_a_database(mongo_replica_set_url, body)

        assert response.updated_document.rules.max_kadergroesse == PERMITTED_KADER

    def test_a_cap_below_the_live_squad_is_refused(self, mongo_replica_set_url: str):
        """The control: without it the case above would also pass on an aggregation that answered nothing at all."""

        async def body(database: AsyncIOMotorDatabase) -> DocumentConflictException:
            with pytest.raises(DocumentConflictException) as refusal:
                await patch_the_rules(database, max_kadergroesse=REFUSED_KADER)

            return refusal.value

        refusal = on_a_database(mongo_replica_set_url, body)

        assert refusal.error_code == RULES_KADER_BELOW_USE
        # The live squad and nothing larger, so a decoy counted in would show here as well as in the verdict.
        assert str(LIVE_SQUAD) in refusal.error_detail["message"]


class TestTheDrawItselfIsWhatFreezesTheShape:
    """`REQ-RULES-011` through the endpoint, whose count of the season's fixtures is the whole of what the rule turns on."""

    def test_widening_a_group_after_the_draw_is_refused(self, mongo_replica_set_url: str):
        """A widening crosses no other bound: `REQ-RULES-003` reads the narrowing direction and the matchday stays under the wider count."""

        async def body(database: AsyncIOMotorDatabase) -> DocumentConflictException:
            with pytest.raises(DocumentConflictException) as refusal:
                await patch_the_rules(database, teams_per_group=WIDER_PER_GROUP)

            return refusal.value

        refusal = on_a_database(mongo_replica_set_url, body, spiele=drawn_spiele())

        assert refusal.error_code == RULES_SHAPE_AFTER_DRAW
        assert str(DRAWN_FIXTURES) in refusal.error_detail["message"]

    def test_the_same_edit_goes_through_while_nothing_is_drawn(self, mongo_replica_set_url: str):
        """The same season and the same matchday, minus its fixtures: a season still being set up widens freely."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            return await patch_the_rules(database, teams_per_group=WIDER_PER_GROUP)

        response = on_a_database(mongo_replica_set_url, body)

        assert response.updated_document.rules.teams_per_group == WIDER_PER_GROUP


class TestTheKnockoutIsWhatFreezesTheTiebreak:
    """`REQ-RULES-012` through the endpoint, whose count of PLAYED bracket fixtures is what the rule turns on.

    The phase and the predicate are both the endpoint's own: a case here reaches neither by handing
    a number in, which is what the unit tests do.
    """

    def test_a_played_knockout_fixture_freezes_the_order(self, mongo_replica_set_url: str):
        """The bracket was seeded from the group placings this order decides, and one round of it is now on the record."""

        async def body(database: AsyncIOMotorDatabase) -> DocumentConflictException:
            with pytest.raises(DocumentConflictException) as refusal:
                await patch_the_rules(database, tiebreak_order=OTHER_TIEBREAK)

            return refusal.value

        refusal = on_a_database(
            mongo_replica_set_url,
            body,
            spiele=[*drawn_spiele(), *knockout_spiele(played=PLAYED_KNOCKOUT_FIXTURES)],
            spieltage=[knockout_spieltag_document()],
        )

        assert refusal.error_code == RULES_TIEBREAK_AFTER_KNOCKOUT
        # The played one alone: every other bracket fixture counted in would show here as well as in the verdict.
        assert str(PLAYED_KNOCKOUT_FIXTURES) in refusal.error_detail["message"]

    def test_a_knockout_fixture_holding_only_a_shoot_out_freezes_it_too(self, mongo_replica_set_url: str):
        """Through the route, so the endpoint's projection is proven to carry `elfmeterschiessen` to the predicate."""

        decided = [{**knockout_spiele()[0], "elfmeterschiessen": {"team1": 5, "team2": 4}}, *knockout_spiele()[1:]]

        async def body(database: AsyncIOMotorDatabase) -> DocumentConflictException:
            with pytest.raises(DocumentConflictException) as refusal:
                await patch_the_rules(database, tiebreak_order=OTHER_TIEBREAK)

            return refusal.value

        refusal = on_a_database(
            mongo_replica_set_url,
            body,
            spiele=[*drawn_spiele(), *decided],
            spieltage=[knockout_spieltag_document()],
        )

        assert refusal.error_code == RULES_TIEBREAK_AFTER_KNOCKOUT

    def test_a_drawn_but_unplayed_bracket_leaves_the_order_open(self, mongo_replica_set_url: str):
        """The boundary: the fixtures exist and are wired, and re-seeding them costs nobody a round they already played."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            return await patch_the_rules(database, tiebreak_order=OTHER_TIEBREAK)

        response = on_a_database(
            mongo_replica_set_url,
            body,
            spiele=[*drawn_spiele(), *knockout_spiele()],
            spieltage=[knockout_spieltag_document()],
        )

        assert response.updated_document.rules.tiebreak_order == OTHER_TIEBREAK

    def test_a_played_group_fixture_leaves_the_order_open(self, mongo_replica_set_url: str):
        """The narrowing to the bracket: a group still being played is exactly where re-ordering it is a normal correction."""

        played_gruppenphase = [{**drawn_spiele()[0], "ergebnis": "2:0"}, *drawn_spiele()[1:]]

        async def body(database: AsyncIOMotorDatabase) -> Any:
            return await patch_the_rules(database, tiebreak_order=OTHER_TIEBREAK)

        response = on_a_database(
            mongo_replica_set_url,
            body,
            spiele=[*played_gruppenphase, *knockout_spiele()],
            spieltage=[knockout_spieltag_document()],
        )

        assert response.updated_document.rules.tiebreak_order == OTHER_TIEBREAK
