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
)
from app.api.saisons.services import (
    RULES_BRACKET_IMPOSSIBLE,
    RULES_SHAPE_AFTER_DRAW,
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
from app.core.constraints import apply_constraints
from app.core.exceptions import DocumentConflictException
from app.core.logging import correlation_id_var

pytestmark = pytest.mark.db

DATABASE_NAME = "fl_spielplan_write_test"

# Named rather than caught broadly: another failure must not read as the rollback this suite proves.
DOCUMENT_VALIDATION_FAILED = 121

SAISON_ID = "2026"

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


def saison_document(*, status: str = "future", rules: dict[str, Any] | None = None) -> dict[str, Any]:
    """Every key spelled out: the shipped `saisons` validator is attached before this is inserted."""

    return {
        "_id": SAISON_ID,
        "start_date": "2026-01-01",
        "end_date": "2026-06-30",
        "status": status,
        "rules": rules or rules_document(),
    }


def entry_rows(*, groups: int = GROUPS, teams: int = TEAMS_PER_GROUP, short_gruppe: str | None = None) -> list[dict[str, Any]]:
    """Every club of a full season as its `saison_teams` row; `short_gruppe` leaves one group a club down.

    The groups are INTERLEAVED, so entry order and group membership disagree: a draw partitioning by
    list position pairs clubs that never meet.
    """

    rows: list[dict[str, Any]] = []
    for index, (seat, gruppe) in enumerate(product(range(teams), offered_gruppen(groups))):
        if gruppe == short_gruppe and seat == teams - 1:
            continue

        rows.append(
            {
                "_id": ObjectId(f"6890a1b2c3d4e5f6074{index:05d}"),
                "saison_id": SAISON_ID,
                "team_id": ObjectId(f"6890a1b2c3d4e5f6075{index:05d}"),
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
    """One season as the database holds it when the draw is asked for."""

    saison: dict[str, Any] = field(default_factory=saison_document)
    entered: list[dict[str, Any]] = field(default_factory=entry_rows)
    spiele: list[dict[str, Any]] = field(default_factory=list)
    spieltage: list[dict[str, Any]] = field(default_factory=list)


Body = Callable[[AsyncIOMotorDatabase, AsyncIOMotorClient], Awaitable[Any]]


def on_a_seeded_saison(url: str, body: Body, *, seed: Seed | None = None) -> Any:
    """One client and event loop per call: Motor binds to the loop it first ran on. A transaction cannot create a collection."""

    seeded = seed or Seed()

    async def _run() -> Any:
        client = AsyncIOMotorClient(url)
        try:
            await client.drop_database(DATABASE_NAME)
            database = client[DATABASE_NAME]

            # Process-global and keyed by season id, so an entry another module left would answer for this one.
            invalidate_saison_cache()
            # `asyncio.run` copies the context, so nothing set here reaches another test.
            correlation_id_var.set(CORRELATION_ID)

            # The SHIPPED validators and unique indexes, which is what makes a document MongoDB would
            # refuse in production fail here. It creates every collection too.
            await apply_constraints(database)

            await database[Collection.SAISONS].insert_one(seeded.saison)
            await database[Collection.SAISON_TEAMS].insert_many(seeded.entered)
            if seeded.spieltage:
                await database[Collection.SPIELTAGE].insert_many(seeded.spieltage)
            if seeded.spiele:
                await database[Collection.SPIELE].insert_many(seeded.spiele)

            return await body(database, client)
        finally:
            await client.drop_database(DATABASE_NAME)
            client.close()

    return asyncio.run(_run())


async def call_draw(
    database: AsyncIOMotorDatabase, client: AsyncIOMotorClient, *, replace: bool = False, today: str = TODAY
) -> FLGenerateSpielplanResponse:
    return await generate_spielplan(
        saison_id=SAISON_ID,
        saisons_collection=database[Collection.SAISONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        spiele_collection=database[Collection.SPIELE],
        spieltage_collection=database[Collection.SPIELTAGE],
        db=client,
        spielplan_data=FLGenerateSpielplanPayload(replace=replace),
        today=today,
    )


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
    )


async def counts_now(database: AsyncIOMotorDatabase) -> tuple[int, int]:
    """The season's matchdays and fixtures, read outside any transaction -- what a later request would see."""

    return (
        await database[Collection.SPIELTAGE].count_documents({"saison_id": SAISON_ID}),
        await database[Collection.SPIELE].count_documents({"saison_id": SAISON_ID}),
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

        aborted = on_a_seeded_saison(mongo_replica_set_url, body)

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

# One fixture carrying one of these closes the window `REQ-SPIELPLAN-005` opens and `REQ-RULES-011`
# steps aside in. Only the first is played by `has_taken_place`, so the three under it are what say
# both windows read `holds_a_recorded_fact`.
RECORDS_CLOSING_THE_WINDOW = (
    pytest.param({"sonderereignis": A_RECORD}, id="an abandonment"),
    pytest.param({"sonderereignis": "ausgefallen"}, id="a cancellation, which has_taken_place reads as untouched"),
    pytest.param({"ort": A_BOOKED_ORT}, id="a booked venue"),
    pytest.param({"schiedsrichter": A_BOOKED_SCHIEDSRICHTER}, id="a booked referee"),
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

        aborted = on_a_seeded_saison(mongo_replica_set_url, body)

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


class TestTheShapeFreezeLiftsInTheSameWindowTheReplaceRunsIn:
    """`REQ-RULES-011`'s carve-out WIRED, over the season the cases above judge the replace on.

    `patch_saison` counts these fixtures itself, so a count drifting from the draw's unfreezes a
    season whose repairing redraw `REQ-SPIELPLAN-005` then refuses.
    """

    def test_a_drawn_future_season_with_nothing_recorded_may_change_the_shape_it_was_drawn_from(self, mongo_replica_set_url: str):
        """The control: a carve-out that never lifted would pass every case below."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            await call_draw(database, client)

            return await call_patch_rules(database, teams_per_group=WIDER_PER_GROUP)

        patched = on_a_seeded_saison(mongo_replica_set_url, body)

        assert patched.updated_document.rules.teams_per_group == WIDER_PER_GROUP

    @pytest.mark.parametrize("record", RECORDS_CLOSING_THE_WINDOW)
    def test_one_fixture_carrying_a_record_keeps_the_freeze(self, mongo_replica_set_url: str, record: dict[str, Any]):
        """Read this count with `has_taken_place` and the last three fail: the season would take rules no draw of it can be run from."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            await call_draw(database, client)
            await database[Collection.SPIELE].update_one({"spiel_nr": 1}, {"$set": record})

            with pytest.raises(DocumentConflictException) as refused:
                await call_patch_rules(database, teams_per_group=WIDER_PER_GROUP)

            return refused.value, await database[Collection.SAISONS].find_one({"_id": SAISON_ID})

        refused, stored = on_a_seeded_saison(mongo_replica_set_url, body)

        assert refused.error_code == RULES_SHAPE_AFTER_DRAW
        # Read back, not inferred from the refusal: a rule raised after the write would refuse and store.
        assert stored is not None and stored["rules"]["teams_per_group"] == TEAMS_PER_GROUP
