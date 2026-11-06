from __future__ import annotations

from typing import Any

import pytest
from bson import ObjectId
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.bewerbungen.admin_router import FLBewerbungenAdminFilters, get_bewerbung, get_bewerbungen_admin
from app.api.bewerbungen.schemas import FLBewerbungenAdminFilterParams
from app.api.bewerbungen.services import mit_zustellung
from app.api.outbox.schemas import FLOutboxStatus
from app.core.collections import Collection
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX
from tests import documents
from tests.bans import ban_list
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
        trikot={"existing_satz": "16 rote Trikots", "wunschfarbe": "rot"},
    )


VIEW_DATABASE = worker_database("fl_bewerbungen_view_test")

VIEW_SAISON = "2027"
PICKED_CLUB = ObjectId("6890a1b2c3d4e5f600009998")
PICKED, ALSO_PICKED, NEW_SCHOOL, DECLINED = 9101, 9102, 9103, 9104


async def on_the_view_corpus(mongo_url: str, read: Any) -> Any:
    """A `future` season with one full group and one with room, a pair naming one club, a new school and a declined row."""

    async with a_clean_database(mongo_url, VIEW_DATABASE, constraints=True) as (_, database):
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
            ]
        )

        return await read(database)


async def view_list(database: Any, **filters: Any) -> Any:
    return await get_bewerbungen_admin(
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        teams_collection=database[Collection.TEAMS],
        saisons_collection=database[Collection.SAISONS],
        filters=FLBewerbungenAdminFilterParams.model_validate({"saison_id": VIEW_SAISON, **filters}),
    )


class TestTheSeasonsListRead:
    """The list page's one read: what its rows and its dialogs need, off one request, and no person's details."""

    pytestmark = pytest.mark.db

    def test_a_row_holds_the_list_and_nobody_s_details(self, mongo_url: str):
        """The list shows counts, so an address here is personal data served to a page that never shows it."""

        answered = on_the_seed_loop(on_the_view_corpus(mongo_url, view_list))

        assert KONTAKTPERSON["email"] not in answered.model_dump_json()
        assert {row.name for row in answered.bewerbungen} == {"Adlerhorst", f"Schule {NEW_SCHOOL}"}
        assert [row.new_school for row in answered.bewerbungen if row.id == ObjectId(BEWERBUNG_ID.format(NEW_SCHOOL))] == [True]

    def test_a_list_past_the_cap_says_it_is_cut(self, mongo_url: str):
        """The queue an anonymous form can flood: served short rather than refused, and saying so, the page's one warning."""

        async def read(database: Any) -> Any:
            return await view_list(database, limit=3)

        answered = on_the_seed_loop(on_the_view_corpus(mongo_url, read))

        assert (len(answered.bewerbungen), answered.complete) == (3, False)

    def test_two_open_rows_naming_one_club_are_marked_and_a_decided_one_is_not(self, mongo_url: str):
        answered = on_the_seed_loop(on_the_view_corpus(mongo_url, view_list))

        marked = {row.id for row in answered.bewerbungen if row.duplicate}

        assert marked == {ObjectId(BEWERBUNG_ID.format(PICKED)), ObjectId(BEWERBUNG_ID.format(ALSO_PICKED))}

    def test_the_offer_marks_the_group_an_acceptance_would_be_refused_on(self, mongo_url: str):
        """The dialog's greyed entry and `entry_gruppe_full` read one bound, so a page offers nothing the write refuses."""

        offer = on_the_seed_loop(on_the_view_corpus(mongo_url, view_list)).saison

        assert (offer.status, [(row.gruppe, row.free) for row in offer.gruppen]) == ("future", [("A", 0), ("B", 2)])

    def test_a_row_names_the_code_of_its_club_alone(self, mongo_url: str):
        """The acceptance's closed box: a picked club's code stands in `teams`, and a new school has none until it is accepted."""

        answered = on_the_seed_loop(on_the_view_corpus(mongo_url, view_list))

        codes = {row.id: row.shorthand for row in answered.bewerbungen}

        assert codes[ObjectId(BEWERBUNG_ID.format(PICKED))] == "ADX"
        assert codes[ObjectId(BEWERBUNG_ID.format(NEW_SCHOOL))] is None

    def test_the_review_page_reads_its_name_and_its_offer_off_one_request(self, mongo_url: str):
        async def read(database: Any) -> Any:
            return await get_bewerbung(
                bewerbung_id=ObjectId(BEWERBUNG_ID.format(PICKED)),
                bewerbungen_collection=database[Collection.BEWERBUNGEN],
                teams_collection=database[Collection.TEAMS],
                saisons_collection=database[Collection.SAISONS],
                saison_teams_collection=database[Collection.SAISON_TEAMS],
                outbox_collection=database[Collection.OUTBOX],
                ban_list=ban_list(database),
                today="2026-03-01",
            )

        answered = on_the_seed_loop(on_the_view_corpus(mongo_url, read))

        assert (answered.name, answered.shorthand, answered.saison.saison_id, answered.bewerbung.version) == (
            "Adlerhorst",
            "ADX",
            VIEW_SAISON,
            0,
        )


# The declaration alone, mounted on a bare app: what is under test is how FastAPI fills the model, so
# the real router's admin guard and collection would only stand between the query string and it.
_probe = FastAPI()


# The router's own alias and never a second spelling of it: the filling is what these cases judge.
@_probe.get("/probe")
def _read_filters(filters: FLBewerbungenAdminFilters) -> dict[str, Any]:
    return {"limit": filters.limit}


class TestNoQueryStringReachesAnUnboundedRead:
    """The cap is the whole bound, so a caller able to forge it past the ceiling would disarm it."""

    def test_an_omitted_bound_arrives_as_the_default(self):
        with TestClient(_probe) as client:
            assert client.get("/probe?saison_id=2027").json()["limit"] == LIST_LIMIT_DEFAULT

    @pytest.mark.parametrize("value", ["", "null", "none", "0", "-1", str(LIST_LIMIT_MAX + 1), "999999"])
    def test_no_query_string_reaches_a_larger_read(self, value: str):
        """Empty, unparseable or past either bound is a 422 -- never a read the caller sized."""

        with TestClient(_probe) as client:
            assert client.get(f"/probe?saison_id=2027&limit={value}").status_code == 422


class TestEachSeatReadsItsLastMail:
    """The join the reads serve `delivery` by: one person is sent one mail for two seats, read by the seat it mirrors."""

    def test_a_trainer_who_is_another_seats_person_reads_that_seats_mail_and_an_emptied_seat_reads_none(self):
        sent = FLOutboxStatus(state="sent", delivery=None)
        aufgegeben = FLOutboxStatus(state="abandoned", delivery=None)
        row = {
            "_id": "bewerbung",
            "kontakte": {"trainer_is_also": "ansprechperson"},
            "confirmations": {
                "trainer": {"sent_at": "2026-04-01"},
                "ansprechperson": {"sent_at": "2026-04-01"},
                "stellvertretung": None,
            },
        }

        served = mit_zustellung(row, {("bewerbung", "ansprechperson"): sent, ("bewerbung", "trainer"): aufgegeben}, today="2026-03-01")

        assert served["confirmations"]["trainer"]["delivery"] == served["confirmations"]["ansprechperson"]["delivery"] == sent
        assert served["confirmations"]["stellvertretung"] is None

    def test_a_seat_nobody_was_owed_a_mail_reads_null(self):
        row = {"_id": "bewerbung", "kontakte": {"trainer_is_also": None}, "confirmations": {"trainer": {"sent_at": "2026-04-01"}}}

        assert mit_zustellung(row, {}, today="2026-03-01")["confirmations"]["trainer"]["delivery"] is None
