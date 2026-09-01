from typing import Any, Awaitable, Callable

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.teams.admin_router import patch_saison_team_kontakte
from app.api.teams.schemas import FLPatchSaisonTeamKontaktePayload
from app.core.collections import Collection
from app.core.exceptions import DocumentNotFoundException
from tests.database import a_clean_database, on_the_seed_loop

# Every test here writes through a real mongod: the point of the endpoint is which KEYS a `$set`
# leaves alone, and nothing short of a stored document can show that.
pytestmark = pytest.mark.db

DATABASE_NAME = "fl_saison_team_kontakte_test"

SAISON_ID = "2026"
# A second season the SAME club holds a row in, seeded first so it is what a filter missing
# `saison_id` would reach.
OTHER_SAISON_ID = "2025"

# Fixed rather than generated, so a failure names the same club every run.
TEAM_OID = ObjectId("6890a1b2c3d4e5f607240001")
ABSENT_OID = ObjectId("6890a1b2c3d4e5f607240002")

TEAM_NAME = "Adler"
TEAM_SHORTHAND = "AD"

# The three fields this endpoint must not reach, each seeded to a value entry never writes: a `$set`
# carrying the whole payload would answer with `None` for all three.
GRUPPE = "C"
TRIKOT_FARBE = "bordeaux"
AUSTRITT: dict[str, Any] = {"type": "rueckzug", "grund": "Keine Mannschaft mehr", "datum": "2026-04-01"}


def person(vorname: str) -> dict[str, Any]:
    return {
        "vorname": vorname,
        "nachname": "Musterfrau",
        "email": f"{vorname.lower()}@example.com",
        "telefon": "+4915112345678",
        "geburtsdatum": "1990-05-17",
        "einwilligung": {"umfang": "kontaktdaten", "erteilt_von": "person", "text_version": "v1", "datum": "2026-03-01"},
    }


SEEDED_KONTAKTE: dict[str, Any] = {
    "trainer": person("Ida"),
    "ansprechperson": person("Jonas"),
    "stellvertretung": person("Klara"),
    "trainer_ist_zugleich": None,
}

NEW_KONTAKTE: dict[str, Any] = {
    "trainer": person("Lea"),
    "ansprechperson": person("Mika"),
    "stellvertretung": person("Nils"),
    "trainer_ist_zugleich": "ansprechperson",
}

# What an erasure leaves behind, and what the editor has to be able to send back.
ONE_SLOT_FILLED: dict[str, Any] = {
    "trainer": person("Ove"),
    "ansprechperson": None,
    "stellvertretung": None,
    "trainer_ist_zugleich": None,
}


def junction_document(saison_id: str, kontakte: dict[str, Any] | None) -> dict[str, Any]:
    """One junction row, filled out as the validator requires and as a season in progress holds it."""

    return {
        "saison_id": saison_id,
        "team_id": TEAM_OID,
        "gruppe": GRUPPE,
        "austritt": dict(AUSTRITT),
        "trikot_farbe": TRIKOT_FARBE,
        "kontakte": kontakte,
        "name": TEAM_NAME,
        "shorthand": TEAM_SHORTHAND,
    }


Body = Callable[[AsyncIOMotorDatabase], Awaitable[Any]]


def on_a_league(url: str, body: Body, *, seeded: dict[str, Any] | None = SEEDED_KONTAKTE) -> Any:
    """`constraints=True`, so what this endpoint stores is judged by the database's own validator rather than by Pydantic alone."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_, database):
            # The other season FIRST: `find_one_and_update` takes natural order, so this is the row a
            # filter that forgot `saison_id` would write to.
            await database[Collection.SAISON_TEAMS].insert_one(junction_document(OTHER_SAISON_ID, None))
            await database[Collection.SAISON_TEAMS].insert_one(junction_document(SAISON_ID, seeded))

            return await body(database)

    return on_the_seed_loop(_run())


async def write_kontakte(
    database: AsyncIOMotorDatabase,
    kontakte: dict[str, Any] | None,
    *,
    team_id: ObjectId = TEAM_OID,
    saison_id: str = SAISON_ID,
) -> Any:
    return await patch_saison_team_kontakte(
        team_id=team_id,
        saison_id=saison_id,
        kontakte_data=FLPatchSaisonTeamKontaktePayload.model_validate({"kontakte": kontakte}),
        saison_teams_collection=database[Collection.SAISON_TEAMS],
    )


async def row_now(database: AsyncIOMotorDatabase, saison_id: str = SAISON_ID) -> dict[str, Any]:
    found = await database[Collection.SAISON_TEAMS].find_one({"team_id": TEAM_OID, "saison_id": saison_id})
    assert found is not None, f"the seeded row for {saison_id} is gone"

    return found


async def junction_log(database: AsyncIOMotorDatabase) -> list[dict[str, Any]]:
    return await database[Collection.AKTIONEN].find({"collection": str(Collection.SAISON_TEAMS)}).sort("_id", 1).to_list(length=None)


class TestTheBlockIsWritten:
    def test_the_stored_block_is_the_one_sent_and_the_echo_is_the_stored_one(self, mongo_replica_set_url: str):
        async def body(database: AsyncIOMotorDatabase) -> Any:
            response = await write_kontakte(database, NEW_KONTAKTE)

            return response, await row_now(database)

        response, stored = on_a_league(mongo_replica_set_url, body)

        assert stored["kontakte"] == NEW_KONTAKTE
        assert response.kontakte is not None
        assert response.kontakte.model_dump(mode="json") == NEW_KONTAKTE
        assert (response.saison_id, response.team_id) == (SAISON_ID, TEAM_OID)

    def test_a_null_clears_the_block(self, mongo_replica_set_url: str):
        """How a team with no recorded contacts is expressed at entry, and the only way back to it."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            response = await write_kontakte(database, None)

            return response, await row_now(database)

        response, stored = on_a_league(mongo_replica_set_url, body)

        assert stored["kontakte"] is None
        assert response.kontakte is None

    def test_an_empty_slot_round_trips(self, mongo_replica_set_url: str):
        """A row an erasure emptied stays editable: two null slots are sent, stored and echoed back."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            response = await write_kontakte(database, ONE_SLOT_FILLED)

            return response, await row_now(database)

        response, stored = on_a_league(mongo_replica_set_url, body)

        assert stored["kontakte"] == ONE_SLOT_FILLED
        assert response.kontakte is not None
        assert (response.kontakte.ansprechperson, response.kontakte.stellvertretung) == (None, None)


class TestNothingElseOnTheRowMoves:
    """The whole reason the endpoint exists: two editors write one row and must not clobber each other."""

    def test_the_group_the_exit_and_the_kit_colour_are_left_exactly_as_seeded(self, mongo_replica_set_url: str):
        async def body(database: AsyncIOMotorDatabase) -> Any:
            await write_kontakte(database, NEW_KONTAKTE)

            return await row_now(database)

        stored = on_a_league(mongo_replica_set_url, body)

        # By equality against the seed, not merely "not None": a wholesale `$set` would write the
        # payload's absent keys as nulls, and a colour cleared reads as an admin's own choice.
        assert stored["gruppe"] == GRUPPE
        assert stored["austritt"] == AUSTRITT
        assert stored["trikot_farbe"] == TRIKOT_FARBE
        assert (stored["name"], stored["shorthand"]) == (TEAM_NAME, TEAM_SHORTHAND)

    def test_the_same_clubs_other_season_is_not_the_row_that_moves(self, mongo_replica_set_url: str):
        """`saison_id` is half the filter: without it the club's earliest row takes the write."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await write_kontakte(database, NEW_KONTAKTE)

            return await row_now(database, OTHER_SAISON_ID), await row_now(database)

        other, target = on_a_league(mongo_replica_set_url, body)

        assert other["kontakte"] is None
        assert target["kontakte"] == NEW_KONTAKTE


class TestAPairNoRowAnswers:
    def test_an_unknown_club_is_a_404_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncIOMotorDatabase) -> Any:
            with pytest.raises(DocumentNotFoundException):
                await write_kontakte(database, NEW_KONTAKTE, team_id=ABSENT_OID)

            return await row_now(database), await junction_log(database)

        stored, log = on_a_league(mongo_replica_set_url, body)

        assert stored["kontakte"] == SEEDED_KONTAKTE
        # The refusal has to stop the write, not merely accompany it.
        assert log == []

    def test_a_season_the_club_holds_no_row_in_is_a_404(self, mongo_replica_set_url: str):
        """The pair is what is addressed: a club that exists and a season that exists still name no row."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            with pytest.raises(DocumentNotFoundException):
                await write_kontakte(database, NEW_KONTAKTE, saison_id="2027")

            return await row_now(database)

        assert on_a_league(mongo_replica_set_url, body)["kontakte"] == SEEDED_KONTAKTE


class TestTheWriteIsRecorded:
    def test_one_action_row_carries_the_block_this_write_replaced(self, mongo_replica_set_url: str):
        """The undo path: the pre-image is the only copy of three people's details a mistake overwrote."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await write_kontakte(database, NEW_KONTAKTE)

            return await row_now(database), await junction_log(database)

        stored, log = on_a_league(mongo_replica_set_url, body)

        assert len(log) == 1
        assert log[0]["operation"] == "patch_one"
        assert log[0]["document_id"] == stored["_id"]
        assert log[0]["before"]["kontakte"] == SEEDED_KONTAKTE
