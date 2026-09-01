import asyncio
from typing import Any, Mapping, cast

import pytest
from bson import ObjectId
from pydantic import BaseModel
from pymongo import ReturnDocument
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.helpers_shared import _index_document

from app.core.collections import Collection
from app.core.crud import build_query, build_sort, patch_one_in_db, pull_one_from_db
from app.core.exceptions import DOCUMENT_NOT_FOUND, DocumentNotFoundException
from app.shared.schemas.custom import CustomObjectId

TEAM_OID = "6890a1b2c3d4e5f607182930"


class _Filters(BaseModel):
    """A stand-in for a slice's filter params: two query terms, and the paging a query must never carry."""

    saison_id: str | None = None
    team_id: CustomObjectId | None = None
    include_inactive: bool = False
    limit: int = 1024
    sort_by: str = "name"
    order: str = "asc"


TERMS = {"saison_id", "team_id"}


class TestBuildQuery:
    def test_passes_a_named_term_through_under_its_own_name(self):
        query = build_query(_Filters.model_validate({"saison_id": "2526"}), terms=TERMS)

        assert query == {"saison_id": "2526"}

    def test_omits_a_term_that_was_not_asked_for(self):
        """An unset term is absent, never null: a null would match documents that carry nothing there."""
        assert build_query(_Filters.model_validate({}), terms=TERMS) == {}

    def test_never_leaks_paging_or_sorting_into_the_query(self):
        """`limit`, `sort_by` and `order` are how a read is served, not what it selects."""
        query = build_query(_Filters.model_validate({"saison_id": "2526"}), terms=TERMS)

        assert {"limit", "sort_by", "order", "include_inactive"}.isdisjoint(query)

    def test_an_objectid_term_stays_an_objectid(self):
        """The stringified form matches no document, and matching nothing looks like an empty result rather than a fault."""
        query = build_query(_Filters.model_validate({"team_id": TEAM_OID}), terms=TERMS)

        assert query["team_id"] == ObjectId(TEAM_OID)

    def test_an_empty_term_set_selects_everything(self):
        """A slice with no dumpable term passes none: an empty `include` means empty, not "everything"."""
        assert build_query(_Filters.model_validate({"saison_id": "2526"}), terms=frozenset()) == {}

    @pytest.mark.parametrize("include_inactive", [True, None])
    def test_only_a_false_switch_adds_the_soft_delete_scope(self, include_inactive: bool | None):
        """A switch whose False ADDS a term, so it is translated rather than dumped; True and "not asked" both mean no scope."""
        query = build_query(_Filters.model_validate({}), terms=TERMS, include_inactive=include_inactive)

        assert "inactive_since" not in query

    def test_a_false_switch_scopes_the_read_to_live_rows(self):
        query = build_query(_Filters.model_validate({}), terms=TERMS, include_inactive=False)

        assert query == {"inactive_since": None}

    def test_a_compiled_term_replaces_the_raw_one_it_was_compiled_from(self):
        """A parameter the database does not store is compiled by its slice, and the compiled form has to win."""
        compiled: dict[str, Any] = {"saison_id": {"$ne": "2526"}}
        query = build_query(_Filters.model_validate({"saison_id": "2526"}), terms=TERMS, compiled=compiled)

        assert query == {"saison_id": {"$ne": "2526"}}


class TestBuildSort:
    def test_the_requested_key_carries_the_requested_direction(self):
        assert build_sort(sort_by="name", order="desc") == [("name", -1)]

    def test_a_chain_entry_keeps_the_direction_it_names(self):
        """The chain is not forced ascending: a descending page needs the descending end of a tie."""
        assert build_sort(sort_by="beginn", order="desc", chain=(("_id", -1),)) == [("beginn", -1), ("_id", -1)]

    def test_a_chain_entry_equal_to_the_sort_key_is_dropped(self):
        assert build_sort(sort_by="beginn", order="desc", chain=(("beginn", 1), ("_id", 1))) == [("beginn", -1), ("_id", 1)]

    def test_a_repeated_key_would_have_overwritten_the_requested_direction(self):
        """The regression this guard exists for: pymongo builds a DICT from the list, so a repeated key silently wins.

        A sort answering `desc` with ascending rows returns 200 and correct data, and nothing logs it.
        """
        unguarded = [("beginn", -1), ("beginn", 1), ("_id", 1)]
        assert _index_document(unguarded) == {"beginn": 1, "_id": 1}

        guarded = build_sort(sort_by="beginn", order="desc", chain=(("beginn", 1), ("_id", 1)))
        assert _index_document(guarded) == {"beginn": -1, "_id": 1}


FILTER: Mapping[str, Any] = {"_id": ObjectId(TEAM_OID)}
UPDATE: Mapping[str, Any] = {"$set": {"name": "Lessing"}}
STORED: Mapping[str, Any] = {"_id": ObjectId(TEAM_OID), "name": "Lessing"}
# What the update replaced, distinct from the post-image so a test can tell which one it was handed.
REPLACED: Mapping[str, Any] = {"_id": ObjectId(TEAM_OID), "name": "Lessing-Gymnasium"}


class _RecordingCollection:
    """The log the write helpers append to, so a crud test can see what was recorded."""

    def __init__(self, rows: list[Mapping[str, Any]]) -> None:
        self.rows = rows

    async def insert_one(self, row: Mapping[str, Any], session: Any = None) -> None:
        self.rows.append(row)


class _OneDocumentCollection:
    """Answers either single-document helper with whatever the test hands it, and records how it was called.

    Keyword-only, exactly as `app/core/crud.py` calls the driver: a positional fake would accept an
    argument bound to the wrong parameter.
    """

    def __init__(self, document: Mapping[str, Any] | None, pre: Mapping[str, Any] | None = None) -> None:
        self.document = document
        # The two images a patch involves. Distinct where a test needs to prove which one reached
        # which consumer; the same object otherwise, which is what most callers care about.
        self.pre = document if pre is None else pre
        self.calls: list[dict[str, Any]] = []
        # Separate from `calls`: a patch re-reads for the caller's echo, and folding both shapes into
        # one list would make `calls[0]` mean whichever call happened to come first.
        self.reads: list[dict[str, Any]] = []
        # A write records (`app/core/recording.py`), and it reaches the log through the target
        # collection's own database handle -- so a double standing in for a collection needs both.
        self.recorded: list[Mapping[str, Any]] = []
        self.name = Collection.TEAMS
        self.database = {Collection.AKTIONEN: _RecordingCollection(self.recorded)}

    async def find_one_and_update(self, *, filter: Any, update: Any, session: Any, return_document: Any) -> Mapping[str, Any] | None:
        self.calls.append({"filter": filter, "update": update, "session": session, "return_document": return_document})

        return self.pre

    async def find_one(self, *, filter: Any, projection: Any, session: Any) -> Mapping[str, Any] | None:
        self.reads.append({"filter": filter, "projection": projection, "session": session})

        return self.document


def as_collection(stub: _OneDocumentCollection) -> AsyncCollection:
    return cast(AsyncCollection, stub)


class TestPatchOneInDb:
    def test_the_default_answers_with_the_post_write_document(self):
        """Call sites echo what this returns, so answering with the pre-image would report the state the write just replaced."""
        stub = _OneDocumentCollection(STORED, pre=REPLACED)

        returned = asyncio.run(patch_one_in_db(collection=as_collection(stub), db_filter=FILTER, update=UPDATE))

        assert returned == STORED

    def test_the_log_is_given_the_image_the_update_itself_replaced(self):
        """The atomic one. A pre-image read separately could name a document another writer had already replaced."""
        stub = _OneDocumentCollection(STORED, pre=REPLACED)

        asyncio.run(patch_one_in_db(collection=as_collection(stub), db_filter=FILTER, update=UPDATE))

        assert stub.calls[0]["return_document"] is ReturnDocument.BEFORE
        assert stub.recorded[0]["before"] == REPLACED

    def test_an_explicit_pre_image_is_answered_without_a_second_read(self):
        """A default, not a rewrite: a caller wanting the document as it stood already holds it."""
        stub = _OneDocumentCollection(STORED, pre=REPLACED)

        returned = asyncio.run(
            patch_one_in_db(collection=as_collection(stub), db_filter=FILTER, update=UPDATE, return_document=ReturnDocument.BEFORE)
        )

        assert returned == REPLACED
        assert stub.reads == []

    def test_a_miss_raises_rather_than_returning_none(self):
        """No caller branches on `None`, so returning one would put a miss into a response body as a 200."""
        stub = _OneDocumentCollection(None)

        with pytest.raises(DocumentNotFoundException) as excinfo:
            asyncio.run(patch_one_in_db(collection=as_collection(stub), db_filter=FILTER, update=UPDATE))

        assert excinfo.value.status_code == 404
        assert excinfo.value.error_code == DOCUMENT_NOT_FOUND
        # The filter travels with the exception, which is what lets the handler log what was looked for.
        assert excinfo.value.filter == FILTER


class TestPullOneFromDb:
    def test_a_miss_raises_rather_than_returning_none(self):
        """The same contract on the read side: one shape across the module is what keeps a `None` branch out of every handler."""
        stub = _OneDocumentCollection(None)

        with pytest.raises(DocumentNotFoundException) as excinfo:
            asyncio.run(pull_one_from_db(collection=as_collection(stub), db_filter=FILTER))

        assert excinfo.value.status_code == 404
        assert excinfo.value.error_code == DOCUMENT_NOT_FOUND
        assert excinfo.value.filter == FILTER
