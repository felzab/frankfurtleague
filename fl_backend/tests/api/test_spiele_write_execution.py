import asyncio
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo.errors import OperationFailure

from app.api.saisons.cache import invalidate_saison_cache
from app.api.spiele.admin_router import patch_spiel_data
from app.api.spiele.crud import apply_release_to_spiel
from app.api.spiele.schemas import (
    FLPatchSpielDataPayload,
    FLPatchSpielDataResponse,
    FLSpiel,
    FLSpielElfmeterschiessen,
    FLSpielListAdapter,
)
from app.api.spiele.services import judge_spieltag_occupancy
from app.core.collections import Collection

pytestmark = pytest.mark.db

DATABASE_NAME = "fl_spiele_write_test"

# Named rather than caught broadly: another failure must not read as the rollback this suite proves.
DOCUMENT_VALIDATION_FAILED = 121

SAISON_ID = "2026"

# Fixed rather than generated, so a failure names the same club every run.
ALPHA = ObjectId("6890a1b2c3d4e5f607220001")
BETA = ObjectId("6890a1b2c3d4e5f607220002")
GAMMA = ObjectId("6890a1b2c3d4e5f607220003")
DELTA = ObjectId("6890a1b2c3d4e5f607220004")

NAMES = {ALPHA: ("Alpha", "AL"), BETA: ("Beta", "BE"), GAMMA: ("Gamma", "GA"), DELTA: ("Delta", "DE")}

SPIELTAG_GRUPPE = ObjectId("6890a1b2c3d4e5f6072200a1")
SPIELTAG_VIERTELFINALE = ObjectId("6890a1b2c3d4e5f6072200a2")
SPIELTAG_HALBFINALE = ObjectId("6890a1b2c3d4e5f6072200a3")

# Each matchday's phase and span. The span is real seed data: the handler reads it back to judge the
# saved fixture's date, and a fixture takes its phase and its date from the matchday it sits on.
SPIELTAGE = {
    SPIELTAG_GRUPPE: ("gruppenphase", "2026-03-15", "2026-03-15"),
    SPIELTAG_VIERTELFINALE: ("viertelfinale", "2026-05-01", "2026-05-01"),
    SPIELTAG_HALBFINALE: ("halbfinale", "2026-05-08", "2026-05-08"),
}

VIERTELFINALE = ObjectId("6890a1b2c3d4e5f607220011")
HALBFINALE = ObjectId("6890a1b2c3d4e5f607220012")
GRUPPE_HELD = ObjectId("6890a1b2c3d4e5f607220013")
GRUPPE_FILLING = ObjectId("6890a1b2c3d4e5f607220014")

# Read back off the stored documents, which key by `spiel_nr` rather than by id.
VIERTELFINALE_NR = 1
HALBFINALE_NR = 5
GRUPPE_HELD_NR = 11
GRUPPE_FILLING_NR = 12


def side(team_id: ObjectId, tore: int | None = None) -> dict[str, Any]:
    return {"team_id": team_id, "name": NAMES[team_id][0], "shorthand": NAMES[team_id][1], "tore": tore}


def junction(team_id: ObjectId) -> dict[str, Any]:
    """A dict rather than a model: `saison_teams` has no model of the row."""

    return {"saison_id": SAISON_ID, "team_id": team_id, "gruppe": "A", "disqualifikation": None}


def saison_document() -> dict[str, Any]:
    """`rules` alone, because that is all this path reads a season for; the document is never validated here."""

    return {
        "_id": SAISON_ID,
        "rules": {
            "win_points": 3,
            "draw_points": 1,
            "qualifiers_per_group": 2,
            "number_of_groups": 4,
            "teams_per_group": 4,
            "erlaubte_stufen": ["E1", "Q1", "Q2", "Q3", "Q4"],
        },
    }


def spieltag_documents() -> list[dict[str, Any]]:
    return [
        {
            "_id": spieltag_id,
            "beginn": beginn,
            "ende": ende,
            "saison_id": SAISON_ID,
            "saison_phase": saison_phase,
            "inactive_since": None,
        }
        for spieltag_id, (saison_phase, beginn, ende) in SPIELTAGE.items()
    ]


def spiel_document(
    *,
    spiel_id: ObjectId,
    spiel_nr: int,
    spieltag_id: ObjectId,
    team1: dict[str, Any] | None,
    team2: dict[str, Any] | None,
    ergebnis: str | None = None,
    elfmeterschiessen: dict[str, int] | None = None,
    team1_quelle: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Every key spelled out: `FLSpiel` defaults `notiz` alone, so an omitted one fails inside the handler."""

    saison_phase, datum, _ = SPIELTAGE[spieltag_id]

    return {
        "_id": spiel_id,
        "spiel_nr": spiel_nr,
        "saison_id": SAISON_ID,
        "saison_phase": saison_phase,
        "spieltag_id": spieltag_id,
        "team1": team1,
        "team2": team2,
        "team1_quelle": team1_quelle,
        "team2_quelle": None,
        "datum": datum,
        "uhrzeit": "18:00:00",
        # Null on both, so a payload built from this document claims neither, and the double-booking
        # read is never the thing a failure here is about.
        "ort": None,
        "schiedsrichter": None,
        "ergebnis": ergebnis,
        "elfmeterschiessen": elfmeterschiessen,
        "is_canceled": False,
        "notiz": None,
    }


def bracket_season() -> list[dict[str, Any]]:
    """A quarter-final Beta won, and the semi-final its winner feeds -- played out, shoot-out and all.

    Consistent as seeded, so the only advancement a test here sees is the one its own save causes.
    """

    return [
        spiel_document(
            spiel_id=VIERTELFINALE,
            spiel_nr=VIERTELFINALE_NR,
            spieltag_id=SPIELTAG_VIERTELFINALE,
            team1=side(ALPHA, 1),
            team2=side(BETA, 3),
            ergebnis="1:3",
        ),
        spiel_document(
            spiel_id=HALBFINALE,
            spiel_nr=HALBFINALE_NR,
            spieltag_id=SPIELTAG_HALBFINALE,
            team1=side(BETA, 2),
            team2=side(GAMMA, 2),
            ergebnis="2:2",
            elfmeterschiessen={"team1": 4, "team2": 3},
            team1_quelle={"type": "spiel", "spiel_nr": VIERTELFINALE_NR, "ausgang": "sieger"},
        ),
    ]


def one_spieltag(*, opponent: ObjectId | None, ergebnis: str | None, tore: tuple[int | None, int | None]) -> list[dict[str, Any]]:
    """Two group fixtures on ONE matchday: Alpha stands in the first, and the second is about to field it."""

    return [
        spiel_document(
            spiel_id=GRUPPE_HELD,
            spiel_nr=GRUPPE_HELD_NR,
            spieltag_id=SPIELTAG_GRUPPE,
            team1=side(ALPHA, tore[0]),
            team2=None if opponent is None else side(opponent, tore[1]),
            ergebnis=ergebnis,
        ),
        spiel_document(
            spiel_id=GRUPPE_FILLING,
            spiel_nr=GRUPPE_FILLING_NR,
            spieltag_id=SPIELTAG_GRUPPE,
            team1=side(GAMMA),
            team2=side(DELTA),
        ),
    ]


Body = Callable[[AsyncIOMotorDatabase, AsyncIOMotorClient], Awaitable[Any]]


def on_a_seeded_season(url: str, body: Body, *, spiele: list[dict[str, Any]]) -> Any:
    """One client and event loop per call: Motor binds to the loop it first ran on. A transaction cannot create a collection."""

    async def _run() -> Any:
        client = AsyncIOMotorClient(url)
        try:
            await client.drop_database(DATABASE_NAME)
            database = client[DATABASE_NAME]

            # Process-global and keyed by season id, so an entry another module left would answer for this one.
            invalidate_saison_cache()

            await database[Collection.SAISONS].insert_one(saison_document())
            await database[Collection.SAISON_TEAMS].insert_many([junction(team_id) for team_id in NAMES])
            await database[Collection.SPIELTAGE].insert_many(spieltag_documents())
            await database.create_collection(Collection.SPIELE)
            await database[Collection.SPIELE].insert_many(spiele)

            return await body(database, client)
        finally:
            await client.drop_database(DATABASE_NAME)
            client.close()

    return asyncio.run(_run())


async def call_patch(
    database: AsyncIOMotorDatabase,
    client: AsyncIOMotorClient,
    spiel_id: ObjectId,
    spiel_data: FLPatchSpielDataPayload,
    *,
    dry_run: bool = False,
) -> FLPatchSpielDataResponse:
    return await patch_spiel_data(
        spiel_id=spiel_id,
        spiel_data=spiel_data,
        db=client,
        spiele_collection=database[Collection.SPIELE],
        teams_collection=database[Collection.TEAMS],
        saisons_collection=database[Collection.SAISONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        spieltage_collection=database[Collection.SPIELTAGE],
        dry_run=dry_run,
    )


async def payload_for(database: AsyncIOMotorDatabase, spiel_id: ObjectId, **overrides: Any) -> FLPatchSpielDataPayload:
    """The stored fixture as a payload changing nothing but `overrides`.

    Read off the document because this endpoint writes wholesale: a field a test left out would be
    erased rather than kept, and the test would be about that instead.
    """

    stored = await database[Collection.SPIELE].find_one({"_id": spiel_id})
    assert stored is not None, f"the seed holds no fixture {spiel_id}"

    unchanged = {field: stored.get(field) for field in FLPatchSpielDataPayload.model_fields}

    return FLPatchSpielDataPayload.model_validate({**unchanged, **overrides})


async def read_spiel(database: AsyncIOMotorDatabase, spiel_id: ObjectId) -> FLSpiel:
    """Read outside any transaction -- what a later request would see."""

    return FLSpiel.model_validate(await database[Collection.SPIELE].find_one({"_id": spiel_id}))


async def spiele_now(database: AsyncIOMotorDatabase) -> dict[int, dict[str, Any]]:
    """The RAW documents, keyed by `spiel_nr`: a model would answer with its own defaults for a key the write dropped."""

    rows = await database[Collection.SPIELE].find({"saison_id": SAISON_ID}).to_list(length=None)

    return {row["spiel_nr"]: row for row in rows}


class TestASavedResultCarriesThroughTheBracket:
    def test_the_refilled_slot_loses_its_result_and_its_shoot_out(self, mongo_replica_set_url: str):
        """Alpha replaces Beta in the semi-final, and `docs/backend/spec.md :: I25b` says both halves of the old result go."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            spiel_data = await payload_for(database, VIERTELFINALE, team1=side(ALPHA, 3), team2=side(BETA, 1))
            response = await call_patch(database, client, VIERTELFINALE, spiel_data)

            return response, await spiele_now(database)

        response, spiele = on_a_seeded_season(mongo_replica_set_url, body, spiele=bracket_season())

        assert spiele[VIERTELFINALE_NR]["ergebnis"] == "3:1"

        assert spiele[HALBFINALE_NR]["team1"] == {"team_id": ALPHA, "name": "Alpha", "shorthand": "AL", "tore": None}
        assert spiele[HALBFINALE_NR]["ergebnis"] is None
        # The stale shoot-out is the damage: the bracket would name a winner the goals no longer support.
        assert spiele[HALBFINALE_NR]["elfmeterschiessen"] is None, "the shoot-out outlived the side that won it"
        assert spiele[HALBFINALE_NR]["team2"]["tore"] is None, "the side that stayed kept goals scored against a team that left"

        (advancement,) = response.advanced_to
        assert advancement.spiel_nr == HALBFINALE_NR
        assert (advancement.voided_ergebnis, advancement.voided_elfmeterschiessen) == ("2:2", FLSpielElfmeterschiessen(team1=4, team2=3))

    def test_a_save_changing_nothing_advances_nobody(self, mongo_replica_set_url: str):
        """The control for the test above: the seeded season already agrees with its wiring, so that advancement is the save's doing."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            spiel_data = await payload_for(database, VIERTELFINALE)
            response = await call_patch(database, client, VIERTELFINALE, spiel_data)

            return response, await spiele_now(database)

        response, spiele = on_a_seeded_season(mongo_replica_set_url, body, spiele=bracket_season())

        assert response.advanced_to == []
        assert spiele[HALBFINALE_NR]["team1"]["team_id"] == BETA
        assert spiele[HALBFINALE_NR]["elfmeterschiessen"] == {"team1": 4, "team2": 3}


class TestAMidFlightFailureTakesTheWholeSaveBack:
    def test_neither_the_edit_nor_the_advancement_survives(self, mongo_replica_set_url: str):
        """A validator admitting only a string `ergebnis` refuses the advancement's null, after the admin's own edit has landed."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            await database.command(
                "collMod",
                Collection.SPIELE.value,
                validator={"$jsonSchema": {"bsonType": "object", "properties": {"ergebnis": {"bsonType": "string"}}}},
                validationLevel="strict",
            )

            spiel_data = await payload_for(database, VIERTELFINALE, team1=side(ALPHA, 3), team2=side(BETA, 1))
            with pytest.raises(OperationFailure) as failure:
                await call_patch(database, client, VIERTELFINALE, spiel_data)

            return failure.value.code, await spiele_now(database)

        code, spiele = on_a_seeded_season(mongo_replica_set_url, body, spiele=bracket_season())

        # Asserted on the code, so this cannot pass because something failed before the first write.
        assert code == DOCUMENT_VALIDATION_FAILED, f"expected the validator to refuse the advancement, got code {code}"
        # "3:1" is a string the validator admits, so a quarter-final still reading "1:3" can only mean the edit was taken back.
        assert spiele[VIERTELFINALE_NR]["ergebnis"] == "1:3", "the admin's own edit outlived a rolled-back save"
        assert (spiele[VIERTELFINALE_NR]["team1"]["tore"], spiele[VIERTELFINALE_NR]["team2"]["tore"]) == (1, 3)
        assert spiele[HALBFINALE_NR]["team1"]["team_id"] == BETA
        assert spiele[HALBFINALE_NR]["elfmeterschiessen"] == {"team1": 4, "team2": 3}


@dataclass(frozen=True)
class ReleaseRun:
    """One release, seen five ways, so the assertions read outside the event loop."""

    before: FLSpiel
    predicted: FLSpiel
    after_preview: FLSpiel
    after_save: FLSpiel
    preview: FLPatchSpielDataResponse
    saved: FLPatchSpielDataResponse


class TestAReleaseWritesWhatThePureModelPredicts:
    @pytest.mark.parametrize(
        ("opponent", "ergebnis", "tore"),
        [
            pytest.param(BETA, "2:1", (2, 1), id="a played fixture whose other side must lose its goals"),
            pytest.param(None, None, (None, None), id="a fixture with no other side to strip"),
        ],
    )
    def test_the_stored_fixture_is_what_apply_release_to_spiel_predicts(
        self,
        mongo_replica_set_url: str,
        opponent: ObjectId | None,
        ergebnis: str | None,
        tore: tuple[int | None, int | None],
    ):
        """`release_spieltag_sides` writes a hand-built `$set` where the preview applies the model; nothing else holds the two to one answer."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            rows = await database[Collection.SPIELE].find({"saison_id": SAISON_ID}).to_list(length=None)
            season = FLSpielListAdapter.validate_python(rows)
            before = next(spiel for spiel in season if spiel.id == GRUPPE_HELD)

            spiel_data = await payload_for(database, GRUPPE_FILLING, team1=side(ALPHA))
            # The handler's own judgement, over the season it is about to read: what the model is then handed.
            (release,) = judge_spieltag_occupancy(GRUPPE_FILLING, spiel_data, season).releases

            preview = await call_patch(database, client, GRUPPE_FILLING, spiel_data, dry_run=True)
            after_preview = await read_spiel(database, GRUPPE_HELD)

            saved = await call_patch(database, client, GRUPPE_FILLING, spiel_data)

            return ReleaseRun(
                before=before,
                predicted=apply_release_to_spiel(before, release),
                after_preview=after_preview,
                after_save=await read_spiel(database, GRUPPE_HELD),
                preview=preview,
                saved=saved,
            )

        run = on_a_seeded_season(
            mongo_replica_set_url,
            body,
            spiele=one_spieltag(opponent=opponent, ergebnis=ergebnis, tore=tore),
        )

        assert run.after_save == run.predicted
        assert run.after_preview == run.before, "the dry run wrote something"
        assert run.saved == run.preview, "the preview answered differently from the save it previews"

        (released,) = run.saved.released_sides
        assert (released.spiel_nr, released.side, released.team_name) == (GRUPPE_HELD_NR, "team1", "Alpha")
        assert released.voided_ergebnis == ergebnis
