"""
API · a seat holder's own consent press writes past its season row's count, against the shipped indexes

The team editor saves no consent: a seat whose person stays keeps the record its save reads in session. So an editor
opened before the press saves around it, where a press raising the count would refuse that save as stale.
"""

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.teams.person_router import patch_einwilligung
from app.core.collections import Collection
from app.shared.einwilligung_evidence import evidence_state_of
from app.shared.schemas.einwilligung import FLSeatEinwilligungPayload
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop
from tests.records import record_collections
from tests.team_writes import write_the_block
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_team_seat_consent_test")

SAISON_ID = "2026"
TODAY = "2026-04-01"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
TEAM = ObjectId("6890a1b2c3d4e5f607a10001")

# Theo confirmed the Trainer's seat granting both choices, and withdraws them.
THEO = documents.kontaktperson_document("Theo", confirmed_at="2026-03-21", einwilligung={"scope": "kontakt_data_whatsapp", "media": True})


def person(seat: dict[str, Any]) -> dict[str, Any]:
    """The seat's person as the team editor sends them back, unchanged."""

    return {field: seat[field] for field in ("first_name", "last_name", "email", "phone")}


def on_a_row(url: str) -> Any:
    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active"))
            await database[Collection.TEAMS].insert_one(documents.team_document(TEAM, "Zorbanax", "ZOX"))
            await database[Collection.SAISON_TEAMS].insert_one(
                documents.saison_team_document(SAISON_ID, TEAM, "Zorbanax", "ZOX", kontakte=documents.kontakte_document(trainer=THEO))
            )

            return await body(database, client)

    return on_the_seed_loop(_run())


async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    row = await database[Collection.SAISON_TEAMS].find_one({"team_id": TEAM})
    assert row is not None
    # The version the team editor was opened on, before the press.
    opened_on = row.get("version", 0)

    await patch_einwilligung(
        team_id=TEAM,
        saison_id=SAISON_ID,
        einwilligung_data=FLSeatEinwilligungPayload.model_validate(
            {
                "scope": "kontakt_data",
                "media": False,
                "text_versions": dict(documents.SEAT_TEXT_VERSIONS),
                "evidence_state": evidence_state_of(blocks=[THEO["einwilligung"]]),
            }
        ),
        identifier=THEO["email"],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        records=record_collections(database),
        db=client,
        today=TODAY,
        germany_now=NOW,
    )
    pressed = await database[Collection.SAISON_TEAMS].find_one({"team_id": TEAM})
    assert pressed is not None

    await write_the_block(
        database,
        {"trainer": person(THEO), "ansprechperson": None, "stellvertretung": None, "trainer_is_also": None},
        team_id=TEAM,
        saison_id=SAISON_ID,
        version=opened_on,
        today=TODAY,
        germany_now=NOW,
    )
    saved = await database[Collection.SAISON_TEAMS].find_one({"team_id": TEAM})
    assert saved is not None

    return opened_on, pressed, saved


class TestASeatHoldersConsentPressAndTheTeamEditor:
    def test_an_editor_opened_before_the_press_saves_and_the_press_stands(self, mongo_replica_set_url: str):
        opened_on, pressed, saved = on_a_row(mongo_replica_set_url)

        # The premise: the press moved both choices and left the count where the editor read it.
        assert (pressed["kontakte"]["trainer"]["einwilligung"]["scope"], pressed["kontakte"]["trainer"]["einwilligung"]["media"]) == (
            "kontakt_data",
            False,
        )
        assert pressed.get("version", 0) == opened_on
        # The save on that version took, and kept the press's record whole.
        assert saved.get("version", 0) == opened_on + 1
        assert saved["kontakte"]["trainer"]["einwilligung"] == pressed["kontakte"]["trainer"]["einwilligung"]
