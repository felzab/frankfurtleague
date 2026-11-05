"""
API · the Übersicht places each kind of open work on its card, and leaves out what asks nothing

A wrong filter in the one read hides open work in silence: a card reads „Nichts offen.“ while a fixture waits for its
result or a club for its answer. So one corpus seeds a fixture per kind, and beside them what must stay off every card:
a row about an Ansetzung its fixture has left, a fixture called off, another season's fixture, a decided application.
"""

import asyncio
import functools
from collections.abc import Iterator
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from fastapi import FastAPI
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

SAISON = "2026"
OTHER_SAISON = "2025"
PATH = f"/api/v{API_VERSION}/saisons/{SAISON}/overview"

NOW = datetime(2026, 3, 15, 12, tzinfo=ZoneInfo("Europe/Berlin"))
TODAY = "2026-03-15"

# Its own hex range, as every module in this suite carves one.
OID = "6890a1b2c3d4e5f6079a{:04x}"
HOME, AWAY, PICKED = ObjectId(OID.format(0x101)), ObjectId(OID.format(0x102)), ObjectId(OID.format(0x103))
SPIELORT, SCHIEDSRICHTER = ObjectId(OID.format(0x201)), ObjectId(OID.format(0x202))
NEW_SCHOOL, PICKED_CLUB, DECIDED = ObjectId(OID.format(0x301)), ObjectId(OID.format(0x302)), ObjectId(OID.format(0x303))
CLASH_SPIELTAG = ObjectId(OID.format(0x400))

# One fixture per kind, numbered so a failure names it.
OVERDUE, DUE_TODAY, MOVED, UNPLAYED, REPORTED, PROPOSED, UNDATED, DECLINED, OPEN_SIDE = range(1, 10)
CLASH_FIRST, CLASH_SECOND, CALLED_OFF, OTHER_SEASONS = 10, 11, 12, 13

ORT = {"spielort_id": SPIELORT, "name": "Halle Ost", "maps_link": "Halle Ost, Frankfurt", "mietpreis": 40}
REFEREE = {"schiedsrichter_id": SCHIEDSRICHTER, "name": "Anna Körner", "payment": 20}


def _side(team_id: ObjectId, name: str, tore: int | None = None) -> dict[str, Any]:
    return {"team_id": team_id, "name": name, "shorthand": name[:3].upper(), "tore": tore}


def fixture(nr: int, datum: str | None, *, saison_id: str = SAISON, **fields: Any) -> dict[str, Any]:
    """A group fixture of its own matchday, slot and cast set unless `fields` empties one."""

    set_for = {
        "spieltag_id": ObjectId(OID.format(0x500 + nr)),
        "team1": _side(HOME, "Lessing"),
        "team2": _side(AWAY, "Goethe"),
        "datum": datum,
        "uhrzeit": None if datum is None else "15:00:00",
        "ort": None if datum is None else ORT,
        "schiedsrichter": None if datum is None else REFEREE,
    }

    return documents.spiel_document(spiel_id=ObjectId(OID.format(nr)), saison_id=saison_id, spiel_nr=nr, **{**set_for, **fields})


def club_row(spiel: dict[str, Any], team_id: ObjectId, **fields: Any) -> dict[str, Any]:
    return documents.spielbestaetigung_document(spiel, party={"art": "team", "team_id": team_id}, **fields)


SPIELE = {
    OVERDUE: fixture(OVERDUE, "2026-03-20"),
    DUE_TODAY: fixture(DUE_TODAY, "2026-03-17"),
    MOVED: fixture(MOVED, "2026-03-21"),
    UNPLAYED: fixture(UNPLAYED, "2026-03-10"),
    REPORTED: fixture(REPORTED, "2026-03-08", ergebnis="2:1", team1=_side(HOME, "Lessing", 2), team2=_side(AWAY, "Goethe", 1)),
    PROPOSED: fixture(PROPOSED, "2026-03-25"),
    UNDATED: fixture(UNDATED, None),
    DECLINED: fixture(DECLINED, "2026-03-28", schiedsrichter=None),
    OPEN_SIDE: fixture(OPEN_SIDE, "2026-03-29", saison_phase="halbfinale", team1=None),
    # One club fielded twice on one matchday: the smallest stored fault, reported on both fixtures.
    CLASH_FIRST: fixture(CLASH_FIRST, "2026-04-01", spieltag_id=CLASH_SPIELTAG, uhrzeit="10:00:00"),
    CLASH_SECOND: fixture(CLASH_SECOND, "2026-04-01", spieltag_id=CLASH_SPIELTAG, uhrzeit="18:00:00", team2=_side(PICKED, "Schiller")),
    CALLED_OFF: fixture(CALLED_OFF, None, sonderereignis="ausgefallen"),
    OTHER_SEASONS: fixture(OTHER_SEASONS, None, saison_id=OTHER_SAISON),
}

ROWS = [
    club_row(SPIELE[OVERDUE], HOME, frist="2026-03-14", asked_at="2026-03-10"),
    club_row(SPIELE[DUE_TODAY], AWAY, frist=TODAY, asked_at=None),
    # Minted for the day the fixture was set for before it moved: it speaks for an Ansetzung the fixture has left.
    club_row({**SPIELE[MOVED], "datum": "2026-03-22"}, HOME, frist="2026-03-14", asked_at="2026-03-10"),
    club_row(
        SPIELE[PROPOSED],
        AWAY,
        frist="2026-03-20",
        asked_at="2026-03-12",
        antwort={
            "art": "declined",
            "am": "2026-03-14",
            "von": {"art": "kontakt", "rolle": "trainer"},
            "vorschlag": {"datum": "2026-03-27", "uhrzeit": "16:00:00"},
            "begruendung": None,
        },
    ),
    documents.spielbestaetigung_document(
        SPIELE[DECLINED],
        party={"art": "schiedsrichter", "schiedsrichter_id": SCHIEDSRICHTER},
        asked_at="2026-03-10",
        closed={"at": "2026-03-12", "grund": "schiedsrichter_declined"},
    ),
]


def application(bewerbung_id: ObjectId, status: str, submitted_at: str, **fields: Any) -> dict[str, Any]:
    """Two of its three seats confirmed by their own people."""

    kontakte = documents.kontakte_document(
        trainer=documents.kontaktperson_document("Anna", confirmed_at="2026-03-01"),
        ansprechperson=documents.kontaktperson_document("Ben"),
        stellvertretung=documents.kontaktperson_document("Cem", confirmed_at="2026-03-02"),
    )

    return documents.bewerbung_document(bewerbung_id, SAISON, status, kontakte=kontakte, submitted_at=submitted_at, **fields)


@pytest.fixture(scope="module")
def seeded_url(mongo_replica_set_url: str) -> Iterator[str]:
    database_name = build_test_config().db_base_name

    client = MongoClient(mongo_replica_set_url)
    try:
        database = a_clean_database_sync(client, mongo_replica_set_url, database_name)
        database[Collection.GRANTS].insert_many(grants_for_the_suite())
        database[Collection.SAISONS].insert_many([documents.saison_document(OTHER_SAISON, "past"), documents.saison_document(SAISON, "active")])
        database[Collection.TEAMS].insert_many(
            [
                documents.team_document(HOME, "Lessing", "LES"),
                documents.team_document(AWAY, "Goethe", "GOE"),
                documents.team_document(PICKED, "Schiller", "SCH"),
            ]
        )
        database[Collection.SAISON_TEAMS].insert_many(
            [
                documents.saison_team_document(SAISON, team_id, name, name[:3].upper())
                for team_id, name in ((HOME, "Lessing"), (AWAY, "Goethe"), (PICKED, "Schiller"))
            ]
        )
        database[Collection.SPIELORTE].insert_one(
            {"_id": SPIELORT, "name": "Halle Ost", "maps_link": "Halle Ost, Frankfurt", "default_mietpreis": 40, "inactive_since": None}
        )
        database[Collection.SCHIEDSRICHTER].insert_one(
            documents.schiedsrichter_document(
                SCHIEDSRICHTER, email="anna.koerner@example.com", name="Anna Körner", default_payment=20, einwilligung=None
            )
        )
        database[Collection.SPIELE].insert_many(list(SPIELE.values()))
        database[Collection.SPIELBESTAETIGUNGEN].insert_many(ROWS)
        database[Collection.SPIELBERICHTE].insert_one(documents.spielbericht_document(SPIELE[REPORTED]))
        database[Collection.BEWERBUNGEN].insert_many(
            [
                application(NEW_SCHOOL, "submitted", "2026-02-01", schule=documents.new_schule_document("Riedberg", "RIE")),
                application(PICKED_CLUB, "submitted", "2026-02-10", team_id=PICKED),
                application(DECIDED, "declined", "2026-01-20", schule=documents.new_schule_document("Westend", "WES")),
            ]
        )

        with unwritten(mongo_replica_set_url, database_name):
            yield mongo_replica_set_url
    finally:
        client.close()


@functools.cache
def _served() -> FastAPI:
    return create_app(build_test_config())


def answered(uri: str, path: str) -> Response:
    async def _answered() -> Response:
        async with app_client(uri, app=_served(), now=NOW) as http:
            return await http.get(path, headers=dict(ADMIN_AUTH))

    return asyncio.run(_answered())


def placed(response: Response) -> dict[str, list[tuple[str, Any]]]:
    """Each card's rows in order, a fixture's by its number and an application's by its school."""

    return {
        card["card"]: [(row["kind"], row["spiel"]["spiel_nr"] if "spiel" in row else row["name"]) for row in card["rows"]]
        for card in response.json()["cards"]
    }


@pytest.mark.db
class TestEachKindLandsOnItsCard:
    def test_every_kind_is_on_its_card_and_nothing_else_is(self, seeded_url: str):
        """A kind left out of the read, or one the filter widened to another season or a stale row, changes a list here."""

        response = answered(seeded_url, PATH)

        assert response.status_code == 200
        assert placed(response) == {
            "due": [("spielbestaetigung_overdue", OVERDUE), ("spielbestaetigung_due", DUE_TODAY)],
            "ergebnisse": [("ergebnis_missing", UNPLAYED), ("spielbericht_open", REPORTED)],
            "dates": [
                ("vorschlag_open", PROPOSED),
                ("date_missing", UNDATED),
                ("time_missing", UNDATED),
                ("spielort_missing", UNDATED),
                # Dated before undated within a kind.
                ("schiedsrichter_missing", DECLINED),
                ("schiedsrichter_missing", UNDATED),
                ("schiedsrichter_declined", DECLINED),
                ("team_missing", OPEN_SIDE),
                ("bracket_fault", CLASH_FIRST),
                ("bracket_fault", CLASH_SECOND),
            ],
            "bewerbungen": [("bewerbung", "Riedberg"), ("bewerbung", "Schiller")],
        }

    def test_each_row_carries_what_its_act_writes(self, seeded_url: str):
        """The acts' inputs: a proposal's row and its slot, each owed party's row, an application's confirmed seats."""

        rows = {
            (row["kind"], row["spiel"]["spiel_nr"] if "spiel" in row else row["name"]): row
            for card in answered(seeded_url, PATH).json()["cards"]
            for row in card["rows"]
        }
        proposed = rows[("vorschlag_open", PROPOSED)]
        overdue = rows[("spielbestaetigung_overdue", OVERDUE)]
        riedberg = rows[("bewerbung", "Riedberg")]

        assert (proposed["spielbestaetigung_id"], proposed["team_id"], proposed["vorschlag"]) == (
            str(ROWS[3]["_id"]),
            str(AWAY),
            {"datum": "2026-03-27", "uhrzeit": "16:00:00"},
        )
        assert overdue["parties"] == [{"spielbestaetigung_id": str(ROWS[0]["_id"]), "team_id": str(HOME), "deadline": "2026-03-14"}]
        assert (riedberg["bewerbung_id"], riedberg["seats_confirmed"], riedberg["seats"]) == (str(NEW_SCHOOL), 2, 3)

    def test_a_season_that_does_not_exist_is_not_found(self, seeded_url: str):
        assert answered(seeded_url, f"/api/v{API_VERSION}/saisons/1999/overview").status_code == 404
