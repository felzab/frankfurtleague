"""
API · the erasure's grants step: an erased person's grants, the notices naming them, and the records they made

Against a replica set, the step run in a transaction of its own as the erasure runs it. Seeded through
the composers each route writes with, so a field a route stores in another shape is one these cases miss.
"""

from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.database import AsyncDatabase

from app.api.address_change.services import masked_address
from app.api.grants.erasure import erase_grants_in_session
from app.api.grants.services import compose_notice
from app.api.identity.crud import erase_the_mails_in_session
from app.core.collections import Collection
from app.readback import RECORD_MODELS
from tests.database import a_clean_database
from tests.documents import outbox_document, saison_document
from tests.whole_database import where_held
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_grants_erasure_test")

# A century ahead of the real clock: the TTL monitor deletes a row whose delete date has passed, under a case reading it back.
NOW = datetime(2126, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
# When the notices she finds still queued were, so none reads as one the erasure queued.
QUEUED = datetime(2126, 3, 31, 9, 0, tzinfo=UTC)
RUNNING = "2026"

# The person erased. Distinctive, so the whole-database scan finding it is no coincidence.
ERIKA = "erika.zwirbelmoos@frankfurtleague.de"
# Another mailbox, one character from hers.
NAHE = "erikaxzwirbelmoos@frankfurtleague.de"
# The owner, erasing her as the administrator's own route will.
DORA = "dora.inhaberin@frankfurtleague.de"
BERND = "bernd.admin@frankfurtleague.de"
CLARA = "clara.admin@frankfurtleague.de"

ERIKA_ID = ObjectId("6890a1b2c3d4e5f607a10001")
DORA_ID = ObjectId("6890a1b2c3d4e5f607a10003")
BERND_ID = ObjectId("6890a1b2c3d4e5f607a10004")
CLARA_ID = ObjectId("6890a1b2c3d4e5f607a10005")
NAHE_ID = ObjectId("6890a1b2c3d4e5f607a10006")

# The notices still queued when she is erased, one naming her and two not.
NAMING_HER_GRANT = ObjectId("6890a1b2c3d4e5f607a20001")
NOT_HERS = ObjectId("6890a1b2c3d4e5f607a20004")
# Naming another mailbox at her local part, which the fold refuses.
ELSEWHERE = ObjectId("6890a1b2c3d4e5f607a20005")
ERIKA_ELSEWHERE = ERIKA.replace("@frankfurtleague.de", "@anderswo.example.org")
ELSEWHERE_GRANTED_ID = ObjectId("6890a1b2c3d4e5f607a10008")

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def grant_row(grant_id: ObjectId, address: str, admin_tier: str) -> dict[str, Any]:
    return {
        "_id": grant_id,
        "address": address,
        "admin_tier": admin_tier,
        "effective_from": datetime(2026, 1, 1, tzinfo=UTC),
    }


def notice(row_id: ObjectId, grant_id: ObjectId, change: Any, address: str | None) -> dict[str, Any]:
    """Dora's copy of a notice about `grant_id`, keyed by her own grant row, as the enqueue keys each recipient's."""

    composed = compose_notice(grant_id=grant_id, change=change, stage="started", address=address)
    key = f"grant/{grant_id}/{change}/started/{QUEUED.isoformat()}/{DORA_ID}"

    return outbox_document(key, to=DORA, now=QUEUED, data=composed.data, _id=row_id)


async def a_league_she_administered(database: AsyncDatabase) -> None:
    await database[Collection.SAISONS].insert_one(saison_document(RUNNING, "active"))
    await database[Collection.GRANTS].insert_many(
        [
            grant_row(ERIKA_ID, ERIKA, "administration"),
            grant_row(DORA_ID, DORA, "owner"),
            grant_row(BERND_ID, BERND, "administration"),
            grant_row(CLARA_ID, CLARA, "administration"),
            grant_row(NAHE_ID, NAHE, "administration"),
        ]
    )
    await database[Collection.OUTBOX].insert_many(
        [
            notice(NAMING_HER_GRANT, ERIKA_ID, "handover", ERIKA),
            notice(NOT_HERS, CLARA_ID, "granted", CLARA),
            notice(ELSEWHERE, ELSEWHERE_GRANTED_ID, "granted", ERIKA_ELSEWHERE),
        ]
    )


async def on_a_league(url: str, body: Body, *, stores_a_refused_shape: str | None = None) -> Any:
    """The shipped indexes, so a write production would refuse as a duplicate fails here too."""

    async with a_clean_database(url, DATABASE_NAME, constraints=True, stores_a_refused_shape=stores_a_refused_shape) as (
        client,
        database,
    ):
        await a_league_she_administered(database)

        return await body(database, client)


async def erase(database: AsyncDatabase, client: AsyncMongoClient, *, identifier: str = ERIKA) -> None:
    async def step(session: AsyncClientSession) -> None:
        await erase_grants_in_session(
            grants_collection=database[Collection.GRANTS],
            outbox_collection=database[Collection.OUTBOX],
            identifier=identifier,
            now=NOW,
            session=session,
        )

    async with client.start_session() as session:
        await session.with_transaction(step)


async def erase_the_mails(database: AsyncDatabase, client: AsyncMongoClient) -> list[str]:
    """The step that takes the notices about her, which runs after this one in the erasure."""

    async def step(session: AsyncClientSession) -> list[str]:
        return await erase_the_mails_in_session(outbox_collection=database[Collection.OUTBOX], identifier=ERIKA, session=session)

    async with client.start_session() as session:
        return await session.with_transaction(step)


async def outbox_read_back(database: AsyncDatabase) -> None:
    """Every mail row the case leaves, judged as the read-back judges it: the opt-out for her grant spares no row of `outbox`."""

    async for row in database[Collection.OUTBOX].find({}):
        RECORD_MODELS[Collection.OUTBOX].model_validate(row, extra="forbid")


async def ids_in(database: AsyncDatabase, collection: Collection) -> set[ObjectId]:
    return {row["_id"] async for row in database[collection].find({}, {"_id": 1})}


async def queued_for(database: AsyncDatabase, grant_id: ObjectId) -> list[Mapping[str, Any]]:
    """The notices about one grant this erasure owed, each once whoever it is owed to, in the order it owed them."""

    notices: dict[str, Mapping[str, Any]] = {}
    async for row in database[Collection.OUTBOX].find({"key": {"$regex": f"^grant/{grant_id}/"}, "recorded_at": NOW}).sort("_id", 1):
        data = row["data"]
        notices.setdefault(
            row["key"].rpartition("/")[0],
            {"change": data["change"], "stage": data["stage"], "address": data["address"]},
        )

    return list(notices.values())


class TestHerGrantsGo:
    async def test_her_grant_goes_and_nobody_elses(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> set[ObjectId]:
            await erase(database, client)

            return await ids_in(database, Collection.GRANTS)

        assert await on_a_league(mongo_replica_set_url, body) == {DORA_ID, BERND_ID, CLARA_ID, NAHE_ID}


class TestTheNotices:
    """No notice still queued names her, and every administrator is told her grant ended."""

    async def test_her_grants_end_is_queued_with_no_address(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[Mapping[str, Any]]:
            await erase(database, client)

            return await queued_for(database, ERIKA_ID)

        assert await on_a_league(mongo_replica_set_url, body) == [{"change": "revoked", "stage": "completed", "address": None}]

    async def test_every_notice_about_her_goes_and_no_other_moves(self, mongo_replica_set_url: str):
        """A notice owed any holder naming her, or her mask, is deleted whole; only a full address stands on a line."""

        granted, completed, settled = ObjectId(), ObjectId(), ObjectId()

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[set[ObjectId], list[str]]:
            moved = notice(completed, BERND_ID, "address", BERND)
            await database[Collection.OUTBOX].insert_many(
                [
                    notice(granted, ERIKA_ID, "granted", ERIKA),
                    {**moved, "data": {**moved["data"], "stage": "completed", "new_address": masked_address(ERIKA)}},
                    # A sent row keeps no data, which the read meets as nothing to judge.
                    {**notice(settled, CLARA_ID, "revoked", CLARA), "state": "sent", "data": None},
                ]
            )

            lines = await erase_the_mails(database, client)
            await outbox_read_back(database)

            return await ids_in(database, Collection.OUTBOX), lines

        left, lines = await on_a_league(mongo_replica_set_url, body)

        assert left.isdisjoint({NAMING_HER_GRANT, granted, completed})
        assert left >= {NOT_HERS, ELSEWHERE, settled}
        assert sorted(lines) == sorted(f"{Collection.OUTBOX}/{row_id}/data.address" for row_id in (NAMING_HER_GRANT, granted))

    async def test_a_handover_waiting_on_her_row_is_withdrawn_naming_nobody(self, mongo_replica_set_url: str):
        """The holders hold a date for it, and the grant it waited on is gone."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[Mapping[str, Any]]:
            await database[Collection.GRANTS].update_one({"_id": ERIKA_ID}, {"$set": {"owner_from": NOW}})
            await erase(database, client)

            return await queued_for(database, ERIKA_ID)

        assert await on_a_league(mongo_replica_set_url, body) == [
            {"change": "revoked", "stage": "completed", "address": None},
            {"change": "handover", "stage": "withdrawn", "address": None},
        ]


async def test_her_address_is_held_nowhere_in_the_database(mongo_replica_set_url: str):
    """Rendered whole, the step's own log rows included: an image or a filter naming her would keep what the step destroys."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> dict[str, list[str]]:
        held = await where_held(database, ERIKA)
        assert held[ERIKA], f"the control: the seed holds her nowhere, so the scan below proves nothing: {held}"
        await erase(database, client)
        await erase_the_mails(database, client)

        return await where_held(database, ERIKA)

    assert await on_a_league(mongo_replica_set_url, body) == {ERIKA: []}
