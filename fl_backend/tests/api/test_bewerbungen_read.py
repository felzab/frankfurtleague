from __future__ import annotations

from typing import Any

import pytest
from bson import ObjectId

from app.api.bewerbungen.admin_router import get_bewerbung, get_bewerbungen_admin
from app.api.bewerbungen.services import saison_state_of, with_delivery
from app.api.outbox.schemas import FLOutboxStatus
from app.core.collections import Collection
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import confirmed_kenntnisnahme
from tests.worker import worker_database

SAISON_ID = "2026"

# 20 fixed characters and a four-digit tail, so every id below is a well-formed ObjectId.
BEWERBUNG_ID = "6890a1b2c3d4e5f60793{:04d}"

KONTAKTPERSON = {
    "first_name": "Anke",
    "last_name": "Koerner",
    "email": "a.koerner@example.de",
    "phone": "+49 170 1234567",
    "birth_date": "1984-05-09",
    "einwilligung": confirmed_kenntnisnahme(),
}


def bewerbung_document(
    index: int,
    status: str = "submitted",
    saison_id: str = SAISON_ID,
    *,
    submitted_at: str = "2026-02-01",
    team_id: ObjectId | None = None,
) -> dict[str, Any]:
    """One stored application. Validated by the route, so every required field is here.

    A `team_id` empties `schule`: the two are exclusive, and a row
    naming both collides on neither.
    """

    return documents.bewerbung_document(
        ObjectId(BEWERBUNG_ID.format(index)),
        saison_id,
        status,
        kontakte=documents.kontakte_document(trainer=dict(KONTAKTPERSON)),
        submitted_at=submitted_at,
        team_id=team_id,
        schule=None
        if team_id is not None
        else documents.new_schule_document(
            f"Schule {index}", full_name=f"Schule {index} Gesamtschule", schulform="gesamtschule", website_url="https://example.de"
        ),
        trikot={"existing_set": "16 rote Trikots", "wunschfarbe": "rot"},
    )


VIEW_DATABASE = worker_database("fl_bewerbungen_view_test")

VIEW_SAISON = "2027"
PICKED_CLUB = ObjectId("6890a1b2c3d4e5f600009998")
PICKED, ALSO_PICKED, NEW_SCHOOL, DECLINED, ANOTHER_SEASON = 9101, 9102, 9103, 9104, 9105


async def on_the_view_corpus(mongo_replica_set_url: str, read: Any) -> Any:
    """A `future` season with one full group and one with room, a pair naming one club, a new school, a declined row and another season's."""

    async with a_clean_database(mongo_replica_set_url, VIEW_DATABASE, constraints=True) as (_, database):
        rules = documents.rules_document(teams_per_gruppe=2, number_of_gruppen=2)
        await database[Collection.SAISONS].insert_one(documents.saison_document(VIEW_SAISON, "future", rules=rules))
        await database[Collection.TEAMS].insert_one(documents.team_document(PICKED_CLUB, "Adlerhorst", "ADX"))
        await database[Collection.SAISON_TEAMS].insert_many(
            [
                documents.saison_team_document(VIEW_SAISON, ObjectId(), "Fremd", "FRX", gruppe="A", trikot_farbe="blau"),
                documents.saison_team_document(VIEW_SAISON, ObjectId(), "Anders", "ANX", gruppe="A", trikot_farbe=None),
            ]
        )
        await database[Collection.BEWERBUNGEN].insert_many(
            [
                bewerbung_document(PICKED, saison_id=VIEW_SAISON, team_id=PICKED_CLUB),
                bewerbung_document(ALSO_PICKED, saison_id=VIEW_SAISON, team_id=PICKED_CLUB),
                bewerbung_document(NEW_SCHOOL, saison_id=VIEW_SAISON),
                bewerbung_document(DECLINED, "declined", VIEW_SAISON, team_id=PICKED_CLUB),
                # Its seat confirmed as every row here is, so the list's second read must keep it out by its season.
                bewerbung_document(ANOTHER_SEASON),
            ]
        )

        return await read(database)


async def view_list(database: Any) -> Any:
    return await get_bewerbungen_admin(
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        teams_collection=database[Collection.TEAMS],
        saisons_collection=database[Collection.SAISONS],
        saison_id=VIEW_SAISON,
    )


async def view_one(database: Any, bewerbung_id: ObjectId) -> Any:
    return await get_bewerbung(
        bewerbung_id=bewerbung_id,
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        teams_collection=database[Collection.TEAMS],
        saisons_collection=database[Collection.SAISONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        outbox_collection=database[Collection.OUTBOX],
        today="2026-02-02",
    )


class TestTheReviewPagesRead:
    pytestmark = pytest.mark.db

    def test_it_says_what_the_list_says_of_a_duplicate(self, mongo_replica_set_url: str):
        """A row's one chip can hide the Dublette, so this read is where an administrator deciding on it learns of the collision."""

        async def read(database: Any) -> Any:
            listed = await view_list(database)
            return {row.id: row.duplicate for row in listed.bewerbungen}, {
                row.id: (await view_one(database, row.id)).duplicate for row in listed.bewerbungen
            }

        listed, reviewed = on_the_seed_loop(on_the_view_corpus(mongo_replica_set_url, read))

        assert (
            reviewed
            == listed
            == {ObjectId(BEWERBUNG_ID.format(index)): index in (PICKED, ALSO_PICKED) for index in (PICKED, ALSO_PICKED, NEW_SCHOOL, DECLINED)}
        )


class TestTheSeasonsListRead:
    """The list page's one read: what its rows and its dialogs need, off one request, and no person's details."""

    pytestmark = pytest.mark.db

    def test_a_row_holds_the_list_and_nobody_s_details(self, mongo_replica_set_url: str):
        """The list shows counts, so an address here is personal data served to a page that never shows it."""

        answered = on_the_seed_loop(on_the_view_corpus(mongo_replica_set_url, view_list))

        assert KONTAKTPERSON["email"] not in answered.model_dump_json()
        assert {row.name for row in answered.bewerbungen} == {"Adlerhorst", f"Schule {NEW_SCHOOL}"}
        assert [row.new_school for row in answered.bewerbungen if row.id == ObjectId(BEWERBUNG_ID.format(NEW_SCHOOL))] == [True]

    def test_a_row_says_it_holds_a_seat_never_mailed(self, mongo_replica_set_url: str):
        """The sweep erases that application on its day, so the list must say so; a seat an erasure cleared and a decided row ask nothing."""

        def row_id(index: int) -> ObjectId:
            return ObjectId(BEWERBUNG_ID.format(index))

        async def read(database: Any) -> Any:
            for index, update in (
                (PICKED, {"confirmations.stellvertretung.sent_at": None}),
                (NEW_SCHOOL, {"confirmations.trainer": None}),
                (DECLINED, {"confirmations.trainer.sent_at": None}),
            ):
                await database[Collection.BEWERBUNGEN].update_one({"_id": row_id(index)}, {"$set": update})
            return await view_list(database)

        served = {row.id: row.unmailed for row in on_the_seed_loop(on_the_view_corpus(mongo_replica_set_url, read)).bewerbungen}

        assert served == {row_id(PICKED): True, row_id(ALSO_PICKED): False, row_id(NEW_SCHOOL): False, row_id(DECLINED): False}

    def test_a_flood_past_the_cap_says_it_is_cut_and_cuts_no_confirmed_row(self, mongo_replica_set_url: str):
        """The queue an anonymous form can flood: served short rather than refused, saying so, and with the season's confirmed rows."""

        flood = range(1, LIST_LIMIT_DEFAULT + 2)

        async def read(database: Any) -> Any:
            await database[Collection.BEWERBUNGEN].insert_many(
                [
                    {**bewerbung_document(index, saison_id=VIEW_SAISON, submitted_at="2026-03-01"), "kontakte": documents.kontakte_document()}
                    for index in flood
                ]
            )
            return await view_list(database)

        answered = on_the_seed_loop(on_the_view_corpus(mongo_replica_set_url, read))
        served = [row.id for row in answered.bewerbungen]

        assert answered.complete is False
        assert ObjectId(BEWERBUNG_ID.format(flood[0])) not in served
        assert served[LIST_LIMIT_DEFAULT:] == [ObjectId(BEWERBUNG_ID.format(index)) for index in (DECLINED, NEW_SCHOOL, ALSO_PICKED, PICKED)]

    def test_the_offer_marks_the_group_an_acceptance_would_be_refused_on(self, mongo_replica_set_url: str):
        """The dialog's greyed entry and `entry_gruppe_full` read one bound, so a page offers nothing the write refuses."""

        offer = on_the_seed_loop(on_the_view_corpus(mongo_replica_set_url, view_list)).saison

        assert (offer.status, [(row.gruppe, row.free) for row in offer.gruppen]) == ("future", [("A", 0), ("B", 2)])
        # The boxes the dialog disables, which `trikot_farbe_taken` would refuse: a row holding no colour takes none.
        assert offer.taken == ["blau"]


class TestEachSeatServesWhereItStands:
    """The state the triage's page chips and offers a re-send on: a state served wrong there asks an administrator to chase an answered seat."""

    LIVE = {"deadline": "2026-04-20", "declined_at": None}

    def read(self, *, status: str = "submitted", **confirmations: Any) -> dict[str, Any]:
        row = {
            "_id": "bewerbung",
            "status": status,
            "kontakte": {
                "trainer": documents.kontaktperson_document("Anke", confirmed_at="2026-04-02"),
                "ansprechperson": documents.kontaktperson_document("Berta"),
                "stellvertretung": None,
                "trainer_is_also": None,
            },
            "confirmations": {"trainer": self.LIVE, "ansprechperson": self.LIVE, "stellvertretung": None, **confirmations},
        }

        return with_delivery(row, {}, today="2026-04-10")["confirmations"]

    def test_a_stamp_a_decline_and_a_running_link_each_read_as_their_link_does(self):
        served = self.read(stellvertretung={"deadline": "2026-04-20", "declined_at": "2026-04-05"})

        assert [served[seat]["state"] for seat in ("trainer", "ansprechperson", "stellvertretung")] == ["confirmed", "valid", "declined"]

    def test_a_link_past_its_day_is_spent(self):
        assert self.read(ansprechperson={"deadline": "2026-04-09", "declined_at": None})["ansprechperson"]["state"] == "expired"

    def test_a_decision_spends_an_unanswered_link_whatever_its_day(self):
        assert self.read(status="declined")["ansprechperson"]["state"] == "expired"

    def test_a_row_its_season_stripped_serves_as_it_stands(self):
        """The strip nulls the block, and the review page still opens the application it leaves."""

        stripped = {"_id": "bewerbung", "kontakte": None, "confirmations": None}

        assert with_delivery(stripped, {}, today="2026-04-10") == stripped

    def test_a_season_row_s_confirmed_seat_reads_confirmed_and_offers_its_link_no_press(self):
        """Read off anything but the row's block, its link asks a person who answered to confirm again."""

        row = {
            "kontakte": {"trainer": documents.kontaktperson_document("Anke", confirmed_at="2026-04-02")},
            "confirmations": {"trainer": self.LIVE},
        }

        assert saison_state_of(row=row, seat="trainer", today="2026-04-10", saison_status="active") == "confirmed"


class TestEachSeatReadsItsLastMail:
    """The join the reads serve `delivery` by: one person is sent one mail for two seats, read by the seat it mirrors."""

    def test_a_trainer_who_is_another_seats_person_reads_that_seats_mail_and_an_emptied_seat_reads_none(self):
        """Served wrong, the bounce chip goes, the administrator's one sign that nobody was reached."""

        sent = FLOutboxStatus(state="sent", delivery=None)
        abandoned = FLOutboxStatus(state="abandoned", delivery=None)
        row = {
            "_id": "bewerbung",
            "kontakte": {"trainer_is_also": "ansprechperson"},
            "confirmations": {
                "trainer": {"sent_at": "2026-04-01"},
                "ansprechperson": {"sent_at": "2026-04-01"},
                "stellvertretung": None,
            },
        }

        served = with_delivery(row, {("bewerbung", "ansprechperson"): sent, ("bewerbung", "trainer"): abandoned}, today="2026-03-01")

        assert served["confirmations"]["trainer"]["delivery"] == served["confirmations"]["ansprechperson"]["delivery"] == sent
        assert served["confirmations"]["stellvertretung"] is None
