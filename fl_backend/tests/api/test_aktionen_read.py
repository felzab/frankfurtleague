from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping
from typing import Any, cast

import pytest
from bson import ObjectId
from pymongo.asynchronous.collection import AsyncCollection

from app.api.aktionen.admin_router import get_aktionen
from app.api.aktionen.schemas import FLAktion, FLAktionenFilterParams, FLAktionenListAdapter, FLAktionMitStand
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT

# A `spiele` document as Mongo returns it: ids at the top, nested inside the embedded copies, and one
# in a list. A pass over the top level alone would leave every id that actually breaks serialization.
STORED_SPIEL = {
    "_id": ObjectId("6890a1b2c3d4e5f607200010"),
    "team1": {"team_id": ObjectId("6890a1b2c3d4e5f607200011"), "name": "Lessing", "tore": 2},
    "ort": {"spielort_id": ObjectId("6890a1b2c3d4e5f607200012"), "name": "Sportplatz Ost"},
    "schiedsrichter": {"schiedsrichter_id": ObjectId("6890a1b2c3d4e5f607200013"), "name": "A. Referee"},
    "mitwirkende": [ObjectId("6890a1b2c3d4e5f607200014")],
    "ergebnis": "2:1",
}


def stored_row(**overrides):
    row = {
        "_id": ObjectId("6890a1b2c3d4e5f607200020"),
        "at": "2026-03-15T09:30:00+00:00",
        "actor": {"kind": "admin_session", "email": "admin@example.invalid"},
        "trace_id": "9f2c1b7e4a6d8c3f",
        "request": {"method": "PATCH", "path": "/api/v0/spiele/{spiel_id}"},
        "collection": "spiele",
        "operation": "patch_one",
        "document_id": ObjectId("6890a1b2c3d4e5f607200010"),
        "db_filter": None,
        "before": dict(STORED_SPIEL),
        "modified_count": None,
        "redacted_at": None,
    }
    row.update(overrides)
    return row


class TestARecordedRowSurvivesTheResponseModel:
    """The write side is proved elsewhere; nothing proved a stored row could be served back out.

    Append-only and answered as a list, so one unrenderable row takes the page down and nothing
    can remove it. The image half is the SINGLE read's alone.
    """

    def test_a_stored_pre_image_serializes_to_json(self):
        serialized = FLAktionMitStand.model_validate(stored_row()).model_dump_json()

        assert json.loads(serialized)["before"]["ergebnis"] == "2:1"

    def test_every_objectid_in_the_pre_image_becomes_text(self):
        """`ObjectId` has no JSON form, so one left anywhere under `before` raises on serialization."""
        before = json.loads(FLAktionMitStand.model_validate(stored_row()).model_dump_json())["before"]

        assert before["_id"] == "6890a1b2c3d4e5f607200010"
        assert before["team1"]["team_id"] == "6890a1b2c3d4e5f607200011"
        assert before["ort"]["spielort_id"] == "6890a1b2c3d4e5f607200012"
        assert before["schiedsrichter"]["schiedsrichter_id"] == "6890a1b2c3d4e5f607200013"
        assert before["mitwirkende"] == ["6890a1b2c3d4e5f607200014"]

    def test_the_pre_image_keeps_every_other_value_as_stored(self):
        """A read model repairs nothing: the row answers with the document as it was, minus the id types."""
        before = FLAktionMitStand.model_validate(stored_row()).before

        # One document, never the array a removal stores: this row records a patch.
        assert isinstance(before, dict)
        assert before["team1"]["name"] == "Lessing"
        assert before["team1"]["tore"] == 2

    @pytest.mark.parametrize(
        ("collection", "document_id"),
        [
            # Every collection but `saisons` keys on an ObjectId; `saisons` keys on the season string.
            ("teams", ObjectId("6890a1b2c3d4e5f607200030")),
            ("saisons", "2026"),
        ],
    )
    def test_either_kind_of_document_id_serializes(self, collection: str, document_id: object):
        row = stored_row(collection=collection, document_id=document_id, before={"_id": document_id})

        assert json.loads(FLAktion.model_validate(row).model_dump_json())["document_id"] == str(document_id)

    def test_a_removals_id_array_serves_as_null(self):
        """The removed ids serve the redaction's `$in` alone (`docs/backend/spec.md :: I42`).

        On the wire the row stays a set-write: `document_id` names the one row a restore
        targets, and an array rendered as its Python repr would read as a dead id.
        """

        removed = [ObjectId("6890a1b2c3d4e5f607200040"), ObjectId("6890a1b2c3d4e5f607200041")]
        row = stored_row(operation="delete_many", document_id=removed, before=[dict(STORED_SPIEL)], db_filter={"saison_id": "2026"})

        assert json.loads(FLAktion.model_validate(row).model_dump_json())["document_id"] is None

    def test_a_fan_out_row_serializes_with_its_filter_and_count(self):
        row = stored_row(operation="patch_many", document_id=None, before=None, db_filter={"saison_id": "2026"}, modified_count=40)
        served = json.loads(FLAktion.model_validate(row).model_dump_json())

        assert served["db_filter"] == {"saison_id": "2026"}
        assert served["modified_count"] == 40

    def test_a_list_of_rows_serializes_whole(self):
        """The read answers with a list, so one unrenderable row would take every other row with it."""
        rows = FLAktionenListAdapter.validate_python([stored_row(), stored_row(operation="insert", before=None)])

        assert len(FLAktionenListAdapter.dump_json(rows)) > 0


class TestTheListReportsTheImageWithoutServingIt:
    """The list row answers `stand_gesichert` in the image's place (`docs/backend/spec.md :: I107`).

    The empty array is load-bearing: a removal that matched nothing secured no document, and must
    not badge like a kept image (I48).
    """

    @pytest.mark.parametrize(
        ("before", "recorded"),
        [
            (dict(STORED_SPIEL), True),
            ([dict(STORED_SPIEL)], True),
            ([], False),
            (None, False),
        ],
        ids=["one-image", "a-set-of-images", "a-removal-that-matched-nothing", "no-image-kept"],
    )
    def test_the_flag_reads_the_stored_image(self, before: object, recorded: bool):
        assert FLAktion.model_validate(stored_row(before=before)).stand_gesichert is recorded

    def test_the_image_itself_never_reaches_the_list_wire(self):
        served = json.loads(FLAktion.model_validate(stored_row()).model_dump_json())

        assert "before" not in served
        assert served["stand_gesichert"] is True


class _LogCells:
    """What `aggregate` answers with, called as `aggregate_many_from_db` calls the driver: `to_list`."""

    def __init__(self, cells: list[dict[str, Any]]) -> None:
        self.cells = cells

    async def to_list(self, length: int | None = None) -> list[dict[str, Any]]:
        return self.cells if length is None else self.cells[:length]


# Not subsumed by the counting cases: each of those covers one filter combination, so a term added to
# the tally alone under a `document_id` filter passes this module whole without this refusal.
def _plain_terms(match: Mapping[str, Any]) -> Mapping[str, Any]:
    """Refused rather than answered: a term matching nothing would read as a facet the log recorded no rows under.

    Judged whole and before any comparison, or whether the refusal fires depends on the rows a case seeded.
    """

    for field, value in match.items():
        if field.startswith("$") or isinstance(value, (Mapping, list)):
            raise AssertionError(f"the tally's $match carries {field}={value!r}, which this double answers with equality alone")

    return match


class _LogCollection:
    """One collection, called as `pull_many_from_db` calls the driver: `find`, `sort`, `limit`, `to_list`."""

    def __init__(self, documents: list[dict[str, Any]]) -> None:
        self.documents = documents
        # The whole population, kept apart from the list above: `limit` rebinds that one to a slice,
        # and the tally is issued against the same object in the same `asyncio.gather`.
        self.population = list(documents)
        # What the route ASKED for, kept because the answer alone cannot tell a read bounded at the
        # cap from one bounded a document past it.
        self.requested_limit: int | None = None
        self.requested_filter: Any = None
        self.requested_pipeline: Any = None

    async def aggregate(self, pipeline: Any, collation: Any = None, session: Any = None) -> _LogCells:
        """The `$match` is read; the `$group` beside it is not, so the cells below are this double's shape rather than the pipeline's.

        Which is why the group keys and the accumulator are pinned against a real server instead
        (`fl_backend/tests/api/test_aktionen_tally_execution.py`).
        """

        self.requested_pipeline = list(pipeline)
        match = _plain_terms(self.requested_pipeline[0].get("$match", {}))
        tally: dict[tuple[str, str], int] = {}

        for document in self.population:
            if any(document.get(field) != value for field, value in match.items()):
                continue
            cell = (str(document["collection"]), str(document["operation"]))
            tally[cell] = tally.get(cell, 0) + 1

        return _LogCells([{"_id": {"collection": area, "operation": art}, "anzahl": held} for (area, art), held in tally.items()])

    def find(self, filter: Any, projection: Any = None, collation: Any = None, session: Any = None) -> _LogCollection:
        self.requested_filter = filter
        return self

    def sort(self, sort_by: Any) -> _LogCollection:
        for field, direction in reversed(list(sort_by)):
            self.documents.sort(key=lambda document: str(document[field]), reverse=direction < 0)
        return self

    def limit(self, count: int) -> _LogCollection:
        self.requested_limit = count
        # Truncating rather than answering everything: this IS the silent loss under test.
        self.documents = self.documents[:count]
        return self

    async def to_list(self, length: int | None = None) -> list[dict[str, Any]]:
        return self.documents if length is None else self.documents[:length]


def log_of(count: int) -> list[dict[str, Any]]:
    return [stored_row(_id=ObjectId(f"6890a1b2c3d4e5f607{index:06d}")) for index in range(1, count + 1)]


def log_of_two_areas(recent: int, older: int) -> list[dict[str, Any]]:
    """One area's rows newer than the other's throughout, so a read bounded at the cap serves the first alone.

    The older area is the point: what it counts is a number no page carries.
    """

    return [
        stored_row(_id=ObjectId(f"6890a1b2c3d4e5f607{index:06d}"), collection="teams", operation="patch_one") for index in range(1, recent + 1)
    ] + [
        stored_row(
            _id=ObjectId(f"6890a1b2c3d4e5f608{index:06d}"),
            at="2025-03-15T09:30:00+00:00",
            collection="spielorte",
            operation="insert",
        )
        for index in range(1, older + 1)
    ]


# Named `log` rather than `collection`, which is a filter term this route takes: the keyword would
# collide with the parameter below it.
def run_list(log: _LogCollection, **filters: Any) -> Any:
    """`asyncio.run`, as `test_bewerbungen_read.py` drives its route; no event-loop plugin is configured."""

    return asyncio.run(
        get_aktionen(
            aktionen_collection=cast(AsyncCollection, log),
            filters=FLAktionenFilterParams.model_validate(filters),
        )
    )


class TestATruncatedPageSaysSo:
    """The log takes a row per recorded write and keeps it twelve months, so this read reaches the cap by ordinary use.

    The probe-row shape is `get_bewerbungen`'s (`docs/backend/spec.md :: I45`); the boundary
    cases mirror `test_bewerbungen_read.py`'s.
    """

    def test_a_log_past_the_cap_is_served_short_and_flagged(self):
        answered = run_list(_LogCollection(log_of(LIST_LIMIT_DEFAULT + 25)))

        assert len(answered.aktionen) == LIST_LIMIT_DEFAULT
        assert answered.vollstaendig is False

    def test_a_log_under_the_cap_is_whole(self):
        answered = run_list(_LogCollection(log_of(7)))

        assert len(answered.aktionen) == 7
        assert answered.vollstaendig is True

    def test_a_log_exactly_at_the_cap_is_whole(self):
        """The boundary the probe row exists for: the largest complete answer must not call itself short."""

        answered = run_list(_LogCollection(log_of(LIST_LIMIT_DEFAULT)))

        assert len(answered.aktionen) == LIST_LIMIT_DEFAULT
        assert answered.vollstaendig is True


class TestTheListNarrowsOnOneDocument:
    """`aktionen_target`'s first purpose: one document's history, asked for in the STORED spelling.

    The term is compiled rather than dumped (`app/api/aktionen/services.py :: document_id_term`).
    """

    def test_an_objectid_spelling_asks_for_the_stored_objectid(self):
        collection = _LogCollection(log_of(3))
        run_list(collection, document_id="6890a1b2c3d4e5f607200010")

        assert collection.requested_filter["document_id"] == ObjectId("6890a1b2c3d4e5f607200010")

    def test_a_season_id_asks_for_the_stored_string(self):
        """`saisons` is the one collection whose `_id` is its season string, so the text stands as given."""

        collection = _LogCollection(log_of(3))
        run_list(collection, document_id="2026_27")

        assert collection.requested_filter["document_id"] == "2026_27"

    @pytest.mark.parametrize(
        "value",
        [
            "6890a1b2 c3d4e5f6 071829",
            "6890a1b2\tc3d4e5f6\t071829",
            "6890a1b2\nc3d4e5f6\n071829",
            "6890a1b2\rc3d4e5f6\r071829",
            "6890a1b2\vc3d4e5f6\v071829",
            "6890a1b2\fc3d4e5f6\f071829",
        ],
    )
    def test_an_id_bson_decodes_shorter_asks_for_the_text_as_given(self, value: str):
        """`ObjectId.is_valid` accepts all six, so none is redundant: `bytes.fromhex` skips every ASCII whitespace character.

        Compiled, the eleven-byte id reaches the driver zero-padded into a well-formed id nobody
        typed, and the log answers for that other document.
        """

        collection = _LogCollection(log_of(3))
        run_list(collection, document_id=value)

        assert collection.requested_filter["document_id"] == value

    def test_an_upper_case_id_asks_for_the_stored_objectid(self):
        """Guards the fold: bson lower-cases a well-formed upper-case id, and a round trip compared exactly would send this one as text."""

        collection = _LogCollection(log_of(3))
        run_list(collection, document_id="6890A1B2C3D4E5F607200010")

        assert collection.requested_filter["document_id"] == ObjectId("6890a1b2c3d4e5f607200010")

    def test_an_unfiltered_read_names_no_document(self):
        collection = _LogCollection(log_of(3))
        run_list(collection)

        assert "document_id" not in collection.requested_filter

    def test_the_read_asks_one_row_past_what_it_serves(self):
        """Non-vacuity: a read bounded AT the cap could never tell a full list from a truncated one."""

        collection = _LogCollection(log_of(3))
        run_list(collection)

        assert collection.requested_limit == LIST_LIMIT_DEFAULT + 1

    def test_the_probe_row_is_never_served(self):
        answered = run_list(_LogCollection(log_of(9)), limit=4)

        assert len(answered.aktionen) == 4
        assert answered.vollstaendig is False


class TestTheFacetCountsAnswerForTheWholeLog:
    """The bar's options count the LOG, never the page the cap cut.

    Counted off the served rows instead, every other area reads zero and goes dead, and the control
    that hid them is the only way back.
    """

    def test_an_area_the_page_never_carries_still_counts(self):
        older = 5
        answered = run_list(_LogCollection(log_of_two_areas(LIST_LIMIT_DEFAULT, older)))

        # Non-vacuity: the answer has to be cut and one-area, or a count over the served rows agrees
        # with a count over the log by accident.
        assert len(answered.aktionen) == LIST_LIMIT_DEFAULT
        assert answered.vollstaendig is False
        assert {row.collection for row in answered.aktionen} == {"teams"}

        assert answered.anzahl_je_collection == {"teams": LIST_LIMIT_DEFAULT, "spielorte": older}
        assert answered.anzahl_je_operation == {"patch_one": LIST_LIMIT_DEFAULT, "insert": older}

    def test_an_areas_count_ignores_the_area_the_request_narrowed_to(self):
        """A dimension counted under its own selection offers the picked option and kills every other."""

        log = _LogCollection(log_of_two_areas(4, 5))
        answered = run_list(log, collection="teams")

        assert log.requested_filter["collection"] == {"$in": ["teams"]}
        assert answered.anzahl_je_collection == {"teams": 4, "spielorte": 5}

    def test_an_areas_count_keeps_the_operation_the_request_narrowed_to(self):
        """The other dimension does apply, or an option answers what it would leave under no filter at all."""

        answered = run_list(_LogCollection(log_of_two_areas(4, 5)), operation="insert")

        assert answered.anzahl_je_collection == {"spielorte": 5}
        assert answered.anzahl_je_operation == {"patch_one": 4, "insert": 5}

    def test_a_trace_narrows_the_counts_as_it_narrows_the_page(self):
        """`trace_id` is no facet, so it stays in the tally's own filter rather than being excluded from it."""

        rows = log_of_two_areas(4, 5)
        rows[0] = stored_row(_id=ObjectId("6890a1b2c3d4e5f607900001"), collection="teams", trace_id="0123456789abcdef")
        answered = run_list(_LogCollection(rows), trace_id="0123456789abcdef")

        assert answered.anzahl_je_collection == {"teams": 1}


class TestTheAreaAndOperationTermsCarryASelection:
    """The bar offering them is multi-select, so a joined value is the request two picked options make."""

    def test_a_two_area_selection_reaches_the_read_as_one_term(self):
        log = _LogCollection(log_of_two_areas(4, 5))
        run_list(log, collection="teams,spielorte")

        assert log.requested_filter["collection"] == {"$in": ["teams", "spielorte"]}

    def test_a_two_operation_selection_reaches_the_read_as_one_term(self):
        log = _LogCollection(log_of_two_areas(4, 5))
        run_list(log, operation="patch_one,insert")

        assert log.requested_filter["operation"] == {"$in": ["patch_one", "insert"]}

    def test_an_emptied_parameter_narrows_nothing(self):
        """The facet turned off. `$in: []` would answer that with a page holding nothing."""

        log = _LogCollection(log_of_two_areas(4, 5))
        run_list(log, collection="")

        assert "collection" not in log.requested_filter

    def test_the_tally_is_never_narrowed_by_a_facet_term(self):
        log = _LogCollection(log_of_two_areas(4, 5))
        run_list(log, collection="teams", operation="patch_one", trace_id="9f2c1b7e4a6d8c3f")

        assert log.requested_pipeline[0]["$match"] == {"trace_id": "9f2c1b7e4a6d8c3f"}


class TestTheDoubleRefusesAMatchItCannotAnswer:
    """The double reads the `$match` and answers equality alone, so an operator term must fail rather than match nothing.

    Answering nothing instead would read as a facet the log recorded no rows under, which this
    endpoint legally answers.
    """

    def test_an_operator_term_is_refused_rather_than_matching_nothing(self):
        with pytest.raises(AssertionError, match="equality alone"):
            _plain_terms({"document_id": {"$in": [ObjectId("6890a1b2c3d4e5f607200010")]}})

    def test_a_logical_operator_is_refused_too(self):
        with pytest.raises(AssertionError, match="equality alone"):
            _plain_terms({"$and": [{"trace_id": "9f2c1b7e4a6d8c3f"}]})

    def test_a_term_beside_a_refused_one_does_not_excuse_it(self):
        """The whole `$match`, so whether the refusal fires cannot depend on which rows a case seeded."""

        with pytest.raises(AssertionError, match="equality alone"):
            _plain_terms({"trace_id": "9f2c1b7e4a6d8c3f", "redacted_at": {"$eq": None}})

    def test_the_terms_the_tally_really_carries_are_passed_through(self):
        """Non-vacuity: a guard refusing everything passes every case above, and only this one names it as the cause."""

        assert _plain_terms({"trace_id": "9f2c1b7e4a6d8c3f"}) == {"trace_id": "9f2c1b7e4a6d8c3f"}
        assert _plain_terms({"document_id": ObjectId("6890a1b2c3d4e5f607200010")}) == {"document_id": ObjectId("6890a1b2c3d4e5f607200010")}
