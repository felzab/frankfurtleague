import asyncio
from collections.abc import Iterator
from typing import Any

import pytest
from bson import ObjectId
from httpx2 import Response
from pymongo import MongoClient

from app.core.collections import Collection
from app.core.config import API_VERSION
from app.main import create_app
from tests import documents
from tests.app_client import app_client
from tests.config import ADMIN_AUTH, build_test_config, grants_for_the_suite
from tests.database import a_clean_database_sync

from .conftest import unwritten

SAISON_ID = "2026"

# Fixed rather than generated, so a failure names the same fixture every run.
SPIELTAG_ID = ObjectId("6890a1b2c3d4e5f6072310a1")
EDITED_ID = ObjectId("6890a1b2c3d4e5f607231001")
NEIGHBOUR_ID = ObjectId("6890a1b2c3d4e5f607231002")
HOME = ObjectId("6890a1b2c3d4e5f607231011")
WIRED = ObjectId("6890a1b2c3d4e5f607231012")
LOOSE = ObjectId("6890a1b2c3d4e5f607231013")
FREE = ObjectId("6890a1b2c3d4e5f607231014")
GONE = ObjectId("6890a1b2c3d4e5f607231015")

PATH = f"/api/v{API_VERSION}/spiele/{EDITED_ID}/verwaltung"


def knockout_fixture(spiel_id: ObjectId, spiel_nr: int, **fields: Any) -> dict[str, Any]:
    return documents.spiel_document(
        spiel_id=spiel_id, saison_id=SAISON_ID, spiel_nr=spiel_nr, spieltag_id=SPIELTAG_ID, saison_phase="viertelfinale", **fields
    )


def answered(uri: str) -> Response:
    async def _answered() -> Response:
        async with app_client(uri, app=create_app(build_test_config())) as http:
            return await http.get(PATH, headers=dict(ADMIN_AUTH))

    return asyncio.run(_answered())


@pytest.fixture(scope="module")
def seeded_url(mongo_replica_set_url: str) -> Iterator[str]:
    """One knockout matchday of two fixtures and five clubs, each standing differently towards the edited fixture."""

    database_name = build_test_config().db_base_name
    client = MongoClient(mongo_replica_set_url)
    try:
        database = a_clean_database_sync(client, mongo_replica_set_url, database_name)
        database[Collection.GRANTS].insert_many(grants_for_the_suite())
        database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active"))
        database[Collection.SPIELE].insert_many(
            [
                knockout_fixture(
                    EDITED_ID,
                    25,
                    datum="2026-05-10",
                    team1={"team_id": HOME, "tore": None},
                    team1_quelle={"type": "gruppe", "gruppe": "A", "platz": 1},
                    team2_quelle={"type": "gruppe", "gruppe": "B", "platz": 2},
                ),
                # A club the wiring placed here cannot be fielded twice; one fielded by hand is moved off.
                knockout_fixture(
                    NEIGHBOUR_ID,
                    26,
                    team1={"team_id": WIRED, "tore": None},
                    team1_quelle={"type": "gruppe", "gruppe": "B", "platz": 1},
                    team2={"team_id": LOOSE, "tore": None},
                ),
            ]
        )
        database[Collection.SAISON_TEAMS].insert_many(
            [
                documents.saison_team_document(SAISON_ID, HOME, "Alpha", "ALP"),
                documents.saison_team_document(SAISON_ID, WIRED, "Birke", "BIR"),
                documents.saison_team_document(SAISON_ID, LOOSE, "Eiche", "EIC"),
                documents.saison_team_document(SAISON_ID, FREE, "Linde", "LIN"),
                # Out before the fixture's day, so the write refuses fielding it there.
                documents.saison_team_document(
                    SAISON_ID, GONE, "Ulme", "ULM", austritt={"type": "rueckzug", "grund": "Zu wenige Spieler", "datum": "2026-04-01"}
                ),
            ]
        )

        with unwritten(mongo_replica_set_url, database_name):
            yield mongo_replica_set_url
    finally:
        client.close()


@pytest.mark.db
def test_a_knockout_fixture_offers_each_club_as_the_write_would_judge_fielding_it(seeded_url: str):
    """The Begegnung's clubs are judged by the write's own rules, read on knockout fixtures alone.

    A read failing on this path closes the editor of every knockout match, and a flag judged unlike the write offers a
    club the save then refuses, or withholds one it would take; no other case reads a knockout fixture's editor.
    """

    response = answered(seeded_url)

    assert response.status_code == 200
    assert [(team["name"], team["on_spieltag"], team["fieldable"]) for team in response.json()["teams"]] == [
        ("Alpha", False, True),
        ("Birke", True, False),
        ("Eiche", True, True),
        ("Linde", False, True),
        ("Ulme", False, False),
    ]
