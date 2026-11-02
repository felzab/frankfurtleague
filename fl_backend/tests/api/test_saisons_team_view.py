from collections.abc import Awaitable, Callable, Iterator
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.public_router import get_team, get_teams
from app.core.collections import Collection
from app.core.exceptions import DocumentNotFoundError
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop, shared_client
from tests.worker import worker_database

from .conftest import unwritten

DATABASE_NAME = worker_database("fl_saisons_team_view_test")

SAISON = "2026"
EARLIER = "2025"
SPIELTAG = ObjectId("6890a1b2c3d4e5f607420001")
CLUBS = {name: ObjectId(f"6890a1b2c3d4e5f60742010{index}") for index, name in enumerate(("Alpha", "Beta", "Delta", "Gamma"))}

DISQUALIFIED = {"type": "disqualifikation", "grund": "Nicht angetreten", "datum": "2026-03-01"}


def side(name: str, tore: int | None) -> dict[str, Any]:
    return {"team_id": CLUBS[name], "name": name, "shorthand": name[:3].upper(), "tore": tore}


def spiel(spiel_nr: int, home: str, away: str, ergebnis: str | None = None) -> dict[str, Any]:
    goals = (None, None) if ergebnis is None else tuple(int(count) for count in ergebnis.split(":"))
    return documents.spiel_document(
        spiel_id=ObjectId(),
        saison_id=SAISON,
        spiel_nr=spiel_nr,
        spieltag_id=SPIELTAG,
        team1=side(home, goals[0]),
        team2=side(away, goals[1]),
        ergebnis=ergebnis,
    )


def pupil(vorname: str) -> dict[str, Any]:
    published = documents.own_einwilligung_document(text_version=documents.EINWILLIGUNG["text_version"], confirmed_at="2026-01-20")
    return documents.spieler_document(ObjectId(), vorname, "Müller", einwilligung=published)


@pytest.fixture(scope="module")
def seeded_url(mongo_url: str) -> Iterator[str]:
    """One group of three this season, the second disqualified; a fourth club entered last season alone."""

    maxim, nadja = pupil("Maxim"), pupil("Nadja")

    async def _seed() -> None:
        async with a_clean_database(mongo_url, DATABASE_NAME) as (_, database):
            await database[Collection.SAISONS].insert_many(
                [documents.saison_document(SAISON, "active"), documents.saison_document(EARLIER, "past")]
            )
            await database[Collection.TEAMS].insert_many([documents.team_document(oid, name, name[:3].upper()) for name, oid in CLUBS.items()])
            await database[Collection.SAISON_TEAMS].insert_many(
                [
                    documents.saison_team_document(SAISON, CLUBS["Alpha"], "Alpha", "ALP"),
                    documents.saison_team_document(SAISON, CLUBS["Beta"], "Beta", "BET", austritt=dict(DISQUALIFIED)),
                    documents.saison_team_document(SAISON, CLUBS["Delta"], "Delta", "DEL"),
                    documents.saison_team_document(EARLIER, CLUBS["Gamma"], "Gamma", "GAM"),
                ]
            )
            await database[Collection.SPIELTAGE].insert_one(
                {"_id": SPIELTAG, "beginn": None, "ende": None, "position": 2, "saison_phase": "gruppenphase", "saison_id": SAISON}
            )
            await database[Collection.SPIELE].insert_many(
                [spiel(1, "Alpha", "Beta", "2:1"), spiel(2, "Beta", "Delta", "0:1"), spiel(3, "Delta", "Alpha")]
            )
            await database[Collection.SPIELER].insert_many([maxim, nadja])
            await database[Collection.SAISON_SPIELER].insert_many(
                [
                    documents.saison_spieler_document(maxim["_id"], SAISON, CLUBS["Alpha"], nummer="7", stufe="Q3"),
                    documents.saison_spieler_document(nadja["_id"], SAISON, CLUBS["Delta"], nummer="9", stufe="Q3"),
                ]
            )

    on_the_seed_loop(_seed())

    with unwritten(mongo_url, DATABASE_NAME):
        yield mongo_url


def on_a_league(url: str, body: Callable[[AsyncDatabase], Awaitable[Any]]) -> Any:
    async def _run() -> Any:
        return await body(shared_client(url)[DATABASE_NAME])

    return on_the_seed_loop(_run())


def page_of(club: str) -> Callable[[AsyncDatabase], Awaitable[Any]]:
    async def body(database: AsyncDatabase) -> Any:
        return await get_team(
            saison_id=SAISON,
            team_id=CLUBS[club],
            saisons_collection=database[Collection.SAISONS],
            teams_collection=database[Collection.TEAMS],
            spiele_collection=database[Collection.SPIELE],
            saison_spieler_collection=database[Collection.SAISON_SPIELER],
        )

    return body


@pytest.mark.db
def test_the_teams_page_lists_the_season_s_clubs_by_name_each_departure_marked(seeded_url: str):
    async def body(database: AsyncDatabase) -> Any:
        return await get_teams(saison_id=SAISON, saisons_collection=database[Collection.SAISONS], teams_collection=database[Collection.TEAMS])

    response = on_a_league(seeded_url, body)

    assert [(team.name, team.austritt_type) for team in response.teams] == [("Alpha", None), ("Beta", "disqualifikation"), ("Delta", None)]


@pytest.mark.db
def test_the_club_page_holds_its_own_row_matches_and_squad(seeded_url: str):
    response = on_a_league(seeded_url, page_of("Delta"))

    assert response.standing is not None
    assert (response.team.name, response.standing.id, response.standing.platz) == ("Delta", CLUBS["Delta"], 2)
    assert [(match.spiel_nr, match.spieltag_position) for match in response.spiele] == [(2, 2), (3, 2)]
    assert [row.vorname for row in response.kader] == ["Nadja"]


@pytest.mark.db
def test_a_club_the_season_does_not_hold_has_no_page_in_it(seeded_url: str):
    async def body(database: AsyncDatabase) -> Any:
        with pytest.raises(DocumentNotFoundError) as refusal:
            await page_of("Gamma")(database)

        return refusal.value

    assert on_a_league(seeded_url, body).status_code == 404
