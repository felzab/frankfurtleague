from collections.abc import Iterator
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.public_router import get_landing
from app.api.spiele.schemas import FLSpielElfmeterschiessen, FLSpielJoined, FLSpielQuelleSpiel, FLSpielTeamFieldJoined
from app.api.spiele.services import podium_of
from app.core.collections import Collection
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop, shared_client
from tests.worker import worker_database

from .conftest import unwritten

RUNNING_DATABASE_NAME = worker_database("fl_saisons_landing_view_test")
EMPTY_DATABASE_NAME = worker_database("fl_saisons_landing_view_empty_test")

SAISON, NEXT = "2026", "2027"
TODAY = "2026-03-05"
ALPHA, BETA = ObjectId("6890a1b2c3d4e5f607440001"), ObjectId("6890a1b2c3d4e5f607440002")
DAY_1, DAY_2 = ObjectId("6890a1b2c3d4e5f607440011"), ObjectId("6890a1b2c3d4e5f607440012")

# Open today, and for the season after the one the site is on, which the frame withholds.
OPEN_WINDOW = {"offen": True, "von": "2026-03-01", "bis": "2026-03-31"}


def side(team_id: ObjectId, name: str, tore: int | None) -> dict[str, Any]:
    return {"team_id": team_id, "name": name, "shorthand": name[:3].upper(), "tore": tore}


def match(spiel_nr: int, spieltag_id: ObjectId, datum: str, tore: tuple[int, int] | None) -> dict[str, Any]:
    return documents.spiel_document(
        spiel_id=ObjectId(),
        saison_id=SAISON,
        spiel_nr=spiel_nr,
        spieltag_id=spieltag_id,
        team1=side(ALPHA, "Alpha", None if tore is None else tore[0]),
        team2=side(BETA, "Beta", None if tore is None else tore[1]),
        datum=datum,
        uhrzeit="14:00:00",
        ergebnis=None if tore is None else f"{tore[0]}:{tore[1]}",
    )


def spieltag(spieltag_id: ObjectId, position: int) -> dict[str, Any]:
    return {"_id": spieltag_id, "beginn": None, "ende": None, "position": position, "saison_phase": "gruppenphase", "saison_id": SAISON}


@pytest.fixture(scope="module")
def running_url(mongo_url: str) -> Iterator[str]:
    """A season under way: one match played, one to come; two clubs, one live squad row and one ausgetragen."""

    async def _seed() -> None:
        async with a_clean_database(mongo_url, RUNNING_DATABASE_NAME) as (_, database):
            await database[Collection.SAISONS].insert_many(
                [documents.saison_document(SAISON, "active"), documents.saison_document(NEXT, "future", bewerbung=dict(OPEN_WINDOW))]
            )
            await database[Collection.TEAMS].insert_many(
                [documents.team_document(ALPHA, "Alpha", "ALP"), documents.team_document(BETA, "Beta", "BET")]
            )
            await database[Collection.SAISON_TEAMS].insert_many(
                [documents.saison_team_document(SAISON, ALPHA, "Alpha", "ALP"), documents.saison_team_document(SAISON, BETA, "Beta", "BET")]
            )
            await database[Collection.SPIELTAGE].insert_many([spieltag(DAY_1, 1), spieltag(DAY_2, 2)])
            await database[Collection.SPIELE].insert_many([match(1, DAY_1, "2026-03-01", (2, 1)), match(2, DAY_2, "2026-03-08", None)])
            await database[Collection.SAISON_SPIELER].insert_many(
                [
                    documents.saison_spieler_document(ObjectId(), SAISON, ALPHA),
                    documents.saison_spieler_document(ObjectId(), SAISON, BETA, inactive_since="2026-02-01"),
                ]
            )

    on_the_seed_loop(_seed())

    with unwritten(mongo_url, RUNNING_DATABASE_NAME):
        yield mongo_url


def landing(url: str, database_name: str) -> Any:
    async def _run() -> Any:
        database: AsyncDatabase = shared_client(url)[database_name]
        return await get_landing(
            saisons_collection=database[Collection.SAISONS],
            spiele_collection=database[Collection.SPIELE],
            spieltage_collection=database[Collection.SPIELTAGE],
            teams_collection=database[Collection.TEAMS],
            saison_spieler_collection=database[Collection.SAISON_SPIELER],
            today=TODAY,
        )

    return on_the_seed_loop(_run())


@pytest.mark.db
def test_a_running_season_shows_its_latest_result_its_next_match_and_its_figures(running_url: str):
    response = landing(running_url, RUNNING_DATABASE_NAME)
    saison = response.saison

    assert (saison.id, saison.state, saison.first_kickoff, saison.podium) == (SAISON, "running", None, [])
    assert ([spiel.spiel_nr for spiel in saison.recent], [spiel.spiel_nr for spiel in saison.upcoming]) == ([1], [2])
    assert saison.counts.model_dump() == {"count_teams": 2, "count_spieler": 1, "count_spiele": 2, "count_spieltage": 2}
    assert [team.name for team in saison.teams] == ["Alpha", "Beta"]
    assert response.application_window.model_dump() == {"saison_id": NEXT, "von": "2026-03-01", "bis": "2026-03-31"}


@pytest.mark.db
def test_a_league_with_no_season_on_shows_none(mongo_url: str):
    """A fresh league whose first season is still being drawn up: the frontend shows the status page's empty state."""

    async def _seed() -> None:
        async with a_clean_database(mongo_url, EMPTY_DATABASE_NAME) as (_, database):
            await database[Collection.SAISONS].insert_one(documents.saison_document(NEXT, "future"))

    on_the_seed_loop(_seed())

    response = landing(mongo_url, EMPTY_DATABASE_NAME)

    assert (response.saison, response.application_window) == (None, None)


def finale_match(
    team1: tuple[str, int | None], team2: tuple[str, int | None], *, third: bool, shootout: tuple[int, int] | None = None
) -> FLSpielJoined:
    def joined(name: str, tore: int | None) -> FLSpielTeamFieldJoined:
        return FLSpielTeamFieldJoined(team_id=ObjectId(), name=name, shorthand=name[:3].upper(), tore=tore, austritt_type=None)

    quelle = FLSpielQuelleSpiel(type="spiel", spiel_nr=1, ausgang="verlierer" if third else "sieger")
    return FLSpielJoined.model_construct(
        team1=joined(*team1),
        team2=joined(*team2),
        team1_quelle=quelle,
        team2_quelle=quelle,
        elfmeterschiessen=None if shootout is None else FLSpielElfmeterschiessen(team1=shootout[0], team2=shootout[1]),
    )


@pytest.mark.parametrize(
    ("finale", "places"),
    [
        pytest.param(
            [finale_match(("Cara", 0), ("Dora", 1), third=True), finale_match(("Alpha", 2), ("Beta", 2), third=False, shootout=(3, 4))],
            [(1, "Beta"), (2, "Alpha"), (3, "Dora"), (4, "Cara")],
            id="the final by its shoot-out, third place by its goals",
        ),
        pytest.param(
            [finale_match(("Cara", None), ("Dora", None), third=True), finale_match(("Alpha", 1), ("Beta", 0), third=False)],
            [(1, "Alpha"), (2, "Beta")],
            id="third place still to play",
        ),
        pytest.param([finale_match(("Alpha", 1), ("Beta", 1), third=False)], [], id="a level final with no shoot-out names nobody"),
    ],
)
def test_the_podium_places_each_pair_its_match_has_decided(finale: list[FLSpielJoined], places: list[tuple[int, str]]):
    assert [(platz, side.name) for platz, side in podium_of(finale)] == places
