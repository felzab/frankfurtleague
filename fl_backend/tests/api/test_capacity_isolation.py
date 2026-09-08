"""
API · the three rules a count-then-insert reaches, driven with a rival landing inside the window

Each case runs a rival write to completion at the moment the endpoint takes the season's
`bounded_writes`, so the endpoint's own write conflicts on a document the two share. What that
proves is the retry: the callback runs a second time, judges the figure the rival left, and refuses.
The refusals themselves are decided on in `tests/api/test_team_entry_refusal.py`,
`:: test_containment_refusals.py` and `:: test_spieltag_refusals.py`; nothing here re-decides one.
"""

from typing import Any, Awaitable, Callable

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.spieler.admin_router import patch_saison_spieler, post_saison_spieler, reactivate_saison_spieler
from app.api.spieler.schemas import FLPatchSaisonSpielerPayload, FLPostSaisonSpielerPayload
from app.api.spieler.services import SQUAD_FULL
from app.api.spieltage.admin_router import patch_spieltag
from app.api.spieltage.schemas import FLPatchSpieltagPayload
from app.api.spieltage.services import SPIELTAG_BEGINN_OUT_OF_ORDER
from app.api.teams.admin_router import patch_saison_team, post_saison_team
from app.api.teams.schemas import FLPatchSaisonTeamPayload, FLPostSaisonTeamPayload
from app.api.teams.services import ENTRY_GRUPPE_FULL
from app.core.collections import Collection
from app.core.exceptions import DocumentConflictException
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_capacity_isolation_test")

SAISON = "2026"
TEAMS_PER_GROUP = 4
MAX_KADERGROESSE = 18

# What a case reports where nothing refused at all. Reported rather than raised, so a write that
# lands names the state it left instead of an exception that failed to arrive.
COMMITTED = "the write committed"

# The season field every writer judged against one of that season's bounds advances, which is the
# whole of what puts two of them in one write set.
ANCHOR_FIELD = "bounded_writes"

# One phase, two dated positions. The pair each writer moves to is one the other's neighbours
# permit and the committed pair is not.
STANDING_FIRST = "2026-03-01"
STANDING_SECOND = "2026-03-20"
POSTPONED_FIRST = "2026-03-15"
ADVANCED_SECOND = "2026-03-10"


def oid(tail: int) -> ObjectId:
    return ObjectId(f"6890a1b2c3d4e5f608{tail:06d}")


def saison_document() -> dict[str, Any]:
    """`future`, which is the one status `REQ-ENTER-001` admits an entry under."""

    return {
        "_id": SAISON,
        "start_date": "2026-01-01",
        "end_date": "2026-06-30",
        "status": "future",
        "rules": {
            "win_points": 3,
            "draw_points": 1,
            "qualifiers_per_group": 2,
            "number_of_groups": 4,
            "teams_per_group": TEAMS_PER_GROUP,
            "tiebreak_order": "tordifferenz",
            "max_kadergroesse": MAX_KADERGROESSE,
            "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
            "erlaubte_stufen": ["E1", "Q1", "Q2", "Q3", "Q4"],
        },
    }


def team_document(index: int) -> dict[str, Any]:
    return {
        "_id": oid(index),
        "name": f"Schule {index}",
        # Two characters, which is what `FLSaisonTeamResponse` holds a shorthand to.
        "shorthand": f"{index:02d}",
        "description": "",
        "full_name": f"Schule {index} Gesamtschule",
        "website_url": "https://example.de",
        "address": {
            "strasse": "Hanauer Landstraße",
            "hausnummer": "12a",
            "plz": "60314",
            "stadtteil": "Ostend",
            "stadt": "Frankfurt am Main",
        },
        "inactive_since": None,
    }


def junction_document(index: int, gruppe: str) -> dict[str, Any]:
    return {
        "_id": oid(1000 + index),
        "saison_id": SAISON,
        "team_id": oid(index),
        "gruppe": gruppe,
        "austritt": None,
        "name": f"Schule {index}",
        "shorthand": f"{index:02d}",
    }


def spieler_document(index: int) -> dict[str, Any]:
    return {
        "_id": oid(2000 + index),
        "vorname": f"Vorname{index}",
        "nachname": f"Nachname{index}",
        "einwilligung": {
            "umfang": "kader_oeffentlich",
            "erteilt_von": "erziehungsberechtigt",
            "datum": "2026-01-15",
            "bestaetigt_am": "2026-01-20",
        },
        "inactive_since": None,
    }


def squad_document(index: int, team_index: int, *, inactive_since: str | None = None) -> dict[str, Any]:
    return {
        "_id": oid(3000 + index),
        "spieler_id": oid(2000 + index),
        "saison_id": SAISON,
        "team_id": oid(team_index),
        "is_nachgetragen": False,
        "rolle": None,
        "stufe": "Q2",
        "position": "Angriff",
        "nummer": str(index),
        "inactive_since": inactive_since,
    }


def spieltag_document(position: int, beginn: str) -> dict[str, Any]:
    return {
        "_id": oid(4000 + position),
        "beginn": beginn,
        "ende": beginn,
        "saison_phase": "gruppenphase",
        "saison_id": SAISON,
        "position": position,
    }


class SeasonsRunningAHookBeforeTheAnchor:
    """A `saisons` stand-in running one hook just before the write that anchors a bounded judgement.

    Not a subclass: the driver builds a collection off a database handle, so it has to answer every
    other call by delegating.
    """

    def __init__(self, inner: Any, hook: Callable[[], Awaitable[Any]]) -> None:
        self._inner = inner
        self._hook: Callable[[], Awaitable[Any]] | None = hook
        # Every `find_one`. Each pass through a callback reads this season exactly once, so a second
        # read is the retry and no read at all would mean the anchor was never reached.
        self.season_reads = 0

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)

    async def find_one(self, *args: Any, **kwargs: Any) -> Any:
        self.season_reads += 1

        return await self._inner.find_one(*args, **kwargs)

    async def update_many(self, *args: Any, **kwargs: Any) -> Any:
        # ONE-SHOT: the retry has to re-judge against what landed rather than run the interference
        # again, and a second rival would be refused on its own account and mask this one.
        if self._hook is not None:
            hook, self._hook = self._hook, None
            await hook()

        return await self._inner.update_many(*args, **kwargs)


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Body, seed: dict[str, list[Any]]) -> Any:
    """A transaction cannot create a collection, so every one a body writes in is built by the seed."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            for name, rows in seed.items():
                if rows:
                    await database[name].insert_many(rows)

            return await body(database, client)

    return on_the_seed_loop(_run())


async def outcome_of(call: Awaitable[Any]) -> str:
    """A refusal's code, or `COMMITTED`.

    Only a refusal is caught: a write conflict reaching the caller is a retry that never happened,
    and must surface as itself rather than as a write that declined.
    """

    try:
        await call
    except DocumentConflictException as refusal:
        return str(refusal.error_code)

    return COMMITTED


async def anchor_now(database: AsyncDatabase) -> int:
    """The season's token as a later request would read it, which is what the two writers contended on."""

    stored = await database[Collection.SAISONS].find_one({"_id": SAISON})

    return int((stored or {}).get(ANCHOR_FIELD, 0))


class TestASecondEntryLandingMidEntryIsJudgedAgain:
    """Group A holds one free place when both entries judge, and none when the second one writes."""

    def test_the_second_entry_is_refused_on_the_place_the_first_took(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def enter(team_index: int, saisons: Any) -> Any:
                return await post_saison_team(
                    team_id=oid(team_index),
                    saison_team_data=FLPostSaisonTeamPayload(saison_id=SAISON, gruppe="A"),
                    teams_collection=database[Collection.TEAMS],
                    saison_teams_collection=database[Collection.SAISON_TEAMS],
                    saisons_collection=saisons,
                    db=client,
                )

            async def the_rival_takes_the_place() -> None:
                await enter(21, database[Collection.SAISONS])

            seasons = SeasonsRunningAHookBeforeTheAnchor(database[Collection.SAISONS], the_rival_takes_the_place)
            outcome = await outcome_of(enter(20, seasons))

            occupied = await database[Collection.SAISON_TEAMS].count_documents({"saison_id": SAISON, "gruppe": "A"})

            return outcome, seasons.season_reads, occupied, await anchor_now(database)

        outcome, season_reads, occupied, anchor = on_a_league(
            mongo_replica_set_url,
            body,
            {
                Collection.SAISONS: [saison_document()],
                Collection.TEAMS: [team_document(index) for index in (1, 2, 3, 20, 21)],
                Collection.SAISON_TEAMS: [junction_document(index, "A") for index in (1, 2, 3)],
            },
        )

        assert (outcome, occupied) == (ENTRY_GRUPPE_FULL, TEAMS_PER_GROUP)
        assert season_reads == 2, "the callback judged once, so the entry wrote without being re-judged"

        # The rival's take alone: the refused entry's abort took its own back with it, so the token
        # counts the writes that COMMITTED rather than the callbacks that ran.
        assert anchor == 1


class TestASecondSquadWriteLandingMidWriteIsJudgedAgain:
    """One free place in the squad when both writers judge, and none when the second one writes.

    Three verbs reach one helper, so each is driven against a rival add.
    """

    def _squad_seed(self) -> dict[str, list[Any]]:
        """A squad one short of the cap, plus a second club for the transfer and a retired row for the return."""

        return {
            Collection.SAISONS: [saison_document()],
            Collection.TEAMS: [team_document(1), team_document(2)],
            Collection.SAISON_TEAMS: [junction_document(1, "A"), junction_document(2, "B")],
            Collection.SPIELER: [spieler_document(index) for index in [*range(1, MAX_KADERGROESSE), 90, 91, 92]],
            Collection.SAISON_SPIELER: [
                *(squad_document(index, 1) for index in range(1, MAX_KADERGROESSE)),
                # Its club is the OTHER one, so the transfer below moves a live row into the full
                # squad rather than a row already counted in it.
                squad_document(91, 2),
                # Retired, so its place is free and the return has to claim one.
                squad_document(92, 1, inactive_since="2026-02-01"),
            ],
        }

    async def _add(self, database: AsyncDatabase, client: AsyncMongoClient, index: int, saisons: Any) -> Any:
        return await post_saison_spieler(
            spieler_id=oid(2000 + index),
            saison_spieler_data=FLPostSaisonSpielerPayload(
                saison_id=SAISON,
                team_id=oid(1),
                nummer=str(index),
                position="Angriff",
                stufe="Q2",
                is_nachgetragen=False,
                rolle=None,
            ),
            saison_spieler_collection=database[Collection.SAISON_SPIELER],
            saison_teams_collection=database[Collection.SAISON_TEAMS],
            saisons_collection=saisons,
            db=client,
        )

    def _run(self, url: str, under_test: Callable[[AsyncDatabase, AsyncMongoClient, Any], Awaitable[Any]]) -> Any:
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def the_rival_takes_the_place() -> None:
                await self._add(database, client, 90, database[Collection.SAISONS])

            seasons = SeasonsRunningAHookBeforeTheAnchor(database[Collection.SAISONS], the_rival_takes_the_place)
            outcome = await outcome_of(under_test(database, client, seasons))

            squad = await database[Collection.SAISON_SPIELER].count_documents({"saison_id": SAISON, "team_id": oid(1), "inactive_since": None})

            return outcome, seasons.season_reads, squad, await anchor_now(database)

        return on_a_league(url, body, self._squad_seed())

    def test_an_add_is_refused_on_the_place_a_rival_add_took(self, mongo_replica_set_url: str):
        outcome, season_reads, squad, anchor = self._run(
            mongo_replica_set_url, lambda database, client, saisons: self._add(database, client, 91, saisons)
        )

        assert (outcome, squad) == (SQUAD_FULL, MAX_KADERGROESSE)
        assert (season_reads, anchor) == (2, 1), "the callback judged once, so the add wrote without being re-judged"

    def test_a_transfer_is_refused_on_the_place_a_rival_add_took(self, mongo_replica_set_url: str):
        async def transfer(database: AsyncDatabase, client: AsyncMongoClient, saisons: Any) -> Any:
            return await patch_saison_spieler(
                spieler_id=oid(2091),
                saison_id=SAISON,
                saison_spieler_data=FLPatchSaisonSpielerPayload(
                    team_id=oid(1), nummer="91", position="Angriff", stufe="Q2", is_nachgetragen=False, rolle=None
                ),
                saison_spieler_collection=database[Collection.SAISON_SPIELER],
                saison_teams_collection=database[Collection.SAISON_TEAMS],
                saisons_collection=saisons,
                db=client,
            )

        outcome, season_reads, squad, anchor = self._run(mongo_replica_set_url, transfer)

        assert (outcome, squad) == (SQUAD_FULL, MAX_KADERGROESSE)
        assert (season_reads, anchor) == (2, 1), "the callback judged once, so the transfer wrote without being re-judged"

    def test_a_return_is_refused_on_the_place_a_rival_add_took(self, mongo_replica_set_url: str):
        async def bring_back(database: AsyncDatabase, client: AsyncMongoClient, saisons: Any) -> Any:
            return await reactivate_saison_spieler(
                spieler_id=oid(2092),
                saison_id=SAISON,
                saison_spieler_collection=database[Collection.SAISON_SPIELER],
                saison_teams_collection=database[Collection.SAISON_TEAMS],
                saisons_collection=saisons,
                db=client,
            )

        outcome, season_reads, squad, anchor = self._run(mongo_replica_set_url, bring_back)

        assert (outcome, squad) == (SQUAD_FULL, MAX_KADERGROESSE)
        assert (season_reads, anchor) == (2, 1), "the callback judged once, so the return wrote without being re-judged"


class TestASecondDatingLandingMidDatingIsJudgedAgain:
    """Each writer's step passes against the day the other is replacing, and the pair they would leave runs backwards."""

    def test_the_second_dating_is_refused_on_the_day_the_first_left(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def redate(position: int, beginn: str, saisons: Any) -> Any:
                return await patch_spieltag(
                    spieltag_id=oid(4000 + position),
                    spieltag_data=FLPatchSpieltagPayload(beginn=beginn, ende=beginn),
                    spieltage_collection=database[Collection.SPIELTAGE],
                    saisons_collection=saisons,
                    spiele_collection=database[Collection.SPIELE],
                    db=client,
                )

            async def the_rival_advances_the_second() -> None:
                await redate(2, ADVANCED_SECOND, database[Collection.SAISONS])

            seasons = SeasonsRunningAHookBeforeTheAnchor(database[Collection.SAISONS], the_rival_advances_the_second)
            outcome = await outcome_of(redate(1, POSTPONED_FIRST, seasons))

            rows = await database[Collection.SPIELTAGE].find({"saison_id": SAISON}).sort([("position", 1)]).to_list(length=None)

            return outcome, seasons.season_reads, [row["beginn"] for row in rows], await anchor_now(database)

        outcome, season_reads, beginns, anchor = on_a_league(
            mongo_replica_set_url,
            body,
            {
                Collection.SAISONS: [saison_document()],
                Collection.SPIELTAGE: [spieltag_document(1, STANDING_FIRST), spieltag_document(2, STANDING_SECOND)],
            },
        )

        # The rival's advance stands and the postponement does not, so the phase reads forwards.
        assert (outcome, beginns) == (SPIELTAG_BEGINN_OUT_OF_ORDER, [STANDING_FIRST, ADVANCED_SECOND])
        assert (season_reads, anchor) == (2, 1), "the callback judged once, so the re-dating wrote without being re-judged"

    def test_two_matchdays_of_one_phase_still_reach_one_day_together(self, mongo_replica_set_url: str):
        """The control: the comparison is strict, so the anchor may not turn a lawful pair into a refusal."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def redate(position: int, beginn: str, saisons: Any) -> Any:
                return await patch_spieltag(
                    spieltag_id=oid(4000 + position),
                    spieltag_data=FLPatchSpieltagPayload(beginn=beginn, ende=beginn),
                    spieltage_collection=database[Collection.SPIELTAGE],
                    saisons_collection=saisons,
                    spiele_collection=database[Collection.SPIELE],
                    db=client,
                )

            async def the_rival_moves_the_second_onto_the_same_day() -> None:
                await redate(2, POSTPONED_FIRST, database[Collection.SAISONS])

            seasons = SeasonsRunningAHookBeforeTheAnchor(database[Collection.SAISONS], the_rival_moves_the_second_onto_the_same_day)
            outcome = await outcome_of(redate(1, POSTPONED_FIRST, seasons))

            rows = await database[Collection.SPIELTAGE].find({"saison_id": SAISON}).sort([("position", 1)]).to_list(length=None)

            return outcome, seasons.season_reads, [row["beginn"] for row in rows]

        outcome, season_reads, beginns = on_a_league(
            mongo_replica_set_url,
            body,
            {
                Collection.SAISONS: [saison_document()],
                Collection.SPIELTAGE: [spieltag_document(1, STANDING_FIRST), spieltag_document(2, STANDING_SECOND)],
            },
        )

        assert (outcome, beginns) == (COMMITTED, [POSTPONED_FIRST, POSTPONED_FIRST])
        assert season_reads == 2, "the callback judged once, so the pair was never re-judged against the rival's day"


class TestAGroupMoveLandingMidEntryIsJudgedAgain:
    """The move reaches the same rule an entry does, from the endpoint that writes an existing row."""

    def test_the_move_is_refused_on_the_place_a_rival_entry_took(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def move(saisons: Any) -> Any:
                return await patch_saison_team(
                    team_id=oid(30),
                    saison_id=SAISON,
                    saison_team_data=FLPatchSaisonTeamPayload(gruppe="A", austritt=None, trikot_farbe=None),
                    saison_teams_collection=database[Collection.SAISON_TEAMS],
                    saisons_collection=saisons,
                    spiele_collection=database[Collection.SPIELE],
                    db=client,
                )

            async def the_rival_enters_the_group() -> None:
                await post_saison_team(
                    team_id=oid(21),
                    saison_team_data=FLPostSaisonTeamPayload(saison_id=SAISON, gruppe="A"),
                    teams_collection=database[Collection.TEAMS],
                    saison_teams_collection=database[Collection.SAISON_TEAMS],
                    saisons_collection=database[Collection.SAISONS],
                    db=client,
                )

            seasons = SeasonsRunningAHookBeforeTheAnchor(database[Collection.SAISONS], the_rival_enters_the_group)
            outcome = await outcome_of(move(seasons))

            occupied = await database[Collection.SAISON_TEAMS].count_documents({"saison_id": SAISON, "gruppe": "A"})

            return outcome, seasons.season_reads, occupied

        outcome, season_reads, occupied = on_a_league(
            mongo_replica_set_url,
            body,
            {
                Collection.SAISONS: [saison_document()],
                Collection.TEAMS: [team_document(index) for index in (1, 2, 3, 21, 30)],
                # Three in A and the mover standing in B, so the group has exactly one free place.
                Collection.SAISON_TEAMS: [*(junction_document(index, "A") for index in (1, 2, 3)), junction_document(30, "B")],
            },
        )

        assert (outcome, occupied) == (ENTRY_GRUPPE_FULL, TEAMS_PER_GROUP)
        assert season_reads == 2, "the callback judged once, so the move wrote without being re-judged"
