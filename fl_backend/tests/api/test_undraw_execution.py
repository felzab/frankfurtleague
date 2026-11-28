from dataclasses import dataclass
from datetime import datetime
from typing import Any, NamedTuple
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.api.spiele.admin_router import patch_spiel
from app.api.spiele.schemas import FLPatchSpielDataPayload
from app.core.codes import Code
from app.core.collections import Collection
from tests.database import DOCUMENT_VALIDATION_FAILED
from tests.isolation import refused_code
from tests.season_routes import (
    BESIDE_A_NEIGHBOUR,
    NEIGHBOUR_SAISON_ID,
    SAISON_ID,
    TODAY,
    Body,
    Seed,
    a_record_of_each_kind_on_both_seasons,
    call_draw,
    call_undraw,
    counts_now,
    saison_document,
    the_season_now,
    watermark_now,
)
from tests.season_routes import on_a_seeded_saison as on_a_named_database
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_undraw_write_test")

# Noon of the draw's day, the instant a match save reads its day from.
NOW = datetime(2026, 8, 21, 12, 0, tzinfo=ZoneInfo("Europe/Berlin"))


# One field on one fixture, so nothing else about the season moves to reach a state
# `app/api/saisons/services.py :: holds_a_recorded_fact` calls recorded.
RECORDS_CLOSING_THE_WINDOW = (
    pytest.param({"sonderereignis": "ausgefallen"}, id="a cancellation, which has_taken_place reads as untouched"),
    pytest.param({"note": "Platz gesperrt"}, id="an admin's note, for which the draw writes no key at all"),
)

# `spielplan` moved into `required`, so the `$unset` that clears the watermark is the write the
# server refuses -- by which point both removals have already run.
WATERMARK_REQUIRED: dict[str, Any] = {"$jsonSchema": {"bsonType": "object", "required": ["spielplan"]}}


async def on_a_seeded_saison(url: str, body: Body, *, seed: Seed | None = None, mutates_schema: bool = False) -> Any:
    return await on_a_named_database(url, DATABASE_NAME, body, seed=seed, mutates_schema=mutates_schema)


class Drawn(NamedTuple):
    """One season's matchdays and fixtures as its draw stored them."""

    spieltage: int
    spiele: int


async def draw(database: AsyncDatabase, client: AsyncMongoClient, *, saison_id: str = SAISON_ID) -> Drawn:
    await call_draw(database, client, saison_id=saison_id)

    return Drawn(*await counts_now(database, saison_id=saison_id))


def server_code(failure: OperationFailure) -> Any:
    """The code the SERVER answered with; `failure.code` alone names the driver's own wrapper on a bulk write."""

    refused = ((failure.details or {}).get("writeErrors") or [failure.details or {}])[0]

    return refused.get("code", failure.code)


class TestAnUndrawRemovesTheSeasonsDrawAndNothingElse:
    """The fixtures, the matchdays, the watermark and every record naming a fixture, against a season standing beside it."""

    async def test_the_season_keeps_nothing_of_its_draw_and_the_neighbour_everything(self, mongo_replica_set_url: str):
        """Drop any removal, or empty its `db_filter`, and this fails; with one season seeded, the filters' half never does."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            neighbour_drawn = await draw(database, client, saison_id=NEIGHBOUR_SAISON_ID)
            # Demoted to `past` after its draw: what an unscoped removal takes from a finished season is
            # the fixture set its league table is scored from on every read.
            await database[Collection.SAISONS].update_one({"_id": NEIGHBOUR_SAISON_ID}, {"$set": {"status": "past"}})
            await call_draw(database, client)
            await a_record_of_each_kind_on_both_seasons(database)

            await call_undraw(database, client)

            return neighbour_drawn, await the_season_now(database), await the_season_now(database, saison_id=NEIGHBOUR_SAISON_ID)

        neighbour_drawn, subject, neighbour = await on_a_seeded_saison(mongo_replica_set_url, body, seed=BESIDE_A_NEIGHBOUR)

        assert neighbour_drawn.spiele > 0, "the neighbour was drawn nothing, so its survival proves nothing"
        assert subject == {
            "spieltage": 0,
            "spiele": 0,
            "spielbestaetigungen": 0,
            "spielberichte": 0,
            "aufstellungen": 0,
            "watermark": None,
        }, (
            "the season keeps part of its draw: an undraw is these rows GONE, a record naming a removed fixture would name "
            "nothing, and a watermark left standing reads the season as drawn while it holds nothing"
        )
        assert neighbour == {
            "spieltage": neighbour_drawn.spieltage,
            "spiele": neighbour_drawn.spiele,
            "spielbestaetigungen": 1,
            "spielberichte": 1,
            "aufstellungen": 1,
            "watermark": {"generated_at": TODAY},
        }, "the undraw reached the season beside it, whose finished table is scored off these rows"


@dataclass(frozen=True)
class AbortedUndraw:
    """An undraw that fell mid-flight, as the driver reported it and as a later request would find the season."""

    drawn: Drawn
    write_error: Any
    spieltage: int
    spiele: int
    watermark: Any


class TestAnAbortedUndrawLeavesAllThreeStanding:
    """The two removals and the watermark clear are ONE transaction, so a clear that falls takes both removals back."""

    async def test_the_season_keeps_its_spiele_its_matchdays_and_its_watermark(self, mongo_replica_set_url: str):
        """Move the watermark clear outside the callback and this fails: the season is left holding no schedule while claiming one."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> AbortedUndraw:
            drawn = await draw(database, client)

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
            )

        aborted = await on_a_seeded_saison(mongo_replica_set_url, body, mutates_schema=True)

        # On the code, so this cannot pass because the undraw fell before it removed anything.
        assert aborted.write_error == DOCUMENT_VALIDATION_FAILED, f"expected the validator to refuse the write, got {aborted.write_error}"
        assert (aborted.spieltage, aborted.spiele) == (aborted.drawn.spieltage, aborted.drawn.spiele), "a rolled-back undraw removed rows"
        assert aborted.watermark == {"generated_at": TODAY}


@dataclass(frozen=True)
class RefusedUndraw:
    """An undraw refused before it removed anything, and the season it left standing."""

    drawn: Drawn
    error_code: str
    spieltage: int
    spiele: int


async def an_undraw_refused_on(url: str, *, record: dict[str, Any]) -> RefusedUndraw:
    """Draw the season, then close its window with `record` on one fixture, then ask for the undraw."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> RefusedUndraw:
        drawn = await draw(database, client)
        await database[Collection.SPIELE].update_one({"spiel_nr": 1}, {"$set": record})

        code = await refused_code(call_undraw(database, client))

        spieltage, spiele = await counts_now(database)

        return RefusedUndraw(
            drawn=drawn,
            error_code=code,
            spieltage=spieltage,
            spiele=spiele,
        )

    return await on_a_seeded_saison(url, body)


class TestTheWindowIsReachedThroughTheRoute:
    """`spielplan_undraw_outside_its_window` WIRED: the endpoint reads its fixtures' recorded facts inside the transaction."""

    @pytest.mark.parametrize("record", RECORDS_CLOSING_THE_WINDOW)
    async def test_a_single_recorded_spiel_keeps_the_whole_spielplan(self, mongo_replica_set_url: str, record: dict[str, Any]):
        """Count these off anything but the stored rows and this fails; drop `note` from the projection and the last one does."""

        refused = await an_undraw_refused_on(mongo_replica_set_url, record=record)

        assert refused.error_code == Code.SPIELPLAN_UNDRAW_OUTSIDE_ITS_WINDOW
        assert (refused.spieltage, refused.spiele) == (refused.drawn.spieltage, refused.drawn.spiele)


async def call_patch_spiel(database: AsyncDatabase, client: AsyncMongoClient, *, spiel_id: Any, payload: FLPatchSpielDataPayload) -> Any:
    async with client.start_session(snapshot=True) as session:
        return await patch_spiel(
            spiel_id=spiel_id,
            spiel_data=payload,
            db=client,
            spiele_collection=database[Collection.SPIELE],
            teams_collection=database[Collection.TEAMS],
            saisons_collection=database[Collection.SAISONS],
            saison_teams_collection=database[Collection.SAISON_TEAMS],
            spieltage_collection=database[Collection.SPIELTAGE],
            spielorte_collection=database[Collection.SPIELORTE],
            schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
            spielberichte_collection=database[Collection.SPIELBERICHTE],
            aufstellungen_collection=database[Collection.AUFSTELLUNGEN],
            spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
            germany_now=NOW,
            session=session,
        )


def seeding_payload(stored: dict[str, Any], team_id: ObjectId) -> FLPatchSpielDataPayload:
    """The editor's own save for taking a bracket slot over: clear `team1_quelle`, name the club.

    Written wholesale, so every field is stated; this is the route
    `app/api/spiele/services.py :: find_wiring_refusal` names past a maintained side.
    """

    return FLPatchSpielDataPayload.model_validate(
        {
            "sonderereignis": None,
            "team1": {"team_id": team_id, "tore": None},
            "team2": None,
            "team1_quelle": None,
            "team2_quelle": stored["team2_quelle"],
            "elfmeterschiessen": None,
            "date": None,
            "time": None,
            "spielort": None,
            "schiedsrichter": None,
            "note": None,
            "version": stored["version"],
        }
    )


@dataclass(frozen=True)
class SeededBracket:
    """One bracket slot taken over by hand on a drawn `future` season, and what the undraw then answered."""

    seeded_team: Any
    stored_team1: Any
    stored_team1_quelle: Any
    error_code: str


async def a_bracket_slot_seeded_by_hand(url: str) -> SeededBracket:
    """Draw the season, seed its first knockout slot through the fixture patch, then ask for the undraw."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> SeededBracket:
        await call_draw(database, client)

        slot = await database[Collection.SPIELE].find_one(
            {"saison_id": SAISON_ID, "saison_phase": {"$ne": "gruppenphase"}}, sort=[("spiel_nr", 1)]
        )
        assert slot is not None, "the draw wrote no knockout fixture, so there is no slot to seed"
        assert slot["team1"] is None and slot["team1_quelle"] is not None, "the draw left this slot occupied, so seeding it proves nothing"

        entered = await database[Collection.SAISON_TEAMS].find_one({"saison_id": SAISON_ID}, sort=[("_id", 1)])
        assert entered is not None, "the season holds no club to seed the slot with"

        await call_patch_spiel(database, client, spiel_id=slot["_id"], payload=seeding_payload(slot, entered["team_id"]))

        code = await refused_code(call_undraw(database, client))

        stored = await database[Collection.SPIELE].find_one({"_id": slot["_id"]})

        return SeededBracket(
            seeded_team=entered["team_id"],
            stored_team1=(stored or {}).get("team1"),
            stored_team1_quelle=(stored or {}).get("team1_quelle"),
            error_code=code,
        )

    return await on_a_seeded_saison(url, body)


class TestABracketSlotSeededByHandKeepsTheWholeSpielplan:
    """The pre-season work a `future` season accumulates before the first kick-off.

    `future` is the only status either destructive window opens on, so the window stands open
    exactly while the hand-seeded data it would destroy is most likely to exist.
    """

    async def test_the_undraw_is_refused(self, mongo_replica_set_url: str):
        """Drop the four side fields from `RECORDED_FACT_FIELDS` and this fails: the undraw answers 200 and the seeding is gone.

        The pick is read back first: the ordinary write path supplies the precondition, rather than a hand edit at the database.
        """

        seeded = await a_bracket_slot_seeded_by_hand(mongo_replica_set_url)

        assert seeded.stored_team1 is not None
        assert seeded.stored_team1["team_id"] == seeded.seeded_team
        assert seeded.stored_team1_quelle is None
        assert seeded.error_code == Code.SPIELPLAN_UNDRAW_OUTSIDE_ITS_WINDOW


@dataclass(frozen=True)
class UndrawOfNothing:
    """One undraw of a season holding no fixture, and what it left."""

    counts: tuple[int, int]
    watermark: Any


async def an_undraw_of(url: str, *, seed: Seed) -> UndrawOfNothing:
    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> UndrawOfNothing:
        await call_undraw(database, client)

        return UndrawOfNothing(counts=await counts_now(database), watermark=await watermark_now(database))

    return await on_a_seeded_saison(url, body, seed=seed)


class TestAnUndrawOfASeasonHoldingNoSpielplan:
    """A DELETE answers the state asked for. Refusing one would fail a second press, and two admins make that ordinary."""

    async def test_a_watermark_standing_with_no_spiele_behind_it_is_cleared(self, mongo_replica_set_url: str):
        """The watermark is the one thing a season can hold with neither collection behind it, so the undraw clears it alone."""

        seed = Seed(saison=saison_document(spielplan={"generated_at": TODAY}))
        undrawn = await an_undraw_of(mongo_replica_set_url, seed=seed)

        assert undrawn.counts == (0, 0)
        assert undrawn.watermark is None
