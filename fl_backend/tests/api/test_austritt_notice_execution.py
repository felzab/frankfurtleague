from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.database import AsyncDatabase

from app.api.outbox.schemas import FLAustrittNoticeData
from app.api.spielbestaetigungen.crud import owe_the_austritt_notices_in_session
from app.api.teams.schemas import FLAustritt
from app.core.collections import Collection
from app.core.transactions import transaction_session
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import kontaktperson_document
from tests.outbox import MAIL_NOW, drained
from tests.worker import worker_database

# Module level, as the other execution suites mark theirs: every test below reaches a real mongod.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_austritt_notice_test")

SAISON_ID = "2026"
EXIT_DAY = "2026-05-10"
DAY_BEFORE = "2026-05-09"
LATER = "2026-09-20"

# Fixed rather than generated, so a failure names the same row every run.
DEPARTED = ObjectId("6890a1b2c3d4e5f607760001")
OPPONENT = ObjectId("6890a1b2c3d4e5f607760002")
EARLIER_OPPONENT = ObjectId("6890a1b2c3d4e5f607760003")
GONE_TOO = ObjectId("6890a1b2c3d4e5f607760004")
DEPARTED_ROW = ObjectId("6890a1b2c3d4e5f6077600a1")
SPIELTAG = ObjectId("6890a1b2c3d4e5f6077600b1")

NAMES = {DEPARTED: "Goethe", OPPONENT: "Schiller", EARLIER_OPPONENT: "Lessing", GONE_TOO: "Kleist"}


def club(team_id: ObjectId, **fields: Any) -> dict[str, Any]:
    name = NAMES[team_id]

    return documents.saison_team_document(
        SAISON_ID,
        team_id,
        name,
        name[:3].upper(),
        kontakte={
            "trainer": kontaktperson_document(f"{name}trainer"),
            "ansprechperson": kontaktperson_document(f"{name}kontakt"),
            "stellvertretung": None,
            "trainer_is_also": None,
        },
        **fields,
    )


def clubs() -> list[dict[str, Any]]:
    # An exit on the fixture's day takes the fixture from this opponent as much as from the departed club.
    gone = {"type": "rueckzug", "exit_reason": "Schulwechsel", "date": LATER}

    return [{**club(DEPARTED), "_id": DEPARTED_ROW}, club(OPPONENT), club(EARLIER_OPPONENT), club(GONE_TOO, austritt=gone)]


def addresses(team_id: ObjectId) -> list[str]:
    return sorted(f"{NAMES[team_id].lower()}{role}@example.com" for role in ("trainer", "kontakt"))


def side(team_id: ObjectId | None, tore: int | None = None) -> dict[str, Any] | None:
    return None if team_id is None else {"team_id": team_id, "tore": tore}


def fixture(
    spiel_nr: int, team1: ObjectId, team2: ObjectId | None, date: str | None, *, tore: int | None = None, **fields: Any
) -> dict[str, Any]:
    """A fixture no confirmation row names, as one past the asking window."""

    return documents.spiel_document(
        spiel_id=ObjectId(),
        saison_id=SAISON_ID,
        spiel_nr=spiel_nr,
        spieltag_id=SPIELTAG,
        team1=side(team1, tore),
        team2=side(team2),
        date=date,
        time="18:00:00",
        **fields,
    )


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Body, *, spiele: list[dict[str, Any]]) -> Any:
    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active"))
            await database[Collection.SAISON_TEAMS].insert_many(clubs())
            await database[Collection.SPIELE].insert_many(spiele)

            return await body(database, client)

    return on_the_seed_loop(_run())


async def save_the_exit(database: AsyncDatabase, client: AsyncMongoClient, *, stored: str | None, proposed: str) -> None:
    """One save of the row, its exit's day going from `stored` to `proposed`."""

    async def owe(session: AsyncClientSession) -> None:
        await owe_the_austritt_notices_in_session(
            spiele_collection=database[Collection.SPIELE],
            saison_teams_collection=database[Collection.SAISON_TEAMS],
            outbox_collection=database[Collection.OUTBOX],
            saison_id=SAISON_ID,
            team_id=DEPARTED,
            stored=None if stored is None else {"date": stored},
            proposed=FLAustritt(type="disqualifikation", exit_reason="Nicht angetreten", date=proposed),
            now=MAIL_NOW,
            session=session,
        )

    async with transaction_session(client) as session:
        await session.with_transaction(owe)


async def told(database: AsyncDatabase, client: AsyncMongoClient) -> dict[str, FLAustrittNoticeData]:
    """Every notice owed since the last drain, by its address: drained, so each has passed the hand-out's own model."""

    mails = await drained(database, client)
    notices = {mail.an: mail.data for mail in mails if isinstance(mail.data, FLAustrittNoticeData)}
    assert len(notices) == len(mails)

    return notices


class TestAnOpponentHearsOfAnExitAtTheExitsOwnWrite:
    """No confirmation row names a fixture past the asking window, and the pass never asks one once a club is out.

    The close's list reaching only rows already asked, an opponent of those fixtures would go to the ground unaware.
    """

    def test_each_opponent_is_owed_one_notice_over_its_open_fixtures_and_the_departed_club_nothing(self, mongo_replica_set_url: str):
        spiele = [
            fixture(1, DEPARTED, OPPONENT, LATER),
            # On the exit's own day, and the departed club on the other side: `entscheidung_of` counts the day as out.
            fixture(2, OPPONENT, DEPARTED, EXIT_DAY),
            fixture(3, DEPARTED, OPPONENT, None),
            # A day the club still played, a result, a call-off, and a side the draw has yet to settle: none is open between two clubs.
            fixture(4, DEPARTED, OPPONENT, DAY_BEFORE),
            fixture(5, DEPARTED, OPPONENT, LATER, tore=1),
            fixture(6, DEPARTED, OPPONENT, LATER, sonderereignis="ausgefallen"),
            fixture(7, DEPARTED, None, LATER),
            # An opponent whose only fixture lies before the exit, and one out itself by the fixture's day.
            fixture(8, DEPARTED, EARLIER_OPPONENT, DAY_BEFORE),
            fixture(9, DEPARTED, GONE_TOO, LATER),
        ]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await save_the_exit(database, client, stored=None, proposed=EXIT_DAY)

            return await database[Collection.OUTBOX].find().to_list(), await told(database, client)

        rows, notices = on_a_league(mongo_replica_set_url, body, spiele=spiele)

        assert sorted(notices) == addresses(OPPONENT)
        for notice in notices.values():
            assert (notice.team, notice.saison_id) == ("Goethe", SAISON_ID)
            # By day, the undated one last.
            assert [(row.team1, row.team2, row.date) for row in notice.fixtures] == [
                ("Schiller", "Goethe", EXIT_DAY),
                ("Goethe", "Schiller", LATER),
                ("Goethe", "Schiller", None),
            ]
        # Never the opponent's seat: the team editor reads a seat's last mail as the delivery of its link.
        assert {(row["reference"]["id"], row["reference"]["seat"]) for row in rows} == {(DEPARTED_ROW, None)}

    def test_a_later_save_tells_only_the_opponents_a_moved_day_newly_reaches(self, mongo_replica_set_url: str):
        spiele = [fixture(1, DEPARTED, OPPONENT, LATER), fixture(2, DEPARTED, EARLIER_OPPONENT, DAY_BEFORE)]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await save_the_exit(database, client, stored=None, proposed=EXIT_DAY)
            first = await told(database, client)
            await save_the_exit(database, client, stored=EXIT_DAY, proposed=EXIT_DAY)
            resaved = await told(database, client)
            await save_the_exit(database, client, stored=EXIT_DAY, proposed=DAY_BEFORE)

            return first, resaved, await told(database, client)

        first, resaved, moved = on_a_league(mongo_replica_set_url, body, spiele=spiele)

        assert sorted(first) == addresses(OPPONENT)
        assert resaved == {}
        assert sorted(moved) == addresses(EARLIER_OPPONENT)
