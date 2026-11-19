import asyncio
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from itertools import combinations, product
from typing import Any

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure, PyMongoError

from app.api.saisons.admin_router import delete_spielplan, patch_saison, post_spielplan
from app.api.saisons.schedule import group_spieltage
from app.api.saisons.schemas import (
    FLGenerateSpielplanPayload,
    FLPatchSaisonPayload,
    FLSaisonRules,
)
from app.api.spielberichte.person_router import put_spielbericht_bericht
from app.api.spielberichte.schemas import FLSpielberichtBerichtPayload, FLSpielberichtPayload
from app.api.teams.services import offered_gruppen
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError
from app.shared.schemas.responses import FLVersionResponse
from tests import documents
from tests.database import DOCUMENT_VALIDATION_FAILED, a_clean_database
from tests.isolation import COMMITTED, outcome_of, refused_code
from tests.records import record_collections
from tests.stored import the_row
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_spielplan_write_test")


SAISON_ID = "2026"

# A SECOND season, drawn beside the one under test and never asked to be redrawn: what a removal
# that lost its `saison_id` would take with it.
NEIGHBOUR_SAISON_ID = "2025"

# Minted well clear of the subject rows, so only the filter can leave a neighbour standing.
NEIGHBOUR_OID_OFFSET = 100

# Fixed rather than the real day, so the watermark's date is a value this file chose.
TODAY = "2026-08-21"

GROUPS = 4
TEAMS_PER_GROUP = 4
QUALIFIERS = 2

# `(number_of_groups, teams_per_group, qualifiers_per_group)`: the ordinary season, and one whose odd
# groups take a bye round and whose bracket opens at the semi-finals, the smallest the rules take.
SHAPES: tuple[tuple[int, int, int], ...] = ((GROUPS, TEAMS_PER_GROUP, QUALIFIERS), (2, 3, 2))
SHAPE_IDS = ("four groups of four into a quarter-final", "two odd groups into a semi-final")


def rules_document(*, groups: int = GROUPS, teams: int = TEAMS_PER_GROUP, qualifiers: int = QUALIFIERS) -> dict[str, Any]:
    return documents.rules_document(qualifiers_per_gruppe=qualifiers, number_of_gruppen=groups, teams_per_gruppe=teams)


def saison_document(
    *,
    saison_id: str = SAISON_ID,
    status: str = "future",
    rules: dict[str, Any] | None = None,
    start_date: str = "2026-01-01",
    end_date: str = "2026-06-30",
) -> dict[str, Any]:
    """The default span is half a year, so `saison_span_below_spielplan` is what no case not about it can be refused on."""

    return documents.saison_document(saison_id, status, start_date=start_date, end_date=end_date, rules=rules or rules_document())


def entry_rows(
    *,
    saison_id: str = SAISON_ID,
    offset: int = 0,
    groups: int = GROUPS,
    teams: int = TEAMS_PER_GROUP,
) -> list[dict[str, Any]]:
    """Every club of a full season as its `saison_teams` row.

    `offset` moves both ObjectId runs along, seeding a second season that shares no row and no club.
    """

    rows: list[dict[str, Any]] = []
    # Interleaved, so entry order and group membership disagree: a draw partitioning by list
    # position pairs clubs that never meet.
    for index, (seat, gruppe) in enumerate(product(range(teams), offered_gruppen(groups))):
        rows.append(
            documents.saison_team_document(
                saison_id,
                ObjectId(f"6890a1b2c3d4e5f6075{index + offset:05d}"),
                f"{gruppe}{seat + 1}-Schule",
                f"{gruppe}S{chr(65 + seat)}",
                _id=ObjectId(f"6890a1b2c3d4e5f6074{index + offset:05d}"),
                gruppe=gruppe,
            )
        )

    return rows


@dataclass(frozen=True)
class Seed:
    """One season as the database holds it when the draw is asked for, and a second beside it where a case asks for one."""

    saison: dict[str, Any] = field(default_factory=saison_document)
    entered: list[dict[str, Any]] = field(default_factory=entry_rows)
    spiele: list[dict[str, Any]] = field(default_factory=list)
    #: Seeded only by a case about what a removal must NOT reach: a database holding one season
    #: answers the same whether the removal was scoped or took the collection.
    neighbour: dict[str, Any] | None = None
    neighbour_entered: list[dict[str, Any]] = field(default_factory=list)


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


async def on_a_seeded_saison(
    url: str, body: Body, *, seed: Seed | None = None, mutates_schema: bool = False, stores_a_refused_shape: str | None = None
) -> Any:
    """The shipped unique indexes, so a document MongoDB would refuse in production fails here.

    `mutates_schema=True` where the body installs a validator (`tests/database.py :: a_clean_database`).
    """

    seeded = seed or Seed()

    async with a_clean_database(
        url, DATABASE_NAME, constraints=True, mutates_schema=mutates_schema, stores_a_refused_shape=stores_a_refused_shape
    ) as (client, database):
        await database[Collection.SAISONS].insert_one(seeded.saison)
        await database[Collection.SAISON_TEAMS].insert_many(seeded.entered)
        if seeded.spiele:
            await database[Collection.SPIELE].insert_many(seeded.spiele)

        if seeded.neighbour is not None:
            await database[Collection.SAISONS].insert_one(seeded.neighbour)
            await database[Collection.SAISON_TEAMS].insert_many(seeded.neighbour_entered)

        return await body(database, client)


async def call_draw(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    *,
    saison_id: str = SAISON_ID,
    replace: bool = False,
    today: str = TODAY,
    spielberichte_collection: Any = None,
    saisons_collection: Any = None,
) -> None:
    await post_spielplan(
        saison_id=saison_id,
        saisons_collection=database[Collection.SAISONS] if saisons_collection is None else saisons_collection,
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        spiele_collection=database[Collection.SPIELE],
        spieltage_collection=database[Collection.SPIELTAGE],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        spielberichte_collection=database[Collection.SPIELBERICHTE] if spielberichte_collection is None else spielberichte_collection,
        aufstellungen_collection=database[Collection.AUFSTELLUNGEN],
        db=client,
        spielplan_data=FLGenerateSpielplanPayload(replace=replace),
        today=today,
    )


async def call_undraw(
    database: AsyncDatabase, client: AsyncMongoClient, *, spielberichte_collection: Any = None, saisons_collection: Any = None
) -> None:
    await delete_spielplan(
        saison_id=SAISON_ID,
        saisons_collection=database[Collection.SAISONS] if saisons_collection is None else saisons_collection,
        spiele_collection=database[Collection.SPIELE],
        spieltage_collection=database[Collection.SPIELTAGE],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        spielberichte_collection=database[Collection.SPIELBERICHTE] if spielberichte_collection is None else spielberichte_collection,
        aufstellungen_collection=database[Collection.AUFSTELLUNGEN],
        db=client,
    )


async def stored_rules(database: AsyncDatabase) -> dict[str, Any]:
    """The season's whole `rules` sub-document, read outside any transaction -- what a later request would find."""

    return (await the_row(database, Collection.SAISONS, {"_id": SAISON_ID}, f"the seed holds no season {SAISON_ID}"))["rules"]


async def call_patch_rules(database: AsyncDatabase, **overrides: Any) -> FLVersionResponse:
    """The whole rules object every time, `rules` being required on the patch, so a case names only the value it changes.

    The seed's own dates, so `saison_span_below_spieltage` and `saison_span_below_spielplan` cannot be what a refusal is about,
    judged the day before its start, so `rules_saison_started` cannot either.
    """

    seeded = saison_document()

    return await patch_saison(
        saison_id=SAISON_ID,
        saison_data=FLPatchSaisonPayload(
            start_date=seeded["start_date"],
            end_date=seeded["end_date"],
            rules=FLSaisonRules.model_validate({**rules_document(), **overrides}),
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
        today=str(date.fromisoformat(seeded["start_date"]) - timedelta(days=1)),
    )


async def counts_now(database: AsyncDatabase, *, saison_id: str = SAISON_ID) -> tuple[int, int]:
    """The season's matchdays and fixtures, read outside any transaction -- what a later request would see."""

    return (
        await database[Collection.SPIELTAGE].count_documents({"saison_id": saison_id}),
        await database[Collection.SPIELE].count_documents({"saison_id": saison_id}),
    )


async def watermark_now(database: AsyncDatabase) -> Any:
    stored = await database[Collection.SAISONS].find_one({"_id": SAISON_ID})

    return (stored or {}).get("spielplan")


def bracket_rounds(rules: FLSaisonRules) -> tuple[int, ...]:
    """How many matches each knockout round holds, halving the qualifier product down to one final.

    Derived here rather than through `knockout_phases_for`, which the draw walks: an oracle reading
    that function would agree with a draw one round short. The Finale's matchday adds the match for
    third place wherever semi-finals precede it.
    """

    # `rules_bracket_impossible` refuses a product that is no power of two, so the halving always lands on 1.
    remaining = rules.number_of_gruppen * rules.qualifiers_per_gruppe

    sizes: list[int] = []
    while remaining >= 2:
        sizes.append(remaining // 2)
        remaining //= 2

    return (*sizes[:-1], sizes[-1] + 1) if len(sizes) > 1 else tuple(sizes)


def group_phase_count(rules: FLSaisonRules) -> int:
    """Every group-phase fixture these rules imply: `C(n, 2)` per group."""

    return rules.number_of_gruppen * (rules.teams_per_gruppe * (rules.teams_per_gruppe - 1) // 2)


def expected_counts(rules: FLSaisonRules) -> tuple[int, int]:
    """How many matchdays and fixtures these rules imply, from arithmetic rather than the draw's own helpers.

    A combination for the group phase and a halved product for the bracket, so neither half can
    agree with the draw by sharing a function with it.
    """

    bracket = bracket_rounds(rules)
    spieltage = group_spieltage(rules.teams_per_gruppe) + len(bracket)

    return spieltage, group_phase_count(rules) + sum(bracket)


@dataclass(frozen=True)
class DrawnSeason:
    """One committed draw, read back three ways, so the assertions run outside the event loop."""

    saison: dict[str, Any]
    entered: list[dict[str, Any]]
    spieltage: list[dict[str, Any]]
    spiele: list[dict[str, Any]]


async def a_drawn_season(url: str, *, groups: int = GROUPS, teams: int = TEAMS_PER_GROUP, qualifiers: int = QUALIFIERS) -> DrawnSeason:
    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> DrawnSeason:
        await call_draw(database, client)

        saison = await database[Collection.SAISONS].find_one({"_id": SAISON_ID})
        assert saison is not None, f"the seed holds no season {SAISON_ID}"

        return DrawnSeason(
            saison=saison,
            # The junction rows the draw itself read: what a stored side's club and name are checked against.
            entered=await database[Collection.SAISON_TEAMS].find({}).to_list(length=None),
            # Insertion order on both, which is playing order: the draw emits `spiel_nr` contiguously
            # from 1 and every generated `_id` rises with the clock.
            spieltage=await database[Collection.SPIELTAGE].find({}).sort("_id", 1).to_list(length=None),
            spiele=await database[Collection.SPIELE].find({}).sort("spiel_nr", 1).to_list(length=None),
        )

    seed = Seed(
        saison=saison_document(rules=rules_document(groups=groups, teams=teams, qualifiers=qualifiers)),
        entered=entry_rows(groups=groups, teams=teams),
    )

    drawn = await on_a_seeded_saison(url, body, seed=seed)

    # Every case below FILTERS these lists, and a filter over an empty one holds trivially. What the
    # counts should be is `expected_counts`' judgement, not this one's.
    assert drawn.spieltage and drawn.spiele, "the draw wrote nothing"

    return drawn


def junction_by_team(drawn: DrawnSeason) -> dict[Any, Mapping[str, Any]]:
    """The `saison_teams` rows the draw read, keyed by club."""

    return {row["team_id"]: row for row in drawn.entered}


def side_from(junction_row: Mapping[str, Any]) -> dict[str, Any]:
    """One side as a drawn fixture must store it: the club and no goals, its name joined at read off the row."""

    return {"team_id": junction_row["team_id"], "tore": None}


def group_spiele(drawn: DrawnSeason) -> list[dict[str, Any]]:
    """This season's group fixtures, counted before they are handed back so no filter over them can pass on a short draw."""

    rules = FLSaisonRules.model_validate(drawn.saison["rules"])
    spiele = [row for row in drawn.spiele if row["saison_phase"] == "gruppenphase"]

    assert len(spiele) == group_phase_count(rules)

    return spiele


class TestACleanDrawWritesTheWholeSeason:
    @pytest.mark.parametrize(
        ("groups", "teams", "qualifiers"),
        SHAPES,
        ids=SHAPE_IDS,
    )
    async def test_the_stored_counts_are_the_ones_the_rules_imply(self, mongo_replica_set_url: str, groups: int, teams: int, qualifiers: int):
        """Both numbers read off the database, which is what the draw wrote rather than what it meant to."""

        drawn = await a_drawn_season(mongo_replica_set_url, groups=groups, teams=teams, qualifiers=qualifiers)
        expected = expected_counts(FLSaisonRules.model_validate(drawn.saison["rules"]))

        assert (len(drawn.spieltage), len(drawn.spiele)) == expected


class TestTheGroupPhaseIsEachGroupsOwnRoundRobin:
    """What no count can see: a draw partitioning by list position rather than by `gruppe` writes the right NUMBER of wrong fixtures.

    `entry_rows` interleaves the groups so the two partitions disagree, and these are the assertions
    that read the difference.
    """

    async def test_each_group_plays_every_pair_of_its_own_teams_once(self, mongo_replica_set_url: str):
        """The whole round robin, not merely a legal-looking one.

        A repeated pair leaves two clubs that never meet, and a table neither of them was ranked by.
        """

        drawn = await a_drawn_season(mongo_replica_set_url)
        junction = junction_by_team(drawn)

        played: dict[Any, list[frozenset[Any]]] = {}
        for row in group_spiele(drawn):
            gruppe = junction[row["team1"]["team_id"]]["gruppe"]
            played.setdefault(gruppe, []).append(frozenset((row["team1"]["team_id"], row["team2"]["team_id"])))

        teams_by_gruppe: dict[Any, list[Any]] = {}
        for row in drawn.entered:
            teams_by_gruppe.setdefault(row["gruppe"], []).append(row["team_id"])

        for gruppe, ids in teams_by_gruppe.items():
            pairs = played.get(gruppe, [])
            assert len(pairs) == len(set(pairs)), f"gruppe {gruppe} draws a pair more than once"
            assert set(pairs) == {frozenset(pair) for pair in combinations(ids, 2)}

    async def test_each_side_is_stored_as_the_team_the_junction_holds(self, mongo_replica_set_url: str):
        """The club and no goals, a drawn fixture having not happened, and no name, which every read joins off the row."""

        drawn = await a_drawn_season(mongo_replica_set_url)
        junction = junction_by_team(drawn)

        assert [
            (row["spiel_nr"], slot)
            for row in group_spiele(drawn)
            for slot in ("team1", "team2")
            if row[slot] != side_from(junction[row[slot]["team_id"]])
        ] == []


@dataclass(frozen=True)
class RefusedDraw:
    """A draw refused before it wrote, and the season it left standing."""

    error_code: str
    spieltage: int
    spiele: int
    watermark: Any


class TestEachRefusalIsReachedThroughTheRoute:
    """That the two refusal calls are WIRED, not merely written: an unwired refusal is a green suite and a dead rule."""

    @pytest.mark.parametrize(
        ("code", "seed"),
        [
            pytest.param(Code.SAISON_PAST, Seed(saison=saison_document(status="past")), id="a season already finished"),
            # The other half of `spielplan_gruppen_off_rules`: these clubs stand in groups the season does not
            # offer, so the draw would put them in no round robin at all.
            pytest.param(
                Code.SPIELPLAN_GRUPPEN_OFF_RULES,
                Seed(saison=saison_document(rules=rules_document(groups=2)), entered=entry_rows(groups=4)),
                id="clubs in a group the season does not offer",
            ),
            # `find_rules_refusal`, the OTHER call, the groups matching the rules so nothing above answers
            # first: six qualifiers make no bracket.
            pytest.param(
                Code.RULES_BRACKET_IMPOSSIBLE,
                Seed(saison=saison_document(rules=rules_document(groups=2, qualifiers=3)), entered=entry_rows(groups=2)),
                id="rules whose product is no bracket",
            ),
        ],
    )
    async def test_a_season_that_cannot_be_drawn_is_refused_and_nothing_is_written(self, mongo_replica_set_url: str, code: str, seed: Seed):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> RefusedDraw:
            code = await refused_code(call_draw(database, client))

            spieltage, spiele = await counts_now(database)

            return RefusedDraw(error_code=code, spieltage=spieltage, spiele=spiele, watermark=await watermark_now(database))

        refused = await on_a_seeded_saison(mongo_replica_set_url, body, seed=seed)

        assert refused.error_code == code
        # Exactly what the seed put there: a refusal reached after a write would read higher.
        assert (refused.spieltage, refused.spiele) == (0, len(seed.spiele))
        assert refused.watermark is None


# Each installs a validator on one collection, so the write named below is refused where it
# stands. `date` is null on every drawn fixture and `spielplan` is an object on every watermark.
NARROWED_VALIDATORS: dict[Collection, dict[str, Any]] = {
    Collection.SPIELE: {"$jsonSchema": {"bsonType": "object", "properties": {"date": {"bsonType": "string"}}}},
    Collection.SAISONS: {"$jsonSchema": {"bsonType": "object", "properties": {"spielplan": {"bsonType": "string"}}}},
}


def refused_write(failure: OperationFailure) -> tuple[Any, Any]:
    """The code the SERVER answered with, and the field it named.

    `failure.code` alone names the driver's `BulkWriteError` wrapper, and the field is what says
    which of the three writes fell.
    """

    refused = ((failure.details or {}).get("writeErrors") or [failure.details or {}])[0]
    rules = ((refused.get("errInfo") or {}).get("details") or {}).get("schemaRulesNotSatisfied") or []
    unsatisfied = rules[0].get("propertiesNotSatisfied") if rules else None

    return refused.get("code", failure.code), unsatisfied[0]["propertyName"] if unsatisfied else None


@dataclass(frozen=True)
class AbortedDraw:
    """A draw that fell mid-flight, as the driver reported it and as a later request would find the season."""

    write_error: Any
    refused_field: Any
    spieltage: int
    spiele: int
    watermark: Any


class TestAFailedDrawLeavesNothingBehind:
    """`/spiele` has neither a create nor a delete, so a half-written draw could not be repaired through the API at all."""

    @pytest.mark.parametrize(
        ("narrowed", "refused_field"),
        [
            pytest.param(Collection.SPIELE, "date", id="the fixtures, once the matchdays are written"),
            pytest.param(Collection.SAISONS, "spielplan", id="the watermark, once both collections are written"),
        ],
    )
    async def test_neither_collection_keeps_a_document_nor_the_season_a_watermark(
        self, mongo_replica_set_url: str, narrowed: Collection, refused_field: str
    ):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> AbortedDraw:
            await database.command("collMod", str(narrowed), validator=NARROWED_VALIDATORS[narrowed], validationLevel="strict")

            with pytest.raises(OperationFailure) as failure:
                await call_draw(database, client)

            code, field_named = refused_write(failure.value)
            spieltage, spiele = await counts_now(database)

            return AbortedDraw(
                write_error=code,
                refused_field=field_named,
                spieltage=spieltage,
                spiele=spiele,
                watermark=await watermark_now(database),
            )

        aborted = await on_a_seeded_saison(mongo_replica_set_url, body, mutates_schema=True)

        # Asserted on the code, so this cannot pass because something failed before the first write.
        assert aborted.write_error == DOCUMENT_VALIDATION_FAILED, f"expected the validator to refuse the write, got code {aborted.write_error}"
        # `date` sits on no matchday: the write that fell is the one this case narrowed, so the
        # writes before it had already run.
        assert aborted.refused_field == refused_field
        assert (aborted.spieltage, aborted.spiele) == (0, 0), "a rolled-back draw left documents behind"
        assert aborted.watermark is None, "the season claims a Spielplan the rollback took away"


# Planted beside the shipped indexes: two matchdays of one phase share this key, so the draw's own
# batch collides with itself, which no seed can make the shipped indexes do.


# The replace's own day, so a watermark the first draw left behind reads as one rather than passing
# for the new one.
REDRAWN_TODAY = "2026-08-25"

# The one record the DRAW itself never writes a key for, so a projection missing `note` reads a
# noted fixture as untouched and the replace destroys the note.
A_NOTE = "Platz gesperrt"

# One fixture carrying one of these closes the window `spielplan_replace_outside_its_window` opens. None is played by
# `has_taken_place`, so each says the window reads `holds_a_recorded_fact` instead.
RECORDS_CLOSING_THE_WINDOW = (
    pytest.param({"sonderereignis": "ausgefallen"}, id="a cancellation, which has_taken_place reads as untouched"),
    pytest.param({"note": A_NOTE}, id="an admin's note"),
)

# Wider than the drawn shape, so `rules_capacity_below_use` reads the other way and `rules_shape_after_spielplan` is the
# only rule that can answer.
WIDER_PER_GROUP = 6


async def document_ids(database: AsyncDatabase) -> set[Any]:
    """Every id the season's two drawn collections hold, which is what says a document is GONE rather than replaced by as many."""

    found: set[Any] = set()
    for collection in (Collection.SPIELTAGE, Collection.SPIELE):
        found |= {row["_id"] for row in await database[collection].find({}, {"_id": 1}).to_list(length=None)}

    return found


@dataclass(frozen=True)
class ReplacedSeason:
    """One season drawn, then drawn again over the top, as a later request would find it."""

    first_ids: set[Any]
    spieltage: list[dict[str, Any]]
    spiele: list[dict[str, Any]]


async def a_replaced_season(url: str) -> ReplacedSeason:
    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> ReplacedSeason:
        await call_draw(database, client)
        # Read between the two calls: afterwards nothing tells a surviving row from a fresh one
        # carrying the same numbers.
        first_ids = await document_ids(database)

        await call_draw(database, client, replace=True, today=REDRAWN_TODAY)

        return ReplacedSeason(
            first_ids=first_ids,
            spieltage=await database[Collection.SPIELTAGE].find({}).sort("_id", 1).to_list(length=None),
            spiele=await database[Collection.SPIELE].find({}).sort("spiel_nr", 1).to_list(length=None),
        )

    replaced = await on_a_seeded_saison(url, body)

    assert replaced.first_ids, "the first draw wrote nothing, so the replace had nothing to remove"

    return replaced


def a_confirmation(saison_id: str) -> dict[str, Any]:
    """An open team row of one season's fixture, as the sweep mints it; the fixture itself need not exist for the removal's filter."""

    home = ObjectId()
    spiel = documents.spiel_document(
        spiel_id=ObjectId(),
        saison_id=saison_id,
        spiel_nr=1,
        spieltag_id=ObjectId(),
        team1={"team_id": home, "tore": None},
        team2={"team_id": ObjectId(), "tore": None},
        date="2026-05-01",
        time="18:00:00",
    )

    return documents.spielbestaetigung_document(spiel, party={"kind": "team", "team_id": home})


def a_report(saison_id: str) -> dict[str, Any]:
    """A report document on no fixture, which no count of submitted reports joins: the removal's filter reads the season alone."""

    return documents.spielbericht_document({"_id": ObjectId(), "saison_id": saison_id})


async def report_a_drawn_spiel(database: AsyncDatabase) -> None:
    """A submitted report on a fixture the draw holds: the refusal counts only a report whose fixture stands."""

    spiel = await database[Collection.SPIELE].find_one({"saison_id": SAISON_ID})
    assert spiel is not None, "the premise: the season is drawn"
    await database[Collection.SPIELBERICHTE].insert_one(documents.spielbericht_document(spiel))


class TestAReplaceTakesTheSeasonsReports:
    async def test_the_seasons_reports_go_and_the_neighbours_stay(self, mongo_replica_set_url: str):
        """Drop the replace's report delete and this fails: a report document would name a fixture the replace removed.

        The season's names no fixture the draw holds, so it refuses nothing; the neighbour's stands.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[int, int]:
            await call_draw(database, client)
            await database[Collection.SPIELBERICHTE].insert_many([a_report(SAISON_ID), a_report(NEIGHBOUR_SAISON_ID)])
            await call_draw(database, client, replace=True, today=REDRAWN_TODAY)

            berichte = database[Collection.SPIELBERICHTE]
            return (
                await berichte.count_documents({"saison_id": SAISON_ID}),
                await berichte.count_documents({"saison_id": NEIGHBOUR_SAISON_ID}),
            )

        assert await on_a_seeded_saison(mongo_replica_set_url, body) == (0, 1)


class TestASubmittedReportKeepsTheSpielplanFromAReplace:
    """`spielplan_berichte_submitted` wired: the replace counts the season's submitted reports in its transaction."""

    async def test_the_reports_refuse_the_replace(self, mongo_replica_set_url: str):
        """Drop the count and the replace lands over the report, deleting it with the fixture it is about."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            await call_draw(database, client)
            await report_a_drawn_spiel(database)

            return await refused_code(call_draw(database, client, replace=True, today=REDRAWN_TODAY))

        assert await on_a_seeded_saison(mongo_replica_set_url, body) == Code.SPIELPLAN_BERICHTE_SUBMITTED


# How long the report holds its commit for the removal. The hold lets go once the removal's anchor meets the report's
# season write, the crossing proved, so this bounds only a run that never crosses.
HOLD_S = 2.0

# The race cases' fixture is played the day before their report is written.
PLAYED_ON = "2026-08-20"
REPORTED_AT = datetime(2026, 8, 21, 12, tzinfo=UTC)

# The referee the race cases' fixture is booked to, whose own route writes the report.
REPORTING_REFEREE = ObjectId("6890a1b2c3d4e5f607760103")
REPORTING_REFEREE_EMAIL = "otto.gruber@example.com"

# A goalless report, the least a write takes.
NULL_NULL = FLSpielberichtBerichtPayload.model_validate(
    {
        "ergebnis_vorschlag": {"elfmeterschiessen": None, "sonderereignis": None},
        "scorers": [],
        "cards": [],
        "remarks": None,
    }
)


async def held_until(event: asyncio.Event) -> None:
    try:
        await asyncio.wait_for(event.wait(), timeout=HOLD_S)
    except TimeoutError:
        return


class RefereesHeldAfterTheReportsSeasonAnchor:
    """The report's referee collection, holding the write open once it anchored the referee, the season anchored before.

    Every judgement is past by then, and the season is the one document the removal writes that the report holds, so
    whatever lands during the hold meets the report there first.
    """

    def __init__(self, collection: Any, *, judged: asyncio.Event, other: asyncio.Event) -> None:
        self._collection = collection
        self._judged = judged
        self._other = other

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    async def update_many(self, *args: Any, **kwargs: Any) -> Any:
        anchored = await self._collection.update_many(*args, **kwargs)
        if not self._judged.is_set():
            self._judged.set()
            await held_until(self._other)

        return anchored


# Never `tests/isolation.py :: InterleavedCollection`, which awaits its rival inside the write: a removal nested in the
# open report conflicts on every retry, and the report cannot commit until the server kills its transaction.
class RemovalsAnchorMeetingTheReport:
    """Counts each time the removal's season anchor meets the write the report holds open, and says so.

    That meeting is the crossing: a removal arriving after the report's commit meets nothing, yet passes every other assertion.
    """

    def __init__(self, collection: Any, *, met: asyncio.Event) -> None:
        self._collection = collection
        self._met = met
        self.conflicts = 0

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    async def update_many(self, *args: Any, **kwargs: Any) -> Any:
        try:
            return await self._collection.update_many(*args, **kwargs)
        except PyMongoError as conflict:
            if conflict.has_error_label("TransientTransactionError"):
                self.conflicts += 1
                self._met.set()
            raise


async def a_referees_first_report(database: AsyncDatabase, client: AsyncMongoClient, *, spiel_id: ObjectId, schiedsrichter: Any) -> str:
    """Through the referee's route, so its own call of the season's anchor is the one under test."""

    return await outcome_of(
        put_spielbericht_bericht(
            spiel_id=spiel_id,
            bericht_data=FLSpielberichtPayload(bericht=NULL_NULL, version=None),
            identifier=REPORTING_REFEREE_EMAIL,
            spiele_collection=database[Collection.SPIELE],
            saisons_collection=database[Collection.SAISONS],
            saison_spieler_collection=database[Collection.SAISON_SPIELER],
            spieler_collection=database[Collection.SPIELER],
            spielberichte_collection=database[Collection.SPIELBERICHTE],
            schiedsrichter_collection=schiedsrichter,
            records=record_collections(database),
            db=client,
            germany_now=REPORTED_AT,
        )
    )


async def a_reportable_spiel(database: AsyncDatabase) -> ObjectId:
    """A group fixture played before the report's day and booked to the reporting referee.

    The booking is a recorded fact, which closes the removal's window, so each race takes it off before the removal judges.
    """

    await database[Collection.SCHIEDSRICHTER].insert_one(
        documents.schiedsrichter_document(
            REPORTING_REFEREE,
            email=REPORTING_REFEREE_EMAIL,
            name="Otto Gruber",
            default_payment=20,
            einwilligung=documents.own_einwilligung_document(text_versions=documents.SCHIEDSRICHTER_TEXT_VERSIONS, confirmed_at="2026-01-10"),
        )
    )
    spiel = await database[Collection.SPIELE].find_one({"saison_id": SAISON_ID, "saison_phase": "gruppenphase"})
    assert spiel is not None, "the premise: the season is drawn"
    await database[Collection.SPIELE].update_one(
        {"_id": spiel["_id"]},
        {"$set": {"date": PLAYED_ON, "schiedsrichter": {"schiedsrichter_id": REPORTING_REFEREE, "payment": 20}}},
    )

    return spiel["_id"]


async def take_the_referee_off(database: AsyncDatabase, spiel_id: ObjectId) -> None:
    await database[Collection.SPIELE].update_one({"_id": spiel_id}, {"$set": {"schiedsrichter": None}})


async def orphaned_reports(database: AsyncDatabase) -> list[ObjectId]:
    standing = {row["_id"] for row in await database[Collection.SPIELE].find({}, {"_id": 1}).to_list()}

    return [row["_id"] async for row in database[Collection.SPIELBERICHTE].find() if row["spiel_id"] not in standing]


Removal = Callable[[Any], Awaitable[Any]]


async def a_report_crossed_by(database: AsyncDatabase, client: AsyncMongoClient, removal: Removal) -> Any:
    """The report passes its judgement on the booked fixture and anchors the season; the booking goes, and the removal runs in the hold."""

    spiel_id = await a_reportable_spiel(database)
    # Set by the removal's anchor meeting the report, whichever retry meets it first: the hold's end.
    judged, met = asyncio.Event(), asyncio.Event()
    referees = RefereesHeldAfterTheReportsSeasonAnchor(database[Collection.SCHIEDSRICHTER], judged=judged, other=met)
    anchors = RemovalsAnchorMeetingTheReport(database[Collection.SAISONS], met=met)

    async def the_removal() -> str:
        await held_until(judged)
        await take_the_referee_off(database, spiel_id)
        return await outcome_of(removal(anchors))

    # A group rather than a gather: whichever side raises, the other is cancelled and drained here, not left to land in the
    # next case's database.
    async with asyncio.TaskGroup() as group:
        reported = group.create_task(a_referees_first_report(database, client, spiel_id=spiel_id, schiedsrichter=referees))
        removed = group.create_task(the_removal())

    return [reported.result(), removed.result()], await orphaned_reports(database), anchors.conflicts


class TestAFirstReportCrossingADrawsRemovalMeetsItOnTheSeason:
    """The removal lands inside the report's tail, every judgement past, before the report's commit."""

    async def test_a_same_day_redraw_landing_inside_a_report_never_leaves_it_orphaned(self, mongo_replica_set_url: str):
        """The redraw's watermark write changes nothing, so only its own anchor writes the season the report anchors."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_draw(database, client)
            return await a_report_crossed_by(
                database, client, lambda saisons: call_draw(database, client, replace=True, saisons_collection=saisons)
            )

        (report, replace), orphans, conflicts = await on_a_seeded_saison(mongo_replica_set_url, body)

        assert conflicts > 0, "the replace's anchor never met the report inside it, so nothing below is the crossing"
        assert orphans == [], f"a report outlives the replace: the report {report!r}, the replace {replace!r}"
        assert COMMITTED in (report, replace), "neither side landed"

    async def test_an_undraw_of_a_season_holding_no_watermark_landing_inside_a_report_never_leaves_it_orphaned(
        self, mongo_replica_set_url: str
    ):
        """A season drawn outside this API holds no watermark, so the undraw's `$unset` changes nothing and only its anchor meets the report."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_draw(database, client)
            await database[Collection.SAISONS].update_one({"_id": SAISON_ID}, {"$unset": {"spielplan": ""}})
            return await a_report_crossed_by(database, client, lambda saisons: call_undraw(database, client, saisons_collection=saisons))

        (report, undraw), orphans, conflicts = await on_a_seeded_saison(mongo_replica_set_url, body)

        assert conflicts > 0, "the undraw's anchor never met the report inside it, so nothing below is the crossing"
        assert orphans == [], f"a report outlives the undraw: the report {report!r}, the undraw {undraw!r}"
        assert COMMITTED in (report, undraw), "neither side landed"


class TestAReplaceTakesTheSeasonsConfirmations:
    async def test_the_seasons_rows_go_and_the_neighbours_stay(self, mongo_replica_set_url: str):
        """Drop the replace's confirmation delete and this fails: a row would name a fixture the replace removed."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[int, int]:
            await call_draw(database, client)
            await database[Collection.SPIELBESTAETIGUNGEN].insert_many([a_confirmation(SAISON_ID), a_confirmation(NEIGHBOUR_SAISON_ID)])
            await call_draw(database, client, replace=True, today=REDRAWN_TODAY)

            confirmations = database[Collection.SPIELBESTAETIGUNGEN]
            return (
                await confirmations.count_documents({"saison_id": SAISON_ID}),
                await confirmations.count_documents({"saison_id": NEIGHBOUR_SAISON_ID}),
            )

        assert await on_a_seeded_saison(mongo_replica_set_url, body) == (0, 1)

    async def test_the_seasons_line_ups_go_and_the_neighbours_stay(self, mongo_replica_set_url: str):
        """Drop the line-ups' removal and this fails: one would name pupils for a fixture the replace removed."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[str]:
            await call_draw(database, client)
            await database[Collection.AUFSTELLUNGEN].insert_many(
                [
                    documents.aufstellung_document({"_id": ObjectId(), "saison_id": saison_id}, ObjectId(), starters=[ObjectId()])
                    for saison_id in (SAISON_ID, NEIGHBOUR_SAISON_ID)
                ]
            )
            await call_draw(database, client, replace=True, today=REDRAWN_TODAY)

            return [row["saison_id"] async for row in database[Collection.AUFSTELLUNGEN].find()]

        assert await on_a_seeded_saison(mongo_replica_set_url, body) == [NEIGHBOUR_SAISON_ID]


class TestAConfirmedReplaceRedrawsTheWholeSeason:
    """`spielplan_replace_outside_its_window`'s write half: the season's two lists are removed and drawn again inside one transaction."""

    async def test_no_document_of_the_first_draw_survives(self, mongo_replica_set_url: str):
        """Drop either delete and this fails: a replace is these rows being GONE, never as many fresh ones standing beside them."""

        replaced = await a_replaced_season(mongo_replica_set_url)
        surviving = {row["_id"] for row in (*replaced.spieltage, *replaced.spiele)}

        assert surviving & replaced.first_ids == set()
        assert surviving, "the replace removed the season and drew nothing back"

        # Exactly one whole draw afterwards: delete only `spiele` and the fresh matchdays collide with the surviving ones
        # on their own unique index.
        expected = expected_counts(FLSaisonRules.model_validate(saison_document()["rules"]))
        assert (len(replaced.spieltage), len(replaced.spiele)) == expected

        # Every fixture hangs on a matchday the replace itself wrote: the two lists go as one set.
        matchdays = {row["_id"] for row in replaced.spieltage}
        assert [row["spiel_nr"] for row in replaced.spiele if row["spieltag_id"] not in matchdays] == []


@dataclass(frozen=True)
class NeighbouringSeasons:
    """Two drawn seasons, one of them replaced, each collection counted for each season separately."""

    subject_spieltage: int
    subject_spiele: int
    # The neighbour's own two counts as its draw stored them, before the subject's replace.
    neighbour_drawn: tuple[int, int]
    neighbour_spieltage: int
    neighbour_spiele: int


async def a_season_replaced_beside_another(url: str) -> NeighbouringSeasons:
    """Draw both seasons, close the neighbour, then replace the subject's draw alone."""

    seed = Seed(
        neighbour=saison_document(saison_id=NEIGHBOUR_SAISON_ID),
        neighbour_entered=entry_rows(saison_id=NEIGHBOUR_SAISON_ID, offset=NEIGHBOUR_OID_OFFSET),
    )

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> NeighbouringSeasons:
        await call_draw(database, client, saison_id=NEIGHBOUR_SAISON_ID)
        neighbour_drawn = await counts_now(database, saison_id=NEIGHBOUR_SAISON_ID)

        # Demoted to `past` after its draw: what an unscoped removal takes from a finished season is
        # the fixture set its league table is scored from on every read.
        await database[Collection.SAISONS].update_one({"_id": NEIGHBOUR_SAISON_ID}, {"$set": {"status": "past"}})

        await call_draw(database, client)
        await call_draw(database, client, replace=True, today=REDRAWN_TODAY)

        subject_spieltage, subject_spiele = await counts_now(database)
        neighbour_spieltage, neighbour_spiele = await counts_now(database, saison_id=NEIGHBOUR_SAISON_ID)

        return NeighbouringSeasons(
            subject_spieltage=subject_spieltage,
            subject_spiele=subject_spiele,
            neighbour_drawn=neighbour_drawn,
            neighbour_spieltage=neighbour_spieltage,
            neighbour_spiele=neighbour_spiele,
        )

    neighbours = await on_a_seeded_saison(url, body, seed=seed)

    assert neighbours.neighbour_drawn[1] > 0, "the neighbour was drawn nothing, so its survival proves nothing"

    return neighbours


class TestAConfirmedReplaceReachesNoOtherSeason:
    """That the replace's two deletes are bounded by their `saison_id`, proved against a season standing beside the one redrawn."""

    async def test_the_neighbours_spiele_and_matchdays_all_survive(self, mongo_replica_set_url: str):
        """Empty either delete's `db_filter` in `post_spielplan` and this fails; with one season seeded, nothing does.

        Each collection its own assertion, never a pair compared as one: a comparison of the two together passes while half
        the neighbour is gone.
        """

        neighbours = await a_season_replaced_beside_another(mongo_replica_set_url)

        assert neighbours.neighbour_spiele == neighbours.neighbour_drawn[1]
        assert neighbours.neighbour_spieltage == neighbours.neighbour_drawn[0]


class TestAnAbortedReplaceLeavesTheSeasonStanding:
    """The deletes and the redraw are one transaction, so a fixture insert that falls takes the removal back with it."""

    async def test_both_collections_keep_every_document_the_replace_would_have_removed(self, mongo_replica_set_url: str):
        """Move either delete outside the callback and this fails: the season would be left holding no schedule at all."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> AbortedDraw:
            await call_draw(database, client)
            standing = await document_ids(database)

            # Narrowed AFTER the first draw, so what falls is the replace's own insert, by which
            # point both deletes have run.
            await database.command(
                "collMod", str(Collection.SPIELE), validator=NARROWED_VALIDATORS[Collection.SPIELE], validationLevel="strict"
            )

            with pytest.raises(OperationFailure) as failure:
                await call_draw(database, client, replace=True, today=REDRAWN_TODAY)

            code, field_named = refused_write(failure.value)
            spieltage, spiele = await counts_now(database)

            assert await document_ids(database) == standing, "a rolled-back replace left the season's own draw removed"

            return AbortedDraw(
                write_error=code,
                refused_field=field_named,
                spieltage=spieltage,
                spiele=spiele,
                watermark=await watermark_now(database),
            )

        aborted = await on_a_seeded_saison(mongo_replica_set_url, body, mutates_schema=True)

        # On the code, so this cannot pass because the replace fell before it deleted anything.
        assert aborted.write_error == DOCUMENT_VALIDATION_FAILED, f"expected the validator to refuse the write, got {aborted.write_error}"
        assert aborted.refused_field == "date"
        assert aborted.watermark == {"generated_at": TODAY}


class TestTheReplaceWindowIsReachedThroughTheRoute:
    """`spielplan_replace_outside_its_window` WIRED: the endpoint reads its fixtures' recorded facts inside the transaction."""

    @pytest.mark.parametrize("record", RECORDS_CLOSING_THE_WINDOW)
    async def test_a_single_recorded_spiel_is_refused_the_replace(self, mongo_replica_set_url: str, record: dict[str, Any]):
        """Count these off anything but the stored rows and both fail."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_draw(database, client)
            await database[Collection.SPIELE].update_one({"spiel_nr": 1}, {"$set": record})
            standing = await document_ids(database)

            with pytest.raises(APIError) as refused:
                await call_draw(database, client, replace=True, today=REDRAWN_TODAY)

            return refused.value, standing, await document_ids(database)

        refused, standing, surviving = await on_a_seeded_saison(mongo_replica_set_url, body)

        assert refused.error_code == Code.SPIELPLAN_REPLACE_OUTSIDE_ITS_WINDOW
        assert surviving == standing


class TestADrawnSeasonKeepsItsShapeUntilItIsUndrawn:
    """`rules_shape_after_spielplan` WIRED, over the season the cases above judge the replace on.

    The patch writes the whole `rules` object, so a shape reaching it would stand beside fixtures no
    longer drawn from it. An undraw opens the three again, and the next draw runs from what is saved.
    """

    async def test_a_drawn_future_season_with_nothing_recorded_is_refused_too(self, mongo_replica_set_url: str):
        """The state a carve-out for repairs would sit in: nothing recorded, nothing played, and the fixtures still standing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_draw(database, client)

            with pytest.raises(APIError) as refused:
                await call_patch_rules(database, teams_per_gruppe=WIDER_PER_GROUP)

            return refused.value, await stored_rules(database)

        refused, rules = await on_a_seeded_saison(mongo_replica_set_url, body)

        assert refused.error_code == Code.RULES_SHAPE_AFTER_SPIELPLAN
        # Read back, not inferred from the refusal: a rule raised after the write would refuse and store.
        assert rules["teams_per_gruppe"] == TEAMS_PER_GROUP
