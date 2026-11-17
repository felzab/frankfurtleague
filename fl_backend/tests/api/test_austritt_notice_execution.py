from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.database import AsyncDatabase

from app.api.spielbestaetigungen.crud import owe_the_austritt_notices_in_session
from app.core.collections import Collection
from app.core.transactions import transaction_session
from tests.austritt_corpus import (
    DAY_BEFORE,
    DEPARTED,
    DEPARTED_ROW,
    EARLIER_OPPONENT,
    EXIT_DAY,
    GONE_TOO,
    LATER,
    OPPONENT,
    SAISON_ID,
    addresses,
    spiel,
    the_league,
    told,
)
from tests.database import a_clean_database
from tests.outbox import MAIL_NOW
from tests.worker import worker_database

# Module level, as the other execution suites mark theirs: every test below reaches a real mongod.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_austritt_notice_test")


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


async def on_a_league(url: str, body: Body, *, spiele: list[dict[str, Any]]) -> Any:
    async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
        await the_league(database, spiele=spiele)

        return await body(database, client)


async def save_the_exit(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    """The exit's one write, dated `EXIT_DAY`."""

    async def owe(session: AsyncClientSession) -> None:
        await owe_the_austritt_notices_in_session(
            spiele_collection=database[Collection.SPIELE],
            saison_teams_collection=database[Collection.SAISON_TEAMS],
            outbox_collection=database[Collection.OUTBOX],
            saison_id=SAISON_ID,
            team_id=DEPARTED,
            exit_day=EXIT_DAY,
            now=MAIL_NOW,
            session=session,
        )

    async with transaction_session(client) as session:
        await session.with_transaction(owe)


class TestAnOpponentHearsOfAnExitAtTheExitsOwnWrite:
    """No confirmation row names a fixture past the asking window, and the pass never asks one once a club is out.

    The close's list reaching only rows already asked, an opponent of those fixtures would go to the ground unaware.
    """

    async def test_each_opponent_is_owed_one_notice_over_its_open_spiele_and_the_departed_club_nothing(self, mongo_replica_set_url: str):
        spiele = [
            spiel(1, DEPARTED, OPPONENT, LATER),
            # On the exit's own day, and the departed club on the other side: `decision_of` counts the day as out.
            spiel(2, OPPONENT, DEPARTED, EXIT_DAY),
            spiel(3, DEPARTED, OPPONENT, None),
            # A day the club still played, a result, a call-off, and a side the draw has yet to settle: none is open between two clubs.
            spiel(4, DEPARTED, OPPONENT, DAY_BEFORE),
            spiel(5, DEPARTED, OPPONENT, LATER, tore=1),
            spiel(6, DEPARTED, OPPONENT, LATER, sonderereignis="ausgefallen"),
            spiel(7, DEPARTED, None, LATER),
            # An opponent whose only fixture lies before the exit, and one out itself by the fixture's day.
            spiel(8, DEPARTED, EARLIER_OPPONENT, DAY_BEFORE),
            spiel(9, DEPARTED, GONE_TOO, LATER),
        ]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await save_the_exit(database, client)

            return await database[Collection.OUTBOX].find().to_list(), await told(database, client)

        rows, notices = await on_a_league(mongo_replica_set_url, body, spiele=spiele)

        assert sorted(notices) == addresses(OPPONENT)
        for notice in notices.values():
            assert (notice.team, notice.saison_id) == ("Goethe", SAISON_ID)
            # By day, the undated one last.
            assert [(row.team1, row.team2, row.date) for row in notice.spiele] == [
                ("Schiller", "Goethe", EXIT_DAY),
                ("Goethe", "Schiller", LATER),
                ("Goethe", "Schiller", None),
            ]
        # Never the opponent's seat: the team editor reads a seat's last mail as the delivery of its link.
        assert {(row["reference"]["id"], row["reference"]["seat"]) for row in rows} == {(DEPARTED_ROW, None)}
