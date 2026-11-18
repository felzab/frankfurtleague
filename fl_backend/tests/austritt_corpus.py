"""
TESTS · a season one club leaves, the opponents its exit tells, and the notices owed

A running season, the departed club, two opponents and one club out already. Each suite seeds it on a database of its own.
"""

from typing import Any

from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.outbox.schemas import FLAustrittNoticeData
from app.core.collections import Collection
from tests import documents
from tests.documents import kontaktperson_document
from tests.outbox import drained

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


def team(team_id: ObjectId, **fields: Any) -> dict[str, Any]:
    name = NAMES[team_id]

    return documents.saison_team_document(
        SAISON_ID,
        team_id,
        name,
        name[:3].upper(),
        # Two seats confirmed by their own people, whom the notice reaches, and one nobody confirmed, mailed nothing.
        kontakte={
            "trainer": kontaktperson_document(f"{name}trainer", confirmed_at="2026-03-01"),
            "ansprechperson": kontaktperson_document(f"{name}kontakt", confirmed_at="2026-03-01"),
            "stellvertretung": kontaktperson_document(f"{name}deputy"),
            "trainer_is_also": None,
        },
        **fields,
    )


def teams() -> list[dict[str, Any]]:
    # An exit on the fixture's day takes the fixture from this opponent as much as from the departed club.
    gone = {"type": "rueckzug", "reason": "Schulwechsel", "date": LATER}

    return [{**team(DEPARTED), "_id": DEPARTED_ROW}, team(OPPONENT), team(EARLIER_OPPONENT), team(GONE_TOO, austritt=gone)]


def addresses(team_id: ObjectId) -> list[str]:
    return sorted(f"{NAMES[team_id].lower()}{role}@example.com" for role in ("trainer", "kontakt"))


def side(team_id: ObjectId | None, tore: int | None = None) -> dict[str, Any] | None:
    return None if team_id is None else {"team_id": team_id, "tore": tore}


def spiel(
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


async def the_league(database: AsyncDatabase, *, spiele: list[dict[str, Any]]) -> None:
    """The running season, its four clubs, and `spiele` on them."""

    await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active"))
    await database[Collection.SAISON_TEAMS].insert_many(teams())
    await database[Collection.SPIELE].insert_many(spiele)


async def told(database: AsyncDatabase, client: AsyncMongoClient) -> dict[str, FLAustrittNoticeData]:
    """Every notice owed since the last drain, by its address: drained, so each has passed the hand-out's own model."""

    mails = await drained(database, client)
    notices = {mail.to: mail.data for mail in mails if isinstance(mail.data, FLAustrittNoticeData)}
    assert len(notices) == len(mails)

    return notices
