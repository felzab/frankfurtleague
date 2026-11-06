from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.public_router import get_landing
from app.api.saisons.schemas import FLLandingDecided
from app.api.spiele.schemas import FLSpielElfmeterschiessen, FLSpielJoinedInternal, FLSpielTeamFieldJoinedInternal
from app.api.spiele.services import podium_of
from app.api.teams.schemas import FLAustritt
from app.core.collections import Collection
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop, shared_client
from tests.worker import worker_database

VACATED_DATABASE_NAME = worker_database("fl_saisons_landing_view_vacated_test")

SAISON = "2026"
TODAY = "2026-03-05"
ALPHA, BETA = ObjectId("6890a1b2c3d4e5f607440001"), ObjectId("6890a1b2c3d4e5f607440002")
DORA = ObjectId("6890a1b2c3d4e5f607440005")
FINALE_DAY = ObjectId("6890a1b2c3d4e5f607440013")


def side(team_id: ObjectId, tore: int | None) -> dict[str, Any]:
    return {"team_id": team_id, "tore": tore}


def match(
    spiel_nr: int,
    spieltag_id: ObjectId,
    date: str | None,
    tore: tuple[int, int] | None,
    *,
    names: tuple[str, str] = ("Alpha", "Beta"),
    saison_phase: str = "gruppenphase",
) -> dict[str, Any]:
    """Alpha against Beta unless `names` says otherwise, any other name a club of its own."""

    ids = {"Alpha": ALPHA, "Beta": BETA, "Dora": DORA}
    home, away = (side(ids.get(name) or ObjectId(), None if tore is None else tore[index]) for index, name in enumerate(names))

    return documents.spiel_document(
        spiel_id=ObjectId(),
        saison_id=SAISON,
        spiel_nr=spiel_nr,
        spieltag_id=spieltag_id,
        saison_phase=saison_phase,
        team1=home,
        team2=away,
        date=date,
        time="14:00:00",
        ergebnis=None if tore is None else f"{tore[0]}:{tore[1]}",
    )


def spieltag(spieltag_id: ObjectId, position: int, saison_phase: str = "gruppenphase") -> dict[str, Any]:
    return {"_id": spieltag_id, "start": None, "end": None, "position": position, "saison_phase": saison_phase, "saison_id": SAISON}


def seeded(url: str, database_name: str, collections: dict[str, list[dict[str, Any]]]) -> None:
    """The season the site is on, and these documents."""

    async def _seed() -> None:
        async with a_clean_database(url, database_name) as (_, database):
            await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON, "active", start_date="2026-01-01"))
            for name, rows in collections.items():
                await database[name].insert_many(rows)

    on_the_seed_loop(_seed())


async def landing_of(database: AsyncDatabase) -> Any:
    return await get_landing(
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        teams_collection=database[Collection.TEAMS],
        today=TODAY,
    )


def landing(url: str, database_name: str) -> Any:
    return on_the_seed_loop(landing_of(shared_client(url)[database_name]))


@pytest.mark.db
def test_a_place_decided_after_its_club_left_is_served_vacant_and_the_season_decided(mongo_url: str):
    """Cara left the season the day before the match for third place, which it lost: fourth is in, and nobody's."""

    cara = ObjectId("6890a1b2c3d4e5f607440004")
    seeded(
        mongo_url,
        VACATED_DATABASE_NAME,
        {
            Collection.SAISON_TEAMS: [
                *(
                    documents.saison_team_document(SAISON, team_id, name, name[:3].upper())
                    for team_id, name in ((ALPHA, "Alpha"), (BETA, "Beta"), (DORA, "Dora"))
                ),
                documents.saison_team_document(
                    SAISON, cara, "Cara", "CAR", austritt={"type": "disqualifikation", "reason": "Ausgeschlossen", "date": "2026-02-28"}
                ),
            ],
            Collection.SPIELTAGE: [spieltag(FINALE_DAY, 1, "finale")],
            Collection.SPIELE: [
                {**match(2, FINALE_DAY, "2026-03-01", (0, 3), names=("Cara", "Dora"), saison_phase="finale"), "team1": side(cara, 0)},
                match(3, FINALE_DAY, "2026-03-01", (2, 1), saison_phase="finale"),
            ],
        },
    )

    saison = landing(mongo_url, VACATED_DATABASE_NAME).saison

    assert type(saison) is FLLandingDecided
    assert [place and place.name for place in saison.podium] == ["Alpha", "Beta", "Dora", None]


# The numbers the draw gives a bracket with semi-finals: theirs, then the match for third place, then the final.
THIRD_NR, FINAL_NR = 23, 24
# The day both Finale matches are played on, the one an exit is ordered against.
MATCH_DAY = "2026-06-20"


def finale_match(
    team1: tuple[str, int | None],
    team2: tuple[str, int | None],
    *,
    third: bool,
    shootout: tuple[int, int] | None = None,
    left: dict[str, str] | None = None,
) -> FLSpielJoinedInternal:
    """`third` is the read's mark; `left` names a club by name and the day it left the season; every match is played on `MATCH_DAY`."""

    def joined(name: str, tore: int | None) -> FLSpielTeamFieldJoinedInternal:
        austritt = None if left is None or name not in left else FLAustritt(type="disqualifikation", reason="Ausgeschlossen", date=left[name])
        return FLSpielTeamFieldJoinedInternal(
            team_id=ObjectId(), name=name, shorthand=name[:3].upper(), tore=tore, austritt_type=austritt and austritt.type, austritt=austritt
        )

    return FLSpielJoinedInternal.model_construct(
        date=MATCH_DAY,
        spiel_nr=THIRD_NR if third else FINAL_NR,
        for_third_place=third,
        team1=joined(*team1),
        team2=joined(*team2),
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
            [finale_match(("Alpha", 1), ("Beta", 0), third=False), finale_match(("Cara", 0), ("Dora", 1), third=True)],
            [(1, "Alpha"), (2, "Beta"), (3, "Dora"), (4, "Cara")],
            id="the Finale's two read in either order",
        ),
        pytest.param(
            [
                finale_match(("Cara", 0), ("Dora", 3), third=True, left={"Cara": MATCH_DAY}),
                finale_match(("Alpha", 1), ("Beta", 0), third=False),
            ],
            [(1, "Alpha"), (2, "Beta"), (3, "Dora"), (4, None)],
            id="a club that left on the match's day leaves its place vacant",
        ),
        pytest.param(
            [
                finale_match(("Cara", 0), ("Dora", 3), third=True, left={"Cara": "2026-06-21"}),
                finale_match(("Alpha", 1), ("Beta", 0), third=False),
            ],
            [(1, "Alpha"), (2, "Beta"), (3, "Dora"), (4, "Cara")],
            id="a club that left the day after keeps it",
        ),
    ],
)
def test_the_podium_places_each_pair_its_match_has_decided(finale: list[FLSpielJoinedInternal], places: list[tuple[int, str | None]]):
    assert [(platz, side and side.name) for platz, side in podium_of(finale)] == places
