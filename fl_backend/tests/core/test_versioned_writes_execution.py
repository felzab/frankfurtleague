"""
CORE · the version every edited document carries, written and checked by the two patch helpers alone

A save passing the version its form was read at matches only while it stands; every other write raises it, but a
write to a field no form saves, which goes past it.
"""

from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.database import AsyncDatabase

from app.core.codes import Code
from app.core.collections import Collection
from app.core.crud import VERSION_FIELD, patch_many_in_db, patch_one_in_db, patch_past_the_version_in_db, post_one_to_db
from app.core.exceptions import APIError
from app.core.transactions import transaction_session
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


def on_two_spiele(url: str, body: Body) -> Any:
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


async def save(database: AsyncDatabase, update: dict[str, Any], *, expected_version: int | None = None) -> None:
    await patch_one_in_db(
        collection=database[Collection.SPIELE],
        db_filter={"_id": FIRST},
        update=update,
        expected_version=expected_version,
        return_document=ReturnDocument.AFTER,
    )


class TestASaveNamingItsVersion:
    def test_a_save_on_the_version_standing_writes_and_raises_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> dict[str, Any]:
            await save(database, {"$set": {"note": "verlegt"}}, expected_version=0)

            return await stored(database, FIRST)

        after = on_two_spiele(mongo_replica_set_url, body)

        assert (after["note"], after[VERSION_FIELD]) == ("verlegt", 1)

    def test_a_save_on_a_version_another_write_raised_is_refused_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> tuple[APIError, dict[str, Any]]:
            await save(database, {"$set": {"note": "zuerst"}})
            with pytest.raises(APIError) as refused:
                await save(database, {"$set": {"note": "veraltet"}}, expected_version=0)

            return refused.value, await stored(database, FIRST)

        refusal, after = on_two_spiele(mongo_replica_set_url, body)

        assert (refusal.status_code, refusal.error_code) == (409, Code.VERSION_STALE)
        assert (after["note"], after[VERSION_FIELD]) == ("zuerst", 1)


class TestEveryOtherWrite:
    def test_a_save_naming_no_version_writes_and_raises_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> dict[str, Any]:
            await save(database, {"$set": {"note": "ohne"}})

            return await stored(database, FIRST)

        after = on_two_spiele(mongo_replica_set_url, body)

        assert (after["note"], after[VERSION_FIELD]) == ("ohne", 1)

    def test_a_fan_out_raises_the_version_of_every_document_it_changes_and_of_no_other(self, mongo_replica_set_url: str):
        """Repeated, it changes nothing, so it counts nothing and the versions stand."""

        async def body(database: AsyncDatabase) -> tuple[list[int], list[int]]:
            spiele = database[Collection.SPIELE]
            fanned_out = [
                (await patch_many_in_db(collection=spiele, db_filter={"saison_id": "2026"}, update={"$set": {"note": "alle"}})).modified_count
                for _ in range(2)
            ]

            return fanned_out, [(await stored(database, spiel_id))[VERSION_FIELD] for spiel_id in (FIRST, SECOND)]

        assert on_two_spiele(mongo_replica_set_url, body) == ([2, 0], [1, 1])


PUPIL = ObjectId("6890a1b2c3d4e5f607700021")
TEAM = ObjectId("6890a1b2c3d4e5f607700031")

# One press of each kind on its own record: the collection, the record as stored, the state the press moves and names
# in its filter, what it sets, and a field of the same record that its administrator's form saves.
PRESSES = {
    "a consent press": (
        Collection.SPIELER,
        documents.spieler_document(PUPIL, "Lina", "Albers", version=0),
        {"einwilligung.media": False},
        {"einwilligung.media": True},
        {"first_name": "Lina-Marie"},
    ),
    "a seat's confirmation": (
        Collection.SAISON_TEAMS,
        documents.saison_team_document(
            "2026", TEAM, "Adler", "ADX", _id=TEAM, kontakte=documents.kontakte_document(trainer=documents.kontaktperson_document("Tilda"))
        ),
        {"kontakte.trainer.einwilligung.confirmed_at": None},
        {"kontakte.trainer.einwilligung.confirmed_at": "2026-04-01"},
        {"gruppe": "B"},
    ),
}


class TestAWritePastTheVersion:
    @pytest.mark.parametrize("kind", PRESSES)
    def test_an_editors_save_read_before_a_persons_own_press_succeeds_and_the_press_stands(self, mongo_replica_set_url: str, kind: str):
        """An administrator has the record open while its person presses: the save is not refused for it, and loses nothing of it.

        The press pressed again matches nothing, its filter naming the state the first one moved.
        """

        name, record, moved_from, moved_to, edited = PRESSES[kind]

        async def press(client: AsyncMongoClient, database: AsyncDatabase) -> int:
            async def write(session: AsyncClientSession) -> int:
                return await patch_past_the_version_in_db(
                    collection=database[name], db_filter={"_id": record["_id"], **moved_from}, update={"$set": moved_to}, session=session
                )

            async with transaction_session(client) as session:
                return await session.with_transaction(write)

        async def _run() -> Any:
            async with a_clean_database(mongo_replica_set_url, DATABASE_NAME) as (client, database):
                await database[name].insert_one(dict(record))
                read_at = record[VERSION_FIELD]
                pressed = [await press(client, database), await press(client, database)]
                saved = await patch_one_in_db(
                    collection=database[name],
                    db_filter={"_id": record["_id"]},
                    update={"$set": edited},
                    expected_version=read_at,
                    return_document=ReturnDocument.AFTER,
                )

                return pressed, saved

        pressed, saved = on_the_seed_loop(_run())

        def at(path: str) -> Any:
            value: Any = saved
            for key in path.split("."):
                value = value[key]

            return value

        assert pressed == [1, 0]
        assert {path: at(path) for path in (*moved_to, *edited)} == {**moved_to, **edited}
        assert saved[VERSION_FIELD] == 1
