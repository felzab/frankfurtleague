"""
API · a referee's own list of one season's fixtures, and the seasons it offers, against the shipped indexes

One row a fixture booked to the address's records, each judged by the newest row asking that booking and by its report;
open work first.
"""

from datetime import datetime
from typing import Any

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.schiedsrichter.person_router import get_self_saisons, get_self_spiele
from app.core import clock
from app.core.codes import Code
from app.core.collections import Collection
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop
from tests.isolation import outcome_of
from tests.records import record_collections
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_schiedsrichter_self_test")

SAISON_ID = "2027"
EARLIER_SAISON = "2026"
TODAY = "2027-05-10"
# Noon on `TODAY`, ahead of its fixture's 18:30 kick-off.
NOW = datetime(2027, 5, 10, 12, tzinfo=clock.GERMANY)

TEAM1 = ObjectId("6890a1b2c3d4e5f607e50001")
TEAM2 = ObjectId("6890a1b2c3d4e5f607e50002")
SPIELTAG = ObjectId("6890a1b2c3d4e5f607e50021")
SPIELORT = ObjectId("6890a1b2c3d4e5f607e50031")
OTTO = "otto@example.com"
OTTO_ID = ObjectId("6890a1b2c3d4e5f607e50041")
UTE = "ute@example.com"
UTE_ID = ObjectId("6890a1b2c3d4e5f607e50042")
# Confirmed and booked nowhere.
KARL = "karl@example.com"
KARL_ID = ObjectId("6890a1b2c3d4e5f607e50043")

# Otto's fixtures of the season, each named for where his list puts it.
TO_ANSWER = ObjectId("6890a1b2c3d4e5f607e50011")
REPORT_OWED = ObjectId("6890a1b2c3d4e5f607e50012")
REPORTED = ObjectId("6890a1b2c3d4e5f607e50013")
TO_COME = ObjectId("6890a1b2c3d4e5f607e50014")
CALLED_OFF = ObjectId("6890a1b2c3d4e5f607e50015")
STRUCK_OUT = ObjectId("6890a1b2c3d4e5f607e50016")
UTES = ObjectId("6890a1b2c3d4e5f607e50017")
LAST_SEASONS = ObjectId("6890a1b2c3d4e5f607e50018")

AGREED = {"kind": "agreed", "at": "2027-04-20", "by": {"kind": "schiedsrichter"}, "vorschlag": None, "reason": None}
OWN_DECLINE = {"kind": "declined", "at": "2027-05-05", "by": {"kind": "schiedsrichter"}, "vorschlag": None, "reason": "Verhindert"}

# The entries case's own: two clubs of this season that left it, and the fixtures it adds to Otto's.
TEAM3 = ObjectId("6890a1b2c3d4e5f607e50003")
TEAM4 = ObjectId("6890a1b2c3d4e5f607e50004")
LEFT_AWAY = ObjectId("6890a1b2c3d4e5f607e50071")
LEFT_HOME = ObjectId("6890a1b2c3d4e5f607e50072")
DECLINED_HERE = ObjectId("6890a1b2c3d4e5f607e50073")
TODAYS = ObjectId("6890a1b2c3d4e5f607e50074")
OPEN_SLOT = ObjectId("6890a1b2c3d4e5f607e50075")

# The kick-off cases' own: a fixture of today kicked off before `NOW`, one of today with no time, and one moved back to
# the slot its newest row was closed for leaving.
KICKED_OFF = ObjectId("6890a1b2c3d4e5f607e50076")
UNTIMED = ObjectId("6890a1b2c3d4e5f607e50077")
MOVED_BACK = ObjectId("6890a1b2c3d4e5f607e50078")


def spiel(spiel_id: ObjectId, spiel_nr: int, date: str, *, schiedsrichter_id: ObjectId = OTTO_ID, **fields: Any) -> dict[str, Any]:
    return documents.spiel_document(
        spiel_id=spiel_id,
        saison_id=SAISON_ID,
        spiel_nr=spiel_nr,
        spieltag_id=SPIELTAG,
        **{
            "team1": {"team_id": TEAM1, "tore": None},
            "team2": {"team_id": TEAM2, "tore": None},
            "date": date,
            "time": "18:30:00",
            "schiedsrichter": {"schiedsrichter_id": schiedsrichter_id, "payment": 20},
            **fields,
        },
    )


SPIELE = [
    spiel(TO_ANSWER, 1, "2027-05-20", spielort={"spielort_id": SPIELORT, "mietpreis": 40}),
    spiel(REPORT_OWED, 2, "2027-05-03"),
    spiel(REPORTED, 3, "2027-05-01"),
    spiel(TO_COME, 4, "2027-05-24"),
    spiel(CALLED_OFF, 5, "2027-05-22", sonderereignis="annulliert"),
    spiel(STRUCK_OUT, 6, "2027-05-06", sonderereignis="ausgefallen"),
    spiel(UTES, 7, "2027-05-21", schiedsrichter_id=UTE_ID),
    {**spiel(LAST_SEASONS, 1, "2026-05-21"), "saison_id": EARLIER_SAISON},
]


def row(spiel_id: ObjectId, *, schiedsrichter_id: ObjectId = OTTO_ID, **fields: Any) -> dict[str, Any]:
    """The row the pass minted for the fixture's referee about the fixture as `SPIELE` holds it."""

    [stored] = [candidate for candidate in SPIELE if candidate["_id"] == spiel_id]

    return documents.spielbestaetigung_document(stored, party={"kind": "schiedsrichter", "schiedsrichter_id": schiedsrichter_id}, **fields)


async def seed(database: AsyncDatabase, *, saison_status: str) -> None:
    await database[Collection.SAISONS].insert_many(
        [documents.saison_document(SAISON_ID, saison_status), documents.saison_document(EARLIER_SAISON, "past")]
    )
    await database[Collection.SAISON_TEAMS].insert_many(
        [
            documents.saison_team_document(saison_id, team_id, name, shorthand)
            for saison_id in (SAISON_ID, EARLIER_SAISON)
            for team_id, name, shorthand in ((TEAM1, "Adler", "ADX"), (TEAM2, "Biber", "BIX"))
        ]
    )
    await database[Collection.SPIELORTE].insert_one(documents.spielort_document(SPIELORT, "Halle Ost"))
    consent = documents.own_einwilligung_document(text_versions=documents.SCHIEDSRICHTER_TEXT_VERSIONS, confirmed_at="2027-04-01")
    await database[Collection.SCHIEDSRICHTER].insert_many(
        [
            documents.schiedsrichter_document(referee_id, email=email, name=name, default_payment=20, einwilligung=consent)
            for referee_id, email, name in ((OTTO_ID, OTTO, "Otto Gruber"), (UTE_ID, UTE, "Ute Lang"), (KARL_ID, KARL, "Karl Ebert"))
        ]
    )
    await database[Collection.SPIELE].insert_many(SPIELE)
    # The booking Otto was first asked about moved since: only the fresh request is his to answer. Ute's row of his
    # fixture is not his at all.
    moved = {**row(TO_ANSWER)["ansetzung"], "date": "2027-05-19", "digest": "alt"}
    await database[Collection.SPIELBESTAETIGUNGEN].insert_many(
        [
            row(TO_ANSWER, _id=ObjectId("6890a1b2c3d4e5f607e50050"), ansetzung=moved, closed={"reason": "ansetzung_changed"}),
            row(TO_ANSWER, _id=ObjectId("6890a1b2c3d4e5f607e50051")),
            row(TO_ANSWER, _id=ObjectId("6890a1b2c3d4e5f607e50052"), schiedsrichter_id=UTE_ID),
            row(REPORT_OWED, answer=AGREED),
            row(TO_COME, answer={**AGREED, "by": {"kind": "admin"}, "reason": "Am Telefon zugesagt"}),
            row(CALLED_OFF, answer=AGREED),
        ]
    )
    await database[Collection.SPIELBERICHTE].insert_one(documents.spielbericht_document(SPIELE[2]))


def on_the_league(url: str, body: Any, *, saison_status: str = "active") -> Any:
    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME) as (client, database):
            await seed(database, saison_status=saison_status)
            return await body(database, client)

    return on_the_seed_loop(_run())


def own_spiele(identifier: str = OTTO) -> Any:
    def call(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        return get_self_spiele(
            saison_id=SAISON_ID,
            identifier=identifier,
            spiele_collection=database[Collection.SPIELE],
            records=record_collections(database),
            db=client,
            now=NOW,
        )

    return call


def own_saisons(identifier: str) -> Any:
    def call(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        return get_self_saisons(
            identifier=identifier, spiele_collection=database[Collection.SPIELE], records=record_collections(database), db=client
        )

    return call


def answered(url: str, call: Any, **seeding: Any) -> Any:
    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        return await call(database, client)

    return on_the_league(url, body, **seeding)


def refused(url: str, call: Any) -> str:
    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
        return await outcome_of(call(database, client))

    return on_the_league(url, body)


class TestTheSeasonsFixtures:
    def test_open_work_comes_first_then_the_days_to_come_then_the_days_gone_by(self, mongo_replica_set_url: str):
        """The report owed and the booking to answer ahead; Ute's fixture and last season's are not on the list."""

        answer = answered(mongo_replica_set_url, own_spiele())

        assert [(entry.spiel_id, entry.state, entry.reportable, entry.submitted_at is not None) for entry in answer.spiele] == [
            (REPORT_OWED, "agreed", True, False),
            (TO_ANSWER, "valid", False, False),
            (CALLED_OFF, "cancelled", False, False),
            (TO_COME, "agreed", False, False),
            (STRUCK_OUT, None, False, False),
            (REPORTED, None, True, True),
        ]

    def test_a_fixture_answers_its_bookings_newest_row_as_it_stands(self, mongo_replica_set_url: str):
        answer = answered(mongo_replica_set_url, own_spiele())

        [entry] = [entry for entry in answer.spiele if entry.spiel_id == TO_ANSWER]
        assert (entry.spielbestaetigung_id, entry.date, entry.team1_name, entry.team2_name, entry.past) == (
            ObjectId("6890a1b2c3d4e5f607e50051"),
            "2027-05-20",
            "Adler",
            "Biber",
            False,
        )
        assert entry.spielort is not None and entry.spielort.name == "Halle Ost"

    def test_the_leagues_answer_is_marked_and_its_reason_not_theirs_to_read(self, mongo_replica_set_url: str):
        answer = answered(mongo_replica_set_url, own_spiele())

        [entry] = [entry for entry in answer.spiele if entry.spiel_id == TO_COME]
        assert (entry.entered, entry.reason) == (True, None)

    def test_once_the_season_has_ended_no_report_is_owed(self, mongo_replica_set_url: str):
        answer = answered(mongo_replica_set_url, own_spiele(), saison_status="past")

        assert [entry.spiel_id for entry in answer.spiele if entry.reportable] == []
        assert answer.spiele[0].spiel_id == TO_ANSWER

    def test_an_address_holding_no_live_confirmed_record_is_refused(self, mongo_replica_set_url: str):
        assert refused(mongo_replica_set_url, own_spiele("niemand@example.com")) == Code.ROLE_NOT_HELD

    def test_each_entry_reads_its_clubs_rows_of_its_season_its_own_decline_its_day_and_an_open_slot(self, mongo_replica_set_url: str):
        """A request whose away or home club has left the season has ended; Adler's exit from the season before ends none.

        His own decline shows its reason, a fixture today is not past, an open away slot is named by nobody, and every entry
        carries its time.
        """

        left = {"type": "rueckzug", "reason": "Kein Team mehr", "date": "2027-05-01"}
        open_rows = {LEFT_AWAY: ObjectId("6890a1b2c3d4e5f607e50061"), LEFT_HOME: ObjectId("6890a1b2c3d4e5f607e50062")}
        added = [
            spiel(LEFT_AWAY, 8, "2027-05-25", team2={"team_id": TEAM3, "tore": None}),
            spiel(LEFT_HOME, 9, "2027-05-26", team1={"team_id": TEAM4, "tore": None}),
            spiel(DECLINED_HERE, 10, "2027-05-27"),
            spiel(TODAYS, 11, TODAY),
            spiel(OPEN_SLOT, 12, "2027-05-28", team2=None),
        ]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISON_TEAMS].insert_many(
                [
                    documents.saison_team_document(SAISON_ID, TEAM3, "Corax", "COX", austritt=left),
                    documents.saison_team_document(SAISON_ID, TEAM4, "Dachs", "DAX", austritt=left),
                ]
            )
            await database[Collection.SAISON_TEAMS].update_one(
                {"saison_id": EARLIER_SAISON, "team_id": TEAM1}, {"$set": {"austritt": {**left, "date": "2026-06-01"}}}
            )
            await database[Collection.SPIELE].insert_many(added)
            party = {"kind": "schiedsrichter", "schiedsrichter_id": OTTO_ID}
            await database[Collection.SPIELBESTAETIGUNGEN].insert_many(
                [
                    *(documents.spielbestaetigung_document(stored, party=party, _id=open_rows[stored["_id"]]) for stored in added[:2]),
                    documents.spielbestaetigung_document(
                        added[2], party=party, answer=OWN_DECLINE, closed={"reason": "schiedsrichter_declined"}
                    ),
                ]
            )
            return await own_spiele()(database, client)

        by_id = {entry.spiel_id: entry for entry in answered(mongo_replica_set_url, body).spiele}

        assert {spiel_id: by_id[spiel_id].state for spiel_id in (LEFT_AWAY, LEFT_HOME, TO_ANSWER)} == {
            LEFT_AWAY: "expired",
            LEFT_HOME: "expired",
            TO_ANSWER: "valid",
        }
        assert (by_id[DECLINED_HERE].state, by_id[DECLINED_HERE].reason) == ("declined", OWN_DECLINE["reason"])
        assert (by_id[TODAYS].past, by_id[REPORTED].past) == (False, True)
        assert (by_id[OPEN_SLOT].team1_name, by_id[OPEN_SLOT].team2_name) == ("Adler", None)
        assert {entry.time for entry in by_id.values()} == {"18:30:00"}

    def test_from_its_kick_off_a_booking_takes_no_answer_and_its_game_is_past(self, mongo_replica_set_url: str):
        """An unanswered booking reads as lapsed, and its game as played, from the kick-off; a game with no time from its day.

        Read by the day instead, the row would offer „Zusagen“ and „Ablehnen“ until midnight beside the report it owes.
        """

        added = [spiel(KICKED_OFF, 13, TODAY, time="11:00:00"), spiel(TODAYS, 11, TODAY), spiel(UNTIMED, 14, TODAY, time=None)]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELE].insert_many(added)
            # Unanswered, each about its fixture as it stands; a fixture with no time is asked nothing.
            party = {"kind": "schiedsrichter", "schiedsrichter_id": OTTO_ID}
            await database[Collection.SPIELBESTAETIGUNGEN].insert_many(
                [documents.spielbestaetigung_document(stored, party=party) for stored in added[:2]]
            )
            return await own_spiele()(database, client)

        by_id = {entry.spiel_id: entry for entry in answered(mongo_replica_set_url, body).spiele}

        assert [(by_id[spiel_id].state, by_id[spiel_id].past, by_id[spiel_id].reportable) for spiel_id in (KICKED_OFF, TODAYS, UNTIMED)] == [
            ("expired", True, True),
            ("valid", False, False),
            (None, True, True),
        ]

    def test_a_closed_row_reads_by_the_reason_it_was_closed_for(self, mongo_replica_set_url: str):
        """Its fixture moved back to the slot the row asked about, it still offers no answer: the press would meet `ansetzung_closed`."""

        moved_back = spiel(MOVED_BACK, 15, "2027-05-29")

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELE].insert_one(moved_back)
            await database[Collection.SPIELBESTAETIGUNGEN].insert_one(
                documents.spielbestaetigung_document(
                    moved_back,
                    party={"kind": "schiedsrichter", "schiedsrichter_id": OTTO_ID},
                    closed={"reason": "ansetzung_changed"},
                )
            )
            return await own_spiele()(database, client)

        [entry] = [entry for entry in answered(mongo_replica_set_url, body).spiele if entry.spiel_id == MOVED_BACK]

        assert entry.state == "invalid"


class TestTheSeasonsOffered:
    def test_each_season_booking_them_the_newest_first(self, mongo_replica_set_url: str):
        assert [saison.id for saison in answered(mongo_replica_set_url, own_saisons(OTTO)).saisons] == [SAISON_ID, EARLIER_SAISON]

    def test_a_referee_booked_nowhere_is_answered_none(self, mongo_replica_set_url: str):
        assert answered(mongo_replica_set_url, own_saisons(KARL)).saisons == []

    def test_an_address_holding_no_live_confirmed_record_is_refused(self, mongo_replica_set_url: str):
        assert refused(mongo_replica_set_url, own_saisons("niemand@example.com")) == Code.ROLE_NOT_HELD
