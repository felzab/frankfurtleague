import asyncio
from dataclasses import dataclass, field
from itertools import product
from typing import Any, Awaitable, Callable

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo.errors import OperationFailure

from app.api.saisons.admin_router import generate_spielplan
from app.api.saisons.cache import invalidate_saison_cache, read_cached_saison, store_cached_saison
from app.api.saisons.schedule import schedule_for, total_group_matches
from app.api.saisons.schemas import FLGenerateSpielplanResponse, FLSaisonRules
from app.api.saisons.services import (
    RULES_BRACKET_IMPOSSIBLE,
    SPIELPLAN_ALREADY_DRAWN,
    SPIELPLAN_GRUPPE_SHORT,
    SPIELPLAN_MATCHDAYS_HELD,
    SPIELPLAN_SAISON_NOT_FUTURE,
)
from app.api.spiele.schemas import FLSpiel
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


async def call_draw(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> FLGenerateSpielplanResponse:
    return await generate_spielplan(
        saison_id=SAISON_ID,
        saisons_collection=database[Collection.SAISONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        spiele_collection=database[Collection.SPIELE],
        spieltage_collection=database[Collection.SPIELTAGE],
        db=client,
        today=TODAY,
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


def expected_counts(rules: FLSaisonRules) -> tuple[int, int]:
    """How many matchdays and fixtures these rules imply, counted by `app/api/saisons/schedule.py`.

    The independent oracle: it reads a combination and a phase ladder, where the draw arrives at the
    same two numbers by pairing clubs and walking the bracket.
    """

    schedule = schedule_for(rules)
    bracket = sum(entry.matches_per_matchday for entry in schedule if entry.phase != "gruppenphase")

    return sum(entry.matchdays for entry in schedule), total_group_matches(rules.number_of_groups, rules.teams_per_group) + bracket


@dataclass(frozen=True)
class DrawnSeason:
    """One committed draw, read back four ways, so the assertions run outside the event loop."""

    response: FLGenerateSpielplanResponse
    saison: dict[str, Any]
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

    return on_a_seeded_saison(url, body, seed=seed)


class TestACleanDrawWritesTheWholeSeason:
    @pytest.mark.parametrize(
        ("groups", "teams", "qualifiers"),
        SHAPES,
        ids=["four groups of four into a quarter-final", "two odd groups into one final"],
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
            pytest.param(SPIELPLAN_SAISON_NOT_FUTURE, Seed(saison=saison_document(status="active")), id="a season already running"),
            pytest.param(SPIELPLAN_GRUPPE_SHORT, Seed(entered=entry_rows(short_gruppe="D")), id="a group short of a club"),
            # `find_rules_refusal`, the OTHER call: six qualifiers are no power of two, so this season
            # has no bracket to draw at all.
            pytest.param(
                RULES_BRACKET_IMPOSSIBLE,
                Seed(saison=saison_document(rules=rules_document(groups=2, qualifiers=3))),
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

        assert on_a_seeded_saison(mongo_replica_set_url, body, seed=Seed(saison=saison_document(status="active"))) is not None
