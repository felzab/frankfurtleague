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

from app.api.saisons.overview import _gaps
from app.api.spiele.schemas import FLSpielJoinedInternal
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
CLASH_FIRST, CLASH_SECOND, CALLED_OFF, OTHER_SEASONS, REFEREE_OWED = 10, 11, 12, 13, 14

# As `spiele` stores them: every name the Übersicht serves is joined from the rows seeded beside them.
ORT = {"spielort_id": SPIELORT, "mietpreis": 40}
REFEREE = {"schiedsrichter_id": SCHIEDSRICHTER, "payment": 20}


def _side(team_id: ObjectId, tore: int | None = None) -> dict[str, Any]:
    return {"team_id": team_id, "tore": tore}


def spiel(nr: int, date: str | None, *, saison_id: str = SAISON, **fields: Any) -> dict[str, Any]:
    """A group fixture of its own matchday, slot and cast set unless `fields` empties one."""

    set_for = {
        "spieltag_id": ObjectId(OID.format(0x500 + nr)),
        "team1": _side(HOME),
        "team2": _side(AWAY),
        "date": date,
        "time": None if date is None else "15:00:00",
        "spielort": None if date is None else ORT,
        "schiedsrichter": None if date is None else REFEREE,
    }

    return documents.spiel_document(spiel_id=ObjectId(OID.format(nr)), saison_id=saison_id, spiel_nr=nr, **{**set_for, **fields})


def club_row(spiel: dict[str, Any], team_id: ObjectId, **fields: Any) -> dict[str, Any]:
    return documents.spielbestaetigung_document(spiel, party={"kind": "team", "team_id": team_id}, **fields)


REFEREE_PARTY = {"kind": "schiedsrichter", "schiedsrichter_id": SCHIEDSRICHTER}


SPIELE = {
    OVERDUE: spiel(OVERDUE, "2026-03-20"),
    DUE_TODAY: spiel(DUE_TODAY, "2026-03-17"),
    MOVED: spiel(MOVED, "2026-03-21"),
    UNPLAYED: spiel(UNPLAYED, "2026-03-10"),
    REPORTED: spiel(REPORTED, "2026-03-08", ergebnis="2:1", team1=_side(HOME, 2), team2=_side(AWAY, 1)),
    PROPOSED: spiel(PROPOSED, "2026-03-25"),
    UNDATED: spiel(UNDATED, None),
    DECLINED: spiel(DECLINED, "2026-03-28", schiedsrichter=None),
    OPEN_SIDE: spiel(OPEN_SIDE, "2026-03-29", saison_phase="halbfinale", team1=None),
    # One club fielded twice on one matchday: the smallest stored fault, reported on both fixtures.
    CLASH_FIRST: spiel(CLASH_FIRST, "2026-04-01", spieltag_id=CLASH_SPIELTAG, time="10:00:00"),
    CLASH_SECOND: spiel(CLASH_SECOND, "2026-04-01", spieltag_id=CLASH_SPIELTAG, time="18:00:00", team2=_side(PICKED)),
    CALLED_OFF: spiel(CALLED_OFF, None, sonderereignis="ausgefallen"),
    OTHER_SEASONS: spiel(OTHER_SEASONS, None, saison_id=OTHER_SAISON),
    REFEREE_OWED: spiel(REFEREE_OWED, "2026-03-19"),
}

ROWS = [
    club_row(SPIELE[OVERDUE], HOME, deadline="2026-03-14", asked_at="2026-03-10"),
    club_row(SPIELE[DUE_TODAY], AWAY, deadline=TODAY, asked_at=None),
    # Minted for the day the fixture was set for before it moved: it speaks for an Ansetzung the fixture has left.
    club_row({**SPIELE[MOVED], "date": "2026-03-22"}, HOME, deadline="2026-03-14", asked_at="2026-03-10"),
    club_row(
        SPIELE[PROPOSED],
        AWAY,
        deadline="2026-03-20",
        asked_at="2026-03-12",
        answer={
            "kind": "declined",
            "at": "2026-03-14",
            "by": {"kind": "kontakt", "rolle": "trainer"},
            "vorschlag": {"date": "2026-03-27", "time": "16:00:00"},
            "reason": None,
        },
    ),
    documents.spielbestaetigung_document(
        SPIELE[DECLINED],
        party=REFEREE_PARTY,
        asked_at="2026-03-10",
        closed={"reason": "schiedsrichter_declined"},
    ),
    # The booked referee owing an answer past the deadline too: the fixture's one row names both parties.
    documents.spielbestaetigung_document(SPIELE[OVERDUE], party=REFEREE_PARTY, deadline="2026-03-14", asked_at="2026-03-10"),
    # The proposal's other club, asked and agreed, and its referee, never asked: an adoption has the pass tell the
    # first of the move and not the second.
    club_row(
        SPIELE[PROPOSED],
        HOME,
        deadline="2026-03-20",
        asked_at="2026-03-12",
        answer={"kind": "agreed", "at": "2026-03-13", "by": {"kind": "kontakt", "rolle": "trainer"}, "vorschlag": None, "reason": None},
    ),
    documents.spielbestaetigung_document(SPIELE[PROPOSED], party=REFEREE_PARTY, deadline="2026-03-20", asked_at=None),
    # The referee alone still to answer, past the clubs' deadline: a referee answers until the kick-off, so nothing lapsed.
    documents.spielbestaetigung_document(SPIELE[REFEREE_OWED], party=REFEREE_PARTY, deadline="2026-03-12", asked_at="2026-03-05"),
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
        with a_clean_database_sync(client, mongo_replica_set_url, database_name) as database:
            database[Collection.GRANTS].insert_many(grants_for_the_suite())
            database[Collection.SAISONS].insert_many(
                [documents.saison_document(OTHER_SAISON, "past"), documents.saison_document(SAISON, "active")]
            )
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
            database[Collection.SPIELORTE].insert_one(documents.spielort_document(SPIELORT, "Halle Ost", default_mietpreis=40))
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
                    application(NEW_SCHOOL, "submitted", "2026-02-01", schule=documents.new_schule_document("Riedberg")),
                    application(PICKED_CLUB, "submitted", "2026-02-10", team_id=PICKED),
                    application(DECIDED, "declined", "2026-01-20", schule=documents.new_schule_document("Westend")),
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
        """A kind left out, one widened to another season or a stale row, or a fixture twice on a card changes a list here."""

        response = answered(seeded_url, PATH)

        assert response.status_code == 200
        assert placed(response) == {
            "due": [("spielbestaetigung_overdue", OVERDUE), ("spielbestaetigung_due", DUE_TODAY), ("spielbestaetigung_due", REFEREE_OWED)],
            "ergebnisse": [("spielbericht_open", REPORTED), ("ergebnis_missing", UNPLAYED)],
            "dates": [
                ("vorschlag_open", PROPOSED),
                # Lacking its slot, its ground and its referee, the fixture stands once, for the first of them.
                ("appointment_missing", UNDATED),
                # The referee's own decline is a referee missing, one row.
                ("schiedsrichter_missing", DECLINED),
                ("team_missing", OPEN_SIDE),
                ("bracket_fault", CLASH_FIRST),
                ("bracket_fault", CLASH_SECOND),
            ],
            "bewerbungen": [("bewerbung", "Riedberg"), ("bewerbung", "Schiller")],
        }

    def test_each_row_carries_what_its_act_writes(self, seeded_url: str):
        """The acts' inputs: a proposal's row and its slot and whom each act mails, each owed party's row and name, an application's seats.

        A referee left off the owed parties cannot be entered from the page; a recipient the page guesses names a mail the
        backend never sends, or misses one it does.
        """

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
            {"date": "2026-03-27", "time": "16:00:00"},
        )
        away, home, referee = (
            {"kind": "team", "team_id": str(AWAY)},
            {"kind": "team", "team_id": str(HOME)},
            {"kind": "schiedsrichter", "schiedsrichter_id": str(SCHIEDSRICHTER)},
        )
        # Each recipient by the name its season row holds, so the questions name a party no fixture shows.
        assert sorted(proposed["adoption_recipients"], key=str) == sorted([{**away, "name": "Goethe"}, {**home, "name": "Lessing"}], key=str)
        assert proposed["discard_recipients"] == [{**away, "name": "Goethe"}]
        assert sorted(overdue["parties"], key=str) == sorted(
            [
                {
                    "spielbestaetigung_id": str(ROWS[0]["_id"]),
                    "party": home,
                    "name": "Lessing",
                    "asked_at": "2026-03-10",
                    "due_by": "2026-03-14",
                    "lapsed_on": "2026-03-14",
                },
                # The clubs' deadline binds no referee, who answers until the kick-off: due by the fixture's day.
                {
                    "spielbestaetigung_id": str(ROWS[5]["_id"]),
                    "party": referee,
                    "name": "Anna Körner",
                    "asked_at": "2026-03-10",
                    "due_by": "2026-03-20",
                    "lapsed_on": None,
                },
            ],
            key=str,
        )
        assert (riedberg["bewerbung_id"], riedberg["seats_confirmed"], riedberg["seats"]) == (str(NEW_SCHOOL), 2, 3)


def joined(**fields: Any) -> FLSpielJoinedInternal:
    """One fixture of the season as the read joins it, its two clubs named, every gap but those `fields` open closed."""

    closed = {
        "date": "2026-04-01",
        "time": "18:00:00",
        "spielort": {"spielort_id": SPIELORT, "mietpreis": 40},
        "schiedsrichter": {"schiedsrichter_id": SCHIEDSRICHTER, "payment": 20},
        "team1": {"team_id": HOME, "tore": None},
        "team2": {"team_id": AWAY, "tore": None},
    }
    stored = documents.spiel_document(spiel_id=ObjectId(), saison_id=SAISON, spiel_nr=1, spieltag_id=ObjectId(), **{**closed, **fields})

    return FLSpielJoinedInternal.model_validate(documents.joined_spiel_document(stored))


class TestWhatASpielStillLacks:
    """The gaps the Übersicht's dates card lists, judged without the database: a gap missed leaves a fixture unprepared unseen."""

    def test_a_dated_spiel_with_no_time_still_lacks_its_date(self):
        assert _gaps(joined(time=None), today=TODAY) == ["appointment_missing"]

    def test_a_knockout_side_awaiting_its_source_is_no_missing_club(self):
        """Its club arrives with the bracket's resolution: listed, it asks the administrator to pick a club the draw will place."""

        sourced = joined(saison_phase="halbfinale", team2=None, team2_quelle={"type": "gruppe", "gruppe": "A", "platz": 1})
        open_side = joined(saison_phase="halbfinale", team2=None)

        assert (_gaps(sourced, today=TODAY), _gaps(open_side, today=TODAY)) == ([], ["team_missing"])
