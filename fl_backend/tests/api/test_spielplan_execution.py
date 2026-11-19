from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, timedelta
from itertools import combinations
from typing import Any

import pytest
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.api.saisons.schedule import group_spieltage
from app.api.saisons.schemas import FLSaisonRules
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError
from app.shared.schemas.responses import FLVersionResponse
from tests import documents
from tests.database import DOCUMENT_VALIDATION_FAILED
from tests.isolation import refused_code
from tests.season_routes import (
    BESIDE_A_NEIGHBOUR,
    GROUPS,
    NEIGHBOUR_SAISON_ID,
    QUALIFIERS,
    SAISON_ID,
    TEAMS_PER_GROUP,
    TODAY,
    Body,
    Seed,
    a_record_of_each_kind_on_both_seasons,
    call_draw,
    call_season_save,
    counts_now,
    entry_rows,
    rules_document,
    saison_document,
    the_season_now,
    watermark_now,
)
from tests.season_routes import on_a_seeded_saison as on_a_named_database
from tests.stored import the_row
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_spielplan_write_test")


# `(number_of_groups, teams_per_group, qualifiers_per_group)`: the ordinary season, and one whose odd
# groups take a bye round and whose bracket opens at the semi-finals, the smallest the rules take.
SHAPES: tuple[tuple[int, int, int], ...] = ((GROUPS, TEAMS_PER_GROUP, QUALIFIERS), (2, 3, 2))
SHAPE_IDS = ("four groups of four into a quarter-final", "two odd groups into a semi-final")


async def on_a_seeded_saison(url: str, body: Body, *, seed: Seed | None = None, mutates_schema: bool = False) -> Any:
    return await on_a_named_database(url, DATABASE_NAME, body, seed=seed, mutates_schema=mutates_schema)


async def stored_rules(database: AsyncDatabase) -> dict[str, Any]:
    """The season's whole `rules` sub-document, read outside any transaction -- what a later request would find."""

    return (await the_row(database, Collection.SAISONS, {"_id": SAISON_ID}, f"the seed holds no season {SAISON_ID}"))["rules"]


async def call_patch_rules(database: AsyncDatabase, **overrides: Any) -> FLVersionResponse:
    """The whole rules object every time, `rules` being required on the patch, so a case names only the value it changes.

    The seed's own dates, so `saison_span_below_spieltage` and `saison_span_below_spielplan` cannot be what a refusal is about,
    judged the day before its start, so `rules_saison_started` cannot either.
    """

    seeded = saison_document()

    return await call_season_save(
        database,
        saison_id=SAISON_ID,
        start_date=seeded["start_date"],
        end_date=seeded["end_date"],
        rules={**rules_document(), **overrides},
        today=str(date.fromisoformat(seeded["start_date"]) - timedelta(days=1)),
    )


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
        assert (refused.spieltage, refused.spiele) == (0, 0)
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
        found |= {row["_id"] for row in await database[collection].find({"saison_id": SAISON_ID}, {"_id": 1}).to_list(length=None)}

    return found


async def report_a_drawn_spiel(database: AsyncDatabase) -> None:
    """A submitted report on a fixture the draw holds: the refusal counts only a report whose fixture stands."""

    spiel = await database[Collection.SPIELE].find_one({"saison_id": SAISON_ID})
    assert spiel is not None, "the premise: the season is drawn"
    await database[Collection.SPIELBERICHTE].insert_one(documents.spielbericht_document(spiel))


class TestASubmittedReportKeepsTheSpielplanFromAReplace:
    """`spielplan_berichte_submitted` wired: the replace counts the season's submitted reports in its transaction."""

    async def test_the_reports_refuse_the_replace(self, mongo_replica_set_url: str):
        """Drop the count and the replace lands over the report, deleting it with the fixture it is about."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            await call_draw(database, client)
            await report_a_drawn_spiel(database)

            return await refused_code(call_draw(database, client, replace=True, today=REDRAWN_TODAY))

        assert await on_a_seeded_saison(mongo_replica_set_url, body) == Code.SPIELPLAN_BERICHTE_SUBMITTED


@dataclass(frozen=True)
class ReplacedSeason:
    """One season drawn, then drawn again over the top beside a finished season, as a later request would find both."""

    first_ids: set[Any]
    spieltage: list[dict[str, Any]]
    spiele: list[dict[str, Any]]
    subject: dict[str, Any]
    # The neighbour's own two counts as its draw stored them, before the subject's replace.
    neighbour_drawn: tuple[int, int]
    neighbour: dict[str, Any]


class TestAConfirmedReplaceRedrawsTheSeasonAndNothingElse:
    """`spielplan_replace_outside_its_window`'s write half, inside one transaction, against a season standing beside it.

    The season's draw and every record naming its fixtures go, and the draw comes back whole.
    """

    async def test_no_document_of_the_first_draw_survives_and_the_neighbour_keeps_everything(self, mongo_replica_set_url: str):
        """Drop any removal, or empty its `db_filter`, and this fails; with one season seeded, the filters' half never does."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> ReplacedSeason:
            await call_draw(database, client, saison_id=NEIGHBOUR_SAISON_ID)
            neighbour_drawn = await counts_now(database, saison_id=NEIGHBOUR_SAISON_ID)
            # Demoted to `past` after its draw: what an unscoped removal takes from a finished season is
            # the fixture set its league table is scored from on every read.
            await database[Collection.SAISONS].update_one({"_id": NEIGHBOUR_SAISON_ID}, {"$set": {"status": "past"}})
            await call_draw(database, client)
            # Read between the two draws: afterwards nothing tells a surviving row from a fresh one carrying the same numbers.
            first_ids = await document_ids(database)
            await a_record_of_each_kind_on_both_seasons(database)

            await call_draw(database, client, replace=True, today=REDRAWN_TODAY)

            return ReplacedSeason(
                first_ids=first_ids,
                spieltage=await database[Collection.SPIELTAGE].find({"saison_id": SAISON_ID}).to_list(length=None),
                spiele=await database[Collection.SPIELE].find({"saison_id": SAISON_ID}).to_list(length=None),
                subject=await the_season_now(database),
                neighbour_drawn=neighbour_drawn,
                neighbour=await the_season_now(database, saison_id=NEIGHBOUR_SAISON_ID),
            )

        replaced = await on_a_seeded_saison(mongo_replica_set_url, body, seed=BESIDE_A_NEIGHBOUR)

        assert replaced.first_ids, "the first draw wrote nothing, so the replace had nothing to remove"
        assert replaced.neighbour_drawn[1] > 0, "the neighbour was drawn nothing, so its survival proves nothing"

        surviving = {row["_id"] for row in (*replaced.spieltage, *replaced.spiele)}
        assert surviving & replaced.first_ids == set(), "a document of the first draw survives: a replace is these rows GONE"
        # Exactly one whole draw afterwards: delete only `spiele` and the fresh matchdays collide with the surviving ones
        # on their own unique index.
        spieltage, spiele = expected_counts(FLSaisonRules.model_validate(saison_document()["rules"]))
        assert replaced.subject == {
            "spieltage": spieltage,
            "spiele": spiele,
            "spielbestaetigungen": 0,
            "spielberichte": 0,
            "aufstellungen": 0,
            "watermark": {"generated_at": REDRAWN_TODAY},
        }, "the season holds other than one whole draw of the replace's own day, or a record naming a fixture the replace removed survives it"
        matchdays = {row["_id"] for row in replaced.spieltage}
        assert [row["spiel_nr"] for row in replaced.spiele if row["spieltag_id"] not in matchdays] == [], (
            "a fixture hangs on a matchday the replace did not write: the two lists go as one set"
        )
        assert replaced.neighbour == {
            "spieltage": replaced.neighbour_drawn[0],
            "spiele": replaced.neighbour_drawn[1],
            "spielbestaetigungen": 1,
            "spielberichte": 1,
            "aufstellungen": 1,
            "watermark": {"generated_at": TODAY},
        }, "the replace reached the season beside it, whose finished table is scored off these rows"


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
