"""
API · a team's two reads, its Übersicht and its fixtures, served to its seat holders through the mounted application

What each serves of the dates the league asked the team to confirm, of its line-ups and of its registrations, and to
whom: every case reads the wire, so a field the model would drop and a key a nested block would smuggle in are both seen.
"""

import functools
import json
from collections.abc import Iterator, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from fastapi import FastAPI
from pymongo.asynchronous.database import AsyncDatabase

from app.core.collections import Collection
from app.core.config import API_VERSION
from app.main import create_app
from tests import documents
from tests.app_client import app_client
from tests.config import ADMIN_KEY, build_test_config
from tests.database import a_clean_database, on_the_seed_loop
from tests.session_headers import StampedHeaders
from tests.worker import worker_database

# Module level: each read opens a snapshot session against a real mongod.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_team_panel_test")
WIRE_CONFIG = build_test_config().model_copy(update={"db_base_name": DATABASE_NAME})

SAISON_ID = "2026"
PAST_SAISON_ID = "2025"
NEXT_SAISON_ID = "2027"
TODAY = "2026-04-01"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

TEAM = ObjectId("6890a1b2c3d4e5f607990001")
OTHER = ObjectId("6890a1b2c3d4e5f607990002")
# Two clubs out of this season from a day before their fixture with the team, one fielded at home and one away.
LEFT_HOME_CLUB = ObjectId("6890a1b2c3d4e5f607990003")
LEFT_AWAY_CLUB = ObjectId("6890a1b2c3d4e5f607990004")
SPIELTAG = ObjectId("6890a1b2c3d4e5f6079900a1")
SPIELORT = ObjectId("6890a1b2c3d4e5f6079900b1")

# This season: Theo the confirmed Trainer, Anna an unanswered Ansprechperson, the Stellvertretung empty. Past season:
# Paula. Next season: Nora, confirmed. Otto holds the other club's seat.
THEO = "theo@example.com"
ANNA = "anna@example.com"
OTTO = "otto@example.com"
PAULA = "paula@example.com"
NORA = "nora@example.com"

CONFIRMED_ON = "2026-03-21"
OTHERS_REASON = "Unsere Halle ist belegt"
OWN_REASON = "Wir sind auf Klassenfahrt"


def spiel(
    number: int, date: str | None, time: str | None = "18:00:00", *, home: ObjectId = TEAM, away: ObjectId | None = None, **fields: Any
) -> dict[str, Any]:
    away = away or (OTHER if home == TEAM else TEAM)

    return documents.spiel_document(
        spiel_id=ObjectId(f"6890a1b2c3d4e5f6079900{number:02d}"),
        saison_id=SAISON_ID,
        spiel_nr=number,
        spieltag_id=SPIELTAG,
        team1={"team_id": home, "tore": None},
        team2={"team_id": away, "tore": None},
        date=date,
        time=time,
        spielort={"spielort_id": SPIELORT, "mietpreis": 40},
        **fields,
    )


# Each the case its name gives, ordered by their day: a team row past its deadline unanswered; open while the other
# club's decline proposes another date; declined by the team; agreed, its line-up stored; a decline the league
# discarded, kicking off tomorrow at noon, so its line-up is overdue; its kick-off within the hour, so its line-up is
# locked; undated; and a row about the slot a move left. Then, each holding a stored line-up so it asks for none: a row
# nobody answered yet; two whose opponent has left the season by their day, whose exit the row's state is judged by; and
# a fixture called off, whose row the hourly pass has not closed yet and which asks nothing.
EXPIRED = spiel(5, TODAY, "13:00:00")
VORSCHLAG = spiel(1, "2026-04-15")
DECLINED = spiel(2, "2026-04-22", home=OTHER)
AGREED = spiel(3, "2026-04-29")
OVERDUE = spiel(4, "2026-04-02", "12:00:00")
UNDATED = spiel(6, None, None)
MOVED = spiel(7, "2026-05-06")
VALID = spiel(8, "2026-05-13")
LEFT_HOME = spiel(9, "2026-05-20", home=LEFT_HOME_CLUB)
LEFT_AWAY = spiel(10, "2026-05-24", away=LEFT_AWAY_CLUB)
CALLED_OFF = spiel(11, "2026-05-27", sonderereignis="ausgefallen")
SPIELE = [VORSCHLAG, DECLINED, AGREED, OVERDUE, EXPIRED, UNDATED, MOVED, VALID, LEFT_HOME, LEFT_AWAY, CALLED_OFF]
EXIT = {"type": "rueckzug", "reason": "Schule zieht zurück", "date": "2026-05-01"}


def row(spiel_raw: Mapping[str, Any], team_id: ObjectId, **fields: Any) -> dict[str, Any]:
    return documents.spielbestaetigung_document(
        spiel_raw, party={"kind": "team", "team_id": team_id}, **{"deadline": "2026-04-08", "asked_at": "2026-03-25", **fields}
    )


def declined(rolle: str, reason: str, date: str) -> dict[str, Any]:
    return documents.kontakt_answer_document(rolle, reason=reason, vorschlag={"date": date, "time": "17:00:00"})


ROWS = [
    row(EXPIRED, TEAM, deadline="2026-03-31"),
    row(VORSCHLAG, TEAM),
    row(VORSCHLAG, OTHER, answer=declined("trainer", OTHERS_REASON, "2026-04-16")),
    row(DECLINED, TEAM, answer=declined("ansprechperson", OWN_REASON, "2026-04-23")),
    row(AGREED, TEAM, answer={"kind": "agreed", "at": TODAY, "by": {"kind": "kontakt", "rolle": "trainer"}, "vorschlag": None, "reason": None}),
    row(OVERDUE, TEAM, answer=declined("trainer", OWN_REASON, "2026-04-03"), closed={"reason": "discarded"}),
    {**row(MOVED, TEAM), "ansetzung": {**row(MOVED, TEAM)["ansetzung"], "time": "16:00:00", "digest": "a-slot-left"}},
    row(VALID, TEAM),
    row(LEFT_HOME, TEAM),
    row(LEFT_AWAY, TEAM),
    row(CALLED_OFF, TEAM),
]


def seat(first_name: str, *, confirmed: bool = True) -> dict[str, Any]:
    return documents.kontaktperson_document(first_name, confirmed_at=CONFIRMED_ON if confirmed else None)


def kontakte(**seats: Any) -> dict[str, Any]:
    return documents.kontakte_document(**seats)


async def seed(database: AsyncDatabase) -> None:
    await database[Collection.SAISONS].insert_many(
        [
            documents.saison_document(SAISON_ID, "active"),
            documents.saison_document(PAST_SAISON_ID, "past"),
            documents.saison_document(NEXT_SAISON_ID, "future"),
        ]
    )
    await database[Collection.TEAMS].insert_many(
        [
            documents.team_document(TEAM, "Zorbanax", "ZOX"),
            documents.team_document(OTHER, "Quillhilde", "QUX"),
            documents.team_document(LEFT_HOME_CLUB, "Brackenmoor", "BRX"),
            documents.team_document(LEFT_AWAY_CLUB, "Wraxlington", "WRX"),
        ]
    )
    await database[Collection.SAISON_TEAMS].insert_many(
        [
            documents.saison_team_document(
                SAISON_ID, TEAM, "Zorbanax", "ZOX", kontakte=kontakte(trainer=seat("Theo"), ansprechperson=seat("Anna", confirmed=False))
            ),
            documents.saison_team_document(PAST_SAISON_ID, TEAM, "Zorbanax", "ZOX", kontakte=kontakte(ansprechperson=seat("Paula"))),
            documents.saison_team_document(NEXT_SAISON_ID, TEAM, "Zorbanax", "ZOX", kontakte=kontakte(ansprechperson=seat("Nora"))),
            documents.saison_team_document(SAISON_ID, OTHER, "Quillhilde", "QUX", kontakte=kontakte(trainer=seat("Otto"))),
            # The other club's exit from another season, which judges none of this season's rows.
            documents.saison_team_document(PAST_SAISON_ID, OTHER, "Quillhilde", "QUX", austritt={**EXIT, "date": "2025-06-01"}),
            documents.saison_team_document(SAISON_ID, LEFT_HOME_CLUB, "Brackenmoor", "BRX", austritt=dict(EXIT)),
            documents.saison_team_document(SAISON_ID, LEFT_AWAY_CLUB, "Wraxlington", "WRX", austritt=dict(EXIT)),
        ]
    )
    await database[Collection.SPIELTAGE].insert_one(
        {
            "_id": SPIELTAG,
            "start": "2026-03-01",
            "end": "2026-06-30",
            "position": 1,
            "saison_id": SAISON_ID,
            "saison_phase": "gruppenphase",
            "version": 0,
        }
    )
    await database[Collection.SPIELORTE].insert_one(documents.spielort_document(SPIELORT, "Halle Ost", default_mietpreis=40))
    await database[Collection.SPIELE].insert_many([dict(spiel_raw) for spiel_raw in SPIELE])
    await database[Collection.SPIELBESTAETIGUNGEN].insert_many([dict(stored) for stored in ROWS])
    await database[Collection.AUFSTELLUNGEN].insert_many(
        [
            *(documents.aufstellung_document(stored, TEAM, starters=[ObjectId()]) for stored in (AGREED, VALID, LEFT_HOME, LEFT_AWAY, EXPIRED)),
        ]
    )
    await database[Collection.REGISTRIERUNGEN].insert_many(
        [
            documents.registrierung_document(
                ObjectId("6890a1b2c3d4e5f6079900c1"),
                "ole@example.com",
                saison_id=SAISON_ID,
                team_id=TEAM,
                first_name="Ole",
                last_name="Sommer",
                token="ole-link",
                submitted_at="2026-03-28",
                deadline="2026-04-11",
                position="Abwehr",
                stufe="Q2",
                confirmed=documents.registrierung_confirmed(
                    birth_date="2009-05-04", today="2026-03-29", at="2026-03-29T08:00:00+00:00", scope="internal", media=False
                ),
            ),
            documents.registrierung_document(
                ObjectId("6890a1b2c3d4e5f6079900c2"),
                "pia@example.com",
                saison_id=SAISON_ID,
                team_id=TEAM,
                first_name="Pia",
                last_name="Winter",
                token="pia-link",
                submitted_at="2026-03-30",
                deadline="2026-04-13",
            ),
        ]
    )


@functools.cache
def _served() -> FastAPI:
    return create_app(WIRE_CONFIG)


def read(url: str, what: str, *, identifier: str = THEO, saison_id: str = SAISON_ID) -> tuple[int, Any]:
    async def _run() -> tuple[int, Any]:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_, database):
            await seed(database)
            async with app_client(url, app=_served(), now=NOW) as http:
                response = await http.get(
                    f"/api/v{API_VERSION}/teams/{TEAM}/saisons/{saison_id}/self/{what}",
                    headers=StampedHeaders(identifier, ADMIN_KEY, lane="person"),
                )

            return response.status_code, response.json()

    return on_the_seed_loop(_run())


def keys_at_every_depth(value: Any) -> Iterator[str]:
    if isinstance(value, Mapping):
        for key, inner in value.items():
            yield key
            yield from keys_at_every_depth(inner)
    elif isinstance(value, list):
        for inner in value:
            yield from keys_at_every_depth(inner)


@pytest.mark.parametrize("what", ["overview", "spiele"])
class TestEachReadAnswersTheTeamsSeatHoldersAlone:
    @pytest.mark.parametrize(
        ("identifier", "saison_id"),
        [(OTTO, SAISON_ID), (ANNA, SAISON_ID), (PAULA, PAST_SAISON_ID), (NORA, SAISON_ID)],
        ids=("another team's seat", "an unconfirmed seat", "the team's past season", "the same team in another season"),
    )
    def test_a_seat_granting_nothing_here_is_refused(self, mongo_replica_set_url: str, what: str, identifier: str, saison_id: str):
        status, served = read(mongo_replica_set_url, what, identifier=identifier, saison_id=saison_id)

        assert (status, served["error_code"]) == (403, "role_not_held")

    def test_no_address_telephone_birthdate_or_other_clubs_reason_at_any_depth(self, mongo_replica_set_url: str, what: str):
        """Over the serialised body, keys and values both, so a nested block cannot smuggle one in."""

        status, served = read(mongo_replica_set_url, what)

        # A refused read would pass the scan below with nothing scanned.
        assert status == 200
        assert not {"email", "phone", "birth_date", "einwilligung", "confirmed_at", "by"} & set(keys_at_every_depth(served))
        text = json.dumps(served)
        assert not any(value in text for value in ("@", "+49", "2009-05-04", CONFIRMED_ON, OTHERS_REASON))


class TestTheOverview:
    def test_it_lists_the_open_work_and_nothing_settled(self, mongo_replica_set_url: str):
        status, served = read(mongo_replica_set_url, "overview")

        assert status == 200
        assert (served["name"], served["full_name"], served["rollen"]) == ("Zorbanax", "Zorbanax-Schule", ["trainer"])
        # The date agreed, the discarded decline, the row about a slot left and the call-off ask nothing; the others by
        # their day.
        assert [(termin["spiel_id"], termin["state"], termin["side"], termin["vorschlag"]) for termin in served["termine"]] == [
            (str(EXPIRED["_id"]), "expired", "team1", None),
            # The other club's proposed date and hour.
            (str(VORSCHLAG["_id"]), "vorschlag", "team1", {"date": "2026-04-16", "time": "17:00:00"}),
            (str(DECLINED["_id"]), "declined", "team2", {"date": "2026-04-23", "time": "17:00:00"}),
            (str(VALID["_id"]), "valid", "team1", None),
            # Inside their deadline: the opponent's exit by the fixture's day is what ends each.
            (str(LEFT_HOME["_id"]), "expired", "team2", None),
            (str(LEFT_AWAY["_id"]), "expired", "team1", None),
        ]
        # Stored, locked within the hour, or undated, a fixture asks for no line-up; the overdue one comes first.
        assert [(entry["spiel_id"], entry["marks"]["phase"]) for entry in served["aufstellungen"]] == [
            (str(OVERDUE["_id"]), "overdue"),
            (str(VORSCHLAG["_id"]), "open"),
            (str(DECLINED["_id"]), "open"),
            (str(MOVED["_id"]), "open"),
        ]
        assert [
            (registrierung["first_name"], registrierung["position"], registrierung["stufe"], registrierung["admissible"])
            for registrierung in served["registrierungen"]
        ] == [("Pia", None, None, False), ("Ole", "Abwehr", "Q2", True)]
        assert [(entry["rollen"], entry["name"], entry["confirmed"]) for entry in served["seats"]] == [
            (["trainer"], "Theo Theo-Mustermann", True),
            (["ansprechperson"], "Anna Anna-Mustermann", False),
            (["stellvertretung"], None, False),
        ]


class TestTheTeamsSpiele:
    def test_each_fixture_carries_its_date_s_state_and_its_line_up_s_marks(self, mongo_replica_set_url: str):
        status, served = read(mongo_replica_set_url, "spiele")

        assert status == 200
        by_spiel = {entry["id"]: entry for entry in served["spiele"]}
        assert [entry["spiel_nr"] for entry in served["spiele"]] == sorted(spiel_raw["spiel_nr"] for spiel_raw in SPIELE)
        assert {spiel_raw["spiel_nr"]: by_spiel[str(spiel_raw["_id"])]["termin"] for spiel_raw in SPIELE} == {
            1: "vorschlag",
            2: "declined",
            3: "agreed",
            4: None,
            5: "expired",
            6: None,
            7: None,
            8: "valid",
            9: "expired",
            10: "expired",
            11: None,
        }
        marks = {spiel_raw["spiel_nr"]: by_spiel[str(spiel_raw["_id"])]["aufstellung"] for spiel_raw in SPIELE}
        assert marks[6] is None
        assert (marks[3]["stored"], marks[3]["phase"]) == (True, "open")
        assert (marks[4]["phase"], marks[5]["phase"]) == ("overdue", "locked")
        # Locked, so the entries of the pupil erased since keep it standing.
        assert marks[5]["stored"] is True
        assert {entry["spieltag_position"] for entry in served["spiele"]} == {1}
