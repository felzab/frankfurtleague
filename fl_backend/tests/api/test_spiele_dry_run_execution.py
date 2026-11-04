"""
API · the fixture save's dry run writes nothing anywhere

`PATCH /spiele/{spiel_id}?dry_run=true` is the one operation the contract marks safe on a condition (`x-safe-when`),
so the frontend sends it as a read: it clears no cached read and drains no mail. Its handler holds writable
collections for the arm that saves: the read helpers the preview calls take read-only ones, but the handler's own
closures are judged by no type (`tests/core/test_safe_operations.py`). This holds the preview by the database itself,
every collection compared before and after the request, rather than the fields another test happens to read back.
"""

import asyncio
import functools
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from fastapi import FastAPI
from httpx2 import Response
from pymongo import MongoClient

from app.api.spiele.schemas import FLPatchSpielDataPayload
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.main import create_app
from tests import documents
from tests.app_client import app_client
from tests.config import ADMIN_AUTH, grants_for_the_suite
from tests.database import a_clean_database_sync
from tests.payloads import spiel_patch_body
from tests.worker import worker_database

from .conftest import config_for, unwritten

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_spiele_dry_run_test")

SAISON_ID = "2026"

# Before the fixtures' day, so the booking rules judge an upcoming match.
NOW = datetime(2026, 4, 1, 12, tzinfo=ZoneInfo("Europe/Berlin"))

# Fixed rather than generated, so a failure names the same row every run.
ALPHA = ObjectId("6890a1b2c3d4e5f607260001")
BETA = ObjectId("6890a1b2c3d4e5f607260002")
GAMMA = ObjectId("6890a1b2c3d4e5f607260003")
NAMES = {ALPHA: ("Alpha", "ALX"), BETA: ("Beta", "BEX"), GAMMA: ("Gamma", "GAX")}

SPIELTAG_VIERTELFINALE = ObjectId("6890a1b2c3d4e5f6072600a1")
SPIELTAG_HALBFINALE = ObjectId("6890a1b2c3d4e5f6072600a2")
VIERTELFINALE = ObjectId("6890a1b2c3d4e5f607260011")
HALBFINALE = ObjectId("6890a1b2c3d4e5f607260012")
SPIELORT = ObjectId("6890a1b2c3d4e5f6072600b1")
SCHIEDSRICHTER = ObjectId("6890a1b2c3d4e5f6072600c1")

# Past the first write, so the adoption the save would stamp is one the seed already counts to.
BERICHT_VERSION = 2


def side(team_id: ObjectId, tore: int | None = None) -> dict[str, Any]:
    name, shorthand = NAMES[team_id]

    return {"team_id": team_id, "name": name, "shorthand": shorthand, "tore": tore}


def bracket() -> list[dict[str, Any]]:
    """A quarter-final Beta won 3:1, booked at a ground with a referee, and the semi-final its winner stands in."""

    viertelfinale = documents.spiel_document(
        spiel_id=VIERTELFINALE,
        saison_id=SAISON_ID,
        spiel_nr=1,
        spieltag_id=SPIELTAG_VIERTELFINALE,
        saison_phase="viertelfinale",
        team1=side(ALPHA, 1),
        team2=side(BETA, 3),
        ergebnis="1:3",
        datum="2026-05-01",
        uhrzeit="18:00:00",
        ort={"spielort_id": SPIELORT, "name": "Sportplatz Ost", "maps_link": "Sportplatz Ost, Frankfurt", "mietpreis": 80},
        schiedsrichter={"schiedsrichter_id": SCHIEDSRICHTER, "name": "Ada Kern", "payment": 20},
    )
    halbfinale = documents.spiel_document(
        spiel_id=HALBFINALE,
        saison_id=SAISON_ID,
        spiel_nr=5,
        spieltag_id=SPIELTAG_HALBFINALE,
        saison_phase="halbfinale",
        team1=side(BETA),
        team2=side(GAMMA),
        team1_quelle={"type": "spiel", "spiel_nr": 1, "ausgang": "sieger"},
        datum="2026-05-08",
        uhrzeit="18:00:00",
    )

    return [viertelfinale, halbfinale]


@functools.cache
def _served() -> FastAPI:
    """Built on first use rather than at import, which every xdist worker pays at collection."""

    return create_app(config_for(DATABASE_NAME))


@pytest.fixture
def seeded_url(mongo_replica_set_url: str) -> str:
    """The season the save judges, the ground and the referee its names are composed from, and the report it stamps."""

    client = MongoClient(mongo_replica_set_url)
    try:
        database = a_clean_database_sync(client, mongo_replica_set_url, DATABASE_NAME)
        database[Collection.GRANTS].insert_many(grants_for_the_suite())
        rules = documents.rules_document(win_points=3, draw_points=1, qualifiers_per_gruppe=2, tiebreak_order="tordifferenz")
        database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active", rules=rules))
        database[Collection.TEAMS].insert_many([documents.team_document(team_id, *names) for team_id, names in NAMES.items()])
        database[Collection.SAISON_TEAMS].insert_many(
            [documents.saison_team_document(SAISON_ID, team_id, *names, gruppe="A") for team_id, names in NAMES.items()]
        )
        # Position 1 in each: the two sit in different phases, where the positions restart.
        database[Collection.SPIELTAGE].insert_many(
            [
                {"_id": spieltag_id, "beginn": tag, "ende": tag, "position": 1, "saison_id": SAISON_ID, "saison_phase": saison_phase}
                for spieltag_id, saison_phase, tag in (
                    (SPIELTAG_VIERTELFINALE, "viertelfinale", "2026-05-01"),
                    (SPIELTAG_HALBFINALE, "halbfinale", "2026-05-08"),
                )
            ]
        )
        database[Collection.SPIELORTE].insert_one(
            {
                "_id": SPIELORT,
                "name": "Sportplatz Ost",
                "address": dict(documents.ADDRESS),
                "maps_link": "Sportplatz Ost, Frankfurt",
                "default_mietpreis": 65,
                "inactive_since": None,
            }
        )
        database[Collection.SCHIEDSRICHTER].insert_one(
            documents.schiedsrichter_document(
                SCHIEDSRICHTER,
                email="ada.kern@example.com",
                name="Ada Kern",
                default_payment=15,
                einwilligung=documents.own_einwilligung_document(
                    text_versions=documents.SCHIEDSRICHTER_TEXT_VERSIONS, confirmed_at="2026-01-20"
                ),
            )
        )
        spiele = bracket()
        database[Collection.SPIELE].insert_many(spiele)
        database[Collection.SPIELBERICHTE].insert_one(
            documents.spielbericht_document(
                spiele[0], bericht=documents.bericht_document(version=BERICHT_VERSION, seiten=documents.spielbericht_seiten(spiele[0]))
            )
        )

        return mongo_replica_set_url
    finally:
        client.close()


def previewed(url: str, body: dict[str, Any]) -> Response:
    """The dry run as a real request, guards and middleware included, which a write could hide in as well.

    A write the preview defers past its response, in a task it starts and leaves running, escapes this: `asyncio.run`
    cancels the task once the response is in, where the server's loop would let it land.
    """

    async def _answered() -> Response:
        async with app_client(url, app=_served(), now=NOW) as http:
            return await http.patch(
                f"/api/v{API_VERSION}/spiele/{VIERTELFINALE}",
                params={"dry_run": "true", "adopts_bericht": BERICHT_VERSION},
                json=body,
                headers=ADMIN_AUTH,
            )

    return asyncio.run(_answered())


def test_a_dry_run_moving_the_bracket_leaves_every_collection_as_it_was(seeded_url: str):
    """Alpha now winning the quarter-final.

    The same request without `dry_run` rewrites both fixtures, stamps the report adopted and logs the save, so each of
    `spiele`, `spielberichte` and `aktionen` holds what the preview must leave alone.
    """

    (stored,) = [spiel for spiel in bracket() if spiel["_id"] == VIERTELFINALE]
    payload = FLPatchSpielDataPayload.model_validate(spiel_patch_body(stored, team1=side(ALPHA, 3), team2=side(BETA, 1)))

    with unwritten(seeded_url, DATABASE_NAME):
        response = previewed(seeded_url, payload.model_dump(mode="json"))

        # The premise: the preview judged a save that would move another fixture, so it had something to write.
        assert response.status_code == 200, response.text
        assert [moved["spiel_id"] for moved in response.json()["advanced_to"]] == [str(HALBFINALE)]
