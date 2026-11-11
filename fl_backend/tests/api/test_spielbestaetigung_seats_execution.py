"""
API · a contact's erasure and their Widerspruch take every reason typed from the seats they leave on the match confirmations

Matched by team, season and role, against the shipped indexes: an answer records the seat and never its holder.
"""

from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.public_router import post_einwilligung
from app.api.bewerbungen.schemas import FLBewerbungEinwilligungDeclined
from app.api.identity.services import build_erasure_seat_pipeline
from app.api.kontakte.crud import erase_kontaktperson_in_session
from app.api.teams.services import compose_kontakt_confirmation
from app.core.collections import Collection
from app.core.crud import aggregate_many_from_db
from app.core.transactions import transaction_session
from app.shared.schemas.literals import KONTAKT_ROLLEN
from app.shared.tokens import hash_token
from tests import documents
from tests.config import build_test_config, grants_for_the_suite
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_spielbestaetigung_seats_test")
CONFIG = build_test_config()

SAISON_ID = "2026"
LATER_SAISON_ID = "2027"
TODAY = "2026-04-01"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

TEAM_OID = ObjectId("6890a1b2c3d4e5f607b60001")
OTHER_TEAM_OID = ObjectId("6890a1b2c3d4e5f607b60002")
ROW_OID = ObjectId("6890a1b2c3d4e5f607b60011")
OTHER_ROW_OID = ObjectId("6890a1b2c3d4e5f607b60012")
REASON_SPIEL_OIDS = [ObjectId(f"6890a1b2c3d4e5f607b6003{position}") for position in range(5)]
SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f607b60041")
LATER_SPIEL_OID = ObjectId("6890a1b2c3d4e5f607b60061")

PHONE = {"Ida": "+4917010000001", "Jonas": "+4917010000002", "Klara": "+4917010000003"}


def stored(first_name: str) -> dict[str, Any]:
    """One person as the row holds them, entered by the league and unconfirmed."""

    return documents.kontaktperson_document(
        first_name,
        einwilligung={"date": "2026-03-01"},
        entered_by="liga",
        last_name="Musterfrau",
        email=f"{first_name.lower()}@example.com",
        phone=PHONE[first_name],
    )


SEATED = {"trainer": "Ida", "ansprechperson": "Jonas", "stellvertretung": "Klara"}
STORED = {**{seat: stored(name) for seat, name in SEATED.items()}, "trainer_is_also": None}


def row_link(seat: str) -> str:
    """The raw token of the season row's own link for this seat, which a Widerspruch presses."""

    return f"season-row-{seat}"


def spiel(spiel_id: ObjectId, *, saison_id: str = SAISON_ID, spiel_nr: int = 1) -> dict[str, Any]:
    """This team at home to the other, as the league's schedule stores it, naming neither."""

    sides = {f"team{position}": {"team_id": team_id, "tore": None} for position, team_id in enumerate((TEAM_OID, OTHER_TEAM_OID), start=1)}

    return documents.spiel_document(
        spiel_id=spiel_id, saison_id=saison_id, spiel_nr=spiel_nr, spieltag_id=SPIELTAG_OID, date="2026-04-18", time="14:00:00", **sides
    )


SPIELE = [spiel(spiel_id, spiel_nr=position) for position, spiel_id in enumerate(REASON_SPIEL_OIDS, start=1)]

Write = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Write) -> Any:
    """The season, two clubs, and this team's row holding `STORED` and its own links."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.GRANTS].insert_many(grants_for_the_suite())
            await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active", start_date="2026-04-02"))
            for team_id, name, shorthand in ((TEAM_OID, "Adler", "ADX"), (OTHER_TEAM_OID, "Falken", "FAX")):
                await database[Collection.TEAMS].insert_one(
                    documents.team_document(team_id, name, shorthand, website_url=None, schulform="gymnasium_g9")
                )
            await database[Collection.SAISON_TEAMS].insert_many(
                [
                    {
                        "_id": ROW_OID,
                        **documents.saison_team_document(
                            SAISON_ID,
                            TEAM_OID,
                            "Adler",
                            "ADX",
                            kontakte=STORED,
                            confirmations={
                                seat: {**compose_kontakt_confirmation(today=TODAY), "token_hashes": [hash_token(row_link(seat))]}
                                for seat in KONTAKT_ROLLEN
                            },
                        ),
                    },
                    {"_id": OTHER_ROW_OID, **documents.saison_team_document(SAISON_ID, OTHER_TEAM_OID, "Falken", "FAX", kontakte=None)},
                ]
            )
            await database[Collection.SPIELE].insert_many([dict(spiel) for spiel in SPIELE])

            await body(database, client)

    return on_the_seed_loop(_run())


async def erase_the_trainer(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    """The erasure registry's seat member, given the rows the person erasure reads for it."""

    identifier = "ida@example.com"

    async def in_session(session: Any) -> Any:
        rows = await aggregate_many_from_db(
            collection=database[Collection.SAISON_TEAMS], pipeline=build_erasure_seat_pipeline(identifier), session=session
        )
        return await erase_kontaktperson_in_session(
            saison_teams_collection=database[Collection.SAISON_TEAMS],
            bewerbungen_collection=database[Collection.BEWERBUNGEN],
            spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
            identifier=identifier,
            saison_team_rows=rows,
            bewerbung_rows=[],
            session=session,
        )

    async with transaction_session(client) as session:
        return await session.with_transaction(in_session)


async def contradict(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    """The Trainer's Widerspruch through the season row's own link."""

    return await post_einwilligung(
        answer_data=FLBewerbungEinwilligungDeclined(token=row_link("trainer"), answer="declined"),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        outbox_collection=database[Collection.OUTBOX],
        db=client,
        today=TODAY,
        germany_now=NOW,
    )


def declined(team_id: ObjectId, spiel: Mapping[str, Any], rolle: str, reason: str) -> dict[str, Any]:
    """A row the team declined from `rolle`, giving a reason; closed since, as a move closes an answered row."""

    return documents.spielbestaetigung_document(
        spiel,
        party={"kind": "team", "team_id": team_id},
        deadline="2026-04-11",
        asked_at=TODAY,
        answer=documents.kontakt_answer_document(rolle, reason=reason),
        closed={"at": TODAY, "reason": "ansetzung_changed"},
    )


# Ida holds this team's Trainer seat in this season. Every reason typed from that seat goes, her predecessor's
# among them, the answer recording the seat alone; one from another seat, team or season stays to the season's end.
REASONS = {
    "from her seat": declined(TEAM_OID, SPIELE[0], "trainer", "Ida ist an dem Tag verreist"),
    "from a seat of another team": declined(OTHER_TEAM_OID, SPIELE[1], "ansprechperson", "Die Fahrt ist zu weit"),
    "her predecessor's, from her seat": declined(TEAM_OID, SPIELE[2], "trainer", "Lea hat Spätdienst"),
    "another seat's": declined(TEAM_OID, SPIELE[3], "ansprechperson", "Die Halle ist belegt"),
    "another team's, from the same role": declined(OTHER_TEAM_OID, SPIELE[4], "trainer", "Unser Trainer ist krank"),
    "from the same seat in another season": declined(
        TEAM_OID, spiel(LATER_SPIEL_OID, saison_id=LATER_SAISON_ID), "trainer", "Wir fahren ins Landheim"
    ),
}
CLEARED = {"from her seat", "her predecessor's, from her seat"}
NAMED = {row["spiel_id"]: name for name, row in REASONS.items()}


def left_behind(name: str, answer: Mapping[str, Any]) -> tuple[str, Any]:
    return name, answer["reason"]


def expected(name: str) -> tuple[str, Any]:
    if name in CLEARED:
        return name, None

    return left_behind(name, REASONS[name]["answer"])


class TestALeavingContactsReasonsGo:
    """Every reason typed from the seat the person leaves goes from its row; the answer stays."""

    @pytest.mark.parametrize(
        "write",
        [
            pytest.param(erase_the_trainer, id="their erasure"),
            pytest.param(contradict, id="their Widerspruch on the season row"),
        ],
    )
    def test_theirs_go_from_the_rows_and_nobody_elses_do(self, mongo_replica_set_url: str, write: Write):
        """A reason typed from the seat an erased person held would survive them: an answer records the seat and never its holder."""

        found: dict[str, Any] = {}

        async def after_the_answers(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            collection = database[Collection.SPIELBESTAETIGUNGEN]
            await collection.insert_many([dict(row) for row in REASONS.values()])

            await write(database, client)

            found["rows"] = sorted(
                [left_behind(NAMED[row["spiel_id"]], row["answer"]) async for row in collection.find({"spiel_id": {"$in": list(NAMED)}})]
            )

        on_a_league(mongo_replica_set_url, after_the_answers)

        assert found["rows"] == sorted(expected(name) for name in REASONS)
