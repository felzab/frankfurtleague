from __future__ import annotations

import asyncio
import json
from typing import Any, cast

import pytest
from bson import ObjectId
from pydantic import ValidationError
from pymongo.asynchronous.collection import AsyncCollection

from app.api.aktionen.admin_router import get_action_log
from app.api.aktionen.schemas import FLActionLogEntry, FLActionLogEntryWithBefore, FLAktionenFilterParams
from app.api.aktionen.services import actor_addresses, mit_vorenthaltenem_akteur
from app.core.collections import Collection
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from tests.bans import ban_list

# A `spiele` document as Mongo returns it: ids at the top, nested inside the embedded copies, and one
# in a list. A pass over the top level alone would leave every id that actually breaks serialization.
STORED_SPIEL = {
    "_id": ObjectId("6890a1b2c3d4e5f607200010"),
    "team1": {"team_id": ObjectId("6890a1b2c3d4e5f607200011"), "tore": 2},
    "spielort": {"spielort_id": ObjectId("6890a1b2c3d4e5f607200012")},
    "schiedsrichter": {"schiedsrichter_id": ObjectId("6890a1b2c3d4e5f607200013")},
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
        "erasure_reason": None,
    }
    row.update(overrides)
    return row


def served_row(**overrides):
    """A stored row as both reads hand it to their models, its actor barred by nobody."""

    return mit_vorenthaltenem_akteur(stored_row(**overrides), frozenset())


class TestARecordedRowSurvivesTheResponseModel:
    """The write side is proved elsewhere; nothing proved a stored row could be served back out.

    Append-only and answered as a list, so one unrenderable row takes the page down and nothing
    can remove it. The image half is the SINGLE read's alone.
    """

    def test_the_pre_image_keeps_every_other_value_as_stored(self):
        """A read model repairs nothing: the row answers with the document as it was, minus the id types."""
        before = FLActionLogEntryWithBefore.model_validate(served_row()).before

        # One document, never the array a removal stores: this row records a patch.
        assert isinstance(before, dict)
        assert before["team1"]["tore"] == 2


class TestAPersonsPseudonymIsServedAsItsPrefix:
    """What the page renders is all the read hands the browser; the whole value stays in the store."""

    PERSON = {"kind": "person_session", "pseudonym": "3f9a07c2" + "d" * 56, "funktion": "spieler"}

    @pytest.mark.parametrize("model", [FLActionLogEntry, FLActionLogEntryWithBefore])
    def test_both_reads_serve_the_first_eight_characters(self, model: type[FLActionLogEntry] | type[FLActionLogEntryWithBefore]):
        served = json.loads(model.model_validate(served_row(actor=dict(self.PERSON))).model_dump_json())["actor"]

        assert served == {"kind": "person_session", "pseudonym": "3f9a07c2", "funktion": "spieler"}


class TestABarredActorIsWithheldOnBothReads:
    """No barred address is served in plain, an actor's included."""

    @pytest.mark.parametrize("model", [FLActionLogEntry, FLActionLogEntryWithBefore])
    def test_an_address_the_ban_list_holds_is_null_beside_the_flag(self, model: type[FLActionLogEntry] | type[FLActionLogEntryWithBefore]):
        row = mit_vorenthaltenem_akteur(stored_row(), {"admin@example.invalid"})
        served = json.loads(model.model_validate(row).model_dump_json())

        assert served["actor"] == {"kind": "admin_session", "email": None, "email_barred": True}
        assert "admin@example.invalid" not in json.dumps({key: value for key, value in served.items() if key != "before"})

    def test_the_address_is_asked_and_compared_on_its_fold(self):
        """The ban list holds folded addresses: a stored spelling in capitals is still the barred mailbox."""

        row = stored_row(actor={"kind": "admin_session", "email": "Admin@Example.INVALID"})

        assert actor_addresses([row]) == ["admin@example.invalid"]
        assert mit_vorenthaltenem_akteur(row, set(actor_addresses([row])))["actor"]["email"] is None

    def test_the_image_is_served_as_recorded(self):
        """The read a restore starts from: an image with its addresses withheld would restore a document the write never replaced."""

        row = mit_vorenthaltenem_akteur(stored_row(before={**STORED_SPIEL, "created_by": "admin@example.invalid"}), {"admin@example.invalid"})
        before = FLActionLogEntryWithBefore.model_validate(row).before

        assert isinstance(before, dict)
        assert before["created_by"] == "admin@example.invalid"

    def test_a_row_nobody_judged_is_refused_by_both_models(self):
        """The flag has no default, so a read skipping the withholding fails rather than serving the address as unbarred."""

        with pytest.raises(ValidationError):
            FLActionLogEntry.model_validate(stored_row())
        with pytest.raises(ValidationError):
            FLActionLogEntryWithBefore.model_validate(stored_row())


class _NoCells:
    """What `aggregate` answers, called as `aggregate_many_from_db` calls the driver: the tally is no part of these cases."""

    async def to_list(self, length: int | None = None) -> list[dict[str, Any]]:
        return []


class _LogCollection:
    """One collection, called as `pull_many_from_db` calls the driver: `find`, `sort`, `limit`, `to_list`."""

    def __init__(self, documents: list[dict[str, Any]]) -> None:
        self.documents = documents
        self.requested_filter: Any = None

    async def aggregate(self, pipeline: Any, collation: Any = None, session: Any = None) -> _NoCells:
        return _NoCells()

    def find(self, filter: Any, projection: Any = None, collation: Any = None, session: Any = None) -> _LogCollection:
        self.requested_filter = filter
        return self

    def sort(self, sort_by: Any) -> _LogCollection:
        return self

    def limit(self, count: int) -> _LogCollection:
        # Truncating rather than answering everything: this IS the silent loss under test.
        self.documents = self.documents[:count]
        return self

    async def to_list(self, length: int | None = None) -> list[dict[str, Any]]:
        return self.documents if length is None else self.documents[:length]


class _NothingStored:
    """The ban list and the seasons, holding nothing: the log's own doubles answer what these cases are about."""

    def find(self, filter: Any, projection: Any = None, collation: Any = None, session: Any = None) -> _NothingStored:
        return self

    def limit(self, count: int) -> _NothingStored:
        return self

    async def to_list(self, length: int | None = None) -> list[dict[str, Any]]:
        return []

    async def find_one(self, filter: Any, projection: Any = None, session: Any = None) -> None:
        return None


def log_of(count: int) -> list[dict[str, Any]]:
    return [stored_row(_id=ObjectId(f"6890a1b2c3d4e5f607{index:06d}")) for index in range(1, count + 1)]


# Named `log` rather than `collection`, which is a filter term this route takes: the keyword would
# collide with the parameter below it.
def run_list(log: _LogCollection, **filters: Any) -> Any:
    """`asyncio.run`, as `test_bewerbungen_read.py` drives its route; no event-loop plugin is configured."""

    return asyncio.run(
        get_action_log(
            action_log_collection=cast(AsyncCollection, log),
            ban_list=ban_list({Collection.BAN_LIST: _NothingStored(), Collection.SAISONS: _NothingStored()}),
            filters=FLAktionenFilterParams.model_validate(filters),
        )
    )


class TestATruncatedPageSaysSo:
    """The log takes a row per recorded write and keeps it twelve months, so this read reaches the cap by ordinary use.

    The probe-row shape is `get_bewerbungen`'s.
    """

    def test_a_log_past_the_cap_is_served_short_and_flagged(self):
        answered = run_list(_LogCollection(log_of(LIST_LIMIT_DEFAULT + 25)))

        assert len(answered.action_log) == LIST_LIMIT_DEFAULT
        assert answered.complete is False


class TestTheListNarrowsOnOneDocument:
    """`action_log_target`'s first purpose: one document's history, asked for in the STORED spelling.

    The term is compiled rather than dumped (`app/api/aktionen/services.py :: document_id_term`).
    """

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
