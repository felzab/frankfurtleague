from __future__ import annotations

import asyncio
from collections.abc import Mapping
from typing import Any, cast

import pytest
from bson import ObjectId
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from pymongo.asynchronous.collection import AsyncCollection

from app.api.bewerbungen.admin_router import FLBewerbungenFilters, get_bewerbung, get_bewerbungen, get_bewerbungen_admin
from app.api.bewerbungen.schemas import FLBewerbungenAdminFilterParams, FLBewerbungenFilterParams
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


def archive_of(count: int) -> list[dict[str, Any]]:
    return [bewerbung_document(index) for index in range(1, count + 1)]


def at(document: Mapping[str, Any], reference: str) -> Any:
    """A `$field.sub` reference, which is every expression the tally's group key composes."""

    held: Any = document

    for step in reference.removeprefix("$").split("."):
        held = held.get(step) if isinstance(held, Mapping) else None

    return held


def matches(document: Mapping[str, Any], db_filter: Mapping[str, Any]) -> bool:
    """Equality, `$in` and `$ne`, which is every operator this endpoint composes."""

    for field, term in db_filter.items():
        held = document.get(field)
        if field == "_id" and isinstance(term, dict) and "$lt" in term:
            if not held < term["$lt"]:
                return False
        elif isinstance(term, dict) and "$ne" in term:
            if held == term["$ne"]:
                return False
        elif isinstance(term, dict):
            if held not in term["$in"]:
                return False
        elif held != term:
            return False

    return True


class _ArchiveCollection:
    """One collection, called as `pull_many_from_db` calls the driver: `find`, `sort`, `limit`, `to_list`."""

    def __init__(self, documents: list[dict[str, Any]]) -> None:
        self.documents = documents
        # The archive as it stands, because `find` narrows `documents` in place and the counts are
        # answered against everything stored rather than against what one read left.
        self.stored = list(documents)
        # What the route ASKED for, kept because the answer alone cannot tell a read bounded at the
        # cap from one bounded a document past it.
        self.requested_limit: int | None = None
        # The cursor is a FILTER term, so a page of the right length off the wrong filter would
        # satisfy every assertion about its contents.
        self.requested_filter: Any = None
        # A `$limit` or a `$sort` reaching the tally would answer for a page, which is the whole
        # defect the pass exists to close, and its stages are the only place that shows.
        self.requested_pipeline: list[Mapping[str, Any]] = []

    def find(self, filter: Any, projection: Any = None, collation: Any = None, session: Any = None) -> _ArchiveCollection:
        self.requested_filter = filter
        # Applied rather than recorded: a fake serving every row whatever it was asked for would let
        # a case about what one status's page holds pass over rows of all three.
        self.documents = [document for document in self.documents if matches(document, filter or {})]
        return self

    async def count_documents(self, filter: Any) -> int:
        return len([document for document in self.stored if matches(document, filter or {})])

    def sort(self, sort_by: Any) -> _ArchiveCollection:
        # Applied rather than accepted: a fake that ignores the sort hands back insertion order, and
        # a keyset walk over it would look total while paging the wrong end of the queue.
        for field, direction in reversed(list(sort_by)):
            self.documents.sort(key=lambda document: document[field], reverse=direction < 0)
        return self

    def limit(self, count: int) -> _ArchiveCollection:
        self.requested_limit = count
        # Truncating rather than answering everything: this IS the silent loss under test.
        self.documents = self.documents[:count]
        return self

    async def to_list(self, length: int | None = None) -> list[dict[str, Any]]:
        return self.documents if length is None else self.documents[:length]

    async def aggregate(self, pipeline: Any, collation: Any = None, session: Any = None) -> _Cells:
        # Grouped rather than answered from a canned list: cells of the reader's own shape would pass
        # a pipeline narrowed to the page. Which keys MongoDB really answers is the db tier's.
        self.requested_pipeline = list(pipeline)
        first_match, first_group, *_ = [body for stage in self.requested_pipeline for body in stage.values()]
        grouped: dict[tuple[Any, ...], dict[str, Any]] = {}

        for document in self.stored:
            if not matches(document, first_match):
                continue

            cell_id = {name: at(document, reference) for name, reference in first_group["_id"].items()}
            held = grouped.setdefault(tuple(cell_id.values()), {"_id": cell_id, "count": 0})
            held["count"] += 1

        return _Cells([cell for cell in grouped.values() if cell["count"] > 1])


class _Cells:
    """What `aggregate` answers with, `aggregate_many_from_db` asking the cursor for its own list."""

    def __init__(self, cells: list[dict[str, Any]]) -> None:
        self.cells = cells

    async def to_list(self, length: int | None = None) -> list[dict[str, Any]]:
        return self.cells if length is None else self.cells[:length]


class _NothingStored:
    """The ban list and the seasons, holding nothing: the archive's own double answers what these cases are about."""

    def find(self, filter: Any, projection: Any = None, collation: Any = None, session: Any = None) -> _NothingStored:
        return self

    def limit(self, count: int) -> _NothingStored:
        return self

    async def to_list(self, length: int | None = None) -> list[dict[str, Any]]:
        return []

    async def find_one(self, filter: Any, projection: Any = None, session: Any = None) -> None:
        return None

    async def aggregate(self, pipeline: Any, collation: Any = None, session: Any = None) -> _Cells:
        return _Cells([])


def run_list(collection: _ArchiveCollection, **filters: Any) -> Any:
    """`asyncio.run`, as the rest of the suite drives an async function; no event-loop plugin is configured."""

    return asyncio.run(
        get_bewerbungen(
            bewerbungen_collection=cast(AsyncCollection, collection),
            outbox_collection=cast(AsyncCollection, _NothingStored()),
            ban_list=ban_list({Collection.BAN_LIST: _NothingStored(), Collection.SAISONS: _NothingStored()}),
            filters=FLBewerbungenFilterParams.model_validate(filters),
            today="2026-03-01",
        )
    )


class TestTheListDegradesRatherThanRefusing:
    """A tripwire would let an anonymous writer choose when this page 500s.

    The reason it does not sits at `app/api/bewerbungen/admin_router.py :: get_bewerbungen`.
    """

    def test_an_archive_past_the_cap_is_served_short(self):
        answered = run_list(_ArchiveCollection(archive_of(LIST_LIMIT_DEFAULT + 25)))

        assert len(answered.bewerbungen) == LIST_LIMIT_DEFAULT
        assert answered.complete is False

    def test_an_archive_past_the_cap_raises_nothing(self):
        """The whole point of the change: the old guard answered 500 here, and 500 is the attack."""

        run_list(_ArchiveCollection(archive_of(LIST_LIMIT_DEFAULT * 3)))

    def test_an_archive_under_the_cap_is_whole(self):
        answered = run_list(_ArchiveCollection(archive_of(7)))

        assert len(answered.bewerbungen) == 7
        assert answered.complete is True

    def test_an_archive_exactly_at_the_cap_is_whole(self):
        """The boundary the probe row exists for: the largest complete answer must not call itself short."""

        answered = run_list(_ArchiveCollection(archive_of(LIST_LIMIT_DEFAULT)))

        assert len(answered.bewerbungen) == LIST_LIMIT_DEFAULT
        assert answered.complete is True

    def test_one_row_past_the_cap_is_the_first_incomplete_answer(self):
        """The other side of the same boundary, so the flag cannot be a constant."""

        assert run_list(_ArchiveCollection(archive_of(LIST_LIMIT_DEFAULT + 1))).complete is False

    def test_the_read_asks_one_row_past_what_it_serves(self):
        """Non-vacuity: a read bounded AT the cap could never tell a full list from a truncated one."""

        collection = _ArchiveCollection(archive_of(3))
        run_list(collection)

        assert collection.requested_limit == LIST_LIMIT_DEFAULT + 1

    def test_the_probe_row_is_never_served(self):
        answered = run_list(_ArchiveCollection(archive_of(9)), limit=4)

        assert len(answered.bewerbungen) == 4
        assert answered.complete is False


class TestTheCallersOwnBoundIsCappedRatherThanObeyed:
    """`limit` is the operator's recovery path under a flood, and it is bounded on both sides."""

    @pytest.mark.parametrize("named", [1, 7, LIST_LIMIT_MAX])
    def test_a_named_bound_is_the_bound_served(self, named: int):
        collection = _ArchiveCollection(archive_of(LIST_LIMIT_MAX + 10))
        answered = run_list(collection, limit=named)

        assert len(answered.bewerbungen) == named
        assert collection.requested_limit == named + 1

    def test_a_named_bound_that_covers_the_archive_reports_it_whole(self):
        """A caller who asked for ten and got seven was not truncated, and must not be told they were."""

        assert run_list(_ArchiveCollection(archive_of(7)), limit=10).complete is True

    @pytest.mark.parametrize("refused", [0, -1, LIST_LIMIT_MAX + 1, 999999])
    def test_a_bound_outside_the_range_is_refused(self, refused: int):
        """The CAP, not just the default: a caller naming a larger read must not be served it."""

        with pytest.raises(ValidationError):
            FLBewerbungenFilterParams.model_validate({"limit": refused})


class TestTheFiltersStillNarrowTheRead:
    """Season and status are what an operator reaches for under a flood, so they reach the query."""

    def test_the_filters_named_reach_the_db_filter(self):
        collection = _ArchiveCollection(archive_of(3))
        run_list(collection, saison_id="2026", status=["submitted"])

        assert collection.requested_filter == {"saison_id": "2026", "status": {"$in": ["submitted"]}}

    def test_two_statuses_reach_the_read_as_one_term(self):
        """The whole reason the parameter is a list: `$in` is what a multi-select facet's second click composes."""

        collection = _ArchiveCollection(archive_of(3))
        run_list(collection, status=["accepted", "declined"])

        assert collection.requested_filter == {"status": {"$in": ["accepted", "declined"]}}

    def test_an_unfiltered_read_narrows_on_nothing(self):
        """The control: a filter built from absent parameters would narrow to rows nobody asked about."""

        collection = _ArchiveCollection(archive_of(3))
        run_list(collection)

        assert collection.requested_filter == {}


DUBLETTEN_DATABASE = worker_database("fl_bewerbungen_dubletten_test")

# The two ends of the queue, with the cap's worth of rows between them.
NEUESTE = 9001
AELTESTE = 9002
PAAR_CLUB = ObjectId("6890a1b2c3d4e5f600009999")
PAAR = f"{SAISON_ID} team {PAAR_CLUB}"


def straddling_archive() -> list[dict[str, Any]]:
    """One row past the cap, the colliding pair at the newest and the oldest end of the queue.

    Rebuilt per call: `insert_many` writes `_id` into every mapping it is handed.
    """

    # A club of its own per row between them, so the seeded pair is the only collision.
    filler = [
        bewerbung_document(index, submitted_at="2026-02-15", team_id=ObjectId(f"6890a1b2c3d4e5f60700{index:04d}"))
        for index in range(1, LIST_LIMIT_DEFAULT)
    ]

    return [
        *filler,
        bewerbung_document(NEUESTE, submitted_at="2026-02-28", team_id=PAAR_CLUB),
        bewerbung_document(AELTESTE, submitted_at="2026-02-01", team_id=PAAR_CLUB),
    ]


def mixed_archive() -> list[dict[str, Any]]:
    """Five open, three accepted, two declined, and the accepted ones in another season."""

    return [
        *(bewerbung_document(index) for index in range(1, 6)),
        *(bewerbung_document(index, status="accepted", saison_id="2025") for index in range(6, 9)),
        *(bewerbung_document(index, status="declined") for index in range(9, 11)),
    ]


class TestTheCountsAreTheServersRatherThanTheRowsOnHand:
    """What the narrowing would otherwise cost: a caller counting the rows it was served.

    Narrowed to one status, that count is zero for every other status -- which is what the triage
    bar disables an option on.
    """

    def test_every_status_is_counted_though_the_page_holds_one(self):
        answered = run_list(_ArchiveCollection(mixed_archive()), status=["submitted"])

        assert [row.status for row in answered.bewerbungen] == ["submitted"] * 5
        assert answered.count_per_status == {"submitted": 5, "accepted": 3, "declined": 2}

    def test_a_page_holding_no_rows_still_says_what_the_others_hold(self):
        """The case that decides the shape: the counts cannot ride on the rows, because there need be none."""

        answered = run_list(_ArchiveCollection(mixed_archive()), saison_id=SAISON_ID, status=["accepted"])

        assert answered.bewerbungen == []
        assert answered.count_per_status == {"submitted": 5, "accepted": 0, "declined": 2}

    def test_each_count_keeps_every_term_but_the_status_it_answers_for(self):
        """A count taken with the request's own status term applied would read zero for every status nobody asked for."""

        answered = run_list(_ArchiveCollection(mixed_archive()), saison_id="2026", status=["submitted"])

        assert answered.count_per_status == {"submitted": 5, "accepted": 0, "declined": 2}

    def test_the_counts_name_all_three_states_whatever_is_stored(self):
        """An option missing from the answer is an option the bar has no number for, which reads as zero."""

        assert sorted(run_list(_ArchiveCollection(archive_of(2))).count_per_status) == ["accepted", "declined", "submitted"]


class TestTheSeasonRelationIsATermTheReadNarrowsOn:
    """The queue's season facet opens narrowed, so a per-status count taken over every season lies.

    The state it counts elsewhere is offered, pressed, and lands on an empty list.
    """

    def test_the_opening_relation_narrows_the_read_to_the_season_named(self):
        collection = _ArchiveCollection(mixed_archive())
        run_list(collection, saison_id=SAISON_ID, saison_reference=["diese_saison"], status=["submitted"])

        assert collection.requested_filter == {"saison_id": SAISON_ID, "status": {"$in": ["submitted"]}}

    def test_a_status_whose_rows_all_sit_in_another_season_is_counted_zero(self):
        """The defect this closes: three applications stand accepted, none of them in the season the bar opens on."""

        # Non-vacuity: unnarrowed, the same archive counts three -- which is the number the queue was
        # told while it sent no season term at all.
        assert run_list(_ArchiveCollection(mixed_archive())).count_per_status["accepted"] == 3

        answered = run_list(_ArchiveCollection(mixed_archive()), saison_id=SAISON_ID, saison_reference=["diese_saison"], status=["submitted"])

        assert answered.count_per_status == {"submitted": 5, "accepted": 0, "declined": 2}

    def test_the_complement_serves_every_other_season(self):
        collection = _ArchiveCollection(mixed_archive())
        answered = run_list(collection, saison_id=SAISON_ID, saison_reference=["other_saison"], status=["accepted"])

        assert collection.requested_filter == {"saison_id": {"$ne": SAISON_ID}, "status": {"$in": ["accepted"]}}
        assert [row.saison_id for row in answered.bewerbungen] == ["2025"] * 3

    def test_both_relations_at_once_narrow_on_no_season(self):
        """Every option picked is the facet turned off, and it has to reach the archive rather than nothing."""

        collection = _ArchiveCollection(mixed_archive())
        run_list(collection, saison_id=SAISON_ID, saison_reference=["diese_saison", "other_saison"], status=["submitted"])

        assert collection.requested_filter == {"status": {"$in": ["submitted"]}}

    def test_a_relation_naming_no_season_narrows_on_nothing(self):
        """A relation to no season composes no term, and an empty page in its place would hide the queue."""

        collection = _ArchiveCollection(mixed_archive())
        run_list(collection, saison_reference=["diese_saison"])

        assert collection.requested_filter == {}

    def test_the_season_alone_still_means_that_season(self):
        """The parameter's older meaning: a caller naming no relation asked for that season's queue."""

        collection = _ArchiveCollection(mixed_archive())
        run_list(collection, saison_id=SAISON_ID)

        assert collection.requested_filter == {"saison_id": SAISON_ID}

    def test_the_collision_pass_covers_the_seasons_the_relation_selects(self):
        """A collision key carries its own season, so the complement parts no pair that the season term left whole."""

        collection = _ArchiveCollection(mixed_archive())
        run_list(collection, saison_id=SAISON_ID, saison_reference=["other_saison"], status=["submitted"])

        assert collection.requested_pipeline[0] == {
            "$match": {"saison_id": {"$ne": SAISON_ID}, "status": "submitted", "team_id": {"$ne": None}}
        }


class TestBothSidesOfTheSeasonRelationAreCounted:
    """The mirror of the status counts: narrowed to one side, the rows of the other are unserved.

    A page counting the rows on hand would read zero there and offer no way across.
    """

    def test_the_side_the_read_left_out_is_counted_all_the_same(self):
        answered = run_list(_ArchiveCollection(mixed_archive()), saison_id=SAISON_ID, saison_reference=["diese_saison"], status=["accepted"])

        assert answered.bewerbungen == []
        assert answered.count_per_saison_reference == {"diese_saison": 0, "other_saison": 3}

    def test_each_side_keeps_the_status_term_and_ignores_the_relation(self):
        answered = run_list(_ArchiveCollection(mixed_archive()), saison_id=SAISON_ID, saison_reference=["other_saison"], status=["submitted"])

        assert answered.count_per_saison_reference == {"diese_saison": 5, "other_saison": 0}

    def test_a_request_naming_no_season_files_every_row_under_the_other_side(self):
        """No season named is no season to stand in, which is what a served row's own flag answers too."""

        assert run_list(_ArchiveCollection(mixed_archive())).count_per_saison_reference == {"diese_saison": 0, "other_saison": 10}


class TestTheCollisionIsAskedOverTheWholeQueue:
    """The pass the marking rests on. Narrowed the way the page is, a pair the cap parted is a group of one at each end."""

    def test_the_pass_ignores_the_status_the_page_was_narrowed_to(self):
        collection = _ArchiveCollection(mixed_archive())
        run_list(collection, status=["accepted"])

        assert collection.requested_pipeline[0] == {"$match": {"status": "submitted", "team_id": {"$ne": None}}}

    def test_the_pass_keeps_the_season_the_request_named(self):
        collection = _ArchiveCollection(mixed_archive())
        run_list(collection, saison_id=SAISON_ID, status=["submitted"])

        assert collection.requested_pipeline[0] == {"$match": {"saison_id": SAISON_ID, "status": "submitted", "team_id": {"$ne": None}}}

    def test_the_pass_carries_no_bound_of_its_own(self):
        collection = _ArchiveCollection(archive_of(2))
        run_list(collection)

        assert [name for stage in collection.requested_pipeline for name in stage] == ["$match", "$group", "$match"]

    def test_the_answer_carries_the_keys_the_pass_found(self):
        """Read off the ANSWER: a router dropping the field would still pass a case over cells built by hand."""

        collection = _ArchiveCollection([bewerbung_document(1, team_id=PAAR_CLUB), bewerbung_document(2, team_id=PAAR_CLUB)])

        assert run_list(collection).duplicates_key == [PAAR]


class TestTheCollisionSurvivesTheReadsCap:
    """Only MongoDB's own `$group` proves the tally's keys are the names `dubletten_schluessel_of` reads them by.

    The double above answers cells of that reader's own shape, so it cannot fail that way.
    """

    pytestmark = pytest.mark.db

    def test_a_pair_at_the_two_ends_of_a_cut_queue_is_named(self, mongo_url: str):
        async def read() -> Any:
            async with a_clean_database(mongo_url, DUBLETTEN_DATABASE, constraints=True) as (_, database):
                collection = database[Collection.BEWERBUNGEN]
                await collection.insert_many(straddling_archive())

                return await get_bewerbungen(
                    bewerbungen_collection=collection,
                    outbox_collection=database[Collection.OUTBOX],
                    ban_list=ban_list(database),
                    filters=FLBewerbungenFilterParams.model_validate({}),
                    today="2026-03-01",
                )

        answered = on_the_seed_loop(read())
        served = {row.id for row in answered.bewerbungen}

        # Non-vacuity: the cap has to have cut the queue and kept exactly one half of the pair, or a
        # whole-queue answer and one taken over the page agree by accident.
        assert answered.complete is False
        assert len(answered.bewerbungen) == LIST_LIMIT_DEFAULT
        assert ObjectId(BEWERBUNG_ID.format(NEUESTE)) in served
        assert ObjectId(BEWERBUNG_ID.format(AELTESTE)) not in served

        assert answered.duplicates_key == [PAAR]


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

    @pytest.mark.parametrize(
        ("origin", "expected"),
        [pytest.param("new_school", {NEW_SCHOOL}, id="new"), pytest.param("existing_team", {PICKED, ALSO_PICKED, DECLINED}, id="existing")],
    )
    def test_the_origin_filter_parts_the_rows(self, mongo_url: str, origin: str, expected: set[int]):
        async def read(database: Any) -> Any:
            return await view_list(database, origin=[origin])

        answered = on_the_seed_loop(on_the_view_corpus(mongo_url, read))

        assert {row.id for row in answered.bewerbungen} == {ObjectId(BEWERBUNG_ID.format(index)) for index in expected}

    def test_the_review_page_reads_its_name_and_its_offer_off_one_request(self, mongo_url: str):
        async def read(database: Any) -> Any:
            return await get_bewerbung(
                bewerbung_id=ObjectId(BEWERBUNG_ID.format(PICKED)),
                bewerbungen_collection=database[Collection.BEWERBUNGEN],
                teams_collection=database[Collection.TEAMS],
                saisons_collection=database[Collection.SAISONS],
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
def _read_filters(filters: FLBewerbungenFilters) -> dict[str, Any]:
    return {"limit": filters.limit, "status": filters.status, "saison_reference": filters.saison_reference}


class TestNoQueryStringReachesAnUnboundedRead:
    """The cap is the whole bound, so a caller able to forge it past the ceiling would disarm it."""

    def test_an_omitted_bound_arrives_as_the_default(self):
        with TestClient(_probe) as client:
            assert client.get("/probe").json()["limit"] == LIST_LIMIT_DEFAULT

    def test_a_named_bound_arrives_as_the_number(self):
        with TestClient(_probe) as client:
            assert client.get("/probe?limit=10").json()["limit"] == 10

    @pytest.mark.parametrize("value", ["", "null", "none", "0", "-1", str(LIST_LIMIT_MAX + 1), "999999"])
    def test_no_query_string_reaches_a_larger_read(self, value: str):
        """Empty, unparseable or past either bound is a 422 -- never a read the caller sized."""

        with TestClient(_probe) as client:
            assert client.get(f"/probe?limit={value}").status_code == 422


class TestTheQueueOffersOneOrderAlone:
    """Why one order is all this endpoint offers sits at `app/api/bewerbungen/schemas.py :: FLBewerbungenSortOptions`."""

    # 422 rather than 404: the value arrives in the query string, and the `routing` line of
    # `docs/decisions.md` keeps 404 for a path id.
    @pytest.mark.parametrize("value", ["saison_id", "status", "submitted_at_desc"])
    def test_an_unoffered_sort_key_is_refused(self, value: str):
        with TestClient(_probe) as client:
            assert client.get(f"/probe?sort_by={value}").status_code == 422

    def test_the_offered_sort_key_is_served(self):
        """Non-vacuity: a model refusing every value would pass the case above without offering anything."""

        with TestClient(_probe) as client:
            assert client.get("/probe?sort_by=submitted_at").status_code == 200


class TestWhatAStatusSelectionMayBeSpelledAs:
    """A `list` field on a `Depends()` model publishes no query parameter and answers `None` whatever the query string holds.

    Silently, which is why `FLBewerbungenFilters` names `Query()` and why these cases drive the
    filling rather than the model.
    """

    @pytest.mark.parametrize(
        ("query", "picked"),
        [
            ("status=submitted", ["submitted"]),
            ("status=submitted&status=declined", ["submitted", "declined"]),
        ],
    )
    def test_each_repeated_key_is_one_value_of_the_selection(self, query: str, picked: list[str]):
        with TestClient(_probe) as client:
            assert client.get(f"/probe?{query}").json()["status"] == picked

    def test_an_absent_parameter_narrows_on_nothing(self):
        """`null` and never `[]`: the facet turned off sends no key, and `$in: []` would answer it with nothing."""

        with TestClient(_probe) as client:
            assert client.get("/probe").json()["status"] is None

    # 422 rather than 404, the `routing` line of `docs/decisions.md` keeping 404 for a path id. A comma-joined
    # pair is one value outside the set.
    @pytest.mark.parametrize("value", ["erfunden", "SUBMITTED", "submitted,declined", "", "null", "0"])
    def test_a_status_outside_the_set_is_refused(self, value: str):
        with TestClient(_probe) as client:
            assert client.get(f"/probe?status={value}").status_code == 422

    def test_the_parameter_is_published_as_a_query_parameter(self):
        """What `Depends()` failed silently at: a body field publishes nothing here and is never filled from a URL."""

        with TestClient(_probe) as client:
            published = client.get("/openapi.json").json()["paths"]["/probe"]["get"]["parameters"]

        assert "status" in [parameter["name"] for parameter in published]


class TestWhatASeasonRelationMayBeSpelledAs:
    """The relation is a list as the status is, so both are filled from one query string the same way."""

    @pytest.mark.parametrize(
        ("query", "picked"),
        [
            ("saison_reference=diese_saison", ["diese_saison"]),
            ("saison_reference=diese_saison&saison_reference=other_saison", ["diese_saison", "other_saison"]),
        ],
    )
    def test_each_repeated_key_is_one_value_of_the_selection(self, query: str, picked: list[str]):
        with TestClient(_probe) as client:
            assert client.get(f"/probe?{query}").json()["saison_reference"] == picked

    def test_an_absent_parameter_asks_for_no_relation(self):
        with TestClient(_probe) as client:
            assert client.get("/probe").json()["saison_reference"] is None

    # 422 rather than 404, the `routing` line of `docs/decisions.md` keeping 404 for a path id.
    @pytest.mark.parametrize("value", ["erfunden", "DIESE_SAISON", "diese_saison,andere_saison", "", "2026"])
    def test_a_relation_outside_the_set_is_refused(self, value: str):
        with TestClient(_probe) as client:
            assert client.get(f"/probe?saison_reference={value}").status_code == 422

    def test_the_parameter_is_published_as_a_query_parameter(self):
        with TestClient(_probe) as client:
            published = client.get("/openapi.json").json()["paths"]["/probe"]["get"]["parameters"]

        assert "saison_reference" in [parameter["name"] for parameter in published]


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
