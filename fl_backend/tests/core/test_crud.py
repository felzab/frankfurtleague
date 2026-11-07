import asyncio
import re
from collections.abc import Mapping
from typing import Any, cast

import pytest
from bson import ObjectId
from pydantic import BaseModel
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import BulkWriteError
from pymongo.results import UpdateResult

from app.core.collections import Collection
from app.core.crud import (
    DUPLICATE_KEY_ERROR,
    build_query,
    ensure_one_in_db,
    literal_pattern,
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
# pinned against a real mongod by `fl_backend/tests/api/test_kontakt_erasure_execution.py`'s NUL case.
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
STORED: Mapping[str, Any] = {"_id": ObjectId(TEAM_OID), "name": "Lessing"}


class _UpsertCollection:
    """Answers an upsert as the driver does: `upserted_id` set where it inserted, `None` where a document matched."""

    def __init__(self, *, present: bool) -> None:
        self.present = present
        self.name = Collection.TEAMS
        self.upserts: list[dict[str, Any]] = []

    async def update_one(self, *, filter: Any, update: Any, upsert: bool, session: Any) -> UpdateResult:
        self.upserts.append({"filter": filter, "update": update, "upsert": upsert})
        raw = {"n": 1, "nModified": 0} if self.present else {"n": 1, "nModified": 0, "upserted": filter["_id"]}

        return UpdateResult(raw, acknowledged=True)


class TestEnsureOneInDb:
    @pytest.mark.parametrize("present", [pytest.param(False, id="absent, inserted"), pytest.param(True, id="present, kept")])
    def test_one_upsert_answers_whether_it_inserted(self, present: bool):
        """A caller counting a created ghost would count one on every erasure that found it standing."""

        stub = _UpsertCollection(present=present)

        inserted = asyncio.run(ensure_one_in_db(collection=cast(AsyncCollection, stub), document=STORED, session=TRANSACTION))

        assert inserted is not present
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
    """Refuses every batch with `failure`."""

    def __init__(self, failure: BulkWriteError) -> None:
        self.failure = failure
        self.name = Collection.TEAMS

    async def insert_many(self, *, documents: Any, session: Any) -> None:
        raise self.failure


class TestPostManyToDb:
    @pytest.mark.parametrize(
        "session", [pytest.param(None, id="no session"), pytest.param(BARE_SESSION, id="a session holding no transaction")]
    )
    def test_rows_that_stand_keep_the_batchs_own_failure(self, session: AsyncClientSession | None):
        """Outside a transaction nothing takes the first two back: a 409 would say nothing was written while they stand."""

        failure = refused_batch(DUPLICATE_ERROR, landed=2)

        with pytest.raises(BulkWriteError) as raised:
            asyncio.run(
                post_many_to_db(
                    collection=cast(AsyncCollection, _RefusedBatchCollection(failure)), documents=[{"name": "Club 0"}], session=session
                )
            )

        assert raised.value is failure
