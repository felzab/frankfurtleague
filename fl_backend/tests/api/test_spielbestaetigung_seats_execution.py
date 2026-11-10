"""
API · every write moving a season seat's holder voids that seat's links on its team's match confirmations, at the write

Each writer of an existing season row's seats is driven against the shipped indexes, and straight after it commits,
with no sweep run, each link is opened through the link's own view (`app/api/spielbestaetigungen/public_router.py ::
get_spielbestaetigung_view`): a link it refuses with `link_invalid` is voided. A contact's erasure and their
Widerspruch also take every reason typed from the seats they leave, matched by team, season and role.
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
from app.api.bewerbungen.system_router import sweep_saison
from app.api.identity.services import build_erasure_seat_pipeline
from app.api.kontakte.crud import erase_kontaktperson_in_session
from app.api.spielbestaetigungen.public_router import get_spielbestaetigung_view
from app.api.teams.admin_router import replace_saison_team
from app.api.teams.schemas import FLReplaceSaisonTeamPayload
from app.api.teams.services import compose_kontakt_confirmation
from app.core.collections import Collection
from app.core.crud import aggregate_many_from_db
from app.core.exceptions import APIError
from app.core.transactions import transaction_session
from app.shared.schemas.confirmation import FLTokenPayload
from app.shared.schemas.literals import KONTAKT_ROLLEN
from app.shared.tokens import hash_token
from tests import documents
from tests.config import build_test_config, grants_for_the_suite
from tests.database import a_clean_database, on_the_seed_loop
from tests.outbox import MAIL_NOW
from tests.team_writes import write_the_block
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
INCOMING_TEAM_OID = ObjectId("6890a1b2c3d4e5f607b60003")
ROW_OID = ObjectId("6890a1b2c3d4e5f607b60011")
OTHER_ROW_OID = ObjectId("6890a1b2c3d4e5f607b60012")
SPIEL_OID = ObjectId("6890a1b2c3d4e5f607b60021")
ANSWERED_SPIEL_OID = ObjectId("6890a1b2c3d4e5f607b60022")
REASON_SPIEL_OIDS = [ObjectId(f"6890a1b2c3d4e5f607b6003{position}") for position in range(5)]
SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f607b60041")

PHONE = {"Ida": "+4917010000001", "Jonas": "+4917010000002", "Klara": "+4917010000003", "Lea": "+4917010000004"}


def person(first_name: str, *, email: str | None = None) -> dict[str, Any]:
    """One person as the contacts editor sends them."""

    return {
        "first_name": first_name,
        "last_name": "Musterfrau",
        "email": email or f"{first_name.lower()}@example.com",
        "phone": PHONE[first_name],
        "einwilligung": {"scope": "kontakt_data", "date": "2026-03-01"},
    }


def stored(first_name: str) -> dict[str, Any]:
    """The same person as the row holds them, entered by the league and unconfirmed."""

    sent = person(first_name)

    return documents.kontaktperson_document(
        first_name,
        einwilligung={"date": sent["einwilligung"]["date"]},
        entered_by="liga",
        last_name=sent["last_name"],
        email=sent["email"],
        phone=sent["phone"],
    )


SEATED = {"trainer": "Ida", "ansprechperson": "Jonas", "stellvertretung": "Klara"}
STORED = {**{seat: stored(name) for seat, name in SEATED.items()}, "trainer_is_also": None}
SENT = {**{seat: person(name) for seat, name in SEATED.items()}, "trainer_is_also": None}


def row_link(seat: str) -> str:
    """The raw token of the season row's own link for this seat, which a Widerspruch presses."""

    return f"season-row-{seat}"


def link(row: str, seat: str) -> str:
    """The raw token a seat was mailed for one confirmation row."""

    return f"{row}-{seat}"


def spiel(spiel_id: ObjectId, *, saison_id: str = SAISON_ID, spiel_nr: int = 1) -> dict[str, Any]:
    """This team at home to the other, as the league's schedule stores it, naming neither."""

    sides = {f"team{position}": {"team_id": team_id, "tore": None} for position, team_id in enumerate((TEAM_OID, OTHER_TEAM_OID), start=1)}

    return documents.spiel_document(
        spiel_id=spiel_id, saison_id=saison_id, spiel_nr=spiel_nr, spieltag_id=SPIELTAG_OID, date="2026-04-18", time="14:00:00", **sides
    )


SPIELE = [spiel(spiel_id, spiel_nr=position) for position, spiel_id in enumerate([SPIEL_OID, ANSWERED_SPIEL_OID, *REASON_SPIEL_OIDS], start=1)]


def confirmation_row(row: str, team_id: ObjectId, spiel: Mapping[str, Any], **fields: Any) -> dict[str, Any]:
    """One team's mailed row about `spiel`, each seat holding the link it was mailed."""

    return documents.spielbestaetigung_document(
        spiel,
        party={"kind": "team", "team_id": team_id},
        deadline="2026-04-11",
        asked_at=TODAY,
        kontakte={seat: {"token_hashes": [hash_token(link(row, seat))], "delivery": None} for seat in KONTAKT_ROLLEN},
        **fields,
    )


# The team's open row, its answered row, and the other team's open row about the same fixture.
ROWS = {
    "open": confirmation_row("open", TEAM_OID, SPIELE[0]),
    "answered": confirmation_row(
        "answered",
        TEAM_OID,
        SPIELE[1],
        answer={"kind": "agreed", "at": TODAY, "by": {"kind": "kontakt", "rolle": "trainer"}, "vorschlag": None, "reason": None},
    ),
    "other": confirmation_row("other", OTHER_TEAM_OID, SPIELE[0]),
}

Write = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Write, *, saison_status: str = "active") -> Any:
    """The season, three clubs, this team's row holding `STORED` and its own links, and `ROWS`."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.GRANTS].insert_many(grants_for_the_suite())
            # Starting the day after `TODAY`, so the club's replacement is still open to it.
            await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, saison_status, start_date="2026-04-02"))
            # The season after, ended, which is what lets the sweep clear this one's blocks.
            await database[Collection.SAISONS].insert_one(documents.saison_document(LATER_SAISON_ID, "past"))
            for team_id, name, shorthand in (
                (TEAM_OID, "Adler", "ADX"),
                (OTHER_TEAM_OID, "Falken", "FAX"),
                (INCOMING_TEAM_OID, "Eulen", "EUX"),
            ):
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
            await database[Collection.SPIELBESTAETIGUNGEN].insert_many([dict(row) for row in ROWS.values()])

            await body(database, client)

            return await links_answering(database), await answers(database)

    return on_the_seed_loop(_run())


async def links_answering(database: AsyncDatabase) -> dict[str, set[str]]:
    """Per row, the seats whose mailed link the link's view still opens; a seat absent here is refused `link_invalid`."""

    answering: dict[str, set[str]] = {}
    for row in ROWS:
        answering[row] = set()
        for seat in KONTAKT_ROLLEN:
            try:
                await get_spielbestaetigung_view(
                    view_data=FLTokenPayload(token=link(row, seat)),
                    spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
                    spiele_collection=database[Collection.SPIELE],
                    saison_teams_collection=database[Collection.SAISON_TEAMS],
                    spielorte_collection=database[Collection.SPIELORTE],
                    teams_collection=database[Collection.TEAMS],
                    today=TODAY,
                )
            except APIError as refused:
                assert refused.error_code == "link_invalid"
                continue
            answering[row].add(seat)

    return answering


async def answers(database: AsyncDatabase) -> list[Any]:
    return [row.get("answer") async for row in database[Collection.SPIELBESTAETIGUNGEN].find({}, sort=[("_id", 1)])]


async def save(database: AsyncDatabase, client: AsyncMongoClient, kontakte: Mapping[str, Any]) -> Any:
    return await write_the_block(database, kontakte, team_id=TEAM_OID, saison_id=SAISON_ID, version=0, today=TODAY, germany_now=MAIL_NOW)


async def hand_the_trainer_on(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    return await save(database, client, {**SENT, "trainer": person("Lea")})


async def empty_the_trainer(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    return await save(database, client, {**SENT, "trainer": None})


async def replace_the_club(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    return await replace_saison_team(
        team_id=TEAM_OID,
        saison_id=SAISON_ID,
        replacement_data=FLReplaceSaisonTeamPayload(incoming_team_id=INCOMING_TEAM_OID),
        teams_collection=database[Collection.TEAMS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        db=client,
        today=TODAY,
    )


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


async def clear_the_blocks(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    """The application sweep's contact-block clock, over a season whose following one has ended."""

    return await sweep_saison(
        saison_id=SAISON_ID,
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        teams_collection=database[Collection.TEAMS],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        spielberichte_collection=database[Collection.SPIELBERICHTE],
        outbox_collection=database[Collection.OUTBOX],
        db=client,
        today=TODAY,
        germany_now=NOW,
    )


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


ALL = set(KONTAKT_ROLLEN)
KEPT = {"open": ALL, "answered": ALL, "other": ALL}


class TestEverySeatWriteVoidsItsLinks:
    """Every route and step writing an existing season row's seats, each voiding what it moves and nothing else."""

    @pytest.mark.parametrize(
        ("write", "voided", "saison_status", "other"),
        [
            pytest.param(hand_the_trainer_on, {"trainer"}, "active", ALL, id="the contacts save handing a seat on"),
            pytest.param(empty_the_trainer, {"trainer"}, "active", ALL, id="the contacts save emptying a seat"),
            pytest.param(replace_the_club, ALL, "active", ALL, id="the club's replacement"),
            pytest.param(erase_the_trainer, {"trainer"}, "active", ALL, id="the person erasure's seat member"),
            # The season's end strips every team row of the season, a club whose block was empty already included.
            pytest.param(clear_the_blocks, ALL, "past", set(), id="the sweep clearing a past season's blocks"),
            pytest.param(contradict, {"trainer"}, "active", ALL, id="the Widerspruch on the season row"),
        ],
    )
    def test_the_moved_seat_s_link_stops_answering_and_nothing_else_does(
        self, mongo_replica_set_url: str, write: Write, voided: set[str], saison_status: str, other: set[str]
    ):
        """The other team's row is the control; this team's answered row loses the seat's links too and keeps its answer."""

        links, stored_answers = on_a_league(mongo_replica_set_url, write, saison_status=saison_status)

        assert links == {"open": ALL - voided, "answered": ALL - voided, "other": other}
        assert stored_answers == [row["answer"] for row in ROWS.values()]

    def test_a_new_person_at_the_same_mailbox_voids_the_seat(self, mongo_replica_set_url: str):
        """Two people sharing one inbox are two holders: the link went to the one who left the seat."""

        async def hand_on_in_place(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await save(database, client, {**SENT, "trainer": person("Lea", email="ida@example.com")})

        links, _ = on_a_league(mongo_replica_set_url, hand_on_in_place)

        assert links == {**KEPT, "open": ALL - {"trainer"}, "answered": ALL - {"trainer"}}


LATER_SPIEL_OID = ObjectId("6890a1b2c3d4e5f607b60061")


def declined(row: str, team_id: ObjectId, spiel: Mapping[str, Any], rolle: str, reason: str) -> dict[str, Any]:
    """A row the team declined from `rolle`'s link, giving a reason; closed since, as a move closes an answered row."""

    return confirmation_row(
        row,
        team_id,
        spiel,
        answer=documents.kontakt_answer_document(rolle, reason=reason),
        closed={"at": TODAY, "reason": "ansetzung_changed"},
    )


# Ida holds this team's Trainer seat in this season. Every reason typed from that seat goes, her predecessor's
# among them, the answer recording the seat alone; one from another seat, team or season stays to the season's end.
REASONS = {
    "from her seat": declined("hers", TEAM_OID, SPIELE[2], "trainer", "Ida ist an dem Tag verreist"),
    "from a seat of another team": declined("left", OTHER_TEAM_OID, SPIELE[3], "ansprechperson", "Die Fahrt ist zu weit"),
    "her predecessor's, from her seat": declined("before", TEAM_OID, SPIELE[4], "trainer", "Lea hat Spätdienst"),
    "another seat's": declined("seat", TEAM_OID, SPIELE[5], "ansprechperson", "Die Halle ist belegt"),
    "another team's, from the same role": declined("team", OTHER_TEAM_OID, SPIELE[6], "trainer", "Unser Trainer ist krank"),
    "from the same seat in another season": declined(
        "season", TEAM_OID, spiel(LATER_SPIEL_OID, saison_id=LATER_SAISON_ID), "trainer", "Wir fahren ins Landheim"
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
