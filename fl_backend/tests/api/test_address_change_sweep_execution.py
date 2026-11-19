"""
API · the address change's clock against the shipped indexes: lapses end, due changes take effect, each judged again

A live change whose step lapsed ends within the hour, and a confirmed change whose waiting time ended takes effect or is
refused, the refused one's new address answered alone.
"""

import re
from collections.abc import Awaitable, Callable, Mapping, Sequence
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pymongo
import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.address_change.schemas import FLAddressChangeMovesDonePayload
from app.api.address_change.system_router import (
    get_address_change_moves,
    post_address_change_moves_done,
    sweep_address_change,
)
from app.api.identity.lookup import get_move_collections
from app.core.codes import Code
from app.core.collections import Collection
from app.core.logging import JSONFormatter
from app.shared.schemas.bounds import ADDRESS_CHANGE_WAITING_PERIOD_DAYS
from app.shared.tokens import hash_token
from tests import documents
from tests.acts import deletions_of
from tests.config import grants_for_the_suite
from tests.database import a_clean_database
from tests.documents import saison_document, schiedsrichter_document, spieler_document
from tests.handles import wired
from tests.isolation import InterleavedCollection
from tests.whole_database import where_held
from tests.worker import worker_database

from .address_change_harness import owed

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_address_change_sweep_test")

# Minted at noon on these days, the link lapsed at noon today, half an hour before `NOW`, and lapses tomorrow.
MINTED_TO_LAPSE_YESTERDAY = "2126-04-15"
MINTED_TO_LAPSE_TODAY = "2126-04-16"
# A century ahead of the real clock: the TTL monitor deletes an expired tombstone or day's count at its next pass,
# under a case reading it back. Every seeded day moves with it.
NOW = datetime(2126, 4, 16, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
# Confirmed this long ago, a change waiting is due by `NOW` or still waits.
CONFIRMED_TO_BE_DUE = NOW - timedelta(days=ADDRESS_CHANGE_WAITING_PERIOD_DAYS, minutes=1)
CONFIRMED_TO_WAIT = NOW - timedelta(days=ADDRESS_CHANGE_WAITING_PERIOD_DAYS) + timedelta(minutes=1)


def numbered(position: int) -> ObjectId:
    """One id sequence for the changes, so a case reads them in the one `_id` order the pass keeps."""

    return ObjectId(f"6890a1b2c3d4e5f607e2{position:04d}")


def on_file(position: int) -> str:
    return f"person.{position}@beispielschule.example.org"


def pending(position: int) -> str:
    return f"neue.adresse.{position}@anderswo.example.org"


def a_change(position: int, *, minted: str, **fields: Any) -> dict[str, Any]:
    """The change of `on_file(position)` to `pending(position)`, minted on `minted`."""

    return {
        **documents.address_change_document(
            address=on_file(position), email=pending(position), token_hash=hash_token(f"t{position}"), day=minted
        ),
        "_id": numbered(position),
        **fields,
    }


def confirmed_on(change: dict[str, Any], confirmed_at: datetime) -> dict[str, Any]:
    """`change` on the lost-mailbox way and confirmed at `confirmed_at`, as the new mailbox's press leaves it."""

    return {
        **change,
        "way": "waiting_period",
        "valid_until": None,
        "confirmed_at": confirmed_at,
        "effective_from": confirmed_at + timedelta(days=ADDRESS_CHANGE_WAITING_PERIOD_DAYS),
    }


def a_pupil(position: int) -> dict[str, Any]:
    return spieler_document(ObjectId(), "Quintessa", f"Muster {position}", email=on_file(position))


def a_referee(position: int) -> dict[str, Any]:
    """A referee who confirmed their own record at `on_file(position)`."""

    return schiedsrichter_document(
        ObjectId(),
        email=on_file(position),
        name=f"Schiedsrichter {position}",
        default_payment=20,
        einwilligung=documents.own_einwilligung_document(text_versions=documents.SCHIEDSRICHTER_TEXT_VERSIONS, confirmed_at="2126-03-01"),
    )


async def stored(database: AsyncDatabase, *changes: dict[str, Any]) -> None:
    await database[Collection.ADDRESS_CHANGES].insert_many(list(changes))


async def a_due_person(database: AsyncDatabase, position: int) -> None:
    """A pupil and the referee beside them at one address, and their change due."""

    await database[Collection.SPIELER].insert_one(a_pupil(position))
    await database[Collection.SCHIEDSRICHTER].insert_one(a_referee(position))
    await stored(database, confirmed_on(a_change(position, minted=MINTED_TO_LAPSE_YESTERDAY), CONFIRMED_TO_BE_DUE))


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


async def on_a_league(url: str, body: Body, *, mutates_schema: bool = False) -> Any:
    async with a_clean_database(url, DATABASE_NAME, constraints=True, mutates_schema=mutates_schema) as (client, database):
        await database[Collection.GRANTS].insert_many(grants_for_the_suite())
        await database[Collection.SAISONS].insert_one(saison_document("2026", "active"))

        return await body(database, client)


async def sweep(database: AsyncDatabase, client: AsyncMongoClient, **replaced: Any) -> Any:
    return await sweep_address_change(
        collections=get_move_collections(**wired(get_move_collections, database, **replaced)),
        db=client,
        germany_now=NOW,
    )


async def live(database: AsyncDatabase) -> list[ObjectId]:
    return await database[Collection.ADDRESS_CHANGES].distinct("_id", {"ended": None})


async def refuse_writes_breaking(database: AsyncDatabase, collection: Collection, schema: Mapping[str, Any]) -> None:
    """How this suite forces one row's write to fail mid-pass: a `$jsonSchema` the planted row breaks and every other row keeps."""

    await database.command("collMod", str(collection), validator={"$jsonSchema": dict(schema)}, validationLevel="strict")


def refusing_a_move_to(positions: Sequence[int]) -> dict[str, Any]:
    """The schema refusing a pupil's write to these changes' new addresses: any write a transaction is refused on."""

    return {"not": {"required": ["email"], "properties": {"email": {"enum": [pending(position) for position in positions]}}}}


class TestALapsedChangeEndsOnceItsDeadlinePassed:
    async def test_its_address_goes_from_the_record_and_a_change_before_its_deadline_stands(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await stored(database, a_change(1, minted=MINTED_TO_LAPSE_YESTERDAY), a_change(2, minted=MINTED_TO_LAPSE_TODAY))
            answer = await sweep(database, client)
            ended = await database[Collection.ADDRESS_CHANGES].find_one({"_id": numbered(1)})

            return answer, ended, await live(database), await where_held(database, pending(1), folded=True)

        answer, ended, standing, held = await on_a_league(mongo_replica_set_url, body)

        assert (answer.removed, answer.discarded, answer.effective, answer.failed) == (1, 0, 0, 0)
        assert (ended["ended"]["kind"], ended["address"], ended["email"]) == ("expired", None, None)
        assert standing == [numbered(2)]
        assert held == {pending(1): []}

    @pytest.mark.parametrize("lapses", [1, 2])
    async def test_a_page_s_lapses_write_one_row_with_their_count(self, mongo_replica_set_url: str, lapses: int):
        """No deletion stands without its row; one per change would fill a year's list with nothing an administrator asks of it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await stored(database, *(a_change(position + 1, minted=MINTED_TO_LAPSE_YESTERDAY) for position in range(lapses)))
            await sweep(database, client)
            await sweep(database, client)
            rows = database[Collection.ACTION_LOG].find({"action": "retention.address_changes"})
            return [(row["by"], row["count"], row["record_id"]) async for row in rows]

        assert await on_a_league(mongo_replica_set_url, body) == [("system", lapses, None)]

    async def test_a_waiting_change_is_no_lapse_and_stands_until_it_is_due(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await stored(database, confirmed_on(a_change(1, minted=MINTED_TO_LAPSE_YESTERDAY), CONFIRMED_TO_WAIT))
            return await sweep(database, client), await live(database)

        answer, standing = await on_a_league(mongo_replica_set_url, body)

        assert (answer.removed, answer.discarded, answer.effective) == (0, 0, 0)
        assert standing == [numbered(1)]


class TestADueChangeTakesEffect:
    async def test_it_moves_the_person_and_names_whom_to_notify(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_due_person(database, 1)
            answer = await sweep(database, client)
            return answer, await database[Collection.SPIELER].distinct("email", {"first_name": "Quintessa"}), await owed(database)

        answer, addresses, notices = await on_a_league(mongo_replica_set_url, body)

        assert answer.effective == 1
        assert notices == [{"kind": "effective", "to": on_file(1)}]
        assert addresses == [pending(1)]

    async def test_a_change_finding_nothing_to_move_is_refused_alike(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await stored(database, confirmed_on(a_change(1, minted=MINTED_TO_LAPSE_YESTERDAY), CONFIRMED_TO_BE_DUE))
            return await sweep(database, client), await owed(database), await deletions_of(database, "retention.address_changes")

        answer, notices, deletions = await on_a_league(mongo_replica_set_url, body)

        assert (answer.discarded, answer.effective, [notice["to"] for notice in notices]) == (1, 0, [pending(1)])
        assert deletions == [("system", None, 1, None)]


class TestEachChangeIsJudgedAgainInItsTransaction:
    async def test_a_link_sent_again_after_the_read_keeps_its_change(self, mongo_replica_set_url: str):
        """End the change by its id alone rather than its lapsed terms and this fails: the fresh link and its address go."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.ADDRESS_CHANGES].insert_one(a_change(1, minted=MINTED_TO_LAPSE_YESTERDAY))

            async def send_it_again() -> None:
                await database[Collection.ADDRESS_CHANGES].update_one(
                    {"_id": numbered(1)}, {"$set": {"valid_until": NOW + timedelta(hours=23)}}
                )

            # Once the page read has answered and before any change's own transaction: the page read is the call's first
            # `aggregate`, and the rival runs once.
            changes = InterleavedCollection(database[Collection.ADDRESS_CHANGES], send_it_again, after="aggregate")
            answer = await sweep(database, client, address_changes_collection=changes)

            return (answer.removed, answer.failed), await live(database)

        counts, standing = await on_a_league(mongo_replica_set_url, body)

        assert counts == (0, 0)
        assert standing == [numbered(1)]


class NotTheDatabases(Exception):
    """A failure no driver raises, standing for every class a change's handling can meet outside the database."""


class RaisesOnOneChange:
    """The changes' collection, whose in-session write of one change raises `NotTheDatabases`."""

    def __init__(self, collection: Any, failing: ObjectId) -> None:
        self._collection = collection
        self._failing = failing

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    async def find_one_and_update(self, filter: Mapping[str, Any], *args: Any, **kwargs: Any) -> Any:
        if filter.get("_id") == self._failing:
            raise NotTheDatabases("synthetic")

        return await self._collection.find_one_and_update(filter, *args, **kwargs)

    async def update_many(self, filter: Mapping[str, Any], *args: Any, **kwargs: Any) -> Any:
        ids = filter.get("_id")
        if isinstance(ids, Mapping) and self._failing in ids.get("$in", ()):
            raise NotTheDatabases("synthetic")

        return await self._collection.update_many(filter, *args, **kwargs)


class TestOneChangeHoldsBackNoOther:
    async def test_a_failure_not_the_databases_is_passed_over_and_the_next_goes(
        self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture
    ):
        """Catch the database's failures alone and the call fails, the second change standing and the next pass stopping at the first again."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_due_person(database, 1)
            await a_due_person(database, 2)
            answer = await sweep(
                database, client, address_changes_collection=RaisesOnOneChange(database[Collection.ADDRESS_CHANGES], numbered(1))
            )

            return (answer.effective, answer.failed), await live(database)

        with caplog.at_level("ERROR"):
            counts, standing = await on_a_league(mongo_replica_set_url, body)

        assert counts == (1, 1)
        assert standing == [numbered(1)]
        [failure] = [record for record in caplog.records if getattr(record, "error_code", None) == Code.UNHANDLED_CRASH]
        assert (failure.levelname, failure.getMessage()) == ("ERROR", "transactions.row_passed_over")
        assert (getattr(failure, "clock", None), getattr(failure, "row_id", None)) == ("effect", str(numbered(1)))
        # Located by the frame that raised it, and never by its message, which can quote a value.
        diagnosis = getattr(failure, "diagnosis", "")
        assert re.fullmatch(r"NotTheDatabases in find_one_and_update at .+\.py:\d+", diagnosis) is not None, diagnosis

    async def test_a_failed_page_of_lapses_holds_back_no_due_change(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """The page's one transaction is its own step: raise through it and the due change behind it waits on nothing of its own."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await stored(database, a_change(1, minted=MINTED_TO_LAPSE_YESTERDAY))
            await a_due_person(database, 2)
            answer = await sweep(
                database, client, address_changes_collection=RaisesOnOneChange(database[Collection.ADDRESS_CHANGES], numbered(1))
            )

            return (answer.removed, answer.effective, answer.failed), await live(database)

        with caplog.at_level("ERROR"):
            counts, standing = await on_a_league(mongo_replica_set_url, body)

        assert counts == (0, 1, 1)
        assert standing == [numbered(1)]
        assert [getattr(record, "clock", None) for record in caplog.records if record.getMessage() == "transactions.row_passed_over"] == [
            "lapse"
        ]

    async def test_a_refused_effect_is_passed_over_and_the_next_goes(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """A write the database itself refuses, whose message quotes the value. Remove the catch and the call fails."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_due_person(database, 1)
            await a_due_person(database, 2)
            await refuse_writes_breaking(database, Collection.SPIELER, refusing_a_move_to([1]))
            answer = await sweep(database, client)

            return (answer.effective, answer.failed), await live(database)

        with caplog.at_level("ERROR"):
            counts, standing = await on_a_league(mongo_replica_set_url, body, mutates_schema=True)

        assert counts == (1, 1)
        assert standing == [numbered(1)]
        failures = [record for record in caplog.records if getattr(record, "error_code", None) == Code.DATABASE_FAILED]
        assert [
            getattr(record, "row_id", None) == str(numbered(1)) and pending(1) not in JSONFormatter().format(record) for record in failures
        ] == [True]


# Server-side, so the database itself stops answering and only the deadline's `maxTimeMS` stops it.
STALL = "sleep(60000) || true"
# Long enough that the change before the stall ends inside it on a loaded machine.
SHORT_DEADLINE_S = 1.5


class StallsItsWrite:
    """A collection whose in-session write of one document sleeps on the server, past the deadline the call runs under."""

    def __init__(self, collection: Any, stalled: ObjectId) -> None:
        self._collection = collection
        self._stalled = stalled

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    async def find_one_and_update(self, filter: Mapping[str, Any], *args: Any, **kwargs: Any) -> Any:
        if filter.get("_id") == self._stalled:
            filter = {**filter, "$where": STALL}

        return await self._collection.find_one_and_update(filter, *args, **kwargs)


class TestTheDeadlineStopsTheCall:
    async def test_a_change_dearer_than_the_budgets_row_moves_nothing_and_stays_due(self, mongo_replica_set_url: str):
        """Nothing bounds what one address holds, so a share can meet a change dearer than the one it is sized at.

        Stalled at its last registration, its pupil row already written: the transaction takes everything back.
        """

        registrations = [
            documents.registrierung_document(
                ObjectId(),
                on_file(2),
                saison_id="2026",
                team_id=ObjectId(),
                first_name="Quintessa",
                last_name="Muster 2",
                token=f"registration-{number}",
                submitted_at="2126-04-14",
                deadline="2126-04-21",
            )
            for number in range(3)
        ]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_due_person(database, 1)
            await a_due_person(database, 2)
            await database[Collection.REGISTRIERUNGEN].insert_many(registrations)
            stalled = StallsItsWrite(database[Collection.REGISTRIERUNGEN], registrations[-1]["_id"])
            with pymongo.timeout(SHORT_DEADLINE_S):
                answer = await sweep(database, client, registrierungen_collection=stalled)

            return (
                answer,
                await database[Collection.SPIELER].distinct("email", {"last_name": "Muster 2"}),
                await database[Collection.REGISTRIERUNGEN].distinct("email", {"_id": {"$in": [row["_id"] for row in registrations]}}),
            )

        answer, dear, moved = await on_a_league(mongo_replica_set_url, body)

        assert (answer.effective, answer.failed) == (1, 0)
        assert (dear, moved) == ([on_file(2)], [on_file(2)])


class TestTheOwedCarries:
    """Owed by an effect on its ended record, listed until the frontend reports each carried."""

    async def test_each_is_listed_until_it_is_reported_carried_and_a_repeat_takes_nothing(self, mongo_replica_set_url: str):
        async def moves(database: AsyncDatabase) -> list[tuple[ObjectId, bool]]:
            """Each change and whether it still owes its carry, as stored."""

            return [(row["_id"], "move" in row) async for row in database[Collection.ADDRESS_CHANGES].find({}, sort=[("_id", 1)])]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.ADDRESS_CHANGES].insert_many(
                [
                    {**a_change(position, minted="2126-04-01"), "move": {"old": on_file(position), "new": pending(position)}}
                    for position in (1, 2)
                ]
            )
            listed = (await get_address_change_moves(address_changes_collection=database[Collection.ADDRESS_CHANGES])).moves
            payload = FLAddressChangeMovesDonePayload(ids=[numbered(1)])
            await post_address_change_moves_done(done_data=payload, address_changes_collection=database[Collection.ADDRESS_CHANGES])
            first = await moves(database)
            await post_address_change_moves_done(done_data=payload, address_changes_collection=database[Collection.ADDRESS_CHANGES])
            again = await moves(database)
            left = (await get_address_change_moves(address_changes_collection=database[Collection.ADDRESS_CHANGES])).moves

            return [(row.id, row.old, row.new) for row in listed], first, again, [row.id for row in left]

        assert await on_a_league(mongo_replica_set_url, body) == (
            [(numbered(1), on_file(1), pending(1)), (numbered(2), on_file(2), pending(2))],
            [(numbered(1), False), (numbered(2), True)],
            [(numbered(1), False), (numbered(2), True)],
            [numbered(2)],
        )
