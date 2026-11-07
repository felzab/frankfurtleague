"""
API · the erasure's grants step: an erased person's grants, the notices naming them, and the records they made

Against a replica set, the step run in a transaction of its own as the registry runs it. Seeded through
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
from app.api.ban_list.services import compose_barred_until_saison_id
from app.api.grants.erasure import erase_grants_in_session
from app.api.grants.services import compose_notice
from app.api.identity.crud import erase_the_mails_in_session
from app.api.outbox.schemas import FLGrantData
from app.api.outbox.services import DELIVERY_DEADLINE, RETENTION
from app.core.collections import Collection
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import saison_document
from tests.whole_database import where_held
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_grants_erasure_test")

NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
# When the notices she finds still queued were, so none reads as one the erasure queued.
QUEUED = datetime(2026, 3, 31, 9, 0, tzinfo=UTC)
TODAY = "2026-04-01"
RUNNING = "2026"
STANDING = compose_barred_until_saison_id(running_saison_id=RUNNING)

# The person erased. Distinctive, so the whole-database scan finding it is no coincidence.
ERIKA = "erika.zwirbelmoos@frankfurtleague.de"
# Her mailbox as a paste, or an actor stored before the fold, typed it: the fold claims it.
ERIKA_TYPED = "Erika.Zwirbelmoos@FrankfurtLeague.de"
# Another mailbox, which a pattern leaving the dot unescaped takes as hers.
NAHE = "erikaxzwirbelmoos@frankfurtleague.de"
# Another mailbox, a long s where hers has an s: the pattern's `i` may read it as hers, the fold does not.
LANGES_S = ERIKA.replace("moos@", f"moo{chr(0x17F)}@")
# Her mailbox at a punycode domain, and as a hand-typed paste may spell it, in capitals and padded: the fold equates
# the two, and a read asking the stored spelling alone misses it.
ERIKA_PUNYCODE = "erika@xn--mller-kva.de"
ERIKA_PUNYCODE_PASTED = f"Erika@XN--MLLER-KVA.DE{chr(0xA0)}"
# The owner, erasing her as the administrator's own route will.
DORA = "dora.inhaberin@frankfurtleague.de"
BERND = "bernd.admin@frankfurtleague.de"
CLARA = "clara.admin@frankfurtleague.de"

ERIKA_ID = ObjectId("6890a1b2c3d4e5f607a10001")
# A second row of hers in a spelling no request matches: a dead grant still holds the address.
ERIKA_DEAD_ID = ObjectId("6890a1b2c3d4e5f607a10002")
DORA_ID = ObjectId("6890a1b2c3d4e5f607a10003")
BERND_ID = ObjectId("6890a1b2c3d4e5f607a10004")
CLARA_ID = ObjectId("6890a1b2c3d4e5f607a10005")
NAHE_ID = ObjectId("6890a1b2c3d4e5f607a10006")

# The notices still queued when she is erased, one naming her and two not.
NAMING_HER_GRANT = ObjectId("6890a1b2c3d4e5f607a20001")
NOT_HERS = ObjectId("6890a1b2c3d4e5f607a20004")
# Naming another mailbox at her local part, which the fold refuses.
ELSEWHERE = ObjectId("6890a1b2c3d4e5f607a20005")
ERIKA_ELSEWHERE = ERIKA.replace("@frankfurtleague.de", "@anderswo.de")
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
    composed = compose_notice(grant_id=grant_id, change=change, stage="started", address=address)

    # Owed to Dora, as `app/api/outbox/services.py :: enqueue_mails` stores a row: her copy of the notice.
    return {
        "_id": row_id,
        "key": f"grant/{grant_id}/{change}/started/{QUEUED.isoformat()}/{DORA}",
        "kind": "grant",
        "to": DORA,
        "data": FLGrantData.model_validate(composed.data).model_dump(mode="json"),
        "secret": None,
        "reference": None,
        "link": None,
        "state": "open",
        "recorded_at": QUEUED,
        "deadline": QUEUED + DELIVERY_DEADLINE,
        "erase_at": QUEUED + DELIVERY_DEADLINE + RETENTION,
        "lease": None,
        "leased_until": None,
        "attempts": 0,
        "message_id": None,
        "delivery": None,
    }


async def a_league_she_administered(database: AsyncDatabase) -> None:
    await database[Collection.SAISONS].insert_one(saison_document(RUNNING, "active"))
    await database[Collection.GRANTS].insert_many(
        [
            grant_row(ERIKA_ID, ERIKA, "administration"),
            grant_row(ERIKA_DEAD_ID, ERIKA_TYPED, "administration"),
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


def on_a_league(url: str, body: Body) -> Any:
    """The shipped indexes, so a write production would refuse as a duplicate fails here too."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await a_league_she_administered(database)

            return await body(database, client)

    return on_the_seed_loop(_run())


async def erase(database: AsyncDatabase, client: AsyncMongoClient, *, identifier: str = ERIKA) -> int:
    async def step(session: AsyncClientSession) -> int:
        return await erase_grants_in_session(
            grants_collection=database[Collection.GRANTS],
            outbox_collection=database[Collection.OUTBOX],
            identifier=identifier,
            now=NOW,
            session=session,
        )

    async with client.start_session() as session:
        return await session.with_transaction(step)


async def erase_the_mails(database: AsyncDatabase, client: AsyncMongoClient) -> list[str]:
    """The step that takes the notices about her, which runs after this one in the registry."""

    async def step(session: AsyncClientSession) -> list[str]:
        return await erase_the_mails_in_session(outbox_collection=database[Collection.OUTBOX], identifier=ERIKA, session=session)

    async with client.start_session() as session:
        return await session.with_transaction(step)


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
    def test_every_grant_her_address_holds_goes_a_dead_spelling_included(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[int, set[ObjectId]]:
            removed = await erase(database, client)

            return removed, await ids_in(database, Collection.GRANTS)

        removed, grants = on_a_league(mongo_replica_set_url, body)

        assert grants == {DORA_ID, BERND_ID, CLARA_ID, NAHE_ID}
        assert removed == 2

    def test_a_grant_pasted_unfolded_goes(self, mongo_replica_set_url: str):
        """Catches a read asking the stored spelling alone, which leaves this grant standing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[bool, dict[str, list[str]]]:
            pasted = ObjectId()
            await database[Collection.GRANTS].insert_one(grant_row(pasted, ERIKA_PUNYCODE_PASTED, "administration"))
            await erase(database, client, identifier=ERIKA_PUNYCODE)
            stands = await database[Collection.GRANTS].find_one({"_id": pasted}) is not None

            return stands, await where_held(database, "MLLER-KVA", folded=True)

        assert on_a_league(mongo_replica_set_url, body) == (False, {"MLLER-KVA": []})


class TestTheNotices:
    """No notice still queued names her, and every administrator is told her grant ended."""

    def test_her_grants_end_is_queued_with_no_address(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[Mapping[str, Any]]:
            await erase(database, client)

            return await queued_for(database, ERIKA_ID)

        assert on_a_league(mongo_replica_set_url, body) == [{"change": "revoked", "stage": "completed", "address": None}]

    def test_every_notice_about_her_goes_and_no_other_moves(self, mongo_replica_set_url: str):
        """A notice owed any holder naming her, in either spelling, or her mask, is deleted whole; only a full address stands on a line."""

        typed, completed, settled = ObjectId(), ObjectId(), ObjectId()

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[set[ObjectId], list[str]]:
            moved = notice(completed, BERND_ID, "address", BERND)
            await database[Collection.OUTBOX].insert_many(
                [
                    notice(typed, ERIKA_ID, "granted", ERIKA_TYPED),
                    {**moved, "data": {**moved["data"], "stage": "completed", "new_address": masked_address(ERIKA)}},
                    # A sent row keeps no data, which the read meets as nothing to judge.
                    {**notice(settled, CLARA_ID, "revoked", CLARA), "state": "sent", "data": None},
                ]
            )

            lines = await erase_the_mails(database, client)

            return await ids_in(database, Collection.OUTBOX), lines

        left, lines = on_a_league(mongo_replica_set_url, body)

        assert left.isdisjoint({NAMING_HER_GRANT, typed, completed})
        assert left >= {NOT_HERS, ELSEWHERE, settled}
        assert sorted(lines) == sorted(f"{Collection.OUTBOX}/{row_id}/data.address" for row_id in (NAMING_HER_GRANT, typed))

    def test_a_handover_waiting_on_her_row_is_withdrawn_naming_nobody(self, mongo_replica_set_url: str):
        """The holders hold a date for it, and the grant it waited on is gone."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[Mapping[str, Any]]:
            await database[Collection.GRANTS].update_one({"_id": ERIKA_ID}, {"$set": {"owner_from": NOW}})
            await erase(database, client)

            return await queued_for(database, ERIKA_ID)

        assert on_a_league(mongo_replica_set_url, body) == [
            {"change": "revoked", "stage": "completed", "address": None},
            {"change": "handover", "stage": "withdrawn", "address": None},
        ]


def test_her_address_is_held_nowhere_in_the_database_in_either_spelling(mongo_replica_set_url: str):
    """Rendered whole, the step's own log rows included: an image or a filter naming her would keep what the step destroys."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> dict[str, list[str]]:
        held = await where_held(database, ERIKA, ERIKA_TYPED)
        assert held[ERIKA] and held[ERIKA_TYPED], f"the control: the seed holds her nowhere, so the scan below proves nothing: {held}"
        await erase(database, client)
        await erase_the_mails(database, client)

        return await where_held(database, ERIKA, ERIKA_TYPED)

    assert on_a_league(mongo_replica_set_url, body) == {ERIKA: [], ERIKA_TYPED: []}
