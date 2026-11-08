from collections.abc import Awaitable, Callable
from typing import Any, Literal

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.admin_router import activate_saison, delete_spielplan, get_saison_admin, post_spielplan
from app.api.saisons.schemas import FLGenerateSpielplanPayload, FLSaisonAdminResponse
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import saison_document, saison_team_document, spiel_document, spielbericht_document
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_saison_admin_read_test")

SAISON_ID = "2026"
# The day both writes and the read judge on, before the season's start, so the start lock answers none of them.
TODAY, START = "2026-03-01", "2026-03-02"


async def read(database: AsyncDatabase) -> FLSaisonAdminResponse:
    return await get_saison_admin(
        saison_id=SAISON_ID,
        saisons_collection=database[Collection.SAISONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        spiele_collection=database[Collection.SPIELE],
        spieltage_collection=database[Collection.SPIELTAGE],
        teams_collection=database[Collection.TEAMS],
        spielberichte_collection=database[Collection.SPIELBERICHTE],
        invitations_collection=database[Collection.INVITATIONS],
        today=TODAY,
    )


async def refused_by(write: Awaitable[Any]) -> Code | None:
    try:
        await write
    except APIError as refusal:
        return refusal.error_code

    return None


# A season of sixteen clubs, four groups of four as the default rules ask, drawn by the draw itself, then put in one state.
CLUBS = {ObjectId(f"6890a1b2c3d4e5f6073400{index:02d}"): "ABCD"[index // 4] for index in range(16)}
OUTGOING_SAISON_ID = "2025"
A_DAY = "2026-04-01"

Act = Literal["activate", "create", "recreate", "undraw"]
State = Callable[[AsyncDatabase], Awaitable[None]]


async def as_drawn(database: AsyncDatabase) -> None:
    """The draw's own output: every matchday undated, nothing recorded."""


async def a_result_entered(database: AsyncDatabase) -> None:
    await database[Collection.SPIELE].update_one({"saison_id": SAISON_ID, "spiel_nr": 1}, {"$set": {"ergebnis": "1:0"}})


async def a_report_submitted(database: AsyncDatabase) -> None:
    spiel = await database[Collection.SPIELE].find_one({"saison_id": SAISON_ID, "spiel_nr": 1})
    assert spiel is not None
    await database[Collection.SPIELBERICHTE].insert_one(spielbericht_document(spiel))


async def a_club_short(database: AsyncDatabase) -> None:
    """One group a club short of the stored rules' size, which the draw refuses until it is filled."""

    await database[Collection.SAISON_TEAMS].delete_one({"saison_id": SAISON_ID, "team_id": next(iter(CLUBS))})


async def the_season_active(database: AsyncDatabase) -> None:
    await database[Collection.SAISONS].update_one({"_id": SAISON_ID}, {"$set": {"status": "active"}})


async def the_season_past(database: AsyncDatabase) -> None:
    await database[Collection.SAISONS].update_one({"_id": SAISON_ID}, {"$set": {"status": "past"}})


async def matchdays_dated(database: AsyncDatabase) -> None:
    await database[Collection.SPIELTAGE].update_many({"saison_id": SAISON_ID}, {"$set": {"start": A_DAY, "end": A_DAY}})


async def dated_beside_an_unfinished_season(database: AsyncDatabase) -> None:
    await matchdays_dated(database)
    await database[Collection.SAISONS].insert_one(saison_document(OUTGOING_SAISON_ID, "active"))
    await database[Collection.SPIELE].insert_one(
        spiel_document(spiel_id=ObjectId(), saison_id=OUTGOING_SAISON_ID, spiel_nr=1, spieltag_id=ObjectId())
    )


async def pressed(act: Act, database: AsyncDatabase, client: AsyncMongoClient) -> Code | None:
    """The act's own write, as its button presses it: a redraw confirmed with no shape, the season's stored one."""

    if act == "activate":
        return await refused_by(
            activate_saison(
                saison_id=SAISON_ID,
                saisons_collection=database[Collection.SAISONS],
                spiele_collection=database[Collection.SPIELE],
                spieltage_collection=database[Collection.SPIELTAGE],
                ban_list_collection=database[Collection.BAN_LIST],
                db=client,
            )
        )
    if act == "undraw":
        return await refused_by(
            delete_spielplan(
                saison_id=SAISON_ID,
                saisons_collection=database[Collection.SAISONS],
                spiele_collection=database[Collection.SPIELE],
                spieltage_collection=database[Collection.SPIELTAGE],
                spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
                spielberichte_collection=database[Collection.SPIELBERICHTE],
                db=client,
            )
        )

    return await refused_by(drawn(database, client, replace=act == "recreate"))


def drawn(database: AsyncDatabase, client: AsyncMongoClient, *, replace: bool) -> Awaitable[Any]:
    return post_spielplan(
        saison_id=SAISON_ID,
        saisons_collection=database[Collection.SAISONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        spiele_collection=database[Collection.SPIELE],
        spieltage_collection=database[Collection.SPIELTAGE],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        spielberichte_collection=database[Collection.SPIELBERICHTE],
        db=client,
        spielplan_data=FLGenerateSpielplanPayload(replace=replace),
        today=TODAY,
    )


class TestTheEditorReadsTheDraw:
    def test_a_season_holding_fixtures_and_no_matchday_reads_drawn(self, mongo_replica_set_url: str):
        """A first draw refuses on those rows: read undrawn, the editor offers the press its write refuses."""

        async def _run() -> Any:
            async with a_clean_database(mongo_replica_set_url, DATABASE_NAME) as (_, database):
                await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, "future", start_date=START))
                await database[Collection.SPIELE].insert_one(
                    spiel_document(spiel_id=ObjectId(), saison_id=SAISON_ID, spiel_nr=1, spieltag_id=ObjectId())
                )

                return (await read(database)).spielplan

        drawn_as = on_the_seed_loop(_run())

        assert (drawn_as.spieltage, drawn_as.spiele) == (0, 1)


class TestTheEditorsActsAreRefusedAsTheirWritesRefuse:
    """An act offered that its write then refuses, or closed that its write would take, sends the administrator the wrong way."""

    @pytest.mark.parametrize(
        ("act", "draw", "state", "refused"),
        [
            pytest.param("create", False, as_drawn, None, id="a first draw of full groups"),
            pytest.param("create", False, a_club_short, Code.SPIELPLAN_GRUPPEN_OFF_RULES, id="a first draw a club short"),
            pytest.param("create", True, as_drawn, Code.SPIELPLAN_ALREADY_DRAWN, id="a first draw of a drawn season"),
            pytest.param("recreate", True, as_drawn, None, id="a redraw of a season nothing is recorded on"),
            pytest.param("recreate", True, a_result_entered, Code.SPIELPLAN_REPLACE_OUTSIDE_ITS_WINDOW, id="a redraw past a result"),
            pytest.param("recreate", True, a_report_submitted, Code.SPIELPLAN_BERICHTE_SUBMITTED, id="a redraw over a report"),
            pytest.param("recreate", True, the_season_active, Code.SPIELPLAN_REPLACE_OUTSIDE_ITS_WINDOW, id="a redraw once activated"),
            pytest.param("undraw", True, as_drawn, None, id="an undraw of a season nothing is recorded on"),
            pytest.param("undraw", True, a_result_entered, Code.SPIELPLAN_UNDRAW_OUTSIDE_ITS_WINDOW, id="an undraw past a result"),
            pytest.param("undraw", True, a_report_submitted, Code.SPIELPLAN_BERICHTE_SUBMITTED, id="an undraw over a report"),
            pytest.param("undraw", True, the_season_active, Code.SPIELPLAN_UNDRAW_OUTSIDE_ITS_WINDOW, id="an undraw once activated"),
            pytest.param("activate", False, as_drawn, Code.ACTIVATE_TARGET_UNDRAWN, id="activating an undrawn season"),
            pytest.param("activate", True, as_drawn, Code.ACTIVATE_SPIELTAGE_UNDATED, id="activating a season with undated matchdays"),
            pytest.param("activate", True, matchdays_dated, None, id="activating a dated season in a fresh league"),
            pytest.param(
                "activate", True, dated_beside_an_unfinished_season, Code.ACTIVATE_SAISON_UNFINISHED, id="activating over an unfinished one"
            ),
            pytest.param("activate", True, the_season_past, Code.SAISON_PAST, id="activating a finished season"),
        ],
    )
    def test_each_act_is_served_the_refusal_its_write_answers(
        self, mongo_replica_set_url: str, act: Act, draw: bool, state: State, refused: Code | None
    ):
        async def _run() -> tuple[Code | None, Code | None]:
            async with a_clean_database(mongo_replica_set_url, DATABASE_NAME) as (client, database):
                await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, "future", start_date=START))
                await database[Collection.SAISON_TEAMS].insert_many(
                    [
                        saison_team_document(SAISON_ID, team_id, f"Schule {index}", f"S{chr(65 + index)}X", gruppe=gruppe)
                        for index, (team_id, gruppe) in enumerate(CLUBS.items())
                    ]
                )
                if draw:
                    await drawn(database, client, replace=False)
                await state(database)

                served = getattr((await read(database)).refusals, act)

                return served, await pressed(act, database, client)

        served, answered = on_the_seed_loop(_run())

        assert (served, answered) == (refused, refused)
