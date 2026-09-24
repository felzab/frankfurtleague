import asyncio
import inspect
import re
from collections.abc import Mapping, Sequence
from typing import Any, cast

import pytest
from bson import ObjectId
from pydantic import BaseModel
from pymongo import ReturnDocument
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import BulkWriteError, DuplicateKeyError
from pymongo.helpers_shared import _index_document

from app.core.collections import Collection
from app.core.crud import DUPLICATE_KEY_ERROR, build_query, build_sort, literal_pattern, patch_one_in_db, post_many_to_db, pull_one_from_db
from app.core.exception_handlers import refused_index_of
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
        """Equality rather than membership: `limit`, `sort_by` and `order` are how a read is served, not what it selects."""
        query = build_query(_Filters.model_validate({"saison_id": "2526"}), terms=TERMS)

        assert query == {"saison_id": "2526"}

    def test_omits_a_term_that_was_not_asked_for(self):
        """An unset term is absent, never null: a null would match documents that carry nothing there."""
        assert build_query(_Filters.model_validate({}), terms=TERMS) == {}

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


# A NUL beside every character a pattern gives a meaning to. The server's refusal of the raw NUL is
# pinned against a real mongod by `fl_backend/tests/api/test_kontakt_erasure_execution.py`'s NUL case.
LITERAL = "a\x00.*+?^$()[]{}|\\/ -#b"


class TestLiteralPattern:
    def test_the_pattern_holds_no_raw_nul(self):
        assert "\x00" not in literal_pattern(LITERAL)

    def test_the_pattern_matches_the_value_and_nothing_wider(self):
        pattern = re.compile(literal_pattern(LITERAL))

        assert pattern.fullmatch(LITERAL)
        assert not pattern.fullmatch(LITERAL.replace(".", "x"))


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
    def test_every_caller_names_the_image_it_wants(self):
        """A default is a re-read paid by every caller that never asked for it, the ones discarding the result included."""

        assert inspect.signature(patch_one_in_db).parameters["return_document"].default is inspect.Parameter.empty

    def test_after_answers_with_the_post_write_document(self):
        """Call sites echo what this returns, so answering with the pre-image would report the state the write just replaced."""
        stub = _OneDocumentCollection(STORED, pre=REPLACED)

        returned = asyncio.run(
            patch_one_in_db(collection=as_collection(stub), db_filter=FILTER, update=UPDATE, return_document=ReturnDocument.AFTER)
        )

        assert returned == STORED

    def test_the_log_is_given_the_image_the_update_itself_replaced(self):
        """Asked for `AFTER`, so the log's pre-image is shown to come from the update whatever the caller wanted."""
        stub = _OneDocumentCollection(STORED, pre=REPLACED)

        asyncio.run(patch_one_in_db(collection=as_collection(stub), db_filter=FILTER, update=UPDATE, return_document=ReturnDocument.AFTER))

        assert stub.calls[0]["return_document"] is ReturnDocument.BEFORE
        assert stub.recorded[0]["before"] == REPLACED

    def test_before_is_answered_without_a_second_read(self):
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
            asyncio.run(patch_one_in_db(collection=as_collection(stub), db_filter=FILTER, update=UPDATE, return_document=ReturnDocument.BEFORE))

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


def refused_batch(error: Mapping[str, Any], *, write_concern: Sequence[Mapping[str, Any]] = ()) -> BulkWriteError:
    """The server's report of a batch refused on its third document, the first two having landed."""

    return BulkWriteError(
        {
            "writeErrors": [error],
            "writeConcernErrors": list(write_concern),
            "nInserted": 2,
            "nUpserted": 0,
            "nMatched": 0,
            "nModified": 0,
            "nRemoved": 0,
            "upserted": [],
        }
    )


REFUSED_INDEX = "uniq_shorthand"
DUPLICATE_ERROR: Mapping[str, Any] = {
    "index": 2,
    "code": DUPLICATE_KEY_ERROR,
    "errmsg": f'E11000 duplicate key error collection: fl_test.teams index: {REFUSED_INDEX} dup key: {{ shorthand: "C2" }}',
    "keyPattern": {"shorthand": 1},
    "keyValue": {"shorthand": "C2"},
    "op": {"name": "Club 2", "shorthand": "C2"},
}
VALIDATION_ERROR: Mapping[str, Any] = {"index": 2, "code": 121, "errmsg": "Document failed validation", "op": {"name": "Club 2"}}
WRITE_CONCERN_ERROR: Mapping[str, Any] = {"code": 64, "errmsg": "waiting for replication timed out", "errInfo": {"wtimeout": True}}


class _RefusedBatchCollection:
    """Refuses every batch with `failure`, and keeps the log rows a write appends."""

    def __init__(self, failure: BulkWriteError) -> None:
        self.failure = failure
        self.recorded: list[Mapping[str, Any]] = []
        self.name = Collection.TEAMS
        self.database = {Collection.AKTIONEN: _RecordingCollection(self.recorded)}

    async def insert_many(self, *, documents: Any, session: Any) -> None:
        raise self.failure


def batch_raised(failure: BulkWriteError) -> tuple[BaseException, list[Mapping[str, Any]]]:
    stub = _RefusedBatchCollection(failure)

    with pytest.raises((BulkWriteError, DuplicateKeyError)) as raised:
        asyncio.run(post_many_to_db(collection=cast(AsyncCollection, stub), documents=[{"name": "Club 0"}]))

    return raised.value, stub.recorded


class TestPostManyToDb:
    def test_a_batch_a_unique_index_refused_raises_what_one_insert_would(self):
        """`DuplicateKeyError`, which the handler answers 409 `DB-COMMON-002`, still naming the index it logs."""

        failure = refused_batch(DUPLICATE_ERROR)
        raised, _ = batch_raised(failure)

        assert isinstance(raised, DuplicateKeyError)
        assert refused_index_of(raised) == REFUSED_INDEX
        assert raised.__cause__ is failure

    @pytest.mark.parametrize(
        "failure",
        [
            pytest.param(refused_batch(VALIDATION_ERROR), id="a validator's refusal"),
            pytest.param(refused_batch(DUPLICATE_ERROR, write_concern=[WRITE_CONCERN_ERROR]), id="a duplicate beside a write-concern error"),
        ],
    )
    def test_any_other_failure_stays_the_batchs_own(self, failure: BulkWriteError):
        raised, _ = batch_raised(failure)

        assert raised is failure

    def test_what_landed_before_the_refusal_is_still_recorded(self):
        """Outside a session nothing takes the first two back, so the refusal raised in their place must not cost their row."""

        _, recorded = batch_raised(refused_batch(DUPLICATE_ERROR))

        assert [(row["operation"], row["modified_count"]) for row in recorded] == [("insert_many", 2)]
