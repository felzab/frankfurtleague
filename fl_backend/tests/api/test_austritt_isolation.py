"""
API · a club's exit committing under a fixture's save, against the shipped indexes

The save judges the club's exit on its season row, which it reads and never writes, so only the exit's anchor on the
season's fixtures makes the two writes meet.
"""

from datetime import datetime
from typing import Any, cast
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.spiele.admin_router import patch_spiel
from app.api.spiele.schemas import FLPatchSpielDataPayload
from app.api.teams.admin_router import put_austritt
from app.api.teams.schemas import FLAustrittPayload
from app.core.codes import Code
from app.core.collections import Collection
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop
from tests.isolation import InterleavedCollection, outcome_of
from tests.payloads import spiel_patch_body
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_austritt_isolation_test")

SAISON_ID = "2026"
# After the season's seeded start, so the exit is taken, and before the exit's own day.
TODAY = "2026-05-01"
NOW = datetime(2026, 5, 1, 12, tzinfo=ZoneInfo("Europe/Berlin"))
EXIT_DAY = "2026-05-10"
BEFORE_THE_EXIT = "2026-05-05"
AFTER_THE_EXIT = "2026-05-20"
BEFORE_TODAY = "2026-04-20"

DEPARTED = ObjectId("6890a1b2c3d4e5f607780001")
OPPONENT = ObjectId("6890a1b2c3d4e5f607780002")
OTHER = ObjectId("6890a1b2c3d4e5f607780003")
# The departed club's fixture before its exit, a fixture of two other clubs after it, and one of the departed club's
# left unplayed before today, on matchdays of their own.
ITS_OWN = ObjectId("6890a1b2c3d4e5f607780011")
OTHERS = ObjectId("6890a1b2c3d4e5f607780012")
ITS_PAST = ObjectId("6890a1b2c3d4e5f607780013")

NAMES = {DEPARTED: "Goethe", OPPONENT: "Schiller", OTHER: "Lessing"}


def side(team_id: ObjectId) -> dict[str, Any]:
    return {"team_id": team_id, "tore": None}


def spiel(spiel_id: ObjectId, spiel_nr: int, team1: ObjectId, team2: ObjectId, date: str) -> dict[str, Any]:
    return documents.spiel_document(
        spiel_id=spiel_id,
        saison_id=SAISON_ID,
        spiel_nr=spiel_nr,
        spieltag_id=ObjectId(),
        team1=side(team1),
        team2=side(team2),
        date=date,
        time="18:00:00",
    )


def on_a_league(url: str, body: Any) -> Any:
    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active"))
            await database[Collection.SAISON_TEAMS].insert_many(
                [documents.saison_team_document(SAISON_ID, team_id, name, name[:3].upper()) for team_id, name in NAMES.items()]
            )
            await database[Collection.SPIELE].insert_many(
                [
                    spiel(ITS_OWN, 1, DEPARTED, OPPONENT, BEFORE_THE_EXIT),
                    spiel(OTHERS, 2, OTHER, OPPONENT, AFTER_THE_EXIT),
                    spiel(ITS_PAST, 3, DEPARTED, OPPONENT, BEFORE_TODAY),
                ]
            )

            return await body(database, client)

    return on_the_seed_loop(_run())


async def record_the_exit(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    await put_austritt(
        team_id=DEPARTED,
        saison_id=SAISON_ID,
        austritt_data=FLAustrittPayload.model_validate({"type": "rueckzug", "reason": "Schulwechsel", "date": EXIT_DAY}),
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        outbox_collection=database[Collection.OUTBOX],
        db=client,
        today=TODAY,
        germany_now=NOW,
    )


class TestAnExitLandingMidSaveIsJudgedAgain:
    """The save judges no exit, and writes a fixture fielding the club from its exit's day on."""

    @pytest.mark.parametrize(
        ("spiel_id", "overrides"),
        [
            pytest.param(ITS_OWN, {"date": AFTER_THE_EXIT}, id="its-own-fixture-moved-past-the-exit"),
            # A fixture fielding the club only once the save lands, which an anchor on the club's own fixtures misses.
            pytest.param(OTHERS, {"team1": side(DEPARTED)}, id="the-club-newly-fielded-past-the-exit"),
            # Dated before today, which an anchor on the fixtures still to come misses.
            pytest.param(ITS_PAST, {"date": AFTER_THE_EXIT}, id="its-fixture-gone-by-moved-past-the-exit"),
        ],
    )
    def test_the_save_is_refused_on_the_exit_that_landed_under_it(self, mongo_replica_set_url: str, spiel_id: ObjectId, overrides: Any):
        """Drop the season's fixtures' anchor from `put_austritt` and this fails: both commit."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            stored = await database[Collection.SPIELE].find_one({"_id": spiel_id})
            assert stored is not None
            # Just before the fixture's write, after every read the judgement makes.
            spiele = InterleavedCollection(database[Collection.SPIELE], lambda: record_the_exit(database, client), before="find_one_and_update")

            outcome = await outcome_of(
                patch_spiel(
                    spiel_id=spiel_id,
                    spiel_data=FLPatchSpielDataPayload.model_validate(spiel_patch_body(stored, **overrides)),
                    db=client,
                    # The stand-in delegates every call, which the endpoint's collection type cannot say.
                    spiele_collection=cast(Any, spiele),
                    teams_collection=database[Collection.TEAMS],
                    saisons_collection=database[Collection.SAISONS],
                    saison_teams_collection=database[Collection.SAISON_TEAMS],
                    spieltage_collection=database[Collection.SPIELTAGE],
                    spielorte_collection=database[Collection.SPIELORTE],
                    schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                    spielberichte_collection=database[Collection.SPIELBERICHTE],
                    aufstellungen_collection=database[Collection.AUFSTELLUNGEN],
                    spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
                    now=NOW,
                )
            )
            spiele.assert_landed_inside(serially=0)
            row = await database[Collection.SAISON_TEAMS].find_one({"saison_id": SAISON_ID, "team_id": DEPARTED})
            assert row is not None

            now_stored = await database[Collection.SPIELE].find_one({"_id": spiel_id})
            assert now_stored is not None
            slot = ("date", "team1")

            return outcome, row["austritt"]["date"], [stored[key] for key in slot], [now_stored[key] for key in slot]

        outcome, exit_day, slot_before, slot_after = on_a_league(mongo_replica_set_url, body)

        assert (outcome, exit_day) == (Code.ELIGIBILITY_DISQUALIFIED, EXIT_DAY)
        assert slot_after == slot_before, "the save landed beside the exit, fielding a club that left"
