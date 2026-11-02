import asyncio
import functools
from collections.abc import Iterator, Mapping
from typing import Any

import pytest
from bson import ObjectId
from fastapi import FastAPI
from httpx2 import Response
from pymongo.asynchronous.database import AsyncDatabase

from app.core.collections import Collection
from app.core.config import API_VERSION
from app.main import create_app
from tests import documents
from tests.app_client import app_client
from tests.config import BASE_AUTH
from tests.core.app_source import application
from tests.database import a_clean_database, on_the_seed_loop, shared_client
from tests.worker import worker_database

from .conftest import config_for, unwritten

DATABASE_NAME = worker_database("fl_saison_contents_visibility_test")

ARCHIVED = "2024"
RUNNING = "2025"
PLANNED = "2026"

STATUS_OF = {ARCHIVED: "past", RUNNING: "active", PLANNED: "future"}

# One group per season, so the club read back names the season the read resolved: the club document is
# season-independent and the junction row is not.
GRUPPE_OF = {ARCHIVED: "A", RUNNING: "B", PLANNED: "C"}

TEAM_OID = ObjectId("6890a1b2c3d4e5f607250001")
SPIELER_OID = ObjectId("6890a1b2c3d4e5f607250002")
# The club's opponent in the archived season's one played match, which only that season's figures count.
OPPONENT_OID = ObjectId("6890a1b2c3d4e5f607250003")

PREFIX = f"/api/v{API_VERSION}"


def an_id(kind: str, saison_id: str) -> ObjectId:
    """One id per document per season, so a failure names the same document every run."""

    return ObjectId(f"6890a1b2c3d4e5f6072{kind}{saison_id}")


def saison_document(saison_id: str) -> dict[str, Any]:
    return documents.saison_document(saison_id, STATUS_OF[saison_id])


def team_document() -> dict[str, Any]:
    """One club, entered in all three seasons: the same id has to read differently per season."""

    return documents.team_document(TEAM_OID, "Helmholtz", "HGX", full_name="Helmholtz-Gymnasium")


def junction_row(saison_id: str) -> dict[str, Any]:
    return documents.saison_team_document(saison_id, TEAM_OID, "Helmholtz", "HGX", gruppe=GRUPPE_OF[saison_id])


def spieler_document(spieler_id: ObjectId, vorname: str) -> dict[str, Any]:
    """A player of that club, holding a row in all three seasons.

    Consent passed, not defaulted: only a published, confirmed one serves the forename.
    """

    published = documents.own_einwilligung_document(text_version=documents.EINWILLIGUNG["text_version"], confirmed_at="2026-01-20")

    return documents.spieler_document(spieler_id, vorname, "Müller", einwilligung=published)


def squad_row(saison_id: str) -> dict[str, Any]:
    return documents.saison_spieler_document(SPIELER_OID, saison_id, TEAM_OID, _id=an_id("4", saison_id), nummer="7", stufe="Q3")


def spiel_document(saison_id: str) -> dict[str, Any]:
    """The archived season's match is a 2:0 win, which only that season's figures count."""

    won = saison_id == ARCHIVED

    return documents.spiel_document(
        spiel_id=an_id("2", saison_id),
        saison_id=saison_id,
        spiel_nr=1,
        spieltag_id=an_id("3", saison_id),
        team1={"team_id": TEAM_OID, "name": "Helmholtz", "shorthand": "HGX", "tore": 2 if won else None},
        team2={"team_id": OPPONENT_OID, "name": "Lessing", "shorthand": "LSX", "tore": 0} if won else None,
        ergebnis="2:0" if won else None,
        datum=f"{saison_id}-03-15",
        uhrzeit="14:00:00",
    )


def spieltag_document(saison_id: str) -> dict[str, Any]:
    return {
        "_id": an_id("3", saison_id),
        "beginn": f"{saison_id}-03-15",
        "ende": f"{saison_id}-03-15",
        "position": 1,
        "saison_phase": "gruppenphase",
        "saison_id": saison_id,
    }


# Module-scoped: every case below reads this corpus and none writes it, which `unwritten` keeps
# from being left as a claim.
@pytest.fixture(scope="module")
def seeded_league(mongo_replica_set_url: str) -> Iterator[str]:
    """Three seasons, one club entered in each, and a fixture, a matchday and squad rows per season."""

    async def _seed() -> None:
        async with a_clean_database(mongo_replica_set_url, DATABASE_NAME) as (_, database):
            await database[Collection.SAISONS].insert_many([saison_document(saison_id) for saison_id in STATUS_OF])
            await database[Collection.TEAMS].insert_one(team_document())
            await database[Collection.SAISON_TEAMS].insert_many([junction_row(saison_id) for saison_id in STATUS_OF])
            await database[Collection.SPIELE].insert_many([spiel_document(saison_id) for saison_id in STATUS_OF])
            await database[Collection.SPIELTAGE].insert_many([spieltag_document(saison_id) for saison_id in STATUS_OF])
            await database[Collection.SPIELER].insert_one(spieler_document(SPIELER_OID, "Maxim"))
            await database[Collection.SAISON_SPIELER].insert_many([squad_row(saison_id) for saison_id in STATUS_OF])

    on_the_seed_loop(_seed())

    with unwritten(mongo_replica_set_url, DATABASE_NAME):
        yield mongo_replica_set_url


@functools.cache
def _served() -> FastAPI:
    """One app for every request a case sends: building one costs more than the request."""

    return create_app(config_for(DATABASE_NAME))


def answered(url: str, path: str) -> Response:
    async def _answered() -> Response:
        async with app_client(url, app=_served()) as http:
            return await http.get(path, headers=BASE_AUTH)

    return asyncio.run(_answered())


# What fills each parameter a season-scoped read can take, for the season a case names: the season itself, or that
# season's own document of the kind the parameter names. A read taking any other parameter fails its case on the
# missing key, so a new read is filled here rather than passed over.
VALUE_OF: Mapping[str, Any] = {
    "saison_id": lambda saison_id: saison_id,
    "team_id": lambda _: TEAM_OID,
    "spiel_id": lambda saison_id: an_id("2", saison_id),
    "spieltag_id": lambda saison_id: an_id("3", saison_id),
}

# A path parameter naming one document of a season's contents, which a by-id read judges by that document's season.
SEASON_DOCUMENT_IDS = frozenset({"spiel_id", "spieltag_id"})

# The application reads name a `future` season by design: it is the one taking applications (`READ-BEWERBUNG-001`).
SERVES_A_PLANNED_SEASON = (f"{PREFIX}/bewerbungen/",)


def _season_scoped_reads() -> list[tuple[str, list[Mapping[str, Any]]]]:
    """Every base-tier GET naming a season or one of a season's documents, read off the document the app publishes."""

    reads: list[tuple[str, list[Mapping[str, Any]]]] = []
    for path, operations in application().openapi()["paths"].items():
        operation = operations.get("get")
        if operation is None or {"BaseKey": []} not in operation.get("security", []) or path.startswith(SERVES_A_PLANNED_SEASON):
            continue
        parameters = operation.get("parameters", [])
        if any(parameter["name"] == "saison_id" or parameter["name"] in SEASON_DOCUMENT_IDS for parameter in parameters):
            reads.append((path, parameters))

    return reads


SEASON_SCOPED_READS = _season_scoped_reads()


def request_for(path: str, parameters: list[Mapping[str, Any]], saison_id: str) -> str:
    """The request naming this season: each path parameter and every required query one filled, and `saison_id` always."""

    filled = {parameter["name"]: VALUE_OF[parameter["name"]](saison_id) for parameter in parameters if parameter["in"] == "path"}
    query = [
        f"{parameter['name']}={VALUE_OF[parameter['name']](saison_id)}"
        for parameter in parameters
        if parameter["in"] == "query" and (parameter.get("required") or parameter["name"] == "saison_id")
    ]

    return path.format(**filled) + (f"?{'&'.join(query)}" if query else "")


@pytest.mark.parametrize(("path", "parameters"), SEASON_SCOPED_READS, ids=[path for path, _ in SEASON_SCOPED_READS])
@pytest.mark.db
class TestEveryReadScopedByASeasonResolvesIt:
    """`app/api/saisons/visibility.py :: resolve_public_saison` makes the refusal; these hold each read to calling it."""

    def test_the_planned_season_misses(self, path: str, parameters: list[Mapping[str, Any]], seeded_league: str):
        response = answered(seeded_league, request_for(path, parameters, PLANNED))

        assert response.status_code == 404, response.text

    @pytest.mark.parametrize("saison_id", [ARCHIVED, RUNNING])
    def test_a_readable_season_is_served(self, path: str, parameters: list[Mapping[str, Any]], saison_id: str, seeded_league: str):
        """The control: a read that refused every season would pass the case above."""

        response = answered(seeded_league, request_for(path, parameters, saison_id))

        assert response.status_code == 200, response.text


def test_the_inventory_is_read_off_the_app():
    """Not empty, so a security scheme or a parameter renamed past these filters cannot pass by matching nothing."""

    assert {f"{PREFIX}/saisons/{{saison_id}}/spiele/{{spiel_id}}", f"{PREFIX}/spiele/{{spiel_id}}"} <= {path for path, _ in SEASON_SCOPED_READS}


@pytest.mark.db
def test_a_match_of_another_season_misses_on_the_season_s_match_page(seeded_league: str):
    """The match page names its season in the path; a readable season with another season's match id holds no such match."""

    response = answered(seeded_league, f"{PREFIX}/saisons/{RUNNING}/spiele/{an_id('2', ARCHIVED)}")

    assert response.status_code == 404, response.text


@pytest.mark.db
def test_one_club_in_a_past_season_is_served_as_that_season(seeded_league: str):
    """Its group and its figures are that season's: the archived season's group and its one win."""

    def served(saison_id: str) -> tuple[str, int]:
        team = answered(seeded_league, f"{PREFIX}/teams/{TEAM_OID}?saison_id={saison_id}").json()["team"]

        return team["gruppe"], team["statistik"]["punkte"]

    assert (served(ARCHIVED), served(RUNNING)) == ((GRUPPE_OF[ARCHIVED], 3), (GRUPPE_OF[RUNNING], 0))


@pytest.mark.db
def test_the_planned_season_holds_what_every_read_above_withheld(seeded_league: str):
    """What makes the refusals mean something: each collection really holds the planned season's document."""

    async def body() -> dict[str, int]:
        database: AsyncDatabase = shared_client(seeded_league)[DATABASE_NAME]
        collections = (Collection.SAISON_TEAMS, Collection.SPIELE, Collection.SPIELTAGE, Collection.SAISON_SPIELER)
        return {name: await database[name].count_documents({"saison_id": PLANNED}) for name in collections}

    assert all(on_the_seed_loop(body()).values())
