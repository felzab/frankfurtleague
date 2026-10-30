"""
CORE · the version every edited document carries, written and checked by the two patch helpers alone

A save naming the version its form was read at matches only while it stands; every other write raises it.
"""

from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase

from app.core.codes import Code
from app.core.collections import Collection
from app.core.crud import VERSION_FIELD, patch_many_in_db, patch_one_in_db, post_one_to_db
from app.core.exceptions import APIError
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_versioned_writes_test")

SPIELTAG = ObjectId("6890a1b2c3d4e5f607700001")
FIRST = ObjectId("6890a1b2c3d4e5f607700011")
SECOND = ObjectId("6890a1b2c3d4e5f607700012")

Body = Callable[[AsyncDatabase], Awaitable[Any]]


def created(spiel_id: ObjectId, spiel_nr: int) -> dict[str, Any]:
    """A fixture as a create sends it: no version, which the insert stamps."""

    document = documents.spiel_document(spiel_id=spiel_id, saison_id="2026", spiel_nr=spiel_nr, spieltag_id=SPIELTAG)
    del document[VERSION_FIELD]

    return document


def on_two_fixtures(url: str, body: Body) -> Any:
    """Two fixtures, each created through the insert helper."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME) as (_, database):
            for spiel_id, spiel_nr in ((FIRST, 1), (SECOND, 2)):
                await post_one_to_db(collection=database[Collection.SPIELE], document=created(spiel_id, spiel_nr))

            return await body(database)

    return on_the_seed_loop(_run())


async def stored(database: AsyncDatabase, spiel_id: ObjectId) -> dict[str, Any]:
    document = await database[Collection.SPIELE].find_one({"_id": spiel_id})
    assert document is not None

    return document


async def save(database: AsyncDatabase, update: dict[str, Any]) -> None:
    await patch_one_in_db(collection=database[Collection.SPIELE], db_filter={"_id": FIRST}, update=update, return_document=ReturnDocument.AFTER)


class TestASaveNamingItsVersion:
    def test_a_save_on_the_version_standing_writes_and_raises_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> dict[str, Any]:
            await save(database, {"$set": {"notiz": "verlegt", VERSION_FIELD: 0}})

            return await stored(database, FIRST)

        after = on_two_fixtures(mongo_replica_set_url, body)

        assert (after["notiz"], after[VERSION_FIELD]) == ("verlegt", 1)

    def test_a_save_on_a_version_another_write_raised_is_refused_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> tuple[APIError, dict[str, Any]]:
            await save(database, {"$set": {"notiz": "zuerst"}})
            with pytest.raises(APIError) as refused:
                await save(database, {"$set": {"notiz": "veraltet", VERSION_FIELD: 0}})

            return refused.value, await stored(database, FIRST)

        refusal, after = on_two_fixtures(mongo_replica_set_url, body)

        assert (refusal.status_code, refusal.error_code) == (409, Code.VERSION_STALE)
        assert (after["notiz"], after[VERSION_FIELD]) == ("zuerst", 1)


class TestEveryOtherWrite:
    def test_a_save_naming_no_version_writes_and_raises_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> dict[str, Any]:
            await save(database, {"$set": {"notiz": "ohne"}})

            return await stored(database, FIRST)

        after = on_two_fixtures(mongo_replica_set_url, body)

        assert (after["notiz"], after[VERSION_FIELD]) == ("ohne", 1)

    def test_a_fan_out_raises_the_version_of_every_document_it_changes_and_of_no_other(self, mongo_replica_set_url: str):
        """Repeated, it changes nothing, so it counts nothing and the versions stand."""

        async def body(database: AsyncDatabase) -> tuple[list[int], list[int]]:
            spiele = database[Collection.SPIELE]
            fanned_out = [
                (await patch_many_in_db(collection=spiele, db_filter={"saison_id": "2026"}, update={"$set": {"notiz": "alle"}})).modified_count
                for _ in range(2)
            ]

            return fanned_out, [(await stored(database, spiel_id))[VERSION_FIELD] for spiel_id in (FIRST, SECOND)]

        assert on_two_fixtures(mongo_replica_set_url, body) == ([2, 0], [1, 1])
