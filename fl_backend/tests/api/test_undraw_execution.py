import asyncio
from dataclasses import dataclass, field
from itertools import product
from typing import Any, Awaitable, Callable

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo.errors import OperationFailure

from app.api.saisons.admin_router import generate_spielplan, patch_saison, undraw_spielplan
from app.api.saisons.cache import invalidate_saison_cache, read_cached_saison, store_cached_saison
from app.api.saisons.schemas import (
    FLGenerateSpielplanPayload,
    FLGenerateSpielplanResponse,
    FLPatchSaisonPayload,
    FLPatchSaisonResponse,
    FLSaisonRules,
    FLUndrawSpielplanResponse,
)
from app.api.saisons.services import RULES_SHAPE_AFTER_DRAW, SPIELPLAN_UNDRAW_OUTSIDE_ITS_WINDOW
from app.api.teams.admin_router import post_saison_team
from app.api.teams.schemas import FLGruppenNames, FLPostSaisonTeamPayload, FLSaisonTeamResponse
from app.api.teams.services import ENTRY_GRUPPE_FULL, offered_gruppen
from app.core.collections import Collection
from app.core.constraints import apply_constraints
from app.core.exceptions import DocumentConflictException
from app.core.logging import correlation_id_var

pytestmark = pytest.mark.db

DATABASE_NAME = "fl_undraw_write_test"

# Named rather than caught broadly: another failure must not read as the rollback this suite proves.
DOCUMENT_VALIDATION_FAILED = 121

SAISON_ID = "2026"

# Fixed rather than the real day, so the watermark the draw leaves is a value this file chose.
TODAY = "2026-08-21"

CORRELATION_ID = "0123456789abcdef0123456789abcdef"

GROUPS = 4
TEAMS_PER_GROUP = 4
QUALIFIERS = 2

# Wider than the shape the season was drawn from, which is the step `REQ-RULES-011` refuses while the
# season is drawn -- and the whole reason this endpoint exists.
WIDER_PER_GROUP = 6

# The club the capacity a widening buys is spent on. In `teams` from the start, so an entry refused
# while the season is drawn can only be refused for the group being full.
NEWCOMER_OID = ObjectId("6890a1b2c3d4e5f607770001")

# A hand-assigned kickoff the draw never wrote and nothing regenerates, which is what the removal's
# images are for (`docs/backend/spec.md :: I48`).
A_DATE = "2026-05-01"
A_KICKOFF = "18:00:00"

# One field on one fixture, so nothing else about the season moves to reach a state
# `app/api/saisons/services.py :: holds_a_recorded_fact` calls recorded.
RECORDS_CLOSING_THE_WINDOW = (
    pytest.param({"sonderereignis": "abgebrochen"}, id="an abandonment"),
    pytest.param({"sonderereignis": "ausgefallen"}, id="a cancellation, which has_taken_place reads as untouched"),
    pytest.param({"notiz": "Platz gesperrt"}, id="an admin's note, for which the draw writes no key at all"),
)

# `spielplan` moved into `required`, so the `$unset` that clears the watermark is the write the
# server refuses -- by which point both removals have already run.
WATERMARK_REQUIRED: dict[str, Any] = {"$jsonSchema": {"bsonType": "object", "required": ["spielplan"]}}


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


def saison_document(*, status: str = "future", spielplan: dict[str, Any] | None = None) -> dict[str, Any]:
    """Every key spelled out: the shipped `saisons` validator is attached before this is inserted.

    `spielplan` is OMITTED where absent rather than nulled, which is the shape a season nobody has
    drawn carries.
    """

    document: dict[str, Any] = {
        "_id": SAISON_ID,
        "start_date": "2026-01-01",
        "end_date": "2026-06-30",
        "status": status,
        "rules": rules_document(),
    }

    return document if spielplan is None else {**document, "spielplan": spielplan}


def team_document(oid: ObjectId, shorthand: str) -> dict[str, Any]:
    """A club as `teams` holds one: the entry endpoint reads it to seed the season's own copy of the name."""

    return {
        "_id": oid,
        "name": f"{shorthand}-Schule",
        "shorthand": shorthand,
        "description": "",
        "full_name": f"{shorthand}-Schule Frankfurt",
        "website_url": f"https://{shorthand.lower()}.example.de",
        "address": {
            "strasse": "Hanauer Landstrasse",
            "hausnummer": "12a",
            "plz": "60314",
            "stadtteil": "Ostend",
            "stadt": "Frankfurt am Main",
        },
        "inactive_since": None,
    }


def entry_rows(*, groups: int = GROUPS, teams: int = TEAMS_PER_GROUP) -> list[dict[str, Any]]:
    """Every club of a full season as its `saison_teams` row, so the draw below has a season to draw."""

    return [
        {
            "_id": ObjectId(f"6890a1b2c3d4e5f6077{index:05d}"),
            "saison_id": SAISON_ID,
            "team_id": ObjectId(f"6890a1b2c3d4e5f6078{index:05d}"),
            "gruppe": gruppe,
            "austritt": None,
            "name": f"{gruppe}{seat + 1}-Schule",
            "shorthand": f"{gruppe}{seat + 1}",
        }
        for index, (seat, gruppe) in enumerate(product(range(teams), offered_gruppen(groups)))
    ]


@dataclass(frozen=True)
class Seed:
    """One season as the database holds it when the undraw is asked for."""

    saison: dict[str, Any] = field(default_factory=saison_document)
    entered: list[dict[str, Any]] = field(default_factory=entry_rows)
    teams: list[dict[str, Any]] = field(default_factory=lambda: [team_document(NEWCOMER_OID, "NE")])


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

            # The SHIPPED validators and unique indexes, so a document MongoDB would refuse in
            # production fails here too. It creates every collection as well.
            await apply_constraints(database)

            await database[Collection.SAISONS].insert_one(seeded.saison)
            await database[Collection.SAISON_TEAMS].insert_many(seeded.entered)
            await database[Collection.TEAMS].insert_many(seeded.teams)

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
        spielplan_data=FLGenerateSpielplanPayload(),
        today=TODAY,
    )


async def call_undraw(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> FLUndrawSpielplanResponse:
    return await undraw_spielplan(
        saison_id=SAISON_ID,
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        spieltage_collection=database[Collection.SPIELTAGE],
        db=client,
    )


async def call_patch_rules(database: AsyncIOMotorDatabase, **overrides: Any) -> FLPatchSaisonResponse:
    """The whole rules object every time, `rules` being required on the patch, so a case names only the value it moves."""

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


async def call_entry(database: AsyncIOMotorDatabase, *, gruppe: FLGruppenNames = "A") -> FLSaisonTeamResponse:
    return await post_saison_team(
        team_id=NEWCOMER_OID,
        saison_team_data=FLPostSaisonTeamPayload(saison_id=SAISON_ID, gruppe=gruppe),
        teams_collection=database[Collection.TEAMS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
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


async def stored_rules(database: AsyncIOMotorDatabase) -> dict[str, Any]:
    stored = await database[Collection.SAISONS].find_one({"_id": SAISON_ID})
    assert stored is not None, f"the seed holds no season {SAISON_ID}"

    return stored["rules"]


def server_code(failure: OperationFailure) -> Any:
    """The code the SERVER answered with; `failure.code` alone names the driver's own wrapper on a bulk write."""

    refused = ((failure.details or {}).get("writeErrors") or [failure.details or {}])[0]

    return refused.get("code", failure.code)


@dataclass(frozen=True)
class UndrawnSeason:
    """One committed undraw, read back four ways, so the assertions run outside the event loop."""

    drawn: FLGenerateSpielplanResponse
    response: FLUndrawSpielplanResponse
    spieltage: int
    spiele: int
    watermark: Any
    log: list[dict[str, Any]]


def an_undrawn_season(url: str, *, dated: bool = False) -> UndrawnSeason:
    """Draw the season, optionally date one fixture by hand, then undraw it."""

    async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> UndrawnSeason:
        drawn = await call_draw(database, client)
        if dated:
            await database[Collection.SPIELE].update_one({"spiel_nr": 1}, {"$set": {"datum": A_DATE, "uhrzeit": A_KICKOFF}})

        response = await call_undraw(database, client)
        spieltage, spiele = await counts_now(database)

        return UndrawnSeason(
            drawn=drawn,
            response=response,
            spieltage=spieltage,
            spiele=spiele,
            watermark=await watermark_now(database),
            log=await database[Collection.AKTIONEN].find({}).sort("_id", 1).to_list(length=None),
        )

    undrawn = on_a_seeded_saison(url, body)

    assert undrawn.drawn.spiele > 0, "the draw wrote nothing, so the undraw had nothing to remove"

    return undrawn


class TestAnUndrawRemovesTheWholeSpielplan:
    """`docs/backend/spec.md :: I46`'s three, together: the fixtures, the matchdays and the watermark."""

    def test_neither_collection_keeps_a_document_of_the_season(self, mongo_replica_set_url: str):
        """Drop either removal and this fails: an undraw is these rows being GONE, never merely disowned by a watermark."""

        undrawn = an_undrawn_season(mongo_replica_set_url)

        assert (undrawn.spieltage, undrawn.spiele) == (0, 0)

    def test_the_season_keeps_no_watermark(self, mongo_replica_set_url: str):
        """Leave the watermark standing and the season reads as drawn while holding nothing, which is the state I46 prevents."""

        undrawn = an_undrawn_season(mongo_replica_set_url)

        assert undrawn.watermark is None

    def test_the_response_reports_what_it_removed(self, mongo_replica_set_url: str):
        """Counted off the driver's own results (`docs/backend/spec.md :: I13`): numbers read off the watermark would echo a claim."""

        undrawn = an_undrawn_season(mongo_replica_set_url)

        assert (undrawn.response.spieltage, undrawn.response.spiele) == (undrawn.drawn.spieltage, undrawn.drawn.spiele)
        assert undrawn.response.watermark_cleared is True
        assert undrawn.response.saison_id == SAISON_ID


class TestTheRemovalKeepsEveryImage:
    """`docs/backend/spec.md :: I48`: a drawn schedule carries hand-assigned dates and kickoff times nothing regenerates."""

    def test_the_log_records_both_removals_and_the_watermark_as_three_rows(self, mongo_replica_set_url: str):
        """Fixtures before matchdays, the reverse of the draw's write order: no image names a matchday already gone."""

        undrawn = an_undrawn_season(mongo_replica_set_url)
        removal = undrawn.log[-3:]

        assert [(row["collection"], row["operation"], row["modified_count"]) for row in removal] == [
            (str(Collection.SPIELE), "delete_many", undrawn.drawn.spiele),
            (str(Collection.SPIELTAGE), "delete_many", undrawn.drawn.spieltage),
            (str(Collection.SAISONS), "patch_one", None),
        ]
        assert {row["correlation_id"] for row in removal} == {CORRELATION_ID}
        assert [len(row["before"]) for row in removal if row["operation"] == "delete_many"] == [
            undrawn.drawn.spiele,
            undrawn.drawn.spieltage,
        ]

    def test_a_hand_assigned_kickoff_survives_in_the_image(self, mongo_replica_set_url: str):
        """Call `delete_many` rather than `delete_many_from_db` and the schedule goes unrecorded, with nothing left to restore it from."""

        undrawn = an_undrawn_season(mongo_replica_set_url, dated=True)
        removed = next(row for row in undrawn.log if row["operation"] == "delete_many" and row["collection"] == str(Collection.SPIELE))

        assert [(image["datum"], image["uhrzeit"]) for image in removed["before"] if image["datum"] is not None] == [(A_DATE, A_KICKOFF)]

    def test_the_watermark_reaches_the_log_as_the_patch_pre_image(self, mongo_replica_set_url: str):
        """What a restore replays: the season as it stood while it still claimed a Spielplan."""

        undrawn = an_undrawn_season(mongo_replica_set_url)
        patched = [row for row in undrawn.log if row["operation"] == "patch_one"][-1]

        assert patched["before"]["spielplan"] == {
            "generiert_am": TODAY,
            "spieltage": undrawn.drawn.spieltage,
            "spiele": undrawn.drawn.spiele,
        }


@dataclass(frozen=True)
class AbortedUndraw:
    """An undraw that fell mid-flight, as the driver reported it and as a later request would find the season."""

    drawn: FLGenerateSpielplanResponse
    write_error: Any
    spieltage: int
    spiele: int
    watermark: Any
    log: int
    cached: dict[str, Any] | None


class TestAnAbortedUndrawLeavesAllThreeStanding:
    """The two removals and the watermark clear are ONE transaction, so a clear that falls takes both removals back."""

    def test_the_season_keeps_its_fixtures_its_matchdays_and_its_watermark(self, mongo_replica_set_url: str):
        """Move the watermark clear outside the callback and this fails: the season is left holding no schedule while claiming one."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> AbortedUndraw:
            drawn = await call_draw(database, client)
            # Stored AFTER the draw, which drops the cache on its own commit.
            store_cached_saison(SAISON_ID, saison_document())

            # Narrowed after the draw, so what falls is the `$unset` itself -- by which point both
            # removals have run.
            await database.command("collMod", str(Collection.SAISONS), validator=WATERMARK_REQUIRED, validationLevel="strict")

            with pytest.raises(OperationFailure) as failure:
                await call_undraw(database, client)

            spieltage, spiele = await counts_now(database)

            return AbortedUndraw(
                drawn=drawn,
                write_error=server_code(failure.value),
                spieltage=spieltage,
                spiele=spiele,
                watermark=await watermark_now(database),
                log=await database[Collection.AKTIONEN].count_documents({}),
                cached=read_cached_saison(SAISON_ID),
            )

        aborted = on_a_seeded_saison(mongo_replica_set_url, body)

        # On the code, so this cannot pass because the undraw fell before it removed anything.
        assert aborted.write_error == DOCUMENT_VALIDATION_FAILED, f"expected the validator to refuse the write, got {aborted.write_error}"
        assert (aborted.spieltage, aborted.spiele) == (aborted.drawn.spieltage, aborted.drawn.spiele), "a rolled-back undraw removed rows"
        assert aborted.watermark == {"generiert_am": TODAY, "spieltage": aborted.drawn.spieltage, "spiele": aborted.drawn.spiele}
        # The draw's three rows and nothing else: the removals record in-session, so the abort takes
        # their rows back too.
        assert aborted.log == 3
        # The drop runs after the commit, so an undraw that never committed leaves the cache nothing to unlearn.
        assert aborted.cached is not None


@dataclass(frozen=True)
class RefusedUndraw:
    """An undraw refused before it removed anything, and the season it left standing."""

    drawn: FLGenerateSpielplanResponse
    error_code: str
    message: str
    spieltage: int
    spiele: int
    watermark: Any


def an_undraw_refused_on(url: str, *, status: str | None = None, record: dict[str, Any] | None = None) -> RefusedUndraw:
    """Draw the season, then close its window one way, then ask for the undraw."""

    async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> RefusedUndraw:
        drawn = await call_draw(database, client)
        if status is not None:
            await database[Collection.SAISONS].update_one({"_id": SAISON_ID}, {"$set": {"status": status}})
        if record is not None:
            await database[Collection.SPIELE].update_one({"spiel_nr": 1}, {"$set": record})

        with pytest.raises(DocumentConflictException) as refused:
            await call_undraw(database, client)

        spieltage, spiele = await counts_now(database)

        return RefusedUndraw(
            drawn=drawn,
            error_code=refused.value.error_code,
            message=refused.value.error_detail["message"],
            spieltage=spieltage,
            spiele=spiele,
            watermark=await watermark_now(database),
        )

    return on_a_seeded_saison(url, body)


class TestTheWindowIsReachedThroughTheRoute:
    """`REQ-SPIELPLAN-006` WIRED: the endpoint reads the season's status and its own fixtures inside the transaction."""

    @pytest.mark.parametrize("status", ["active", "past"])
    def test_a_season_outside_its_planning_keeps_its_whole_spielplan(self, mongo_replica_set_url: str, status: str):
        """Wire the undraw past the window and this fails: a league mid-season would lose the schedule it is playing."""

        refused = an_undraw_refused_on(mongo_replica_set_url, status=status)

        assert refused.error_code == SPIELPLAN_UNDRAW_OUTSIDE_ITS_WINDOW
        assert status in refused.message
        assert (refused.spieltage, refused.spiele) == (refused.drawn.spieltage, refused.drawn.spiele)
        assert refused.watermark is not None

    @pytest.mark.parametrize("record", RECORDS_CLOSING_THE_WINDOW)
    def test_a_single_recorded_fixture_keeps_the_whole_spielplan(self, mongo_replica_set_url: str, record: dict[str, Any]):
        """Count these off anything but the stored rows and this fails; drop `notiz` from the projection and the last one does."""

        refused = an_undraw_refused_on(mongo_replica_set_url, record=record)

        assert refused.error_code == SPIELPLAN_UNDRAW_OUTSIDE_ITS_WINDOW
        assert "1 fixture(s)" in refused.message
        assert (refused.spieltage, refused.spiele) == (refused.drawn.spieltage, refused.drawn.spiele)

    def test_a_dated_fixture_does_not_close_the_window(self, mongo_replica_set_url: str):
        """The control: rescheduling is what an undraw is FOR, so a date is not a record and the images keep it."""

        undrawn = an_undrawn_season(mongo_replica_set_url, dated=True)

        assert (undrawn.spieltage, undrawn.spiele) == (0, 0)


@dataclass(frozen=True)
class UndrawOfNothing:
    """One undraw of a season holding no fixture, and what it reported."""

    response: FLUndrawSpielplanResponse
    watermark: Any


def an_undraw_of(url: str, *, seed: Seed) -> UndrawOfNothing:
    async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> UndrawOfNothing:
        return UndrawOfNothing(response=await call_undraw(database, client), watermark=await watermark_now(database))

    return on_a_seeded_saison(url, body, seed=seed)


class TestAnUndrawOfASeasonHoldingNoSpielplan:
    """A DELETE answers the state asked for. Refusing one would fail a second press, and two admins make that ordinary."""

    def test_a_season_that_was_never_drawn_answers_with_zeroes(self, mongo_replica_set_url: str):
        """Refuse an undrawn season and this fails: the refusal names no work an admin can do, the season already being as asked."""

        undrawn = an_undraw_of(mongo_replica_set_url, seed=Seed())

        assert (undrawn.response.spieltage, undrawn.response.spiele) == (0, 0)
        assert undrawn.response.watermark_cleared is False

    def test_a_watermark_standing_with_no_fixtures_behind_it_is_cleared_and_reported(self, mongo_replica_set_url: str):
        """Report the clear off the counts and this fails: the one thing removed here is the claim, and `docs/backend/spec.md :: I13` says report it."""

        seed = Seed(saison=saison_document(spielplan={"generiert_am": TODAY, "spieltage": 8, "spiele": 67}))
        undrawn = an_undraw_of(mongo_replica_set_url, seed=seed)

        assert (undrawn.response.spieltage, undrawn.response.spiele) == (0, 0)
        assert undrawn.response.watermark_cleared is True
        assert undrawn.watermark is None


class TestTheSeasonCacheIsDroppedOnlyByAnUndrawThatCommitted:
    """One process, one cache, keyed by season id -- so dropping it early unlearns a season nothing has changed yet."""

    def test_a_committed_undraw_drops_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            await call_draw(database, client)
            store_cached_saison(SAISON_ID, saison_document())
            await call_undraw(database, client)

            return read_cached_saison(SAISON_ID)

        assert on_a_seeded_saison(mongo_replica_set_url, body) is None

    def test_a_refused_undraw_leaves_it_standing(self, mongo_replica_set_url: str):
        """The control: a drop before the refusal would pass the case above while costing every reader a re-read for nothing."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            await call_draw(database, client)
            store_cached_saison(SAISON_ID, saison_document())
            await database[Collection.SAISONS].update_one({"_id": SAISON_ID}, {"$set": {"status": "active"}})

            with pytest.raises(DocumentConflictException):
                await call_undraw(database, client)

            return read_cached_saison(SAISON_ID)

        assert on_a_seeded_saison(mongo_replica_set_url, body) is not None


@dataclass(frozen=True)
class ReopenedSeason:
    """A drawn season's two refusals, and the same two steps once the draw is gone."""

    patch_refused: str
    entry_refused: str
    widened: FLPatchSaisonResponse
    entered: FLSaisonTeamResponse
    gruppe_a_holds: int


class TestWhatAnUndrawReopens:
    """Why the endpoint exists: a replace repairs a NARROWING alone.

    Widening is refused by `REQ-SPIELPLAN-004` for the groups then short of the new size, and no club
    can be entered into a drawn season at all.
    """

    def test_a_widening_patch_and_an_entry_both_go_through_once_the_draw_is_gone(self, mongo_replica_set_url: str):
        """Leave the watermark, or either list, standing and this fails at the widening: the season would still read as drawn."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> ReopenedSeason:
            await call_draw(database, client)

            with pytest.raises(DocumentConflictException) as refused_patch:
                await call_patch_rules(database, teams_per_group=WIDER_PER_GROUP)

            with pytest.raises(DocumentConflictException) as refused_entry:
                await call_entry(database)

            await call_undraw(database, client)

            return ReopenedSeason(
                patch_refused=refused_patch.value.error_code,
                entry_refused=refused_entry.value.error_code,
                widened=await call_patch_rules(database, teams_per_group=WIDER_PER_GROUP),
                entered=await call_entry(database),
                gruppe_a_holds=await database[Collection.SAISON_TEAMS].count_documents({"saison_id": SAISON_ID, "gruppe": "A"}),
            )

        reopened = on_a_seeded_saison(mongo_replica_set_url, body)

        assert reopened.patch_refused == RULES_SHAPE_AFTER_DRAW
        assert reopened.entry_refused == ENTRY_GRUPPE_FULL
        # Read off the stored document the patch echoes, so a rule refused after the write cannot pass this.
        assert reopened.widened.updated_document.rules.teams_per_group == WIDER_PER_GROUP
        assert (reopened.entered.team_id, reopened.entered.gruppe) == (NEWCOMER_OID, "A")
        assert reopened.gruppe_a_holds == TEAMS_PER_GROUP + 1
