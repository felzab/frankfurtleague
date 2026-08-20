import json

import pytest
from bson import ObjectId

from app.api.aktionen.schemas import FLAktion, FLAktionenListAdapter

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

    Append-only, and the read answers with a list, so one unrenderable row takes the page down and
    nothing can remove it.
    """

    def test_a_stored_pre_image_serializes_to_json(self):
        serialized = FLAktion.model_validate(stored_row()).model_dump_json()

        assert json.loads(serialized)["before"]["ergebnis"] == "2:1"

    def test_every_objectid_in_the_pre_image_becomes_text(self):
        """`ObjectId` has no JSON form, so one left anywhere under `before` raises on serialization."""
        before = json.loads(FLAktion.model_validate(stored_row()).model_dump_json())["before"]

        assert before["_id"] == "6890a1b2c3d4e5f607200010"
        assert before["team1"]["team_id"] == "6890a1b2c3d4e5f607200011"
        assert before["ort"]["spielort_id"] == "6890a1b2c3d4e5f607200012"
        assert before["schiedsrichter"]["schiedsrichter_id"] == "6890a1b2c3d4e5f607200013"
        assert before["mitwirkende"] == ["6890a1b2c3d4e5f607200014"]

    def test_the_pre_image_keeps_every_other_value_as_stored(self):
        """A read model repairs nothing: the row answers with the document as it was, minus the id types."""
        before = FLAktion.model_validate(stored_row()).before

        assert before is not None
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

    def test_a_create_carries_no_pre_image(self):
        row = stored_row(operation="insert", before=None)

        assert json.loads(FLAktion.model_validate(row).model_dump_json())["before"] is None

    def test_a_fan_out_row_serializes_with_its_filter_and_count(self):
        row = stored_row(operation="patch_many", document_id=None, before=None, db_filter={"saison_id": "2026"}, modified_count=40)
        served = json.loads(FLAktion.model_validate(row).model_dump_json())

        assert served["db_filter"] == {"saison_id": "2026"}
        assert served["modified_count"] == 40

    def test_a_list_of_rows_serializes_whole(self):
        """The read answers with a list, so one unrenderable row would take every other row with it."""
        rows = FLAktionenListAdapter.validate_python([stored_row(), stored_row(operation="insert", before=None)])

        assert len(FLAktionenListAdapter.dump_json(rows)) > 0
