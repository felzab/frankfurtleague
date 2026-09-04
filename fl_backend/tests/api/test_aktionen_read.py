import asyncio
import json
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
        "correlation_id": "9f2c1b7e4a6d8c3f",
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


class _LogCollection:
    """One collection, called as `pull_many_from_db` calls the driver: `find`, `sort`, `limit`, `to_list`."""

    def __init__(self, documents: list[dict[str, Any]]) -> None:
        self.documents = documents
        # What the route ASKED for, kept because the answer alone cannot tell a read bounded at the
        # cap from one bounded a document past it.
        self.requested_limit: int | None = None
        self.requested_filter: Any = None

    def find(self, filter: Any, projection: Any = None, collation: Any = None, session: Any = None) -> "_LogCollection":
        self.requested_filter = filter
        return self

    def sort(self, sort_by: Any) -> "_LogCollection":
        for field, direction in reversed(list(sort_by)):
            self.documents.sort(key=lambda document: str(document[field]), reverse=direction < 0)
        return self

    def limit(self, count: int) -> "_LogCollection":
        self.requested_limit = count
        # Truncating rather than answering everything: this IS the silent loss under test.
        self.documents = self.documents[:count]
        return self

    async def to_list(self, length: int | None = None) -> list[dict[str, Any]]:
        return self.documents if length is None else self.documents[:length]


def log_of(count: int) -> list[dict[str, Any]]:
    return [stored_row(_id=ObjectId(f"6890a1b2c3d4e5f607{index:06d}")) for index in range(1, count + 1)]


def run_list(collection: _LogCollection, **filters: Any) -> Any:
    """`asyncio.run`, as `test_bewerbungen_read.py` drives its route; no event-loop plugin is configured."""

    return asyncio.run(
        get_aktionen(
            aktionen_collection=cast(AsyncCollection, collection),
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
