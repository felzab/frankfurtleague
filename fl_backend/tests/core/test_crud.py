import re
from collections.abc import Mapping
from typing import Any, cast

import pytest
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import BulkWriteError

from app.core.collections import Collection
from app.core.crud import (
    DUPLICATE_KEY_ERROR,
    literal_pattern,
    post_many_to_db,
    pull_whole_from_db,
)
from app.core.readonly import ReadCollection
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT

# A NUL beside every character a pattern gives a meaning to. Python's `re` takes a raw NUL, so this
# case stays green with the NUL left unescaped: only a real server refuses one, and the erasure's
# database case is what reads the escape.
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


# A session holding no transaction, whose writes stand as a sessionless call's do.
BARE_SESSION = cast(AsyncClientSession, _Session(in_transaction=False))


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
    async def test_rows_that_stand_keep_the_batchs_own_failure(self, session: AsyncClientSession | None):
        """Outside a transaction nothing takes the first two back: a 409 would say nothing was written while they stand."""

        failure = refused_batch(DUPLICATE_ERROR, landed=2)

        with pytest.raises(BulkWriteError) as raised:
            await post_many_to_db(
                collection=cast(AsyncCollection, _RefusedBatchCollection(failure)), documents=[{"name": "Club 0"}], session=session
            )

        assert raised.value is failure


class _Rows:
    """`count` documents, called as `pull_many_from_db` calls the driver: `find`, then `limit`, then `to_list`."""

    def __init__(self, count: int) -> None:
        self.documents = [{"spiel_nr": nr} for nr in range(1, count + 1)]

    def find(self, **_: Any) -> _Rows:
        return self

    def limit(self, count: int) -> _Rows:
        # Truncating, as the server does: the cut a judgement reading the page that fits would never see.
        self.documents = self.documents[:count]
        return self

    async def to_list(self, length: int | None = None) -> list[dict[str, Any]]:
        return self.documents


async def pulled_whole(count: int) -> list[Mapping[str, Any]]:
    return await pull_whole_from_db(collection=cast(ReadCollection, _Rows(count)), db_filter={}, what="season 2026's fixtures")


class TestPullWholeFromDb:
    """A judgement over a whole set writes back what it derived, so a set it could not read whole is a wrong result committed."""

    async def test_a_set_past_the_cap_is_refused(self):
        with pytest.raises(ValueError, match=f"season 2026's fixtures number more than {LIST_LIMIT_DEFAULT}"):
            await pulled_whole(LIST_LIMIT_DEFAULT + 1)

    async def test_a_set_filling_the_cap_is_read_whole(self):
        assert len(await pulled_whole(LIST_LIMIT_DEFAULT)) == LIST_LIMIT_DEFAULT
