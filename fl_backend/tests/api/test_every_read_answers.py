"""
API · every read the application mounts answers a whole league in each season phase that changes what a read serves

A read whose pipeline stops fitting its response model answers 500 to every caller and fails no static check, and no
case per read is kept to see it. This case asks each GET route `app.routes` mounts, signed in as its guard requires,
against one league seeded three times: before its start with its opening match's sides set, running with its
semi-finals drawn and fielded, and decided. A route added later is asked without a case of its own, and a path or a
query parameter no seed value names fails here until one does.
"""

import asyncio
import functools
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from fastapi import FastAPI
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute
from pydantic import BaseModel
from pymongo import MongoClient

from app.api.saisons.schemas import FLSaisonRules
from app.api.saisons.spielplan import EnteredTeam, draw_spielplan
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.security import verify_access_admin, verify_access_base, verify_access_system, verify_admin_actor, verify_person_actor
from app.main import create_app
from app.readback import RECORD_MODELS
from tests import documents
from tests.app_client import app_client
from tests.config import ADMIN_AUTH, ADMIN_KEY, BASE_AUTH, SYSTEM_AUTH, build_test_config, grants_for_the_suite
from tests.core.app_source import api_routes, application, dependency_calls
from tests.database import a_clean_database_sync
from tests.session_headers import StampedHeaders

from .conftest import unwritten

pytestmark = pytest.mark.db

GERMANY = ZoneInfo("Europe/Berlin")

SAISON = "2126"
NEXT_SAISON = "2127"

# One group of four, every club qualifying: the narrowest bracket, semi-finals then the Finale's matchday.
RULES = documents.rules_document(number_of_gruppen=1, teams_per_gruppe=4, qualifiers_per_gruppe=4)

# In the order the group finishes: each club beats every club after it.
CLUBS = (
    (ObjectId("6890a1b2c3d4e5f607f00001"), "Adler", "ADX"),
    (ObjectId("6890a1b2c3d4e5f607f00002"), "Biber", "BIX"),
    (ObjectId("6890a1b2c3d4e5f607f00003"), "Corax", "COX"),
    (ObjectId("6890a1b2c3d4e5f607f00004"), "Dachs", "DAX"),
)
RANK = {team_id: rank for rank, (team_id, _, _) in enumerate(CLUBS)}

# One address holding every Funktion a person's read asks of: the confirmed Trainer of the first club, a referee
# booked on the phase's featured fixture, and a pupil on the second club's squad.
PERSON = "pia.person@example.com"
PERSON_SPIELER = ObjectId("6890a1b2c3d4e5f607f00011")
PERSON_SCHIEDSRICHTER = ObjectId("6890a1b2c3d4e5f607f00012")
OTHER_SPIELER = ObjectId("6890a1b2c3d4e5f607f00013")
OTHER_SCHIEDSRICHTER = ObjectId("6890a1b2c3d4e5f607f00014")
SPIELORT = ObjectId("6890a1b2c3d4e5f607f00021")
BEWERBUNG = ObjectId("6890a1b2c3d4e5f607f00031")
REGISTRIERUNG = ObjectId("6890a1b2c3d4e5f607f00041")

CONSENTED_SCHIEDSRICHTER = documents.own_einwilligung_document(text_versions=documents.SCHIEDSRICHTER_TEXT_VERSIONS, confirmed_at="2126-01-10")
CONSENTED_SPIELER = documents.own_einwilligung_document(text_versions=documents.SPIELER_TEXT_VERSIONS, confirmed_at="2126-01-10")


def _drawn() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """The season's matchdays and fixtures as the draw inserts them, each stamped with the version an insert gives it."""

    entered = [
        EnteredTeam(row_id=ObjectId(f"6890a1b2c3d4e5f607f001{index:02d}"), team_id=team_id, gruppe="A", name=name, shorthand=shorthand)
        for index, (team_id, name, shorthand) in enumerate(CLUBS)
    ]
    plan = draw_spielplan(saison_id=SAISON, rules=FLSaisonRules.model_validate(RULES), entered=entered)

    def stored(collection: Collection, document: dict[str, Any]) -> dict[str, Any]:
        RECORD_MODELS[collection].model_validate(document, extra="forbid")
        return document

    spieltage = [stored(Collection.SPIELTAGE, {**spieltag, "version": 0}) for spieltag in plan.spieltage]
    spiele = [{**spiel, "version": 0} for spiel in plan.spiele]
    return spieltage, spiele


def _winner_first(spiel: Mapping[str, Any]) -> tuple[int, int]:
    """2:0 to whichever side the group order ranks first."""

    return (2, 0) if RANK[spiel["team1"]["team_id"]] < RANK[spiel["team2"]["team_id"]] else (0, 2)


def _played(spiel: dict[str, Any], date: str, tore: tuple[int, int]) -> None:
    spiel.update(date=date, time="18:30:00", ergebnis=f"{tore[0]}:{tore[1]}")
    spiel["team1"] = {**spiel["team1"], "tore": tore[0]}
    spiel["team2"] = {**spiel["team2"], "tore": tore[1]}


def _fielded(spiel: dict[str, Any], team1: ObjectId, team2: ObjectId, date: str) -> None:
    """A knockout fixture whose sources have resolved: both clubs set, each source kept beside it."""

    spiel.update(team1={"team_id": team1, "tore": None}, team2={"team_id": team2, "tore": None}, date=date, time="18:30:00")


def _booked(spiel: dict[str, Any], schiedsrichter_id: ObjectId) -> None:
    spiel.update(spielort={"spielort_id": SPIELORT, "mietpreis": 40}, schiedsrichter={"schiedsrichter_id": schiedsrichter_id, "payment": 20})


@dataclass(frozen=True)
class Phase:
    name: str
    now: datetime
    start_date: str
    featured: dict[str, Any]
    spieltage: list[dict[str, Any]]
    spiele: list[dict[str, Any]]
    # The fixtures holding a report, the featured one's line-up and confirmation rows apart.
    reported: list[dict[str, Any]]


def _before_start() -> Phase:
    """Two weeks out, the opening fixture dated and booked, every side the draw set."""

    spieltage, spiele = _drawn()
    opening = spiele[0]
    opening.update(date="2126-03-15", time="18:30:00")
    _booked(opening, PERSON_SCHIEDSRICHTER)

    return Phase("before_start", datetime(2126, 3, 1, 12, tzinfo=GERMANY), "2126-03-15", opening, spieltage, spiele, [])


def _group_played(spiele: list[dict[str, Any]]) -> list[dict[str, Any]]:
    group = [spiel for spiel in spiele if spiel["saison_phase"] == "gruppenphase"]
    for day, spiel in enumerate(group):
        _played(spiel, f"2126-03-{15 + day:02d}", _winner_first(spiel))
    _booked(group[0], PERSON_SCHIEDSRICHTER)
    return group


def _semis_fielded(spiele: list[dict[str, Any]]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Group 1st against 4th and 2nd against 3rd, as the bracket's sources name them."""

    first, second = (spiel for spiel in spiele if spiel["saison_phase"] == "halbfinale")
    (top, _, _), (runner_up, _, _), (third, _, _), (fourth, _, _) = CLUBS
    _fielded(first, top, fourth, "2126-05-10")
    _fielded(second, runner_up, third, "2126-05-10")
    return first, second


def _running() -> Phase:
    """The group played, the semi-finals fielded and still to come, the Finale's matchday waiting on them."""

    spieltage, spiele = _drawn()
    group = _group_played(spiele)
    first, _ = _semis_fielded(spiele)
    _booked(first, PERSON_SCHIEDSRICHTER)

    return Phase("running", datetime(2126, 5, 1, 12, tzinfo=GERMANY), "2126-03-15", first, spieltage, spiele, [group[0]])


def _decided() -> Phase:
    """Every fixture played, the Finale's two included, so the season's podium stands."""

    spieltage, spiele = _drawn()
    _group_played(spiele)
    first, second = _semis_fielded(spiele)
    _played(first, "2126-05-10", (3, 1))
    _played(second, "2126-05-10", (2, 0))
    third_place, finale = (spiel for spiel in spiele if spiel["saison_phase"] == "finale")
    (top, _, _), (runner_up, _, _), (third, _, _), (fourth, _, _) = CLUBS
    _fielded(third_place, fourth, third, "2126-05-24")
    _fielded(finale, top, runner_up, "2126-05-24")
    _played(third_place, "2126-05-24", (1, 0))
    _played(finale, "2126-05-24", (2, 1))
    _booked(finale, PERSON_SCHIEDSRICHTER)

    return Phase("decided", datetime(2126, 6, 20, 12, tzinfo=GERMANY), "2126-03-15", finale, spieltage, spiele, [finale])


PHASES = {phase.name: phase for phase in (_before_start(), _running(), _decided())}


def _seed(database: Any, phase: Phase) -> None:
    (own_club, own_name, own_shorthand), (squad_club, _, _), *_ = CLUBS
    featured = phase.featured

    database[Collection.GRANTS].insert_many(grants_for_the_suite())
    database[Collection.SAISONS].insert_many(
        [
            documents.saison_document(SAISON, "active", rules=documents.rules_document(**RULES), start_date=phase.start_date),
            documents.saison_document(NEXT_SAISON, "future"),
        ]
    )
    database[Collection.TEAMS].insert_many([documents.team_document(team_id, name, shorthand) for team_id, name, shorthand in CLUBS])
    trainer = documents.kontaktperson_document("Pia", confirmed_at="2126-01-12", email=PERSON)
    database[Collection.SAISON_TEAMS].insert_many(
        [
            documents.saison_team_document(
                SAISON,
                team_id,
                name,
                shorthand,
                _id=ObjectId(f"6890a1b2c3d4e5f607f001{index:02d}"),
                kontakte=documents.kontakte_document(trainer=trainer) if team_id == own_club else None,
            )
            for index, (team_id, name, shorthand) in enumerate(CLUBS)
        ]
    )
    database[Collection.SPIELTAGE].insert_many(phase.spieltage)
    database[Collection.SPIELE].insert_many([documents.spiel_document(spiel_id=spiel.pop("_id"), **spiel) for spiel in map(dict, phase.spiele)])
    database[Collection.SPIELORTE].insert_one(
        {
            "_id": SPIELORT,
            "name": "Halle Ost",
            "address": dict(documents.ADDRESS),
            "maps_link": "Halle Ost, Frankfurt",
            "default_mietpreis": 40,
            "inactive_since": None,
        }
    )
    database[Collection.SCHIEDSRICHTER].insert_many(
        [
            documents.schiedsrichter_document(
                PERSON_SCHIEDSRICHTER, email=PERSON, name="Pia Person", default_payment=20, einwilligung=CONSENTED_SCHIEDSRICHTER
            ),
            documents.schiedsrichter_document(
                OTHER_SCHIEDSRICHTER, email="otto@example.com", name="Otto Gruber", default_payment=20, einwilligung=None
            ),
        ]
    )
    database[Collection.SPIELER].insert_many(
        [
            documents.spieler_document(PERSON_SPIELER, "Pia", "Person", email=PERSON, birth_date="2008-05-04", einwilligung=CONSENTED_SPIELER),
            documents.spieler_document(OTHER_SPIELER, "Lina", "Krause"),
        ]
    )
    database[Collection.SAISON_SPIELER].insert_many(
        [
            documents.saison_spieler_document(PERSON_SPIELER, SAISON, squad_club, nummer="7"),
            documents.saison_spieler_document(OTHER_SPIELER, SAISON, own_club, nummer="9"),
        ]
    )
    database[Collection.AUFSTELLUNGEN].insert_one(documents.aufstellung_document(featured, own_club, starters=[OTHER_SPIELER]))
    database[Collection.SPIELBESTAETIGUNGEN].insert_many(
        [
            documents.spielbestaetigung_document(featured, party={"kind": "team", "team_id": featured["team1"]["team_id"]}),
            documents.spielbestaetigung_document(featured, party={"kind": "schiedsrichter", "schiedsrichter_id": PERSON_SCHIEDSRICHTER}),
        ]
    )
    if phase.reported:
        database[Collection.SPIELBERICHTE].insert_many([documents.spielbericht_document(spiel) for spiel in phase.reported])
    database[Collection.REGISTRIERUNGEN].insert_one(
        documents.registrierung_document(
            REGISTRIERUNG,
            "jonas.neu@example.com",
            saison_id=SAISON,
            team_id=own_club,
            first_name="Jonas",
            last_name="Neu",
            token="registrierung-link",
            submitted_at="2126-02-20",
            deadline="2126-02-27",
        )
    )
    database[Collection.BEWERBUNGEN].insert_one(
        documents.bewerbung_document(
            BEWERBUNG,
            NEXT_SAISON,
            "submitted",
            kontakte=documents.kontakte_document(trainer=documents.kontaktperson_document("Quentin")),
            submitted_at="2126-02-20",
            schule=documents.new_schule_document("Neue"),
        )
    )
    database[Collection.ADDRESS_CHANGES].insert_one(
        documents.address_change_document(address=PERSON, email="pia.neu@example.com", token_hash=None, day="2126-02-20")
    )
    database[Collection.BAN_LIST].insert_one(documents.ban_document("gesperrt@example.com", until=NEXT_SAISON))


def _path_values(phase: Phase) -> dict[str, str]:
    """The value each path or query parameter of a read takes, all naming what the phase seeded."""

    (own_club, _, _), *_ = CLUBS

    return {
        "saison_id": SAISON,
        "spiel_id": str(phase.featured["_id"]),
        "team_id": str(own_club),
        "spieler_id": str(PERSON_SPIELER),
        "schiedsrichter_id": str(PERSON_SCHIEDSRICHTER),
        "spielort_id": str(SPIELORT),
        "spieltag_id": str(phase.featured["spieltag_id"]),
        "bewerbung_id": str(BEWERBUNG),
    }


GET_ROUTES = sorted((route for route in api_routes(application()) if "GET" in (route.methods or ())), key=lambda route: route.path)


def _headers(route: APIRoute) -> Mapping[str, str]:
    """The key and the session the route's guards ask for, read off its dependency tree."""

    calls = set(dependency_calls(route.dependant))
    if verify_access_system in calls:
        return SYSTEM_AUTH
    if verify_access_base in calls:
        return BASE_AUTH
    if verify_person_actor in calls:
        return StampedHeaders(PERSON, ADMIN_KEY, lane="person")
    if verify_admin_actor in calls:
        return ADMIN_AUTH
    if verify_access_admin in calls:
        return ADMIN_KEY
    return {}


def _required_queries(dependant: Dependant) -> Iterator[str]:
    """Each required query parameter of the tree, a parameter model's required fields opened, a dependency's own included."""

    for param in dependant.query_params:
        annotation = param.field_info.annotation
        if isinstance(annotation, type) and issubclass(annotation, BaseModel):
            yield from (name for name, field in annotation.model_fields.items() if field.is_required())
        elif param.field_info.is_required():
            yield param.name
    for sub in dependant.dependencies:
        yield from _required_queries(sub)


def _query(route: APIRoute, values: Mapping[str, str]) -> dict[str, str]:
    return {name: values[name] for name in _required_queries(route.dependant)}


def _path(route: APIRoute, values: Mapping[str, str]) -> str:
    return route.path_format.format(**{param.name: values[param.name] for param in route.dependant.path_params})


@functools.cache
def _served() -> FastAPI:
    return create_app(build_test_config())


@pytest.fixture(scope="module", params=list(PHASES), ids=list(PHASES))
def league(request: pytest.FixtureRequest, mongo_replica_set_url: str) -> Iterator[Phase]:
    phase = PHASES[request.param]
    database_name = build_test_config().db_base_name
    client = MongoClient(mongo_replica_set_url)
    try:
        _seed(a_clean_database_sync(client, mongo_replica_set_url, database_name), phase)
        with unwritten(mongo_replica_set_url, database_name):
            yield phase
    finally:
        client.close()


def _get(league: Phase, url: str, path: str, *, headers: Mapping[str, str], params: Mapping[str, str] | None = None) -> Any:
    async def asked() -> Any:
        async with app_client(url, app=_served(), now=league.now) as http:
            return await http.get(path, params=dict(params or {}), headers=dict(headers))

    return asyncio.run(asked())


def test_the_league_stands_in_the_phase_each_seed_names(league: Phase, mongo_replica_set_url: str):
    """The premise of every case below: a seed drifting out of its phase would leave the shape it stands for unread.

    The landing answers the phase's state, an opening match with both sides before the start; the editor of the
    featured fixture offers the clubs a knockout fixture's sides are picked from once the group is played.
    """

    landing = _get(league, mongo_replica_set_url, f"/api/v{API_VERSION}/saisons/landing", headers=BASE_AUTH).json()["saison"]
    editor = _get(league, mongo_replica_set_url, f"/api/v{API_VERSION}/spiele/{league.featured['_id']}/admin", headers=ADMIN_AUTH)

    assert landing["state"] == league.name
    if league.name == "before_start":
        opening = landing["opening_spiel"]
        assert opening is not None and opening["team1"] is not None and opening["team2"] is not None, landing
    else:
        assert editor.json()["teams"], editor.text


@pytest.mark.parametrize("route", GET_ROUTES, ids=lambda route: route.path)
def test_every_read_answers_the_league_in_this_phase(league: Phase, route: APIRoute, mongo_replica_set_url: str):
    values = _path_values(league)

    response = _get(league, mongo_replica_set_url, _path(route, values), headers=_headers(route), params=_query(route, values))

    assert response.is_success, f"GET {route.path} in the {league.name} phase answered {response.status_code}: {response.text}"
