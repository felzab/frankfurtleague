import asyncio
import re
from collections.abc import Mapping
from typing import Any, cast

import pytest
from bson import Int64, ObjectId
from bson.codec_options import DEFAULT_CODEC_OPTIONS
from pydantic import BaseModel
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import BulkWriteError, DuplicateKeyError
from pymongo.results import UpdateResult

from app.core.collections import Collection
from app.core.crud import (
    DUPLICATE_KEY_ERROR,
    build_query,
    ensure_one_in_db,
    literal_pattern,
    patch_one_in_db,
    post_many_to_db,
)
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
    def test_an_objectid_term_stays_an_objectid(self):
        """The stringified form matches no document, and matching nothing looks like an empty result rather than a fault."""
        query = build_query(_Filters.model_validate({"team_id": TEAM_OID}), terms=TERMS)

        assert query["team_id"] == ObjectId(TEAM_OID)

    def test_a_false_switch_scopes_the_read_to_live_rows(self):
        query = build_query(_Filters.model_validate({}), terms=TERMS, include_inactive=False)

        assert query == {"inactive_since": None}

    def test_a_compiled_term_replaces_the_raw_one_it_was_compiled_from(self):
        """A parameter the database does not store is compiled by its slice, and the compiled form has to win."""
        compiled: dict[str, Any] = {"saison_id": {"$ne": "2526"}}
        query = build_query(_Filters.model_validate({"saison_id": "2526"}), terms=TERMS, compiled=compiled)

        assert query == {"saison_id": {"$ne": "2526"}}


# A NUL beside every character a pattern gives a meaning to. The server's refusal of the raw NUL is
# pinned against a real mongod by `fl_backend/tests/api/test_kontakt_loeschung_execution.py`'s NUL case.
LITERAL = "a\x00.*+?^$()[]{}|\\/ -#b"


class TestLiteralPattern:
    def test_the_pattern_matches_the_value_and_nothing_wider(self):
        pattern = re.compile(literal_pattern(LITERAL))

        assert pattern.fullmatch(LITERAL)
        assert not pattern.fullmatch(LITERAL.replace(".", "x"))


class _Session:
    """A stand-in for a session handle, which answers the one attribute the helpers read off it."""

    def __init__(self, *, in_transaction: bool) -> None:
        self.in_transaction = in_transaction


TRANSACTION = cast(AsyncClientSession, _Session(in_transaction=True))
# A session holding no transaction, whose writes stand as a sessionless call's do.
BARE_SESSION = cast(AsyncClientSession, _Session(in_transaction=False))

FILTER: Mapping[str, Any] = {"_id": ObjectId(TEAM_OID)}
UPDATE: Mapping[str, Any] = {"$set": {"name": "Lessing"}}
STORED: Mapping[str, Any] = {"_id": ObjectId(TEAM_OID), "name": "Lessing"}
# What the update replaced, distinct from the post-image so a test can tell which one it was handed.
REPLACED: Mapping[str, Any] = {"_id": ObjectId(TEAM_OID), "name": "Lessing-Gymnasium"}


class _RecordingCollection:
    """The log the write helpers append to, so a crud test can see what was recorded."""

    def __init__(self, rows: list[Mapping[str, Any]], sessions: list[Any] | None = None) -> None:
        self.rows = rows
        # The session each row was written under, which decides whether an abort takes the row back.
        self.sessions: list[Any] = [] if sessions is None else sessions

    async def insert_one(self, row: Mapping[str, Any], session: Any = None) -> None:
        self.rows.append(row)
        self.sessions.append(session)


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
        # A write records (`app/core/recording.py`), and it reaches the log through the target
        # collection's own database handle -- so a double standing in for a collection needs both.
        self.recorded: list[Mapping[str, Any]] = []
        self.name = Collection.TEAMS
        self.database = {Collection.ACTION_LOG: _RecordingCollection(self.recorded)}
        self.codec_options = DEFAULT_CODEC_OPTIONS

    async def find_one_and_update(self, *, filter: Any, update: Any, session: Any, return_document: Any) -> Mapping[str, Any] | None:
        self.calls.append({"filter": filter, "update": update, "session": session, "return_document": return_document})

        return self.pre

    async def find_one(self, *, filter: Any, projection: Any, session: Any) -> Mapping[str, Any] | None:
        return self.document


def as_collection(stub: _OneDocumentCollection) -> AsyncCollection:
    return cast(AsyncCollection, stub)


class TestPatchOneInDb:
    def test_the_log_is_given_the_image_the_update_itself_replaced(self):
        """Asked for `AFTER`, so the log's pre-image is shown to come from the update whatever the caller wanted."""
        stub = _OneDocumentCollection(STORED, pre=REPLACED)

        asyncio.run(
            patch_one_in_db(
                collection=as_collection(stub), db_filter=FILTER, update=UPDATE, expected_version=None, return_document=ReturnDocument.AFTER
            )
        )

        assert stub.calls[0]["return_document"] is ReturnDocument.BEFORE
        assert stub.recorded[0]["before"] == REPLACED

    @pytest.mark.parametrize(
        ("replaced", "stored"),
        [
            pytest.param({"_id": ObjectId(TEAM_OID), "spiele": 1}, {"_id": ObjectId(TEAM_OID), "spiele": 1.0}, id="an integer made a double"),
            pytest.param({"_id": ObjectId(TEAM_OID), "active": 1}, {"_id": ObjectId(TEAM_OID), "active": True}, id="an integer made a boolean"),
            pytest.param(
                {"_id": ObjectId(TEAM_OID), "spiele": 1},
                {"_id": ObjectId(TEAM_OID), "spiele": Int64(1)},
                id="a 32-bit integer made a 64-bit one",
            ),
            pytest.param(
                {"_id": ObjectId(TEAM_OID), "trikot": {"colour": "rot", "satz": 2}},
                {"_id": ObjectId(TEAM_OID), "trikot": {"satz": 2, "colour": "rot"}},
                id="a sub-document's keys reordered",
            ),
        ],
    )
    def test_a_change_python_takes_for_equality_is_recorded(self, replaced: Mapping[str, Any], stored: Mapping[str, Any]):
        """Each pair is equal to Python and two values to the server, which rewrote the document and joined its write set."""
        stub = _OneDocumentCollection(stored, pre=replaced)

        asyncio.run(
            patch_one_in_db(
                collection=as_collection(stub),
                db_filter=FILTER,
                update=UPDATE,
                session=TRANSACTION,
                expected_version=None,
                return_document=ReturnDocument.BEFORE,
            )
        )

        assert replaced == stored
        assert [row["before"] for row in stub.recorded] == [replaced]


class _UpsertCollection(_OneDocumentCollection):
    """Answers an upsert as the driver does: `upserted_id` set where it inserted, `None` where a document matched."""

    def __init__(self, *, present: bool) -> None:
        super().__init__(None)
        self.present = present
        self.upserts: list[dict[str, Any]] = []

    async def update_one(self, *, filter: Any, update: Any, upsert: bool, session: Any) -> UpdateResult:
        self.upserts.append({"filter": filter, "update": update, "upsert": upsert})
        raw = {"n": 1, "nModified": 0} if self.present else {"n": 1, "nModified": 0, "upserted": filter["_id"]}

        return UpdateResult(raw, acknowledged=True)


class TestEnsureOneInDb:
    @pytest.mark.parametrize(("present", "rows"), [pytest.param(False, 1, id="absent, inserted"), pytest.param(True, 0, id="present, kept")])
    def test_one_upsert_records_a_row_exactly_where_it_inserted(self, present: bool, rows: int):
        """A row on every call would log an insert each erasure that found its sentinel standing."""

        stub = _UpsertCollection(present=present)

        inserted = asyncio.run(ensure_one_in_db(collection=as_collection(stub), document=STORED, session=TRANSACTION))

        assert (inserted, len(stub.recorded)) == (not present, rows)
        # The `_id` is the filter's alone, and the edited collection's version is stamped as a create stamps it.
        assert stub.upserts == [{"filter": FILTER, "update": {"$setOnInsert": {"name": "Lessing", "version": 0}}, "upsert": True}]


def refused_batch(error: Mapping[str, Any], *, landed: int) -> BulkWriteError:
    """The server's report of a batch refused after `landed` of its documents were written."""

    return BulkWriteError(
        {
            "writeErrors": [error],
            "writeConcernErrors": [],
            "nInserted": landed,
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
    "errmsg": f'E11000 duplicate key error collection: fl_test.teams index: {REFUSED_INDEX} dup key: {{ shorthand: "CCX" }}',
    "keyPattern": {"shorthand": 1},
    "keyValue": {"shorthand": "CCX"},
    "op": {"name": "Club 2", "shorthand": "CCX"},
}


class _RefusedBatchCollection:
    """Refuses every batch with `failure`, and keeps the log rows a write appends."""

    def __init__(self, failure: BulkWriteError) -> None:
        self.failure = failure
        self.recorded: list[Mapping[str, Any]] = []
        self.recorded_under: list[Any] = []
        self.name = Collection.TEAMS
        self.database = {Collection.ACTION_LOG: _RecordingCollection(self.recorded, self.recorded_under)}

    async def insert_many(self, *, documents: Any, session: Any) -> None:
        raise self.failure


def batch_raised(failure: BulkWriteError, *, session: AsyncClientSession | None = None) -> tuple[BaseException, _RefusedBatchCollection]:
    stub = _RefusedBatchCollection(failure)

    with pytest.raises((BulkWriteError, DuplicateKeyError)) as raised:
        asyncio.run(post_many_to_db(collection=cast(AsyncCollection, stub), documents=[{"name": "Club 0"}], session=session))

    return raised.value, stub


class TestPostManyToDb:
    @pytest.mark.parametrize(
        "session", [pytest.param(None, id="no session"), pytest.param(BARE_SESSION, id="a session holding no transaction")]
    )
    def test_rows_that_stand_keep_the_batchs_own_failure_and_their_row(self, session: AsyncClientSession | None):
        """Outside a transaction nothing takes the first two back: a 409 would say nothing was written while they stand."""

        failure = refused_batch(DUPLICATE_ERROR, landed=2)
        raised, stub = batch_raised(failure, session=session)

        assert raised is failure
        assert [(row["operation"], row["modified_count"]) for row in stub.recorded] == [("insert_many", 2)]
        # Under the batch's own session, as every other log row a write files is.
        assert stub.recorded_under == [session]
