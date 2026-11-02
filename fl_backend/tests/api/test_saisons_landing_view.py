from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.public_router import get_landing
from app.api.saisons.schemas import FLLandingKickoff
from app.api.spiele.schemas import FLSpielElfmeterschiessen, FLSpielJoined, FLSpielQuelleSpiel, FLSpielTeamFieldJoined
from app.api.spiele.services import podium_of
from app.core.collections import Collection
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop, shared_client
from tests.worker import worker_database

from .conftest import unwritten

RUNNING_DATABASE_NAME = worker_database("fl_saisons_landing_view_test")
BEFORE_START_DATABASE_NAME = worker_database("fl_saisons_landing_view_before_start_test")
DECIDED_DATABASE_NAME = worker_database("fl_saisons_landing_view_decided_test")
EMPTY_DATABASE_NAME = worker_database("fl_saisons_landing_view_empty_test")

SAISON, NEXT = "2026", "2027"
TODAY = "2026-03-05"
ALPHA, BETA = ObjectId("6890a1b2c3d4e5f607440001"), ObjectId("6890a1b2c3d4e5f607440002")
# A club that left the league before this season, its junction row and a live squad row still standing.
RETIRED = ObjectId("6890a1b2c3d4e5f607440003")
DAY_1, DAY_2 = ObjectId("6890a1b2c3d4e5f607440011"), ObjectId("6890a1b2c3d4e5f607440012")
FINALE_DAY = ObjectId("6890a1b2c3d4e5f607440013")

# Open today, and for the season after the one the site is on, which the frame withholds.
OPEN_WINDOW = {"offen": True, "von": "2026-03-01", "bis": "2026-03-31"}


def side(team_id: ObjectId, name: str, tore: int | None) -> dict[str, Any]:
    return {"team_id": team_id, "name": name, "shorthand": name[:3].upper(), "tore": tore}


def match(
    spiel_nr: int,
    spieltag_id: ObjectId,
    datum: str | None,
    tore: tuple[int, int] | None,
    *,
    uhrzeit: str | None = "14:00:00",
    names: tuple[str, str] = ("Alpha", "Beta"),
    saison_phase: str = "gruppenphase",
) -> dict[str, Any]:
    """Alpha against Beta unless `names` says otherwise, any other name a club of its own."""

    ids = {"Alpha": ALPHA, "Beta": BETA}
    home, away = (side(ids.get(name) or ObjectId(), name, None if tore is None else tore[index]) for index, name in enumerate(names))

    return documents.spiel_document(
        spiel_id=ObjectId(),
        saison_id=SAISON,
        spiel_nr=spiel_nr,
        spieltag_id=spieltag_id,
        saison_phase=saison_phase,
        team1=home,
        team2=away,
        datum=datum,
        uhrzeit=uhrzeit,
        ergebnis=None if tore is None else f"{tore[0]}:{tore[1]}",
    )


def spieltag(spieltag_id: ObjectId, position: int, saison_phase: str = "gruppenphase") -> dict[str, Any]:
    return {"_id": spieltag_id, "beginn": None, "ende": None, "position": position, "saison_phase": saison_phase, "saison_id": SAISON}


def seeded(url: str, database_name: str, collections: dict[str, list[dict[str, Any]]]) -> None:
    """The season the site is on beside the next one, which takes applications today, and these documents."""

    async def _seed() -> None:
        async with a_clean_database(url, database_name) as (_, database):
            await database[Collection.SAISONS].insert_many(
                [documents.saison_document(SAISON, "active"), documents.saison_document(NEXT, "future", bewerbung=dict(OPEN_WINDOW))]
            )
            for name, rows in collections.items():
                await database[name].insert_many(rows)

    on_the_seed_loop(_seed())


@pytest.fixture(scope="module")
def running_url(mongo_url: str) -> Iterator[str]:
    """A season under way: three matches played and three to come, so both lists hold more than they show.

    Three clubs, one of which left the league; seven goals, four of them away, in the three played.
    """

    seeded(
        mongo_url,
        RUNNING_DATABASE_NAME,
        {
            Collection.TEAMS: [
                documents.team_document(ALPHA, "Alpha", "ALP"),
                documents.team_document(BETA, "Beta", "BET"),
                documents.team_document(RETIRED, "Gamma", "GAM", inactive_since="2026-01-15"),
            ],
            Collection.SAISON_TEAMS: [
                documents.saison_team_document(SAISON, ALPHA, "Alpha", "ALP"),
                documents.saison_team_document(SAISON, BETA, "Beta", "BET"),
                documents.saison_team_document(SAISON, RETIRED, "Gamma", "GAM"),
            ],
            Collection.SPIELTAGE: [spieltag(DAY_1, 1), spieltag(DAY_2, 2)],
            # Inserted out of their order, so neither list can pass on the insertion order.
            Collection.SPIELE: [
                match(2, DAY_1, "2026-02-27", (0, 0)),
                match(5, DAY_2, "2026-03-15", None),
                match(1, DAY_1, "2026-02-20", (2, 1)),
                match(6, DAY_2, "2026-03-22", None),
                match(3, DAY_1, "2026-03-01", (1, 3)),
                match(4, DAY_2, "2026-03-08", None),
            ],
        },
    )

    with unwritten(mongo_url, RUNNING_DATABASE_NAME):
        yield mongo_url


async def landing_of(database: AsyncDatabase) -> Any:
    return await get_landing(
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        spieltage_collection=database[Collection.SPIELTAGE],
        teams_collection=database[Collection.TEAMS],
        today=TODAY,
    )


def landing(url: str, database_name: str) -> Any:
    return on_the_seed_loop(landing_of(shared_client(url)[database_name]))


@pytest.mark.db
def test_a_running_season_shows_its_latest_results_its_next_matches_and_its_figures(running_url: str):
    """The latest two results newest first and the next two soonest first; the retired club in no figure."""

    response = landing(running_url, RUNNING_DATABASE_NAME)
    saison = response.saison

    assert (saison.id, saison.state, saison.first_kickoff, saison.podium) == (SAISON, "running", None, [])
    assert ([spiel.spiel_nr for spiel in saison.recent], [spiel.spiel_nr for spiel in saison.upcoming]) == ([3, 2], [4, 5])
    assert saison.counts.model_dump() == {"count_teams": 2, "count_tore": 7, "count_spiele": 6, "count_spieltage": 2}
    assert [team.name for team in saison.teams] == ["Alpha", "Beta"]
    assert response.bewerbung_window.model_dump() == {"saison_id": NEXT, "von": "2026-03-01", "bis": "2026-03-31"}


@pytest.mark.db
def test_a_season_before_its_first_match_shows_when_it_kicks_off(mongo_url: str):
    """The opening day holds an untimed fixture beside two timed ones, which a null sorting ahead of every time would hide.

    Its Spieltag is the second, the first dated later, so the position served is the opening match's own; and the
    opening match fields Beta first, so neither side is read off another match.
    """

    seeded(
        mongo_url,
        BEFORE_START_DATABASE_NAME,
        {
            Collection.SPIELTAGE: [spieltag(DAY_1, 2), spieltag(DAY_2, 1)],
            Collection.SPIELE: [
                match(1, DAY_1, "2026-03-10", None, uhrzeit=None),
                match(2, DAY_1, "2026-03-10", None, uhrzeit="17:30:00"),
                match(3, DAY_1, "2026-03-10", None, uhrzeit="15:00:00", names=("Beta", "Alpha")),
                match(4, DAY_2, "2026-03-17", None, uhrzeit="10:00:00"),
                match(5, DAY_2, None, None, uhrzeit=None),
            ],
        },
    )

    saison = landing(mongo_url, BEFORE_START_DATABASE_NAME).saison

    assert (saison.state, saison.recent, saison.upcoming, saison.podium) == ("before_start", [], [], [])
    assert saison.first_kickoff.model_dump() == {
        "datum": "2026-03-10",
        "uhrzeit": "15:00:00",
        # Winter time in Berlin, an hour ahead of UTC.
        "anpfiff": datetime(2026, 3, 10, 14, 0, tzinfo=UTC),
        "spieltag_position": 2,
        "team1": {"team_id": str(BETA), "name": "Beta", "shorthand": "BET"},
        "team2": {"team_id": str(ALPHA), "name": "Alpha", "shorthand": "ALP"},
    }


@pytest.mark.parametrize(
    ("datum", "uhrzeit", "anpfiff"),
    [
        pytest.param("2026-07-04", "15:00:00", datetime(2026, 7, 4, 13, 0, tzinfo=UTC), id="summer time, two hours ahead of UTC"),
        pytest.param("2026-11-07", "15:00:00", datetime(2026, 11, 7, 14, 0, tzinfo=UTC), id="winter time, one hour ahead of UTC"),
        pytest.param("2026-07-04", None, None, id="no time set, so no instant to count down to"),
    ],
)
def test_the_kick_off_is_served_as_the_instant_berlin_wall_time_names(datum: str, uhrzeit: str | None, anpfiff: datetime | None):
    kickoff = FLLandingKickoff(datum=datum, uhrzeit=uhrzeit, spieltag_position=1, team1=None, team2=None)

    assert kickoff.anpfiff == anpfiff


@pytest.mark.db
def test_a_season_whose_final_is_played_shows_its_podium(mongo_url: str):
    """The match for third place and the final, read off the Finale's matchday through the joined shape the landing serves.

    Its goals count the Finale's beside the group phase's, as the season's own figure.
    """

    seeded(
        mongo_url,
        DECIDED_DATABASE_NAME,
        {
            Collection.SPIELTAGE: [spieltag(DAY_1, 1), spieltag(FINALE_DAY, 1, "finale")],
            Collection.SPIELE: [
                match(1, DAY_1, "2026-02-20", (2, 1)),
                match(2, FINALE_DAY, "2026-03-01", (0, 1), names=("Cara", "Dora"), saison_phase="finale"),
                match(3, FINALE_DAY, "2026-03-01", (2, 1), saison_phase="finale"),
            ],
        },
    )

    saison = landing(mongo_url, DECIDED_DATABASE_NAME).saison

    assert (saison.state, saison.recent, saison.upcoming) == ("decided", [], [])
    assert [(place.platz, place.name) for place in saison.podium] == [(1, "Alpha"), (2, "Beta"), (3, "Dora"), (4, "Cara")]
    assert saison.counts.count_tore == 7


@pytest.mark.db
def test_a_league_with_no_season_on_shows_none(mongo_url: str):
    """A fresh league whose first season is still being drawn up: the frontend shows the status page's empty state."""

    async def _seed() -> None:
        async with a_clean_database(mongo_url, EMPTY_DATABASE_NAME) as (_, database):
            await database[Collection.SAISONS].insert_one(documents.saison_document(NEXT, "future"))

    on_the_seed_loop(_seed())

    response = landing(mongo_url, EMPTY_DATABASE_NAME)

    assert (response.saison, response.bewerbung_window) == (None, None)


# The numbers the draw gives a bracket with semi-finals: theirs, then the match for third place, then the final.
THIRD_NR, FINAL_NR = 23, 24


def finale_match(
    team1: tuple[str, int | None],
    team2: tuple[str, int | None],
    *,
    third: bool,
    shootout: tuple[int, int] | None = None,
    cleared: bool = False,
) -> FLSpielJoined:
    """`cleared` is a slot an admin took over by clearing its source, which leaves the match its number alone."""

    def joined(name: str, tore: int | None) -> FLSpielTeamFieldJoined:
        return FLSpielTeamFieldJoined(team_id=ObjectId(), name=name, shorthand=name[:3].upper(), tore=tore, austritt_type=None)

    quelle = None if cleared else FLSpielQuelleSpiel(type="spiel", spiel_nr=21, ausgang="verlierer" if third else "sieger")
    return FLSpielJoined.model_construct(
        spiel_nr=THIRD_NR if third else FINAL_NR,
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
        pytest.param(
            [finale_match(("Alpha", 1), ("Beta", 0), third=False), finale_match(("Cara", 0), ("Dora", 1), third=True, cleared=True)],
            [(1, "Alpha"), (2, "Beta"), (3, "Dora"), (4, "Cara")],
            id="a match for third place whose sources were cleared by hand, read in any order",
        ),
    ],
)
def test_the_podium_places_each_pair_its_match_has_decided(finale: list[FLSpielJoined], places: list[tuple[int, str]]):
    assert [(platz, side.name) for platz, side in podium_of(finale)] == places
