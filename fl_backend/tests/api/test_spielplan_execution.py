import asyncio
from dataclasses import dataclass, field
from itertools import combinations, product
from typing import Any, Awaitable, Callable, Mapping

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo.errors import OperationFailure

from app.api.saisons.admin_router import generate_spielplan, patch_saison
from app.api.saisons.cache import invalidate_saison_cache, read_cached_saison, store_cached_saison
from app.api.saisons.schedule import group_matchdays, total_group_matches
from app.api.saisons.schemas import (
    FLGenerateSpielplanPayload,
    FLGenerateSpielplanResponse,
    FLPatchSaisonPayload,
    FLPatchSaisonResponse,
    FLSaisonRules,
    FLSpielplanShape,
)
from app.api.saisons.services import (
    RULES_BRACKET_IMPOSSIBLE,
    RULES_SHAPE_AFTER_DRAW,
    SAISON_SPAN_BELOW_SCHEDULE,
    SPIELPLAN_ALREADY_DRAWN,
    SPIELPLAN_GRUPPEN_OFF_RULES,
    SPIELPLAN_MATCHDAYS_HELD,
    SPIELPLAN_REPLACE_OUTSIDE_ITS_WINDOW,
    SPIELPLAN_SAISON_FINISHED,
)
from app.api.saisons.spielplan import BRACKET_SEEDING
from app.api.spiele.schemas import KNOCKOUT_PHASES, FLSpiel
from app.api.spieltage.schemas import FLSpieltag
from app.api.spieltage.services import with_expected_matches
from app.api.teams.services import offered_gruppen
from app.core.collections import Collection
from app.core.exceptions import DocumentConflictException
from app.core.logging import correlation_id_var
from tests.database import a_clean_database

pytestmark = pytest.mark.db

DATABASE_NAME = "fl_spielplan_write_test"

# Named rather than caught broadly: another failure must not read as the rollback this suite proves.
DOCUMENT_VALIDATION_FAILED = 121

SAISON_ID = "2026"

# A SECOND season, drawn beside the one under test and never asked to be redrawn: what a removal
# that lost its `saison_id` would take with it.
NEIGHBOUR_SAISON_ID = "2025"

# The neighbour's rows are minted well clear of the subject's, so the two seasons share no `_id`
# and no club. A neighbour left standing can then only be the filter's doing.
NEIGHBOUR_OID_OFFSET = 100

# Fixed rather than the real day, so the watermark's date is a value this file chose.
TODAY = "2026-08-21"

# Bound as a request binds it, so "these rows are one action" is a real reading rather than the
# system default answering for every row in the database.
CORRELATION_ID = "0123456789abcdef0123456789abcdef"

GROUPS = 4
TEAMS_PER_GROUP = 4
QUALIFIERS = 2

# `(number_of_groups, teams_per_group, qualifiers_per_group)`: the ordinary season, and one whose odd
# groups take a bye round and whose bracket is a single final.
SHAPES: tuple[tuple[int, int, int], ...] = ((GROUPS, TEAMS_PER_GROUP, QUALIFIERS), (2, 3, 1))
SHAPE_IDS = ("four groups of four into a quarter-final", "two odd groups into one final")

# Deliberately in no collection until a case seeds it: a matchday and the fixture hanging on it are
# each their own refusal.
STORED_SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f607760001")
STORED_SPIEL_OID = ObjectId("6890a1b2c3d4e5f607760002")

UNDATED_SPIEL_FIELDS: tuple[str, ...] = ("datum", "uhrzeit", "ort", "schiedsrichter")


def rules_document(*, groups: int = GROUPS, teams: int = TEAMS_PER_GROUP, qualifiers: int = QUALIFIERS) -> dict[str, Any]:
    """3/1 and a 3:0 forfeit are the ordinary competition, so no rule this file is not about refuses the draw first."""

    return {
        "win_points": 3,
        "draw_points": 1,
        "qualifiers_per_group": qualifiers,
        "number_of_groups": groups,
        "teams_per_group": teams,
        "tiebreak_order": "tordifferenz",
        "max_kadergroesse": 18,
        "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
        "erlaubte_stufen": ["E1", "Q1", "Q2", "Q3", "Q4"],
    }


def saison_document(
    *,
    saison_id: str = SAISON_ID,
    status: str = "future",
    rules: dict[str, Any] | None = None,
    start_date: str = "2026-01-01",
    end_date: str = "2026-06-30",
) -> dict[str, Any]:
    """Every key spelled out: the shipped `saisons` validator is attached before this is inserted.

    The default span is half a year, so `REQ-DATE-005` is what no case not about it can be refused on.
    """

    return {
        "_id": saison_id,
        "start_date": start_date,
        "end_date": end_date,
        "status": status,
        "rules": rules or rules_document(),
    }


def entry_rows(
    *,
    saison_id: str = SAISON_ID,
    offset: int = 0,
    groups: int = GROUPS,
    teams: int = TEAMS_PER_GROUP,
    short_gruppe: str | None = None,
) -> list[dict[str, Any]]:
    """Every club of a full season as its `saison_teams` row; `short_gruppe` leaves one group a club down.

    `offset` moves both ObjectId runs along, seeding a second season that shares no row and no club.
    """

    rows: list[dict[str, Any]] = []
    # Interleaved, so entry order and group membership disagree: a draw partitioning by list
    # position pairs clubs that never meet.
    for index, (seat, gruppe) in enumerate(product(range(teams), offered_gruppen(groups))):
        if gruppe == short_gruppe and seat == teams - 1:
            continue

        rows.append(
            {
                "_id": ObjectId(f"6890a1b2c3d4e5f6074{index + offset:05d}"),
                "saison_id": saison_id,
                "team_id": ObjectId(f"6890a1b2c3d4e5f6075{index + offset:05d}"),
                "gruppe": gruppe,
                "austritt": None,
                "name": f"{gruppe}{seat + 1}-Schule",
                "shorthand": f"{gruppe}{seat + 1}",
            }
        )

    return rows


def a_stored_matchday() -> dict[str, Any]:
    """Undated, which is the shape the draw itself leaves: `REQ-SPIELPLAN-002` counts rows and reads no field of one."""

    return {
        "_id": STORED_SPIELTAG_OID,
        "beginn": None,
        "ende": None,
        "saison_phase": "gruppenphase",
        "saison_id": SAISON_ID,
        "position": 1,
    }


def a_stored_fixture() -> dict[str, Any]:
    """Every key spelled out, the `spiele` validator being attached: an unoccupied group fixture, the least this season could already hold."""

    return {
        "_id": STORED_SPIEL_OID,
        "team1": None,
        "team2": None,
        "team1_quelle": None,
        "team2_quelle": None,
        "datum": None,
        "uhrzeit": None,
        "ort": None,
        "schiedsrichter": None,
        "ergebnis": None,
        "elfmeterschiessen": None,
        "spieltag_id": STORED_SPIELTAG_OID,
        "spiel_nr": 1,
        "sonderereignis": None,
        "saison_phase": "gruppenphase",
        "saison_id": SAISON_ID,
    }


@dataclass(frozen=True)
class Seed:
    """One season as the database holds it when the draw is asked for, and a second beside it where a case asks for one."""

    saison: dict[str, Any] = field(default_factory=saison_document)
    entered: list[dict[str, Any]] = field(default_factory=entry_rows)
    spiele: list[dict[str, Any]] = field(default_factory=list)
    spieltage: list[dict[str, Any]] = field(default_factory=list)
    #: Seeded only by a case about what a removal must NOT reach: a database holding one season
    #: answers the same whether the removal was scoped or took the collection.
    neighbour: dict[str, Any] | None = None
    neighbour_entered: list[dict[str, Any]] = field(default_factory=list)


Body = Callable[[AsyncIOMotorDatabase, AsyncIOMotorClient], Awaitable[Any]]


def on_a_seeded_saison(url: str, body: Body, *, seed: Seed | None = None, mutates_schema: bool = False) -> Any:
    """The SHIPPED validators and unique indexes, so a document MongoDB would refuse in production fails here.

    `mutates_schema=True` where the body narrows one of those validators: `tests/database.py` then
    keeps the change off every later test.
    """

    seeded = seed or Seed()

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True, mutates_schema=mutates_schema) as (client, database):
            # Process-global and keyed by season id, so an entry another module left would answer for this one.
            invalidate_saison_cache()
            # `asyncio.run` copies the context, so nothing set here reaches another test.
            correlation_id_var.set(CORRELATION_ID)

            await database[Collection.SAISONS].insert_one(seeded.saison)
            await database[Collection.SAISON_TEAMS].insert_many(seeded.entered)
            if seeded.spieltage:
                await database[Collection.SPIELTAGE].insert_many(seeded.spieltage)
            if seeded.spiele:
                await database[Collection.SPIELE].insert_many(seeded.spiele)

            if seeded.neighbour is not None:
                await database[Collection.SAISONS].insert_one(seeded.neighbour)
                await database[Collection.SAISON_TEAMS].insert_many(seeded.neighbour_entered)

            return await body(database, client)

    return asyncio.run(_run())


async def call_draw(
    database: AsyncIOMotorDatabase,
    client: AsyncIOMotorClient,
    *,
    saison_id: str = SAISON_ID,
    replace: bool = False,
    today: str = TODAY,
    shape: FLSpielplanShape | None = None,
) -> FLGenerateSpielplanResponse:
    return await generate_spielplan(
        saison_id=saison_id,
        saisons_collection=database[Collection.SAISONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        spiele_collection=database[Collection.SPIELE],
        spieltage_collection=database[Collection.SPIELTAGE],
        db=client,
        spielplan_data=FLGenerateSpielplanPayload(replace=replace, shape=shape),
        today=today,
    )


def a_shape(*, groups: int = GROUPS, teams: int = TEAMS_PER_GROUP, qualifiers: int = QUALIFIERS) -> FLSpielplanShape:
    """The three the draw's payload carries, defaulting to the seed's own so a case states only the number it moves."""

    return FLSpielplanShape(number_of_groups=groups, teams_per_group=teams, qualifiers_per_group=qualifiers)


async def stored_rules(database: AsyncIOMotorDatabase) -> dict[str, Any]:
    """The season's whole `rules` sub-document, read outside any transaction -- what a later request would find."""

    stored = await database[Collection.SAISONS].find_one({"_id": SAISON_ID})
    assert stored is not None, f"the seed holds no season {SAISON_ID}"

    return stored["rules"]


async def call_patch_rules(database: AsyncIOMotorDatabase, **overrides: Any) -> FLPatchSaisonResponse:
    """The whole rules object every time, `rules` being required on the patch, so a case names only the value it changes.

    The seed's own dates, so `REQ-DATE-004` and `REQ-DATE-005` cannot be what a refusal is about.
    """

    seeded = saison_document()

    return await patch_saison(
        saison_id=SAISON_ID,
        saison_data=FLPatchSaisonPayload(
            start_date=seeded["start_date"],
            end_date=seeded["end_date"],
            rules=FLSaisonRules.model_validate({**rules_document(), **overrides}),
        ),
        saisons_collection=database[Collection.SAISONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        spiele_collection=database[Collection.SPIELE],
        spieltage_collection=database[Collection.SPIELTAGE],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        db=database.client,
    )


async def counts_now(database: AsyncIOMotorDatabase, *, saison_id: str = SAISON_ID) -> tuple[int, int]:
    """The season's matchdays and fixtures, read outside any transaction -- what a later request would see."""

    return (
        await database[Collection.SPIELTAGE].count_documents({"saison_id": saison_id}),
        await database[Collection.SPIELE].count_documents({"saison_id": saison_id}),
    )


async def watermark_now(database: AsyncIOMotorDatabase) -> Any:
    stored = await database[Collection.SAISONS].find_one({"_id": SAISON_ID})

    return (stored or {}).get("spielplan")


def bracket_rounds(rules: FLSaisonRules) -> tuple[int, ...]:
    """How many matches each knockout round holds, halving the qualifier product down to one final.

    Derived here rather than through `knockout_phases_for`, which the draw walks: an oracle reading
    that function would agree with a draw one round short.
    """

    # `REQ-RULES-001` refuses a product that is no power of two, so the halving always lands on 1.
    remaining = rules.number_of_groups * rules.qualifiers_per_group

    sizes: list[int] = []
    while remaining >= 2:
        sizes.append(remaining // 2)
        remaining //= 2

    return tuple(sizes)


def expected_counts(rules: FLSaisonRules) -> tuple[int, int]:
    """How many matchdays and fixtures these rules imply, from arithmetic rather than the draw's own helpers.

    A combination for the group phase and a halved product for the bracket, so neither half can
    agree with the draw by sharing a function with it.
    """

    bracket = bracket_rounds(rules)
    spieltage = group_matchdays(rules.teams_per_group) + len(bracket)

    return spieltage, total_group_matches(rules.number_of_groups, rules.teams_per_group) + sum(bracket)


@dataclass(frozen=True)
class DrawnSeason:
    """One committed draw, read back five ways, so the assertions run outside the event loop."""

    response: FLGenerateSpielplanResponse
    saison: dict[str, Any]
    entered: list[dict[str, Any]]
    spieltage: list[dict[str, Any]]
    spiele: list[dict[str, Any]]
    log: list[dict[str, Any]]


def a_drawn_season(url: str, *, groups: int = GROUPS, teams: int = TEAMS_PER_GROUP, qualifiers: int = QUALIFIERS) -> DrawnSeason:
    async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> DrawnSeason:
        response = await call_draw(database, client)

        saison = await database[Collection.SAISONS].find_one({"_id": SAISON_ID})
        assert saison is not None, f"the seed holds no season {SAISON_ID}"

        return DrawnSeason(
            response=response,
            saison=saison,
            # The junction rows the draw itself read: what a stored side's club and name are checked against.
            entered=await database[Collection.SAISON_TEAMS].find({}).to_list(length=None),
            # Insertion order on both, which is playing order: the draw emits `spiel_nr` contiguously
            # from 1 and every generated `_id` rises with the clock.
            spieltage=await database[Collection.SPIELTAGE].find({}).sort("_id", 1).to_list(length=None),
            spiele=await database[Collection.SPIELE].find({}).sort("spiel_nr", 1).to_list(length=None),
            log=await database[Collection.AKTIONEN].find({}).sort("_id", 1).to_list(length=None),
        )

    seed = Seed(
        saison=saison_document(rules=rules_document(groups=groups, teams=teams, qualifiers=qualifiers)),
        entered=entry_rows(groups=groups, teams=teams),
    )

    drawn = on_a_seeded_saison(url, body, seed=seed)

    # Every case below FILTERS these lists, and a filter over an empty one holds trivially. What the
    # counts should be is `expected_counts`' judgement, not this one's.
    assert drawn.spieltage and drawn.spiele, "the draw wrote nothing"
    assert (len(drawn.spieltage), len(drawn.spiele)) == (drawn.response.spieltage, drawn.response.spiele)

    return drawn


def junction_by_team(drawn: DrawnSeason) -> dict[Any, Mapping[str, Any]]:
    """The `saison_teams` rows the draw read, keyed by club."""

    return {row["team_id"]: row for row in drawn.entered}


def side_from(junction_row: Mapping[str, Any]) -> dict[str, Any]:
    """One side as a drawn fixture must store it: the club, the season's own name for it, and no goals."""

    return {
        "team_id": junction_row["team_id"],
        "name": junction_row["name"],
        "shorthand": junction_row["shorthand"],
        "tore": None,
    }


def group_fixtures(drawn: DrawnSeason) -> list[dict[str, Any]]:
    """This season's group fixtures, counted before they are handed back so no filter over them can pass on a short draw."""

    rules = FLSaisonRules.model_validate(drawn.saison["rules"])
    fixtures = [row for row in drawn.spiele if row["saison_phase"] == "gruppenphase"]

    assert len(fixtures) == total_group_matches(rules.number_of_groups, rules.teams_per_group)

    return fixtures


def knockout_rounds(drawn: DrawnSeason) -> list[list[dict[str, Any]]]:
    """The bracket's fixtures grouped by matchday, each round and each round's fixtures in playing order."""

    rounds: dict[Any, list[dict[str, Any]]] = {}
    for row in drawn.spiele:
        if row["saison_phase"] != "gruppenphase":
            rounds.setdefault(row["spieltag_id"], []).append(row)

    ordered = [sorted(fixtures, key=lambda row: row["spiel_nr"]) for fixtures in rounds.values()]

    return sorted(ordered, key=lambda fixtures: fixtures[0]["spiel_nr"])


class TestACleanDrawWritesTheWholeSeason:
    @pytest.mark.parametrize(
        ("groups", "teams", "qualifiers"),
        SHAPES,
        ids=SHAPE_IDS,
    )
    def test_the_stored_counts_are_the_ones_the_rules_imply(self, mongo_replica_set_url: str, groups: int, teams: int, qualifiers: int):
        """Both numbers read off the database rather than off the response, which would otherwise report what the draw MEANT to write."""

        drawn = a_drawn_season(mongo_replica_set_url, groups=groups, teams=teams, qualifiers=qualifiers)
        expected = expected_counts(FLSaisonRules.model_validate(drawn.saison["rules"]))

        assert (len(drawn.spieltage), len(drawn.spiele)) == expected
        assert (drawn.response.spieltage, drawn.response.spiele) == expected
        assert drawn.response.saison_id == SAISON_ID

    def test_the_watermark_carries_the_same_pair_and_the_day_it_was_drawn(self, mongo_replica_set_url: str):
        """The two numbers an admin compares against the page in front of them; a watermark disagreeing with the season is the whole damage."""

        drawn = a_drawn_season(mongo_replica_set_url)

        assert drawn.saison["spielplan"] == {"generiert_am": TODAY, "spieltage": len(drawn.spieltage), "spiele": len(drawn.spiele)}
        assert drawn.response.generiert_am == TODAY


class TestTheDrawnDocumentsSurviveMongoDB:
    """The shipped `$jsonSchema` validators are attached before the call, so a document production would refuse is refused here."""

    def test_every_row_reads_back_through_the_model_that_serves_it(self, mongo_replica_set_url: str):
        """`anzahl_spiele` is derived and on no matchday document, so a stored row reaches its model only through `with_expected_matches`."""

        drawn = a_drawn_season(mongo_replica_set_url)
        rules = FLSaisonRules.model_validate(drawn.saison["rules"])

        assert [FLSpieltag.model_validate(with_expected_matches(row, rules)).id for row in drawn.spieltage] == [
            row["_id"] for row in drawn.spieltage
        ]
        assert [FLSpiel.model_validate(row).spiel_nr for row in drawn.spiele] == list(range(1, len(drawn.spiele) + 1))

    def test_the_numbers_are_stored_as_ints_and_the_ids_as_objectids(self, mongo_replica_set_url: str):
        """Read off the RAW documents, which the models would coerce.

        An id stored as its string matches no fixture, and a text `spiel_nr` sorts 10 before 2.
        `type`, not `isinstance`: `bson.Int64` passes an int check while `{"bsonType": "int"}` refuses it.
        """

        drawn = a_drawn_season(mongo_replica_set_url)

        assert [row["position"] for row in drawn.spieltage if type(row["position"]) is not int] == []
        assert [row["spiel_nr"] for row in drawn.spiele if type(row["spiel_nr"]) is not int] == []
        assert [row["_id"] for row in (*drawn.spieltage, *drawn.spiele) if not isinstance(row["_id"], ObjectId)] == []
        assert [row["spiel_nr"] for row in drawn.spiele if not isinstance(row["spieltag_id"], ObjectId)] == []

    def test_every_fixture_hangs_on_a_matchday_the_same_call_wrote(self, mongo_replica_set_url: str):
        """The draw generates both ids together rather than reading one back, and no validator pairs them, so only a real read settles it.

        Equality rather than containment: it also says no matchday was written that nothing plays on.
        """

        drawn = a_drawn_season(mongo_replica_set_url)

        assert {row["spieltag_id"] for row in drawn.spiele} == {row["_id"] for row in drawn.spieltage}


class TestNothingTheDrawWritesIsDated:
    """The draw settles who plays whom and in what order; a date, a ground and a referee are each set afterwards, one row at a time."""

    def test_no_matchday_carries_a_span(self, mongo_replica_set_url: str):
        drawn = a_drawn_season(mongo_replica_set_url)

        assert [row["position"] for row in drawn.spieltage if row["beginn"] is not None or row["ende"] is not None] == []

    def test_no_fixture_carries_a_date_a_ground_or_a_referee(self, mongo_replica_set_url: str):
        drawn = a_drawn_season(mongo_replica_set_url)

        assert [row["spiel_nr"] for row in drawn.spiele if any(row[key] is not None for key in UNDATED_SPIEL_FIELDS)] == []


class TestTheGroupPhaseIsEachGroupsOwnRoundRobin:
    """What no count can see: a draw partitioning by list position rather than by `gruppe` writes the right NUMBER of wrong fixtures.

    `entry_rows` interleaves the groups so the two partitions disagree, and these are the assertions
    that read the difference.
    """

    def test_every_group_fixture_pairs_two_clubs_of_one_group(self, mongo_replica_set_url: str):
        drawn = a_drawn_season(mongo_replica_set_url)
        junction = junction_by_team(drawn)
        fixtures = group_fixtures(drawn)

        assert [row["spiel_nr"] for row in fixtures if row["team1"] is None or row["team2"] is None] == []
        assert [
            row["spiel_nr"] for row in fixtures if junction[row["team1"]["team_id"]]["gruppe"] != junction[row["team2"]["team_id"]]["gruppe"]
        ] == []

    def test_each_group_plays_every_pair_of_its_own_clubs_once(self, mongo_replica_set_url: str):
        """The whole round robin, not merely a legal-looking one.

        A repeated pair leaves two clubs that never meet, and a table neither of them was ranked by.
        """

        drawn = a_drawn_season(mongo_replica_set_url)
        junction = junction_by_team(drawn)

        played: dict[Any, list[frozenset[Any]]] = {}
        for row in group_fixtures(drawn):
            gruppe = junction[row["team1"]["team_id"]]["gruppe"]
            played.setdefault(gruppe, []).append(frozenset((row["team1"]["team_id"], row["team2"]["team_id"])))

        squads: dict[Any, list[Any]] = {}
        for row in drawn.entered:
            squads.setdefault(row["gruppe"], []).append(row["team_id"])

        for gruppe, ids in squads.items():
            pairs = played.get(gruppe, [])
            assert len(pairs) == len(set(pairs)), f"gruppe {gruppe} draws a pair more than once"
            assert set(pairs) == {frozenset(pair) for pair in combinations(ids, 2)}

    def test_each_side_is_stored_under_the_name_the_junction_carries(self, mongo_replica_set_url: str):
        """The name the season is played under, off the row rather than off `teams`, and no goals: a drawn fixture has not happened."""

        drawn = a_drawn_season(mongo_replica_set_url)
        junction = junction_by_team(drawn)

        assert [
            (row["spiel_nr"], slot)
            for row in group_fixtures(drawn)
            for slot in ("team1", "team2")
            if row[slot] != side_from(junction[row[slot]["team_id"]])
        ] == []

    def test_no_group_fixture_carries_a_source(self, mongo_replica_set_url: str):
        """Both sides are drawn outright, so a `quelle` here is a slot the bracket would later refill over a club that qualified for it."""

        drawn = a_drawn_season(mongo_replica_set_url)

        assert [row["spiel_nr"] for row in group_fixtures(drawn) if row["team1_quelle"] is not None or row["team2_quelle"] is not None] == []


class TestTheBracketIsWiredToWhatFeedsIt:
    @pytest.mark.parametrize(("groups", "teams", "qualifiers"), SHAPES, ids=SHAPE_IDS)
    def test_each_round_is_the_phase_and_the_size_the_qualifier_count_implies(
        self, mongo_replica_set_url: str, groups: int, teams: int, qualifiers: int
    ):
        """`KNOCKOUT_PHASES` is a pinned tuple and `bracket_rounds` halves the product itself.

        A ladder one round short then shows twice over: a `halbfinale` holding four matches is both
        the wrong label and the wrong size.
        """

        drawn = a_drawn_season(mongo_replica_set_url, groups=groups, teams=teams, qualifiers=qualifiers)
        sizes = bracket_rounds(FLSaisonRules.model_validate(drawn.saison["rules"]))
        rounds = knockout_rounds(drawn)

        assert [{row["saison_phase"] for row in fixtures} for fixtures in rounds] == [{phase} for phase in KNOCKOUT_PHASES[-len(sizes) :]]
        assert [len(fixtures) for fixtures in rounds] == list(sizes)

    def test_every_knockout_fixture_is_two_unfilled_slots_each_with_a_source(self, mongo_replica_set_url: str):
        """Nobody has qualified when a season is drawn, so a side filled here would name a club the group phase has not chosen yet."""

        drawn = a_drawn_season(mongo_replica_set_url)
        fixtures = [row for round_fixtures in knockout_rounds(drawn) for row in round_fixtures]

        assert len(fixtures) == sum(bracket_rounds(FLSaisonRules.model_validate(drawn.saison["rules"])))
        assert [row["spiel_nr"] for row in fixtures if row["team1"] is not None or row["team2"] is not None] == []
        assert [row["spiel_nr"] for row in fixtures if row["team1_quelle"] is None or row["team2_quelle"] is None] == []

    def test_the_first_round_names_the_placings_the_seeding_table_pins(self, mongo_replica_set_url: str):
        """`BRACKET_SEEDING` fixes who meets in round one.

        Seeded any other way, two clubs out of one group meet before the bracket has narrowed.
        """

        drawn = a_drawn_season(mongo_replica_set_url)
        first, *_ = knockout_rounds(drawn)

        assert [
            (quelle["type"], quelle["gruppe"], quelle["platz"]) for row in first for quelle in (row["team1_quelle"], row["team2_quelle"])
        ] == [("gruppe", gruppe, platz) for gruppe, platz in BRACKET_SEEDING[(GROUPS, QUALIFIERS)]]

    def test_each_later_round_is_fed_by_the_winners_of_the_round_before_it(self, mongo_replica_set_url: str):
        """The chain the bracket resolver walks: a source naming a fixture from anywhere else leaves a slot no result can ever fill."""

        drawn = a_drawn_season(mongo_replica_set_url)
        first, *later = knockout_rounds(drawn)

        assert later, "this bracket holds one round, so the chain is never exercised"

        feeding = [row["spiel_nr"] for row in first]
        for fixtures in later:
            sources = [
                (quelle["type"], quelle["spiel_nr"], quelle["ausgang"])
                for row in fixtures
                for quelle in (row["team1_quelle"], row["team2_quelle"])
            ]
            assert sources == [("spiel", spiel_nr, "sieger") for spiel_nr in feeding]
            feeding = [row["spiel_nr"] for row in fixtures]


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
            pytest.param(SPIELPLAN_ALREADY_DRAWN, Seed(spiele=[a_stored_fixture()]), id="a season already holding a fixture"),
            pytest.param(SPIELPLAN_MATCHDAYS_HELD, Seed(spieltage=[a_stored_matchday()]), id="a season already holding a matchday"),
            pytest.param(SPIELPLAN_SAISON_FINISHED, Seed(saison=saison_document(status="past")), id="a season already finished"),
            pytest.param(SPIELPLAN_GRUPPEN_OFF_RULES, Seed(entered=entry_rows(short_gruppe="D")), id="a group short of a club"),
            # The other half of `REQ-SPIELPLAN-004`: these clubs stand in groups the season does not
            # offer, so the draw would put them in no round robin at all.
            pytest.param(
                SPIELPLAN_GRUPPEN_OFF_RULES,
                Seed(saison=saison_document(rules=rules_document(groups=2)), entered=entry_rows(groups=4)),
                id="clubs in a group the season does not offer",
            ),
            # `find_rules_refusal`, the OTHER call, and the groups match the rules so nothing above
            # answers first: six qualifiers are no power of two, so this season has no bracket at all.
            pytest.param(
                RULES_BRACKET_IMPOSSIBLE,
                Seed(saison=saison_document(rules=rules_document(groups=2, qualifiers=3)), entered=entry_rows(groups=2)),
                id="rules whose product is no bracket",
            ),
        ],
    )
    def test_a_season_that_cannot_be_drawn_is_refused_and_nothing_is_written(self, mongo_replica_set_url: str, code: str, seed: Seed):
        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> RefusedDraw:
            with pytest.raises(DocumentConflictException) as refused:
                await call_draw(database, client)

            spieltage, spiele = await counts_now(database)

            return RefusedDraw(error_code=refused.value.error_code, spieltage=spieltage, spiele=spiele, watermark=await watermark_now(database))

        refused = on_a_seeded_saison(mongo_replica_set_url, body, seed=seed)

        assert refused.error_code == code
        # Exactly what the seed put there: a refusal reached after a write would read higher.
        assert (refused.spieltage, refused.spiele) == (len(seed.spieltage), len(seed.spiele))
        assert refused.watermark is None


# Each replaces the shipped validator on one collection, so the write named below is refused where it
# stands. `datum` is null on every drawn fixture and `spielplan` is an object on every watermark.
NARROWED_VALIDATORS: dict[Collection, dict[str, Any]] = {
    Collection.SPIELE: {"$jsonSchema": {"bsonType": "object", "properties": {"datum": {"bsonType": "string"}}}},
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
    log: int
    cached: dict[str, Any] | None


class TestAFailedDrawLeavesNothingBehind:
    """`/spiele` has neither a create nor a delete, so a half-written draw could not be repaired through the API at all."""

    @pytest.mark.parametrize(
        ("narrowed", "refused_field"),
        [
            pytest.param(Collection.SPIELE, "datum", id="the fixtures, once the matchdays are written"),
            pytest.param(Collection.SAISONS, "spielplan", id="the watermark, once both collections are written"),
        ],
    )
    def test_neither_collection_keeps_a_document_nor_the_season_a_watermark(
        self, mongo_replica_set_url: str, narrowed: Collection, refused_field: str
    ):
        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> AbortedDraw:
            store_cached_saison(SAISON_ID, saison_document())
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
                log=await database[Collection.AKTIONEN].count_documents({}),
                cached=read_cached_saison(SAISON_ID),
            )

        aborted = on_a_seeded_saison(mongo_replica_set_url, body, mutates_schema=True)

        # Asserted on the code, so this cannot pass because something failed before the first write.
        assert aborted.write_error == DOCUMENT_VALIDATION_FAILED, f"expected the validator to refuse the write, got code {aborted.write_error}"
        # `datum` sits on no matchday: the write that fell is the one this case narrowed, so the
        # writes before it had already run.
        assert aborted.refused_field == refused_field
        assert (aborted.spieltage, aborted.spiele) == (0, 0), "a rolled-back draw left documents behind"
        assert aborted.watermark is None, "the season claims a Spielplan the rollback took away"
        # `record_write` runs in-session, so the log is part of what the abort takes back rather than
        # a standing record of writes that never happened.
        assert aborted.log == 0, "the action log kept a row for a write that was rolled back"
        # The drop runs after the commit, so a draw that never committed leaves the cache nothing to unlearn.
        assert aborted.cached is not None


class TestTheActionLogRecordsOneRowPerCollection:
    """The shape the owner chose over a row per document: a drawn season is one action, and sixty rows would bury it."""

    def test_two_bulk_creates_and_the_watermark_are_one_action(self, mongo_replica_set_url: str):
        """In writing order, which is the order the log is the only record of: the matchdays exist before anything hangs on them."""

        drawn = a_drawn_season(mongo_replica_set_url)

        assert [(row["collection"], row["operation"], row["modified_count"]) for row in drawn.log] == [
            (str(Collection.SPIELTAGE), "insert_many", drawn.response.spieltage),
            (str(Collection.SPIELE), "insert_many", drawn.response.spiele),
            (str(Collection.SAISONS), "patch_one", None),
        ]
        assert {row["correlation_id"] for row in drawn.log} == {CORRELATION_ID}
        assert drawn.log[-1]["document_id"] == SAISON_ID
        # The pre-image a restore would replay: the season as it stood before it held a Spielplan.
        assert "spielplan" not in drawn.log[-1]["before"]


class TestASecondDrawIsRefusedByTheWatermarkItLeft:
    def test_the_refusal_names_the_day_and_the_counts_rather_than_a_bare_fixture_total(self, mongo_replica_set_url: str):
        """The bare count is the fallback for a draw this endpoint did not write; a season carrying a watermark reads what is there instead."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            first = await call_draw(database, client)

            with pytest.raises(DocumentConflictException) as refused:
                await call_draw(database, client)

            return first, refused.value, await counts_now(database)

        first, refused, counts = on_a_seeded_saison(mongo_replica_set_url, body)

        assert refused.error_code == SPIELPLAN_ALREADY_DRAWN
        message = refused.error_detail["message"]
        assert TODAY in message
        assert f"{first.spiele} fixtures across {first.spieltage} matchdays" in message
        assert "this endpoint did not write" not in message
        # Nothing doubled: the second call is refused before it writes.
        assert counts == (first.spieltage, first.spiele)


class TestTheSeasonCacheIsDroppedOnlyByADrawThatCommitted:
    """One process, one cache, keyed by season id -- so dropping it early unlearns a season nothing has changed yet."""

    def test_a_committed_draw_drops_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            store_cached_saison(SAISON_ID, saison_document())
            await call_draw(database, client)

            return read_cached_saison(SAISON_ID)

        assert on_a_seeded_saison(mongo_replica_set_url, body) is None

    def test_a_refused_draw_leaves_it_standing(self, mongo_replica_set_url: str):
        """The control: a drop before the refusal would pass the case above while costing every reader a re-read for nothing."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            store_cached_saison(SAISON_ID, saison_document())

            with pytest.raises(DocumentConflictException):
                await call_draw(database, client)

            return read_cached_saison(SAISON_ID)

        assert on_a_seeded_saison(mongo_replica_set_url, body, seed=Seed(saison=saison_document(status="past"))) is not None


# The replace's own day, so a watermark the first draw left behind reads as one rather than passing
# for the new one.
REDRAWN_TODAY = "2026-08-25"

# One field on one fixture, so nothing else about the season moves to reach a state
# `app/api/saisons/services.py :: holds_a_recorded_fact` calls recorded.
A_RECORD = "abgebrochen"

# The one record the DRAW itself never writes a key for, so a projection missing `notiz` reads a
# noted fixture as untouched and the replace destroys the note.
A_NOTE = "Platz gesperrt"

# Every key the `spiele` validator asks of a booking, so the seeding update is a document production
# would accept rather than one this file invented.
A_BOOKED_ORT: dict[str, Any] = {
    "spielort_id": ObjectId("6890a1b2c3d4e5f607760101"),
    "name": "Sporthalle Nord",
    "maps_link": "https://maps.test/nord",
    "mietpreis": 120,
}
A_BOOKED_SCHIEDSRICHTER: dict[str, Any] = {
    "schiedsrichter_id": ObjectId("6890a1b2c3d4e5f607760102"),
    "name": "R. Mustermann",
    "payment": 40,
}

# One fixture carrying one of these closes the window `REQ-SPIELPLAN-005` opens. Only the first is
# played by `has_taken_place`, so the four under it are what say the window reads
# `holds_a_recorded_fact` instead.
RECORDS_CLOSING_THE_WINDOW = (
    pytest.param({"sonderereignis": A_RECORD}, id="an abandonment"),
    pytest.param({"sonderereignis": "ausgefallen"}, id="a cancellation, which has_taken_place reads as untouched"),
    pytest.param({"ort": A_BOOKED_ORT}, id="a booked venue"),
    pytest.param({"schiedsrichter": A_BOOKED_SCHIEDSRICHTER}, id="a booked referee"),
    pytest.param({"notiz": A_NOTE}, id="an admin's note"),
)

# Wider than the drawn shape, so `REQ-RULES-003` and `REQ-RULES-006` both read the other way and
# `REQ-RULES-011` is the only rule that can answer.
WIDER_PER_GROUP = 6


async def document_ids(database: AsyncIOMotorDatabase) -> set[Any]:
    """Every id the season's two drawn collections hold, which is what says a document is GONE rather than replaced by as many."""

    found: set[Any] = set()
    for collection in (Collection.SPIELTAGE, Collection.SPIELE):
        found |= {row["_id"] for row in await database[collection].find({}, {"_id": 1}).to_list(length=None)}

    return found


@dataclass(frozen=True)
class ReplacedSeason:
    """One season drawn, then drawn again over the top, as a later request would find it."""

    first: FLGenerateSpielplanResponse
    second: FLGenerateSpielplanResponse
    first_ids: set[Any]
    spieltage: list[dict[str, Any]]
    spiele: list[dict[str, Any]]
    watermark: Any
    log: list[dict[str, Any]]


def a_replaced_season(url: str) -> ReplacedSeason:
    async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> ReplacedSeason:
        first = await call_draw(database, client)
        # Read between the two calls: afterwards nothing tells a surviving row from a fresh one
        # carrying the same numbers.
        first_ids = await document_ids(database)

        second = await call_draw(database, client, replace=True, today=REDRAWN_TODAY)

        return ReplacedSeason(
            first=first,
            second=second,
            first_ids=first_ids,
            spieltage=await database[Collection.SPIELTAGE].find({}).sort("_id", 1).to_list(length=None),
            spiele=await database[Collection.SPIELE].find({}).sort("spiel_nr", 1).to_list(length=None),
            watermark=await watermark_now(database),
            log=await database[Collection.AKTIONEN].find({}).sort("_id", 1).to_list(length=None),
        )

    replaced = on_a_seeded_saison(url, body)

    assert replaced.first_ids, "the first draw wrote nothing, so the replace had nothing to remove"

    return replaced


class TestAConfirmedReplaceRedrawsTheWholeSeason:
    """`REQ-SPIELPLAN-005`'s write half: the season's two lists are removed and drawn again inside one transaction."""

    def test_no_document_of_the_first_draw_survives(self, mongo_replica_set_url: str):
        """Drop either delete and this fails: a replace is these rows being GONE, never as many fresh ones standing beside them."""

        replaced = a_replaced_season(mongo_replica_set_url)
        surviving = {row["_id"] for row in (*replaced.spieltage, *replaced.spiele)}

        assert surviving & replaced.first_ids == set()
        assert surviving, "the replace removed the season and drew nothing back"

    def test_the_season_holds_exactly_one_whole_draw_afterwards(self, mongo_replica_set_url: str):
        """Delete only `spiele` and this fails: the fresh matchdays collide with the surviving ones on their own unique index."""

        replaced = a_replaced_season(mongo_replica_set_url)
        expected = expected_counts(FLSaisonRules.model_validate(saison_document()["rules"]))

        assert (len(replaced.spieltage), len(replaced.spiele)) == expected
        assert (replaced.second.spieltage, replaced.second.spiele) == expected

    def test_every_fixture_hangs_on_a_matchday_the_replace_itself_wrote(self, mongo_replica_set_url: str):
        """Hang a fresh fixture on a surviving matchday and this fails: the two lists go as one set (`docs/backend/spec.md :: I46`)."""

        replaced = a_replaced_season(mongo_replica_set_url)
        matchdays = {row["_id"] for row in replaced.spieltage}

        assert [row["spiel_nr"] for row in replaced.spiele if row["spieltag_id"] not in matchdays] == []

    def test_the_watermark_is_the_one_the_replace_wrote(self, mongo_replica_set_url: str):
        """Leave the watermark to the first draw and this fails: the season would claim a Spielplan drawn on a day it was not."""

        replaced = a_replaced_season(mongo_replica_set_url)

        assert replaced.watermark == {"generiert_am": REDRAWN_TODAY, "spieltage": len(replaced.spieltage), "spiele": len(replaced.spiele)}

    def test_the_log_records_each_removal_with_every_pre_image(self, mongo_replica_set_url: str):
        """Use `delete_many` rather than `delete_many_from_db` and the schedule goes unrecorded (`docs/backend/spec.md :: I48`)."""

        replaced = a_replaced_season(mongo_replica_set_url)

        assert [(row["collection"], row["operation"], row["modified_count"]) for row in replaced.log] == [
            (str(Collection.SPIELTAGE), "insert_many", replaced.first.spieltage),
            (str(Collection.SPIELE), "insert_many", replaced.first.spiele),
            (str(Collection.SAISONS), "patch_one", None),
            (str(Collection.SPIELE), "delete_many", replaced.first.spiele),
            (str(Collection.SPIELTAGE), "delete_many", replaced.first.spieltage),
            (str(Collection.SPIELTAGE), "insert_many", replaced.second.spieltage),
            (str(Collection.SPIELE), "insert_many", replaced.second.spiele),
            (str(Collection.SAISONS), "patch_one", None),
        ]
        # The hand-assigned dates, venues and referees a redrawn season loses are recoverable from
        # these images alone, so a count with no array would be half a record.
        assert [len(row["before"]) for row in replaced.log if row["operation"] == "delete_many"] == [
            replaced.first.spiele,
            replaced.first.spieltage,
        ]


@dataclass(frozen=True)
class NeighbouringSeasons:
    """Two drawn seasons, one of them replaced, each collection counted for each season separately."""

    replaced: FLGenerateSpielplanResponse
    subject_spieltage: int
    subject_spiele: int
    neighbour_drawn: FLGenerateSpielplanResponse
    neighbour_spieltage: int
    neighbour_spiele: int


def a_season_replaced_beside_another(url: str) -> NeighbouringSeasons:
    """Draw both seasons, close the neighbour, then replace the subject's draw alone."""

    seed = Seed(
        neighbour=saison_document(saison_id=NEIGHBOUR_SAISON_ID),
        neighbour_entered=entry_rows(saison_id=NEIGHBOUR_SAISON_ID, offset=NEIGHBOUR_OID_OFFSET),
    )

    async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> NeighbouringSeasons:
        neighbour_drawn = await call_draw(database, client, saison_id=NEIGHBOUR_SAISON_ID)

        # Demoted to `past` after its draw: what an unscoped removal takes from a finished season is
        # the fixture set its league table is scored from on every read.
        await database[Collection.SAISONS].update_one({"_id": NEIGHBOUR_SAISON_ID}, {"$set": {"status": "past"}})

        await call_draw(database, client)
        replaced = await call_draw(database, client, replace=True, today=REDRAWN_TODAY)

        subject_spieltage, subject_spiele = await counts_now(database)
        neighbour_spieltage, neighbour_spiele = await counts_now(database, saison_id=NEIGHBOUR_SAISON_ID)

        return NeighbouringSeasons(
            replaced=replaced,
            subject_spieltage=subject_spieltage,
            subject_spiele=subject_spiele,
            neighbour_drawn=neighbour_drawn,
            neighbour_spieltage=neighbour_spieltage,
            neighbour_spiele=neighbour_spiele,
        )

    neighbours = on_a_seeded_saison(url, body, seed=seed)

    assert neighbours.neighbour_drawn.spiele > 0, "the neighbour was drawn nothing, so its survival proves nothing"

    return neighbours


class TestAConfirmedReplaceReachesNoOtherSeason:
    """That the replace's two deletes are bounded by their `saison_id`, proved against a season standing beside the one redrawn."""

    def test_the_neighbours_fixtures_all_survive(self, mongo_replica_set_url: str):
        """Empty the fixture delete's `db_filter` in `generate_spielplan` and this fails; with one season seeded, nothing does."""

        neighbours = a_season_replaced_beside_another(mongo_replica_set_url)

        assert neighbours.neighbour_spiele == neighbours.neighbour_drawn.spiele

    def test_the_neighbours_matchdays_all_survive(self, mongo_replica_set_url: str):
        """Its own case, never a pair compared as one: a comparison of the two together passes while half the neighbour is gone."""

        neighbours = a_season_replaced_beside_another(mongo_replica_set_url)

        assert neighbours.neighbour_spieltage == neighbours.neighbour_drawn.spieltage

    def test_the_season_asked_for_is_the_one_redrawn(self, mongo_replica_set_url: str):
        """The floor for the two above: a replace that removed nothing would leave every neighbour standing too."""

        neighbours = a_season_replaced_beside_another(mongo_replica_set_url)

        assert (neighbours.subject_spieltage, neighbours.subject_spiele) == (neighbours.replaced.spieltage, neighbours.replaced.spiele)
        assert neighbours.replaced.spiele > 0


class TestAnAbortedReplaceLeavesTheSeasonStanding:
    """The deletes and the redraw are one transaction, so a fixture insert that falls takes the removal back with it."""

    def test_both_collections_keep_every_document_the_replace_would_have_removed(self, mongo_replica_set_url: str):
        """Move either delete outside the callback and this fails: the season would be left holding no schedule at all."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> AbortedDraw:
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
                log=await database[Collection.AKTIONEN].count_documents({}),
                cached=read_cached_saison(SAISON_ID),
            )

        aborted = on_a_seeded_saison(mongo_replica_set_url, body, mutates_schema=True)

        # On the code, so this cannot pass because the replace fell before it deleted anything.
        assert aborted.write_error == DOCUMENT_VALIDATION_FAILED, f"expected the validator to refuse the write, got {aborted.write_error}"
        assert aborted.refused_field == "datum"
        assert aborted.watermark == {"generiert_am": TODAY, "spieltage": aborted.spieltage, "spiele": aborted.spiele}
        # The first draw's three rows and nothing else: the deletes are recorded in-session, so the
        # abort takes their rows back too.
        assert aborted.log == 3


class TestTheReplaceWindowIsReachedThroughTheRoute:
    """`REQ-SPIELPLAN-005` WIRED: the endpoint reads the season's status and its own fixtures inside the transaction."""

    def test_a_running_season_is_refused_the_replace_and_keeps_its_draw(self, mongo_replica_set_url: str):
        """Wire `replace` past the window and this fails: an active league would lose the schedule it is playing."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            drawn = await call_draw(database, client)
            await database[Collection.SAISONS].update_one({"_id": SAISON_ID}, {"$set": {"status": "active"}})
            standing = await document_ids(database)

            with pytest.raises(DocumentConflictException) as refused:
                await call_draw(database, client, replace=True, today=REDRAWN_TODAY)

            return drawn, standing, refused.value, await document_ids(database), await watermark_now(database)

        drawn, standing, refused, surviving, watermark = on_a_seeded_saison(mongo_replica_set_url, body)

        assert refused.error_code == SPIELPLAN_REPLACE_OUTSIDE_ITS_WINDOW
        assert surviving == standing
        assert watermark == {"generiert_am": TODAY, "spieltage": drawn.spieltage, "spiele": drawn.spiele}

    @pytest.mark.parametrize("record", RECORDS_CLOSING_THE_WINDOW)
    def test_a_single_recorded_fixture_is_refused_the_replace(self, mongo_replica_set_url: str, record: dict[str, Any]):
        """Count these off anything but the stored rows and this fails; drop either booking from the projection and the last two do."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            await call_draw(database, client)
            await database[Collection.SPIELE].update_one({"spiel_nr": 1}, {"$set": record})
            standing = await document_ids(database)

            with pytest.raises(DocumentConflictException) as refused:
                await call_draw(database, client, replace=True, today=REDRAWN_TODAY)

            return refused.value, standing, await document_ids(database)

        refused, standing, surviving = on_a_seeded_saison(mongo_replica_set_url, body)

        assert refused.error_code == SPIELPLAN_REPLACE_OUTSIDE_ITS_WINDOW
        assert "1 fixture(s)" in refused.error_detail["message"]
        assert surviving == standing


class TestTheDrawIsTheOnlyThingThatMovesTheShape:
    """`REQ-RULES-011` WIRED, over the season the cases above judge the replace on.

    The patch writes the whole `rules` object, so a shape reaching it would stand beside fixtures no
    longer drawn from it. The draw is where the three move instead.
    """

    def test_a_drawn_future_season_with_nothing_recorded_is_refused_too(self, mongo_replica_set_url: str):
        """The state a carve-out for repairs would sit in: nothing recorded, nothing played, and the fixtures still standing."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            await call_draw(database, client)

            with pytest.raises(DocumentConflictException) as refused:
                await call_patch_rules(database, teams_per_group=WIDER_PER_GROUP)

            return refused.value, await stored_rules(database)

        refused, rules = on_a_seeded_saison(mongo_replica_set_url, body)

        assert refused.error_code == RULES_SHAPE_AFTER_DRAW
        # Read back, not inferred from the refusal: a rule raised after the write would refuse and store.
        assert rules["teams_per_group"] == TEAMS_PER_GROUP

    @pytest.mark.parametrize("record", RECORDS_CLOSING_THE_WINDOW)
    def test_one_fixture_carrying_a_record_is_refused_as_well(self, mongo_replica_set_url: str, record: dict[str, Any]):
        """The same answer whatever stands against the season: this rule reads that fixtures exist, never what they hold."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            await call_draw(database, client)
            await database[Collection.SPIELE].update_one({"spiel_nr": 1}, {"$set": record})

            with pytest.raises(DocumentConflictException) as refused:
                await call_patch_rules(database, teams_per_group=WIDER_PER_GROUP)

            return refused.value, await stored_rules(database)

        refused, rules = on_a_seeded_saison(mongo_replica_set_url, body)

        assert refused.error_code == RULES_SHAPE_AFTER_DRAW
        assert rules["teams_per_group"] == TEAMS_PER_GROUP

    def test_the_rest_of_the_rules_still_go_through_on_a_drawn_season(self, mongo_replica_set_url: str):
        """The control: a patch refusing every rule of a drawn season passes both cases above while barring a typo's repair."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            await call_draw(database, client)

            return await call_patch_rules(database, win_points=2)

        patched = on_a_seeded_saison(mongo_replica_set_url, body)

        assert patched.updated_document.rules.win_points == 2


# The narrowing that repairs a season drawn from the wrong numbers, and the one nothing else lets
# through: `REQ-RULES-004` reads the bracket's own wiring and `REQ-RULES-006` its own matchdays, so
# each refuses this exact step on the patch.
NARROWED_QUALIFIERS = 1

# A first draw's own shape, off a season created with placeholder numbers: two odd groups holding
# every club that turned up, into a single final.
SHORT_GROUPS = 2
SHORT_PER_GROUP = 3


@dataclass(frozen=True)
class ReshapedSeason:
    """One draw that carried its own shape, and the season it left."""

    response: FLGenerateSpielplanResponse
    rules: dict[str, Any]
    spieltage: list[dict[str, Any]]
    spiele: list[dict[str, Any]]
    watermark: Any
    log: list[dict[str, Any]]


def a_season_drawn_from(url: str, *, seed: Seed, shape: FLSpielplanShape | None, replace: bool = False) -> ReshapedSeason:
    """Draw `seed` from `shape`, twice where `replace` is set -- the first time off the seed's own rules."""

    async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> ReshapedSeason:
        if replace:
            await call_draw(database, client)

        response = await call_draw(database, client, replace=replace, today=REDRAWN_TODAY if replace else TODAY, shape=shape)

        return ReshapedSeason(
            response=response,
            rules=await stored_rules(database),
            spieltage=await database[Collection.SPIELTAGE].find({}).sort("_id", 1).to_list(length=None),
            spiele=await database[Collection.SPIELE].find({}).sort("spiel_nr", 1).to_list(length=None),
            watermark=await watermark_now(database),
            log=await database[Collection.AKTIONEN].find({}).sort("_id", 1).to_list(length=None),
        )

    return on_a_seeded_saison(url, body, seed=seed)


# A `rules` sub-key no model declares. The `saisons` validator admits it, `app/core/constraints.py ::
# _object` emitting no `additionalProperties`, and `FLSaisonRules` ignores it -- so only a write that
# names its paths can leave it standing.
UNDECLARED_RULE: dict[str, Any] = {"spielzeit_minuten": 25}


def a_short_seed(*, extra_rules: Mapping[str, Any] | None = None) -> Seed:
    """A season created with the placeholder shape, holding only the clubs that turned up: six, across two groups."""

    return Seed(
        saison=saison_document(rules={**rules_document(), **(extra_rules or {})}),
        entered=entry_rows(groups=SHORT_GROUPS, teams=SHORT_PER_GROUP),
    )


def the_short_shape() -> FLSpielplanShape:
    return a_shape(groups=SHORT_GROUPS, teams=SHORT_PER_GROUP, qualifiers=NARROWED_QUALIFIERS)


class TestADrawStoresTheShapeItRanFrom:
    """`FLSpielplanShape`: the three the fixtures are a function of, on the draw's own payload.

    Each case proves ONE object was judged, drawn and stored -- a season's rules and its fixture
    list are one fact, and a draw leaving either behind splits them.
    """

    def test_a_first_draw_narrows_the_placeholder_shape_the_season_was_created_with(self, mongo_replica_set_url: str):
        """Judge `REQ-SPIELPLAN-004` off the stored rules and this fails: six clubs across two groups fill no group of four."""

        drawn = a_season_drawn_from(mongo_replica_set_url, seed=a_short_seed(), shape=the_short_shape())
        expected = expected_counts(
            FLSaisonRules.model_validate(rules_document(groups=SHORT_GROUPS, teams=SHORT_PER_GROUP, qualifiers=NARROWED_QUALIFIERS))
        )

        assert [drawn.rules[rule] for rule in the_short_shape().model_dump()] == [SHORT_GROUPS, SHORT_PER_GROUP, NARROWED_QUALIFIERS]
        # The draw itself, not the numbers alone: a `$set` beside a draw off the stored rules would store one shape and play another.
        assert (len(drawn.spieltage), len(drawn.spiele)) == expected
        assert (drawn.response.spieltage, drawn.response.spiele) == expected

    def test_the_rules_the_draw_is_no_function_of_are_left_where_they_stand(self, mongo_replica_set_url: str):
        """`$set` the shape as a whole `rules` object and this fails: the six rules it does not carry would be gone from the season."""

        drawn = a_season_drawn_from(mongo_replica_set_url, seed=a_short_seed(), shape=the_short_shape())
        untouched = {rule: value for rule, value in rules_document().items() if rule not in the_short_shape().model_dump()}

        assert {rule: drawn.rules[rule] for rule in untouched} == untouched

    def test_a_rules_sub_key_no_model_declares_survives_the_draw(self, mongo_replica_set_url: str):
        """`$set` the MERGED `rules` object and this fails: it holds what `FLSaisonRules` declares, so a hand-added key is silently dropped."""

        drawn = a_season_drawn_from(mongo_replica_set_url, seed=a_short_seed(extra_rules=UNDECLARED_RULE), shape=the_short_shape())

        assert {rule: drawn.rules.get(rule) for rule in UNDECLARED_RULE} == UNDECLARED_RULE
        # Beside the shape it moved, so this cannot pass on a draw that wrote nothing at all.
        assert drawn.rules["qualifiers_per_group"] == NARROWED_QUALIFIERS

    def test_a_draw_that_states_no_shape_leaves_every_rule_alone(self, mongo_replica_set_url: str):
        """The control: a `$set` running unconditionally would pass every case above and rewrite a season that asked for nothing."""

        drawn = a_season_drawn_from(mongo_replica_set_url, seed=Seed(), shape=None)

        assert drawn.rules == rules_document()

    def test_the_shape_and_the_watermark_reach_the_log_as_one_row(self, mongo_replica_set_url: str):
        """Two `$set`s and this fails: the second's pre-image would hold rules that were never the season's outside the transaction."""

        drawn = a_season_drawn_from(mongo_replica_set_url, seed=a_short_seed(), shape=the_short_shape())
        written = [row for row in drawn.log if row["collection"] == str(Collection.SAISONS)]

        assert [row["operation"] for row in written] == ["patch_one"]
        # The season as it stood before either moved, which is the whole of what a restore replays.
        assert written[0]["before"]["rules"] == rules_document()
        assert "spielplan" not in written[0]["before"]


class TestAReplaceRedrawsTheSeasonFromTheShapeItCarries:
    """The operation `REQ-RULES-011` names as the repair: the numbers and the fixtures move together, or neither moves."""

    def test_a_narrower_qualifier_count_is_stored_and_drawn(self, mongo_replica_set_url: str):
        """The step no patch of a drawn season permits: `REQ-RULES-004` and `REQ-RULES-006` each refuse this exact one there."""

        replaced = a_season_drawn_from(mongo_replica_set_url, seed=Seed(), shape=a_shape(qualifiers=NARROWED_QUALIFIERS), replace=True)
        expected = expected_counts(FLSaisonRules.model_validate(rules_document(qualifiers=NARROWED_QUALIFIERS)))
        first_round = [row for row in replaced.spiele if row["saison_phase"] == KNOCKOUT_PHASES[-2]]

        assert replaced.rules["qualifiers_per_group"] == NARROWED_QUALIFIERS
        assert (len(replaced.spieltage), len(replaced.spiele)) == expected
        # The bracket the NEW number seeds: a redraw off the stored rules would wire eight slots naming platz 1 and platz 2.
        assert [(quelle["gruppe"], quelle["platz"]) for row in first_round for quelle in (row["team1_quelle"], row["team2_quelle"])] == [
            (gruppe, platz) for gruppe, platz in BRACKET_SEEDING[(GROUPS, NARROWED_QUALIFIERS)]
        ]

    def test_a_wider_qualifier_count_is_stored_and_drawn(self, mongo_replica_set_url: str):
        """The other direction, which a freeze reading narrowings alone would let through while the fixtures stayed as they were."""

        replaced = a_season_drawn_from(
            mongo_replica_set_url,
            seed=Seed(saison=saison_document(rules=rules_document(qualifiers=NARROWED_QUALIFIERS))),
            shape=a_shape(qualifiers=QUALIFIERS),
            replace=True,
        )
        expected = expected_counts(FLSaisonRules.model_validate(rules_document(qualifiers=QUALIFIERS)))

        assert replaced.rules["qualifiers_per_group"] == QUALIFIERS
        assert (len(replaced.spieltage), len(replaced.spiele)) == expected
        assert replaced.watermark == {"generiert_am": REDRAWN_TODAY, "spieltage": expected[0], "spiele": expected[1]}


@dataclass(frozen=True)
class RefusedReshape:
    """A redraw refused before it wrote, and the season it left standing -- its rules included."""

    error_code: str
    rules: dict[str, Any]
    kept_its_draw: bool
    watermark: Any


class TestAShapeTheSeasonCannotBeDrawnFromIsRefused:
    """Every refusal reads the PROPOSED three, so a season never keeps numbers no draw of it could run from."""

    @pytest.mark.parametrize(
        ("code", "shape", "why"),
        [
            pytest.param(
                SPIELPLAN_GRUPPEN_OFF_RULES,
                a_shape(groups=SHORT_GROUPS),
                "sixteen clubs stand in four groups, and two of those groups would be offered nothing to play in",
                id="a shape that strands clubs",
            ),
            pytest.param(
                RULES_BRACKET_IMPOSSIBLE,
                a_shape(qualifiers=3),
                "four groups by three qualifiers is twelve, which halves to no final",
                id="a shape that reaches no bracket",
            ),
        ],
    )
    def test_the_season_keeps_both_its_rules_and_its_draw(self, mongo_replica_set_url: str, code: str, shape: FLSpielplanShape, why: str):
        """Store the shape before these refusals and this fails: the season would hold numbers its standing fixtures contradict."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> RefusedReshape:
            await call_draw(database, client)
            standing = await document_ids(database)

            with pytest.raises(DocumentConflictException) as refused:
                await call_draw(database, client, replace=True, today=REDRAWN_TODAY, shape=shape)

            return RefusedReshape(
                error_code=refused.value.error_code,
                rules=await stored_rules(database),
                kept_its_draw=await document_ids(database) == standing,
                watermark=await watermark_now(database),
            )

        refused = on_a_seeded_saison(mongo_replica_set_url, body)

        assert refused.error_code == code, why
        assert refused.rules == rules_document()
        assert refused.kept_its_draw, "a refused redraw removed the season's own draw"
        assert refused.watermark["generiert_am"] == TODAY


# Two groups of four into a single final: three group matchdays and the final, in a season of
# exactly four days -- the shortest span `POST /saisons` accepts for those rules.
TIGHT_GROUPS = 2
TIGHT_PER_GROUP = 4
TIGHT_SPAN = ("2026-05-01", "2026-05-04")

# The free lever: `REQ-SPIELPLAN-004` pins the other two to the clubs standing in the groups, while
# each doubling of `number_of_groups` x `qualifiers_per_group` adds a knockout round.
WIDENED_QUALIFIERS = 4


def a_tight_seed() -> Seed:
    """A season as long as its own rules ask and no longer, every offered group full."""

    return Seed(
        saison=saison_document(
            rules=rules_document(groups=TIGHT_GROUPS, teams=TIGHT_PER_GROUP, qualifiers=NARROWED_QUALIFIERS),
            start_date=TIGHT_SPAN[0],
            end_date=TIGHT_SPAN[1],
        ),
        entered=entry_rows(groups=TIGHT_GROUPS, teams=TIGHT_PER_GROUP),
    )


def the_tight_shape(*, qualifiers: int) -> FLSpielplanShape:
    return a_shape(groups=TIGHT_GROUPS, teams=TIGHT_PER_GROUP, qualifiers=qualifiers)


class TestASeasonIsNeverDrawnMoreMatchdaysThanItHasDays:
    """`REQ-DATE-005` WIRED over the draw's own three, which decide how many matchdays a season takes.

    `POST /saisons` measured the span against the rules the season was created with, and the draw
    replaces three of them.
    """

    def test_a_shape_implying_more_matchdays_than_the_season_has_days_is_refused(self, mongo_replica_set_url: str):
        """Drop the span call and this fails: six matchdays land in a four-day season, and no two may share a day."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            with pytest.raises(DocumentConflictException) as refused:
                await call_draw(database, client, shape=the_tight_shape(qualifiers=WIDENED_QUALIFIERS))

            return refused.value, await stored_rules(database), await counts_now(database), await watermark_now(database)

        refused, rules, counts, watermark = on_a_seeded_saison(mongo_replica_set_url, body, seed=a_tight_seed())

        assert refused.error_code == SAISON_SPAN_BELOW_SCHEDULE
        assert counts == (0, 0), "a refused draw wrote a schedule the season has no room for"
        # Read back rather than inferred from the refusal: the shape stored beside no fixtures would
        # come back `REQ-DATE-005` on the next patch of any rule at all.
        assert rules == rules_document(groups=TIGHT_GROUPS, teams=TIGHT_PER_GROUP, qualifiers=NARROWED_QUALIFIERS)
        assert watermark is None

    def test_a_shape_the_season_has_exactly_room_for_is_drawn(self, mongo_replica_set_url: str):
        """The control: four matchdays fit four days, so an off-by-one -- or a span read off another season -- refuses a legal draw."""

        drawn = a_season_drawn_from(mongo_replica_set_url, seed=a_tight_seed(), shape=the_tight_shape(qualifiers=NARROWED_QUALIFIERS))
        expected = expected_counts(
            FLSaisonRules.model_validate(rules_document(groups=TIGHT_GROUPS, teams=TIGHT_PER_GROUP, qualifiers=NARROWED_QUALIFIERS))
        )

        assert (len(drawn.spieltage), len(drawn.spiele)) == expected


class TestAnAbortedRedrawLeavesTheOldRulesWithTheOldDraw:
    """Why the shape is written inside the callback: one transaction holds the numbers and the fixtures they produced."""

    def test_the_season_keeps_the_shape_its_standing_fixtures_were_drawn_from(self, mongo_replica_set_url: str):
        """Write the shape outside the session, or before `with_transaction`, and this fails: the rules would move and the draw would not."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            drawn = await call_draw(database, client)
            standing = await document_ids(database)

            # Narrowed AFTER the first draw, so what falls is the redraw's own insert, by which point
            # both deletes have run and the shape has been decided.
            await database.command(
                "collMod", str(Collection.SPIELE), validator=NARROWED_VALIDATORS[Collection.SPIELE], validationLevel="strict"
            )

            with pytest.raises(OperationFailure) as failure:
                await call_draw(database, client, replace=True, today=REDRAWN_TODAY, shape=a_shape(qualifiers=NARROWED_QUALIFIERS))

            code, _ = refused_write(failure.value)

            return drawn, code, await stored_rules(database), await document_ids(database) == standing, await watermark_now(database)

        drawn, code, rules, kept_its_draw, watermark = on_a_seeded_saison(mongo_replica_set_url, body, mutates_schema=True)

        # On the code, so this cannot pass because the redraw fell before it had decided anything.
        assert code == DOCUMENT_VALIDATION_FAILED, f"expected the validator to refuse the write, got {code}"
        assert rules == rules_document(), "the season took a shape whose draw was rolled back"
        assert kept_its_draw, "a rolled-back redraw left the season's own draw removed"
        assert watermark == {"generiert_am": TODAY, "spieltage": drawn.spieltage, "spiele": drawn.spiele}
