from collections.abc import Awaitable, Callable, Iterator
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.spiele.public_router import get_spiel, get_spiele
from app.api.spiele.schemas import FLSpieleFilterParams
from app.api.spieler.public_router import get_spieler
from app.api.spieler.schemas import FLSpielerFilterParams
from app.api.spieltage.public_router import get_spieltag, get_spieltage
from app.api.spieltage.schemas import FLSpieltageFilterParams
from app.api.teams.public_router import get_team, get_teams
from app.api.teams.schemas import FLTeamsFilterParams, FLTeamSingleFilterParams
from app.core.collections import Collection
from app.core.exceptions import DocumentNotFoundError
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop, shared_client
from tests.worker import worker_database

from .conftest import unwritten

DATABASE_NAME = worker_database("fl_saison_contents_visibility_test")

ARCHIVED = "2024"
RUNNING = "2025"
PLANNED = "2026"

STATUS_OF = {ARCHIVED: "past", RUNNING: "active", PLANNED: "future"}

# `get_spiele` takes the day as an argument; only `spiel_status` reads it, and no test here sets one.
TODAY = "2026-03-20"

TEAM_OID = ObjectId("6890a1b2c3d4e5f607250001")
SPIELER_OID = ObjectId("6890a1b2c3d4e5f607250002")
SPIELER_VORNAME = "Maxim"


def an_id(kind: str, saison_id: str) -> ObjectId:
    """One id per document per season, so a failure names the same document every run."""

    return ObjectId(f"6890a1b2c3d4e5f6072{kind}{saison_id}")


def saison_document(saison_id: str) -> dict[str, Any]:
    return documents.saison_document(saison_id, STATUS_OF[saison_id])


def team_document() -> dict[str, Any]:
    """One club, entered in all three seasons: the same id has to read differently per season."""

    return documents.team_document(TEAM_OID, "Helmholtz", "HGX", full_name="Helmholtz-Gymnasium")


def junction_row(saison_id: str) -> dict[str, Any]:
    return documents.saison_team_document(saison_id, TEAM_OID, "Helmholtz", "HGX", gruppe="A")


def spieler_document(spieler_id: ObjectId, vorname: str) -> dict[str, Any]:
    """A player of that club, holding a row in all three seasons.

    Consent passed, not defaulted: only a published, confirmed one serves the forename.
    """

    published = documents.own_einwilligung_document(text_version=documents.EINWILLIGUNG["text_version"], confirmed_at="2026-01-20")

    return documents.spieler_document(spieler_id, vorname, "Müller", einwilligung=published)


def squad_row(saison_id: str) -> dict[str, Any]:
    return documents.saison_spieler_document(SPIELER_OID, saison_id, TEAM_OID, _id=an_id("4", saison_id), nummer="7", stufe="Q3")


def spiel_document(saison_id: str) -> dict[str, Any]:
    return documents.spiel_document(
        spiel_id=an_id("2", saison_id),
        saison_id=saison_id,
        spiel_nr=1,
        spieltag_id=an_id("3", saison_id),
        team1={"team_id": TEAM_OID, "name": "Helmholtz", "shorthand": "HGX", "tore": None},
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


Body = Callable[[AsyncDatabase], Awaitable[Any]]


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
            await database[Collection.SPIELER].insert_one(spieler_document(SPIELER_OID, SPIELER_VORNAME))
            await database[Collection.SAISON_SPIELER].insert_many([squad_row(saison_id) for saison_id in STATUS_OF])

    on_the_seed_loop(_seed())

    with unwritten(mongo_replica_set_url, DATABASE_NAME):
        yield mongo_replica_set_url


def on_a_league(url: str, body: Body) -> Any:
    async def _run() -> Any:
        return await body(shared_client(url)[DATABASE_NAME])

    return on_the_seed_loop(_run())


def raised_by(url: str, body: Body) -> DocumentNotFoundError:
    """The refusal a read answered with, so a test asserts on its status rather than only that it refused."""

    async def _catching(database: AsyncDatabase) -> DocumentNotFoundError:
        with pytest.raises(DocumentNotFoundError) as refusal:
            await body(database)

        return refusal.value

    return on_a_league(url, _catching)


async def read_teams(database: AsyncDatabase, saison_id: str | None) -> Any:
    return await get_teams(
        teams_collection=database[Collection.TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        filters=FLTeamsFilterParams(saison_id=saison_id),
    )


async def read_team(database: AsyncDatabase, saison_id: str | None) -> Any:
    return await get_team(
        team_id=TEAM_OID,
        teams_collection=database[Collection.TEAMS],
        saisons_collection=database[Collection.SAISONS],
        filters=FLTeamSingleFilterParams(saison_id=saison_id),
    )


async def read_spieler(database: AsyncDatabase, saison_id: str | None) -> Any:
    return await get_spieler(
        spieler_collection=database[Collection.SPIELER],
        saisons_collection=database[Collection.SAISONS],
        filters=FLSpielerFilterParams(saison_id=saison_id, team_id=TEAM_OID),
    )


async def read_spiele(database: AsyncDatabase, saison_id: str | None) -> Any:
    return await get_spiele(
        spiele_collection=database[Collection.SPIELE],
        saisons_collection=database[Collection.SAISONS],
        filters=FLSpieleFilterParams(saison_id=saison_id),
        today=TODAY,
    )


async def read_spiel(database: AsyncDatabase, saison_id: str) -> Any:
    return await get_spiel(
        spiel_id=an_id("2", saison_id),
        spiele_collection=database[Collection.SPIELE],
        saisons_collection=database[Collection.SAISONS],
    )


async def read_spieltage(database: AsyncDatabase, saison_id: str | None) -> Any:
    return await get_spieltage(
        spieltage_collection=database[Collection.SPIELTAGE],
        saisons_collection=database[Collection.SAISONS],
        filters=FLSpieltageFilterParams(saison_id=saison_id),
    )


async def read_spieltag(database: AsyncDatabase, saison_id: str) -> Any:
    return await get_spieltag(
        spieltag_id=an_id("3", saison_id),
        spieltage_collection=database[Collection.SPIELTAGE],
        saisons_collection=database[Collection.SAISONS],
    )


# Every base-tier read scoped by one season, each answering for the season it is handed: a list
# names it, a by-id read is handed that season's document and judges its own.
SEASON_SCOPED_READS: dict[str, Callable[[AsyncDatabase, str], Awaitable[Any]]] = {
    "the squads": read_teams,
    "one club's figures": read_team,
    "the fixtures": read_spiele,
    "one fixture": read_spiel,
    "the matchdays": read_spieltage,
    "one matchday": read_spieltag,
    "one club's squad": read_spieler,
}


@pytest.mark.db
@pytest.mark.parametrize("read", SEASON_SCOPED_READS.values(), ids=SEASON_SCOPED_READS.keys())
class TestEveryReadScopedByASeasonResolvesIt:
    """`app/api/saisons/visibility.py :: resolve_public_saison` makes the refusal; these hold each read to calling it."""

    def test_the_planned_season_misses(self, read: Callable[[AsyncDatabase, str], Awaitable[Any]], seeded_league: str):
        assert raised_by(seeded_league, lambda database: read(database, PLANNED)).status_code == 404

    def test_a_readable_season_is_served(self, read: Callable[[AsyncDatabase, str], Awaitable[Any]], seeded_league: str):
        """The control: a read that refused every season would pass the case above."""

        assert on_a_league(seeded_league, lambda database: read(database, RUNNING)) is not None


@pytest.mark.db
def test_the_planned_season_holds_what_every_read_above_withheld(seeded_league: str):
    """What makes the refusals mean something: each collection really holds the planned season's document."""

    async def body(database: AsyncDatabase) -> dict[str, int]:
        collections = (Collection.SAISON_TEAMS, Collection.SPIELE, Collection.SPIELTAGE, Collection.SAISON_SPIELER)
        return {name: await database[name].count_documents({"saison_id": PLANNED}) for name in collections}

    assert all(on_a_league(seeded_league, body).values())
