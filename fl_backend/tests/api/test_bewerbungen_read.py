import asyncio
from typing import Any, Mapping, cast

import pytest
from bson import ObjectId
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from pymongo.asynchronous.collection import AsyncCollection

from app.api.bewerbungen.router import FLBewerbungenFilters, get_bewerbungen
from app.api.bewerbungen.schemas import FLBewerbungenFilterParams
from app.api.bewerbungen.services import dubletten_schluessel_of
from app.core.collections import Collection
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

SAISON_ID = "2026"

# 20 fixed characters and a four-digit tail, so every id below is a well-formed ObjectId.
BEWERBUNG_ID = "6890a1b2c3d4e5f60793{:04d}"

ADDRESS = {
    "strasse": "Hanauer Landstraße",
    "hausnummer": "12a",
    "plz": "60314",
    "stadtteil": "Ostend",
    "stadt": "Frankfurt am Main",
}

KONTAKTPERSON = {
    "vorname": "Anke",
    "nachname": "Koerner",
    "email": "a.koerner@example.de",
    "telefon": "+49 170 1234567",
    "geburtsdatum": "1984-05-09",
    "einwilligung": {"umfang": "kontaktdaten", "erfasst_von": "person", "text_version": "v1", "datum": "2026-01-15"},
}


def bewerbung_document(
    index: int,
    status: str = "eingereicht",
    saison_id: str = SAISON_ID,
    *,
    shorthand: str = "SG",
    eingereicht_am: str = "2026-02-01",
    team_id: ObjectId | None = None,
) -> dict[str, Any]:
    """One stored application. Validated by the route, so every required field is here.

    A `team_id` empties `schule`: the two are exclusive (`docs/backend/spec.md :: I16`), and a row
    naming both collides on neither.
    """

    return {
        "_id": ObjectId(BEWERBUNG_ID.format(index)),
        "saison_id": saison_id,
        "eingereicht_am": eingereicht_am,
        "status": status,
        "team_id": team_id,
        "schule": None
        if team_id is not None
        else {
            "team_name": f"Schule {index}",
            "full_name": f"Schule {index} Gesamtschule",
            "shorthand": shorthand,
            "schulform": "gesamtschule",
            "address": dict(ADDRESS),
            "website_url": "https://example.de",
        },
        "kontakte": {
            "trainer": dict(KONTAKTPERSON),
            "ansprechperson": None,
            "stellvertretung": None,
            "trainer_ist_zugleich": None,
        },
        "trikot": {"vorhandener_satz": "16 rote Trikots", "wunschfarbe": "rot"},
        "kader": {"voraussichtliche_groesse": 14, "gute_spieler": 3},
        "entscheidung": None,
    }


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

    def find(self, filter: Any, projection: Any = None, collation: Any = None, session: Any = None) -> "_ArchiveCollection":
        self.requested_filter = filter
        # Applied rather than recorded: a fake serving every row whatever it was asked for would let
        # a case about what one status's page holds pass over rows of all three.
        self.documents = [document for document in self.documents if matches(document, filter or {})]
        return self

    async def count_documents(self, filter: Any) -> int:
        return len([document for document in self.stored if matches(document, filter or {})])

    def sort(self, sort_by: Any) -> "_ArchiveCollection":
        # Applied rather than accepted: a fake that ignores the sort hands back insertion order, and
        # a keyset walk over it would look total while paging the wrong end of the queue.
        for field, direction in reversed(list(sort_by)):
            self.documents.sort(key=lambda document: document[field], reverse=direction < 0)
        return self

    def limit(self, count: int) -> "_ArchiveCollection":
        self.requested_limit = count
        # Truncating rather than answering everything: this IS the silent loss under test.
        self.documents = self.documents[:count]
        return self

    async def to_list(self, length: int | None = None) -> list[dict[str, Any]]:
        return self.documents if length is None else self.documents[:length]

    async def aggregate(self, pipeline: Any, collation: Any = None, session: Any = None) -> "_Cells":
        # Grouped rather than answered from a canned list: cells of the reader's own shape would pass
        # a pipeline narrowed to the page. Which keys MongoDB really answers is the db tier's.
        self.requested_pipeline = list(pipeline)
        stages = {name: body for stage in self.requested_pipeline for name, body in stage.items()}
        grouped: dict[tuple[Any, ...], dict[str, Any]] = {}

        for document in self.stored:
            if not matches(document, stages.get("$match", {})):
                continue

            cell_id = {name: at(document, reference) for name, reference in stages["$group"]["_id"].items()}
            held = grouped.setdefault(tuple(cell_id.values()), {"_id": cell_id, "anzahl": 0})
            held["anzahl"] += 1

        return _Cells(list(grouped.values()))


class _Cells:
    """What `aggregate` answers with, `aggregate_many_from_db` asking the cursor for its own list."""

    def __init__(self, cells: list[dict[str, Any]]) -> None:
        self.cells = cells

    async def to_list(self, length: int | None = None) -> list[dict[str, Any]]:
        return self.cells if length is None else self.cells[:length]


def run_list(collection: _ArchiveCollection, **filters: Any) -> Any:
    """`asyncio.run`, as the rest of the suite drives an async function; no event-loop plugin is configured."""

    return asyncio.run(
        get_bewerbungen(
            bewerbungen_collection=cast(AsyncCollection, collection),
            filters=FLBewerbungenFilterParams.model_validate(filters),
        )
    )


class TestTheListDegradesRatherThanRefusing:
    """A tripwire would let an anonymous writer choose when this page 500s.

    The reason it does not sits at `app/api/bewerbungen/router.py :: get_bewerbungen`.
    """

    def test_an_archive_past_the_cap_is_served_short(self):
        answered = run_list(_ArchiveCollection(archive_of(LIST_LIMIT_DEFAULT + 25)))

        assert len(answered.bewerbungen) == LIST_LIMIT_DEFAULT
        assert answered.vollstaendig is False

    def test_an_archive_past_the_cap_raises_nothing(self):
        """The whole point of the change: the old guard answered 500 here, and 500 is the attack."""

        run_list(_ArchiveCollection(archive_of(LIST_LIMIT_DEFAULT * 3)))

    def test_an_archive_under_the_cap_is_whole(self):
        answered = run_list(_ArchiveCollection(archive_of(7)))

        assert len(answered.bewerbungen) == 7
        assert answered.vollstaendig is True

    def test_an_archive_exactly_at_the_cap_is_whole(self):
        """The boundary the probe row exists for: the largest complete answer must not call itself short."""

        answered = run_list(_ArchiveCollection(archive_of(LIST_LIMIT_DEFAULT)))

        assert len(answered.bewerbungen) == LIST_LIMIT_DEFAULT
        assert answered.vollstaendig is True

    def test_one_row_past_the_cap_is_the_first_incomplete_answer(self):
        """The other side of the same boundary, so the flag cannot be a constant."""

        assert run_list(_ArchiveCollection(archive_of(LIST_LIMIT_DEFAULT + 1))).vollstaendig is False

    def test_the_read_asks_one_row_past_what_it_serves(self):
        """Non-vacuity: a read bounded AT the cap could never tell a full list from a truncated one."""

        collection = _ArchiveCollection(archive_of(3))
        run_list(collection)

        assert collection.requested_limit == LIST_LIMIT_DEFAULT + 1

    def test_the_probe_row_is_never_served(self):
        answered = run_list(_ArchiveCollection(archive_of(9)), limit=4)

        assert len(answered.bewerbungen) == 4
        assert answered.vollstaendig is False


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

        assert run_list(_ArchiveCollection(archive_of(7)), limit=10).vollstaendig is True

    @pytest.mark.parametrize("refused", [0, -1, LIST_LIMIT_MAX + 1, 999999])
    def test_a_bound_outside_the_range_is_refused(self, refused: int):
        """The CAP, not just the default: a caller naming a larger read must not be served it."""

        with pytest.raises(ValidationError):
            FLBewerbungenFilterParams.model_validate({"limit": refused})


class TestTheFiltersStillNarrowTheRead:
    """Season and status are what an operator reaches for under a flood, so they reach the query."""

    def test_the_filters_named_reach_the_db_filter(self):
        collection = _ArchiveCollection(archive_of(3))
        run_list(collection, saison_id="2026", status=["eingereicht"])

        assert collection.requested_filter == {"saison_id": "2026", "status": {"$in": ["eingereicht"]}}

    def test_two_statuses_reach_the_read_as_one_term(self):
        """The whole reason the parameter is a list: `$in` is what a multi-select facet's second click composes."""

        collection = _ArchiveCollection(archive_of(3))
        run_list(collection, status=["angenommen", "abgelehnt"])

        assert collection.requested_filter == {"status": {"$in": ["angenommen", "abgelehnt"]}}

    def test_an_unfiltered_read_narrows_on_nothing(self):
        """The control: a filter built from absent parameters would narrow to rows nobody asked about."""

        collection = _ArchiveCollection(archive_of(3))
        run_list(collection)

        assert collection.requested_filter == {}


DUBLETTEN_DATABASE = worker_database("fl_bewerbungen_dubletten_test")

# The two ends of the queue, with the cap's worth of rows between them.
NEUESTE = 9001
AELTESTE = 9002
KUERZEL_PAAR = f"{SAISON_ID} kuerzel GG"


def straddling_archive() -> list[dict[str, Any]]:
    """One row past the cap, the colliding pair at the newest and the oldest end of the queue.

    Rebuilt per call: `insert_many` writes `_id` into every mapping it is handed.
    """

    # A club of its own per row between them, so the seeded pair is the only collision.
    filler = [
        bewerbung_document(index, eingereicht_am="2026-02-15", team_id=ObjectId(f"6890a1b2c3d4e5f60700{index:04d}"))
        for index in range(1, LIST_LIMIT_DEFAULT)
    ]

    return [
        *filler,
        bewerbung_document(NEUESTE, eingereicht_am="2026-02-28", shorthand="gg"),
        bewerbung_document(AELTESTE, eingereicht_am="2026-02-01", shorthand="GG"),
    ]


def mixed_archive() -> list[dict[str, Any]]:
    """Five open, three accepted, two declined, and the accepted ones in another season."""

    return [
        *(bewerbung_document(index) for index in range(1, 6)),
        *(bewerbung_document(index, status="angenommen", saison_id="2025") for index in range(6, 9)),
        *(bewerbung_document(index, status="abgelehnt") for index in range(9, 11)),
    ]


class TestTheCountsAreTheServersRatherThanTheRowsOnHand:
    """What the narrowing would otherwise cost: a caller counting the rows it was served.

    Narrowed to one status, that count is zero for every other status -- which is what the triage
    bar disables an option on.
    """

    def test_every_status_is_counted_though_the_page_holds_one(self):
        answered = run_list(_ArchiveCollection(mixed_archive()), status=["eingereicht"])

        assert [row.status for row in answered.bewerbungen] == ["eingereicht"] * 5
        assert answered.anzahl_je_status == {"eingereicht": 5, "angenommen": 3, "abgelehnt": 2}

    def test_a_page_holding_no_rows_still_says_what_the_others_hold(self):
        """The case that decides the shape: the counts cannot ride on the rows, because there need be none."""

        answered = run_list(_ArchiveCollection(mixed_archive()), saison_id=SAISON_ID, status=["angenommen"])

        assert answered.bewerbungen == []
        assert answered.anzahl_je_status == {"eingereicht": 5, "angenommen": 0, "abgelehnt": 2}

    def test_each_count_keeps_every_term_but_the_status_it_answers_for(self):
        """A count taken with the request's own status term applied would read zero for every status nobody asked for."""

        answered = run_list(_ArchiveCollection(mixed_archive()), saison_id="2026", status=["eingereicht"])

        assert answered.anzahl_je_status == {"eingereicht": 5, "angenommen": 0, "abgelehnt": 2}

    def test_the_counts_name_all_three_states_whatever_is_stored(self):
        """An option missing from the answer is an option the bar has no number for, which reads as zero."""

        assert sorted(run_list(_ArchiveCollection(archive_of(2))).anzahl_je_status) == ["abgelehnt", "angenommen", "eingereicht"]


class TestTheSeasonRelationIsATermTheReadNarrowsOn:
    """The queue's season facet opens narrowed, so a per-status count taken over every season lies.

    The state it counts elsewhere is offered, pressed, and lands on an empty list.
    """

    def test_the_opening_relation_narrows_the_read_to_the_season_named(self):
        collection = _ArchiveCollection(mixed_archive())
        run_list(collection, saison_id=SAISON_ID, saisonbezug=["diese_saison"], status=["eingereicht"])

        assert collection.requested_filter == {"saison_id": SAISON_ID, "status": {"$in": ["eingereicht"]}}

    def test_a_status_whose_rows_all_sit_in_another_season_is_counted_zero(self):
        """The defect this closes: three applications stand accepted, none of them in the season the bar opens on."""

        # Non-vacuity: unnarrowed, the same archive counts three -- which is the number the queue was
        # told while it sent no season term at all.
        assert run_list(_ArchiveCollection(mixed_archive())).anzahl_je_status["angenommen"] == 3

        answered = run_list(_ArchiveCollection(mixed_archive()), saison_id=SAISON_ID, saisonbezug=["diese_saison"], status=["eingereicht"])

        assert answered.anzahl_je_status == {"eingereicht": 5, "angenommen": 0, "abgelehnt": 2}

    def test_the_complement_serves_every_other_season(self):
        collection = _ArchiveCollection(mixed_archive())
        answered = run_list(collection, saison_id=SAISON_ID, saisonbezug=["andere_saison"], status=["angenommen"])

        assert collection.requested_filter == {"saison_id": {"$ne": SAISON_ID}, "status": {"$in": ["angenommen"]}}
        assert [row.saison_id for row in answered.bewerbungen] == ["2025"] * 3

    def test_both_relations_at_once_narrow_on_no_season(self):
        """Every option picked is the facet turned off, and it has to reach the archive rather than nothing."""

        collection = _ArchiveCollection(mixed_archive())
        run_list(collection, saison_id=SAISON_ID, saisonbezug=["diese_saison", "andere_saison"], status=["eingereicht"])

        assert collection.requested_filter == {"status": {"$in": ["eingereicht"]}}

    def test_a_relation_naming_no_season_narrows_on_nothing(self):
        """A relation to no season composes no term, and an empty page in its place would hide the queue."""

        collection = _ArchiveCollection(mixed_archive())
        run_list(collection, saisonbezug=["diese_saison"])

        assert collection.requested_filter == {}

    def test_the_season_alone_still_means_that_season(self):
        """The parameter's older meaning: a caller naming no relation asked for that season's queue."""

        collection = _ArchiveCollection(mixed_archive())
        run_list(collection, saison_id=SAISON_ID)

        assert collection.requested_filter == {"saison_id": SAISON_ID}

    def test_the_collision_pass_covers_the_seasons_the_relation_selects(self):
        """A collision key carries its own season, so the complement parts no pair that the season term left whole."""

        collection = _ArchiveCollection(mixed_archive())
        run_list(collection, saison_id=SAISON_ID, saisonbezug=["andere_saison"], status=["eingereicht"])

        assert collection.requested_pipeline[0] == {"$match": {"saison_id": {"$ne": SAISON_ID}, "status": "eingereicht"}}


class TestBothSidesOfTheSeasonRelationAreCounted:
    """The mirror of the status counts: narrowed to one side, the rows of the other are unserved.

    A page counting the rows on hand would read zero there and offer no way across.
    """

    def test_the_side_the_read_left_out_is_counted_all_the_same(self):
        answered = run_list(_ArchiveCollection(mixed_archive()), saison_id=SAISON_ID, saisonbezug=["diese_saison"], status=["angenommen"])

        assert answered.bewerbungen == []
        assert answered.anzahl_je_saisonbezug == {"diese_saison": 0, "andere_saison": 3}

    def test_each_side_keeps_the_status_term_and_ignores_the_relation(self):
        answered = run_list(_ArchiveCollection(mixed_archive()), saison_id=SAISON_ID, saisonbezug=["andere_saison"], status=["eingereicht"])

        assert answered.anzahl_je_saisonbezug == {"diese_saison": 5, "andere_saison": 0}

    def test_a_request_naming_no_season_files_every_row_under_the_other_side(self):
        """No season named is no season to stand in, which is what a served row's own flag answers too."""

        assert run_list(_ArchiveCollection(mixed_archive())).anzahl_je_saisonbezug == {"diese_saison": 0, "andere_saison": 10}

    def test_both_sides_are_named_whatever_is_stored(self):
        assert sorted(run_list(_ArchiveCollection(archive_of(2))).anzahl_je_saisonbezug) == ["andere_saison", "diese_saison"]


class TestTheCollisionIsAskedOverTheWholeQueue:
    """The pass the marking rests on. Narrowed the way the page is, a pair the cap parted is a group of one at each end."""

    def test_the_pass_ignores_the_status_the_page_was_narrowed_to(self):
        collection = _ArchiveCollection(mixed_archive())
        run_list(collection, status=["angenommen"])

        assert collection.requested_pipeline[0] == {"$match": {"status": "eingereicht"}}

    def test_the_pass_keeps_the_season_the_request_named(self):
        collection = _ArchiveCollection(mixed_archive())
        run_list(collection, saison_id=SAISON_ID, status=["eingereicht"])

        assert collection.requested_pipeline[0] == {"$match": {"saison_id": SAISON_ID, "status": "eingereicht"}}

    def test_the_pass_carries_no_bound_of_its_own(self):
        collection = _ArchiveCollection(archive_of(2))
        run_list(collection)

        assert [name for stage in collection.requested_pipeline for name in stage] == ["$match", "$group"]

    def test_the_answer_carries_the_keys_the_pass_found(self):
        """Read off the ANSWER: the fold's own cases below build cells by hand, which a router dropping the field would still satisfy."""

        collection = _ArchiveCollection([bewerbung_document(1, shorthand="gg"), bewerbung_document(2, shorthand="GG")])

        assert run_list(collection).dubletten_schluessel == [KUERZEL_PAAR]


class TestWhatCountsAsOneCollisionKey:
    """The fold and the pair rule, over cells of the shape the tally's `$group` answers with."""

    def test_two_cells_parted_by_the_kuerzels_case_are_one_collision(self):
        """Why the fold cannot move into the pipeline: MongoDB parts `gg` from `GG`, leaving two cells of one."""

        cells = [
            {"_id": {"saison_id": SAISON_ID, "team_id": None, "shorthand": "gg"}, "anzahl": 1},
            {"_id": {"saison_id": SAISON_ID, "team_id": None, "shorthand": " GG "}, "anzahl": 1},
        ]

        assert dubletten_schluessel_of(cells) == [KUERZEL_PAAR]

    def test_a_key_one_application_holds_is_named_by_nothing(self):
        cells = [{"_id": {"saison_id": SAISON_ID, "team_id": None, "shorthand": "GG"}, "anzahl": 1}]

        assert dubletten_schluessel_of(cells) == []

    def test_a_cell_naming_neither_a_club_nor_a_kuerzel_is_passed_over(self):
        """The row `REQ-BEWERBUNG-002` refuses, and two of them are not a pair."""

        cells = [{"_id": {"saison_id": SAISON_ID, "team_id": None, "shorthand": None}, "anzahl": 4}]

        assert dubletten_schluessel_of(cells) == []

    def test_the_season_parts_two_cells_sharing_a_kuerzel(self):
        cells = [
            {"_id": {"saison_id": SAISON_ID, "team_id": None, "shorthand": "GG"}, "anzahl": 1},
            {"_id": {"saison_id": "2025", "team_id": None, "shorthand": "GG"}, "anzahl": 1},
        ]

        assert dubletten_schluessel_of(cells) == []

    def test_a_club_and_a_kuerzel_spelling_one_text_are_two_keys(self):
        """`GG` as a club id is nothing a school could propose, and the words in the key are what keep them apart."""

        cells = [
            {"_id": {"saison_id": SAISON_ID, "team_id": "GG", "shorthand": None}, "anzahl": 1},
            {"_id": {"saison_id": SAISON_ID, "team_id": None, "shorthand": "GG"}, "anzahl": 1},
        ]

        assert dubletten_schluessel_of(cells) == []

    def test_a_club_key_spells_the_id_as_the_served_row_carries_it(self):
        """The frontend composes its half from a row's `team_id` string, so the two only meet on that spelling."""

        club = ObjectId("6890a1b2c3d4e5f600009999")
        cells = [{"_id": {"saison_id": SAISON_ID, "team_id": club, "shorthand": None}, "anzahl": 2}]

        assert dubletten_schluessel_of(cells) == [f"{SAISON_ID} team {club}"]


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
                    filters=FLBewerbungenFilterParams.model_validate({}),
                )

        answered = on_the_seed_loop(read())
        served = {row.id for row in answered.bewerbungen}

        # Non-vacuity: the cap has to have cut the queue and kept exactly one half of the pair, or a
        # whole-queue answer and one taken over the page agree by accident.
        assert answered.vollstaendig is False
        assert len(answered.bewerbungen) == LIST_LIMIT_DEFAULT
        assert ObjectId(BEWERBUNG_ID.format(NEUESTE)) in served
        assert ObjectId(BEWERBUNG_ID.format(AELTESTE)) not in served

        assert answered.dubletten_schluessel == [KUERZEL_PAAR]


# The declaration alone, mounted on a bare app: what is under test is how FastAPI fills the model, so
# the real router's admin guard and collection would only stand between the query string and it.
_probe = FastAPI()


# The router's own alias and never a second spelling of it: the filling is what these cases judge.
@_probe.get("/probe")
def _read_filters(filters: FLBewerbungenFilters) -> dict[str, Any]:
    return {"limit": filters.limit, "status": filters.status, "saisonbezug": filters.saisonbezug}


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

    # 422 rather than 404: the value arrives in the query string, and the routing clause in
    # `.claude/rules/backend.md` keeps 404 for a path id.
    @pytest.mark.parametrize("value", ["saison_id", "status", "eingereicht_am_desc"])
    def test_an_unoffered_sort_key_is_refused(self, value: str):
        with TestClient(_probe) as client:
            assert client.get(f"/probe?sort_by={value}").status_code == 422

    def test_the_offered_sort_key_is_served(self):
        """Non-vacuity: a model refusing every value would pass the case above without offering anything."""

        with TestClient(_probe) as client:
            assert client.get("/probe?sort_by=eingereicht_am").status_code == 200


class TestWhatAStatusSelectionMayBeSpelledAs:
    """A `list` field on a `Depends()` model publishes no query parameter and answers `None` whatever the query string holds.

    Silently, which is why `FLBewerbungenFilters` names `Query()` and why these cases drive the
    filling rather than the model.
    """

    @pytest.mark.parametrize(
        ("query", "picked"),
        [
            ("status=eingereicht", ["eingereicht"]),
            ("status=eingereicht&status=abgelehnt", ["eingereicht", "abgelehnt"]),
            ("status=eingereicht,abgelehnt", ["eingereicht", "abgelehnt"]),
            ("status=angenommen,abgelehnt&status=eingereicht", ["angenommen", "abgelehnt", "eingereicht"]),
        ],
    )
    def test_repeating_the_parameter_and_joining_its_values_are_one_selection(self, query: str, picked: list[str]):
        with TestClient(_probe) as client:
            assert client.get(f"/probe?{query}").json()["status"] == picked

    @pytest.mark.parametrize("query", ["", "status="])
    def test_an_absent_or_emptied_parameter_narrows_on_nothing(self, query: str):
        """`null` and never `[]`: the queue's off-switch is the empty parameter, and `$in: []` would answer it with nothing."""

        with TestClient(_probe) as client:
            assert client.get(f"/probe?{query}").json()["status"] is None

    # 422 rather than 404, the routing clause in `.claude/rules/backend.md` keeping 404 for a path id.
    @pytest.mark.parametrize("value", ["erfunden", "EINGEREICHT", "eingereicht,erfunden", "null", "0"])
    def test_a_status_outside_the_set_is_refused(self, value: str):
        with TestClient(_probe) as client:
            assert client.get(f"/probe?status={value}").status_code == 422

    def test_the_parameter_is_published_as_a_query_parameter(self):
        """What `Depends()` failed silently at: a body field publishes nothing here and is never filled from a URL."""

        with TestClient(_probe) as client:
            published = client.get("/openapi.json").json()["paths"]["/probe"]["get"]["parameters"]

        assert "status" in [parameter["name"] for parameter in published]


class TestWhatASeasonRelationMayBeSpelledAs:
    """The relation rides the same splitter as the status, so both are filled from one query string the same way."""

    @pytest.mark.parametrize(
        ("query", "picked"),
        [
            ("saisonbezug=diese_saison", ["diese_saison"]),
            ("saisonbezug=diese_saison,andere_saison", ["diese_saison", "andere_saison"]),
            ("saisonbezug=diese_saison&saisonbezug=andere_saison", ["diese_saison", "andere_saison"]),
        ],
    )
    def test_repeating_the_parameter_and_joining_its_values_are_one_selection(self, query: str, picked: list[str]):
        with TestClient(_probe) as client:
            assert client.get(f"/probe?{query}").json()["saisonbezug"] == picked

    @pytest.mark.parametrize("query", ["", "saisonbezug="])
    def test_an_absent_or_emptied_parameter_asks_for_no_relation(self, query: str):
        with TestClient(_probe) as client:
            assert client.get(f"/probe?{query}").json()["saisonbezug"] is None

    # 422 rather than 404, the routing clause in `.claude/rules/backend.md` keeping 404 for a path id.
    @pytest.mark.parametrize("value", ["erfunden", "DIESE_SAISON", "diese_saison,erfunden", "2026"])
    def test_a_relation_outside_the_set_is_refused(self, value: str):
        with TestClient(_probe) as client:
            assert client.get(f"/probe?saisonbezug={value}").status_code == 422

    def test_the_parameter_is_published_as_a_query_parameter(self):
        with TestClient(_probe) as client:
            published = client.get("/openapi.json").json()["paths"]["/probe"]["get"]["parameters"]

        assert "saisonbezug" in [parameter["name"] for parameter in published]
