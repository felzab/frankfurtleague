from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.admin_router import get_saison_admin, swap_gruppen
from app.api.saisons.schemas import FLSaisonAdminResponse, FLSwapGruppenPayload
from app.api.teams.admin_router import replace_saison_team
from app.api.teams.schemas import FLReplaceSaisonTeamPayload
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import saison_document, saison_team_document, spiel_document, team_document
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_saison_admin_read_test")

SAISON_ID = "2026"
# The day both writes and the read judge on, before the season's start, so the start lock answers none of them.
TODAY, START = "2026-03-01", "2026-03-02"
NOW = datetime(2026, 3, 1, 12, 0, tzinfo=ZoneInfo("Europe/Berlin"))

# Fixed rather than generated, so a failure names the same club every run.
A1, A2, A3 = ObjectId("6890a1b2c3d4e5f607330001"), ObjectId("6890a1b2c3d4e5f607330002"), ObjectId("6890a1b2c3d4e5f607330003")
B1, B2 = ObjectId("6890a1b2c3d4e5f607330011"), ObjectId("6890a1b2c3d4e5f607330012")
INCOMING = ObjectId("6890a1b2c3d4e5f607330021")
RETIRED = ObjectId("6890a1b2c3d4e5f607330022")
NAMES = {A1: "Aachen", A2: "Bonn", A3: "Celle", B1: "Dessau", B2: "Essen", INCOMING: "Fulda", RETIRED: "Gera"}
GRUPPE = {A1: "A", A2: "A", A3: "A", B1: "B", B2: "B"}
SPIELTAG = ObjectId("6890a1b2c3d4e5f607330031")


def side(team_id: ObjectId, tore: int | None = None) -> dict[str, Any]:
    return {"team_id": team_id, "name": NAMES[team_id], "shorthand": NAMES[team_id][:3].upper(), "tore": tore}


# A1 and A2 have played their group fixture; A3's is still to come, as is group B's; B1 holds a hand-set knockout
# result, a fixture the replacement hands over and the swap never rewrites.
SPIELE = [
    spiel_document(
        spiel_id=ObjectId(), saison_id=SAISON_ID, spiel_nr=1, spieltag_id=SPIELTAG, team1=side(A1, 2), team2=side(A2, 1), ergebnis="2:1"
    ),
    spiel_document(spiel_id=ObjectId(), saison_id=SAISON_ID, spiel_nr=2, spieltag_id=SPIELTAG, team1=side(A3), team2=side(A1)),
    spiel_document(spiel_id=ObjectId(), saison_id=SAISON_ID, spiel_nr=3, spieltag_id=SPIELTAG, team1=side(B1), team2=side(B2)),
    spiel_document(
        spiel_id=ObjectId(),
        saison_id=SAISON_ID,
        spiel_nr=9,
        spieltag_id=ObjectId(),
        saison_phase="halbfinale",
        team1=side(B1, 1),
        team2=None,
        ergebnis="1:0",
    ),
]

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_season(url: str, body: Body) -> Any:
    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME) as (client, database):
            await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, "future", start_date=START))
            await database[Collection.TEAMS].insert_many(
                [
                    team_document(team_id, name, name[:3].upper(), inactive_since="2025-08-01" if team_id == RETIRED else None)
                    for team_id, name in NAMES.items()
                ]
            )
            await database[Collection.SAISON_TEAMS].insert_many(
                [
                    saison_team_document(SAISON_ID, team_id, NAMES[team_id], NAMES[team_id][:3].upper(), gruppe=gruppe)
                    for team_id, gruppe in GRUPPE.items()
                ]
            )
            await database[Collection.SPIELE].insert_many([dict(spiel) for spiel in SPIELE])

            return await body(database, client)

    return on_the_seed_loop(_run())


async def read(database: AsyncDatabase) -> FLSaisonAdminResponse:
    return await get_saison_admin(
        saison_id=SAISON_ID,
        saisons_collection=database[Collection.SAISONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        spiele_collection=database[Collection.SPIELE],
        spieltage_collection=database[Collection.SPIELTAGE],
        teams_collection=database[Collection.TEAMS],
        today=TODAY,
    )


async def refused_by(write: Awaitable[Any]) -> Code | None:
    try:
        await write
    except APIError as refusal:
        return refusal.error_code

    return None


class TestTheEditorGradesAsTheWritesRefuse:
    """A picker offering a pair or a row the write then refuses sends the administrator to a press that fails: the two grade alike."""

    @pytest.mark.parametrize(
        ("team1", "team2", "closed"),
        [
            pytest.param(A1, B2, True, id="a club whose group fixture has taken place"),
            pytest.param(A3, B2, False, id="two clubs whose group fixtures are still to come"),
            pytest.param(A3, B1, False, id="a club whose only result is a knockout one"),
        ],
    )
    def test_a_swap_pair_is_closed_exactly_where_the_swap_refuses_it(
        self, mongo_replica_set_url: str, team1: ObjectId, team2: ObjectId, closed: bool
    ):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[bool, Code | None]:
            flags = {team.team_id: team.group_fixture_taken_place for team in (await read(database)).teams}
            refusal = await refused_by(
                swap_gruppen(
                    saison_id=SAISON_ID,
                    swap_data=FLSwapGruppenPayload(team1_id=team1, team2_id=team2),
                    saisons_collection=database[Collection.SAISONS],
                    saison_teams_collection=database[Collection.SAISON_TEAMS],
                    spiele_collection=database[Collection.SPIELE],
                    teams_collection=database[Collection.TEAMS],
                    db=client,
                    today=TODAY,
                )
            )

            return flags[team1] or flags[team2], refusal

        graded, refusal = on_a_season(mongo_replica_set_url, body)

        assert graded is closed
        assert refusal == (Code.SIDES_TAKEN_PLACE if closed else None)

    @pytest.mark.parametrize(
        ("team_id", "closed"),
        [
            pytest.param(A1, True, id="a row whose group fixture has taken place"),
            pytest.param(B1, True, id="a row whose knockout fixture has taken place"),
            pytest.param(B2, False, id="a row none of whose fixtures has taken place"),
        ],
    )
    def test_a_replacement_row_is_closed_exactly_where_the_replacement_refuses_it(
        self, mongo_replica_set_url: str, team_id: ObjectId, closed: bool
    ):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[bool, list[ObjectId], Code | None]:
            view = await read(database)
            graded = next(team.fixture_taken_place for team in view.teams if team.team_id == team_id)
            refusal = await refused_by(
                replace_saison_team(
                    team_id=team_id,
                    saison_id=SAISON_ID,
                    replacement_data=FLReplaceSaisonTeamPayload(incoming_team_id=INCOMING),
                    teams_collection=database[Collection.TEAMS],
                    saison_teams_collection=database[Collection.SAISON_TEAMS],
                    saisons_collection=database[Collection.SAISONS],
                    spiele_collection=database[Collection.SPIELE],
                    saison_spieler_collection=database[Collection.SAISON_SPIELER],
                    bewerbungen_collection=database[Collection.BEWERBUNGEN],
                    action_log_collection=database[Collection.ACTION_LOG],
                    spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
                    db=client,
                    today=TODAY,
                    germany_now=NOW,
                )
            )

            return graded, [club.id for club in view.incoming_clubs], refusal

        graded, incoming, refusal = on_a_season(mongo_replica_set_url, body)

        assert graded is closed
        assert refusal == (Code.SIDES_TAKEN_PLACE if closed else None)
        # The one club the replacement admits: still in the league, holding no row of the season.
        assert incoming == [INCOMING]
