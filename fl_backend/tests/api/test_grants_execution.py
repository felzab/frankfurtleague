"""
API · the grants: what each act stores and owes, the wait, the one owner, and the races the anchor closes

Against a replica set, every write here running in a transaction. The handlers are called directly,
the actor bound as `bind_actor` binds it; the mounted route is what reads a request's actor, and one
class goes through it.
"""

import functools
import time
from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from fastapi import FastAPI
from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase

from app.api.grants.admin_router import delete_grant, delete_handover, post_grant, post_handover
from app.api.grants.crud import move_the_grant_in_session, owe_in_session
from app.api.grants.schemas import FLPostGrantPayload
from app.api.grants.services import compose_notice
from app.api.grants.system_router import post_handover_pass
from app.core.codes import Code
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.exceptions import APIError, DocumentNotFoundError
from app.core.recording import actor_var
from app.core.security import PASSKEY_FACTOR
from app.main import create_app
from app.shared.schemas.bounds import GRANT_WAIT_HOURS, OWNER_WAIT_DAYS
from tests.app_client import app_client
from tests.bans import ban_through_the_route
from tests.config import ADMIN_KEY
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import rules_document, saison_document
from tests.isolation import COMMITTED, InterleavedCollection, Rival, outcome_of
from tests.session_headers import StampedHeaders, session_headers
from tests.worker import worker_database

from .conftest import config_for

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_grants_test")

CONFIG = config_for(DATABASE_NAME)

NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
TODAY = "2026-04-01"
IN_EFFECT = datetime(2026, 1, 1, tzinfo=UTC)
# The German clock falls back an hour in the night of the 25th.
BEFORE_THE_CLOCK_FALLS_BACK = datetime(2026, 10, 24, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

# The grants every case starts from: the owner, and two administrators.
OWNER_ID = ObjectId("6890a1b2c3d4e5f607910001")
ANNA_ID = ObjectId("6890a1b2c3d4e5f607910002")
BERND_ID = ObjectId("6890a1b2c3d4e5f607910003")
NORA_ID = ObjectId("6890a1b2c3d4e5f607910004")
OWNER = "inhaberin@frankfurtleague.de"
ANNA = "anna.admin@frankfurtleague.de"
BERND = "bernd.admin@frankfurtleague.de"

# An address the league adds in the cases below, in a spelling the fold changes.
NEU_TYPED = "Nora.Neu@Beispielschule.de"
NEU = "nora.neu@beispielschule.de"

BAN_REASON = "Wiederholt gemeldet"

RUNNING = "2026"

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def stored(moment: datetime) -> datetime:
    """An instant as the driver reads it back."""

    return moment.astimezone(UTC).replace(tzinfo=None)


@functools.cache
def _served() -> FastAPI:
    """One app for every case serving through it: building one costs more than the request a case sends through it.

    Built on first use rather than at import, which every xdist worker pays at collection.
    """

    return create_app(CONFIG)


def grant_document(grant_id: ObjectId, address: str, admin_tier: str, *, effective_from: datetime = IN_EFFECT) -> dict[str, Any]:
    """As the recovery paste writes one."""

    return {"_id": grant_id, "address": address, "admin_tier": admin_tier, "granted_by": "PLAYGROUND", "effective_from": effective_from}


# Nora's addition still waiting beside the three in effect.
WAITING = grant_document(NORA_ID, NEU, "administration", effective_from=NOW + timedelta(hours=1))


def the_three_grants() -> list[dict[str, Any]]:
    return [
        grant_document(OWNER_ID, OWNER, "owner"),
        grant_document(ANNA_ID, ANNA, "administration"),
        grant_document(BERND_ID, BERND, "administration"),
    ]


def on_a_league(url: str, body: Body, *, grants: list[dict[str, Any]] | None = None) -> Any:
    """The shipped indexes, a season running, and the grants."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.SAISONS].insert_one(
                saison_document(RUNNING, "active", rules=rules_document(number_of_gruppen=2, allowed_stufen=["E1"]))
            )
            await database[Collection.GRANTS].insert_many(the_three_grants() + (grants or []))

            return await body(database, client)

    return on_the_seed_loop(_run())


async def administering(als: str, call: Callable[[], Awaitable[Any]]) -> Any:
    """`call` as one request of the administrator: the actor `bind_actor` binds."""

    token = actor_var.set(als)
    try:
        return await call()
    finally:
        actor_var.reset(token)


async def add(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    email: str = NEU_TYPED,
    *,
    als: str = OWNER,
    grants: Any = None,
    outbox: Any = None,
    now: datetime = NOW,
) -> ObjectId:
    async def call() -> Any:
        return await post_grant(
            payload=FLPostGrantPayload(email=email),
            grants_collection=grants if grants is not None else database[Collection.GRANTS],
            ban_list_collection=database[Collection.BAN_LIST],
            address_changes_collection=database[Collection.ADDRESS_CHANGES],
            outbox_collection=outbox if outbox is not None else database[Collection.OUTBOX],
            db=client,
            granted_by=als,
            now=now,
        )

    return (await administering(als, call)).grant_id


async def remove(database: AsyncDatabase, client: AsyncMongoClient, grant_id: ObjectId, *, als: str = OWNER, outbox: Any = None) -> None:
    async def call() -> Any:
        return await delete_grant(
            grant_id=grant_id,
            grants_collection=database[Collection.GRANTS],
            address_changes_collection=database[Collection.ADDRESS_CHANGES],
            outbox_collection=outbox if outbox is not None else database[Collection.OUTBOX],
            db=client,
            revoked_by=als,
            now=NOW,
        )

    await administering(als, call)


async def hand_over(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    grant_id: ObjectId = ANNA_ID,
    *,
    als: str = OWNER,
    grants: Any = None,
    now: datetime = NOW,
) -> None:
    async def call() -> Any:
        return await post_handover(
            grant_id=grant_id,
            grants_collection=grants if grants is not None else database[Collection.GRANTS],
            ban_list_collection=database[Collection.BAN_LIST],
            address_changes_collection=database[Collection.ADDRESS_CHANGES],
            outbox_collection=database[Collection.OUTBOX],
            db=client,
            started_by=als,
            now=now,
        )

    await administering(als, call)


async def stop(database: AsyncDatabase, client: AsyncMongoClient, grant_id: ObjectId = ANNA_ID, *, als: str = OWNER) -> None:
    async def call() -> Any:
        return await delete_handover(
            grant_id=grant_id,
            grants_collection=database[Collection.GRANTS],
            address_changes_collection=database[Collection.ADDRESS_CHANGES],
            outbox_collection=database[Collection.OUTBOX],
            db=client,
            stopped_by=als,
            now=NOW,
        )

    await administering(als, call)


async def pass_at(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    now: datetime = NOW + timedelta(days=OWNER_WAIT_DAYS),
    *,
    grants: Any = None,
    outbox: Any = None,
) -> int:
    answer = await post_handover_pass(
        grants_collection=grants if grants is not None else database[Collection.GRANTS],
        address_changes_collection=database[Collection.ADDRESS_CHANGES],
        outbox_collection=outbox if outbox is not None else database[Collection.OUTBOX],
        db=client,
        now=now,
    )

    return answer.handed_over


async def tiers(database: AsyncDatabase) -> dict[str, str]:
    return {str(row["address"]): str(row["admin_tier"]) async for row in database[Collection.GRANTS].find()}


async def addresses(database: AsyncDatabase) -> list[str]:
    return sorted([str(row["address"]) async for row in database[Collection.GRANTS].find()])


async def row_of(database: AsyncDatabase, grant_id: ObjectId) -> Mapping[str, Any]:
    row = await database[Collection.GRANTS].find_one({"_id": grant_id})
    assert row is not None

    return row


async def owed(database: AsyncDatabase) -> list[tuple[str, str, str | None, str | None, list[str], str | None]]:
    """Each notice owed, in order: its change, stage, address, actor, everybody it is owed to, and the date it promises."""

    rows = [row async for row in database[Collection.OUTBOX].find({"state": "open", "kind": "grant"}).sort([("recorded_at", 1), ("_id", 1)])]
    notices: dict[str, tuple[Mapping[str, Any], list[str]]] = {}
    for row in rows:
        notices.setdefault(row["key"].rpartition("/")[0], (row["data"], []))[1].append(str(row["to"]))

    return [
        (data["change"], data["stage"], data["address"], data["changed_by"], sorted(to), data["effective_from"])
        for data, to in notices.values()
    ]


async def acts_on(database: AsyncDatabase, grant_id: ObjectId) -> list[tuple[str, str, str | None]]:
    """The Protokoll's rows on one grant, oldest first: what was done, by whom, and the address it names."""

    rows = database[Collection.ACTION_LOG].find({"record_id": grant_id}, sort=[("_id", 1)])

    return [(row["action"], row["by"], row["label"]) async for row in rows]


async def refusal_of(call: Awaitable[Any]) -> str:
    with pytest.raises(APIError) as raised:
        await call

    return str(raised.value.error_code)


class Aborting:
    """A collection whose named method runs, then raises: the transaction around it aborts after that write.

    Not a subclass: the driver builds a collection off a database handle, so every other call delegates.
    """

    def __init__(self, inner: Any, method: str) -> None:
        self._inner = inner
        self._method = method

    def __getattr__(self, name: str) -> Any:
        attribute = getattr(self._inner, name)
        if name != self._method:
            return attribute

        async def wrapped(*args: Any, **kwargs: Any) -> Any:
            await attribute(*args, **kwargs)
            raise RuntimeError("aborted after the write")

        return wrapped


EVERY_HOLDER = sorted([OWNER, ANNA, BERND])


class TestAnAddition:
    def test_the_row_waits_a_day_its_address_folded_and_every_holder_and_the_person_are_told(self, mongo_replica_set_url: str):
        """Folded, or the actor check's equality misses the person. The starter is told too: a hijacked session's owner learns of it so."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[Any, Any]:
            created = await add(database, client)

            return await database[Collection.GRANTS].find_one({"_id": created}, {"_id": 0, "bounded_writes": 0}), await owed(database)

        row, notices = on_a_league(mongo_replica_set_url, body)

        assert row == {
            "address": NEU,
            "admin_tier": "administration",
            "granted_by": OWNER,
            "effective_from": stored(NOW + timedelta(hours=GRANT_WAIT_HOURS)),
        }
        # The date is the mail's one sentence on when it lands.
        assert notices == [("granted", "started", NEU, OWNER, sorted([*EVERY_HOLDER, NEU]), "2026-04-02T10:30:00Z")]

    def test_a_waiting_holder_is_told_of_nothing_but_their_own_row(self, mongo_replica_set_url: str):
        """The holder list is who is in effect: a row still waiting may yet be withdrawn, and hears only of itself."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await add(database, client, "paul@beispielschule.de")

            return await owed(database)

        [(_, _, _, _, to, _)] = on_a_league(mongo_replica_set_url, body, grants=[WAITING])

        assert to == sorted([*EVERY_HOLDER, "paul@beispielschule.de"])

    def test_an_address_held_is_refused_in_another_spelling_a_waiting_row_included(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[APIError, list[str]]:
            with pytest.raises(APIError) as refused:
                await add(database, client)

            return refused.value, await addresses(database)

        refused, held = on_a_league(mongo_replica_set_url, body, grants=[WAITING])

        # Named on no box, the refusal reaches a shared failure line that sends the owner to a retry refused alike.
        assert (refused.error_code, refused.fields, held) == (Code.GRANT_EXISTS, (("email",),), sorted([*EVERY_HOLDER, NEU]))

    def test_a_live_change_at_the_address_ends(self, mongo_replica_set_url: str):
        """Left standing, its switch would carry the waiting row to an address the owner never named."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            change = await database[Collection.ADDRESS_CHANGES].insert_one(
                {"address": NEU, "email": "woanders@beispielschule.de", "ended": None}
            )
            await add(database, client)

            return await database[Collection.ADDRESS_CHANGES].find_one({"_id": change.inserted_id})

        change = on_a_league(mongo_replica_set_url, body)

        assert change["ended"]["kind"] == "discarded"

    def test_a_retried_write_owes_each_recipient_one_row(self, mongo_replica_set_url: str):
        """A transaction retried after a conflict runs its enqueue again under the instant it was first handed."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> int:
            notice = compose_notice(
                grant_id=ANNA_ID, change="handover", stage="started", address=ANNA, changed_by=OWNER, effective_from=NOW, now=NOW
            )

            async def owe(session: AsyncClientSession) -> None:
                await owe_in_session(
                    [notice],
                    outbox_collection=database[Collection.OUTBOX],
                    grants_collection=database[Collection.GRANTS],
                    address_changes_collection=database[Collection.ADDRESS_CHANGES],
                    now=NOW,
                    session=session,
                )

            for _ in range(2):
                async with client.start_session() as session:
                    await session.with_transaction(owe)

            return await database[Collection.OUTBOX].count_documents({})

        assert on_a_league(mongo_replica_set_url, body) == len(EVERY_HOLDER)

    def test_an_addition_that_aborts_at_its_notice_leaves_neither(self, mongo_replica_set_url: str):
        """A row written outside the transaction would stand with nobody told, and telling the holders is what the wait is for."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[int, int]:
            with pytest.raises(RuntimeError):
                await add(database, client, outbox=cast(AsyncCollection, Aborting(database[Collection.OUTBOX], "insert_many")))

            return await database[Collection.GRANTS].count_documents({"address": NEU}), await database[Collection.OUTBOX].count_documents({})

        assert on_a_league(mongo_replica_set_url, body) == (0, 0)


class TestAWaitCountsHours:
    def test_both_waits_run_their_whole_length_across_a_clock_change(self, mongo_replica_set_url: str):
        """Added to a Berlin value the hours would be the wall clock's, and this wait would run 25 of them."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[Any, Any]:
            created = await add(database, client, now=BEFORE_THE_CLOCK_FALLS_BACK)
            await hand_over(database, client, now=BEFORE_THE_CLOCK_FALLS_BACK)

            return (await row_of(database, created))["effective_from"], (await row_of(database, ANNA_ID))["owner_from"]

        effective_from, owner_from = on_a_league(mongo_replica_set_url, body)

        started = stored(BEFORE_THE_CLOCK_FALLS_BACK)
        assert effective_from == started + timedelta(hours=GRANT_WAIT_HOURS)
        assert owner_from == started + timedelta(days=OWNER_WAIT_DAYS)


class TestOnlyTheOwnerActs:
    @pytest.mark.parametrize(
        "act",
        [
            pytest.param(lambda database, client: add(database, client, als=ANNA), id="an addition"),
            pytest.param(lambda database, client: remove(database, client, BERND_ID, als=ANNA), id="a removal"),
            pytest.param(lambda database, client: hand_over(database, client, BERND_ID, als=ANNA), id="a handover"),
            pytest.param(lambda database, client: stop(database, client, BERND_ID, als=ANNA), id="a stop"),
            pytest.param(lambda database, client: remove(database, client, ObjectId(), als=ANNA), id="before the target is answered"),
        ],
    )
    def test_an_administrator_is_refused_and_nothing_moves(self, mongo_replica_set_url: str, act: Body):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, int, list[str]]:
            return await refusal_of(act(database, client)), await database[Collection.OUTBOX].count_documents({}), await addresses(database)

        assert on_a_league(mongo_replica_set_url, body) == (Code.GRANT_ONLY_OWNER, 0, EVERY_HOLDER)


class TestARemoval:
    def test_it_ends_the_grant_at_once_and_tells_who_remains_and_the_person(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await remove(database, client, BERND_ID)

            return await addresses(database), await owed(database), await acts_on(database, BERND_ID)

        held, notices, acts = on_a_league(mongo_replica_set_url, body)

        assert held == sorted([OWNER, ANNA])
        assert notices == [("revoked", "completed", BERND, OWNER, EVERY_HOLDER, None)]
        assert acts == [("grant.removed", OWNER, BERND)]

    def test_a_waiting_row_is_withdrawn_by_the_same_press(self, mongo_replica_set_url: str):
        """Mailed as a withdrawal: „hat keinen Zugang mehr“ would tell the person they once held one."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await remove(database, client, NORA_ID)

            return await owed(database), await database[Collection.ACTION_LOG].count_documents(
                {"action": "grant.addition_withdrawn", "label": NEU}
            )

        notices, logged = on_a_league(mongo_replica_set_url, body, grants=[WAITING])

        assert notices == [("granted", "withdrawn", NEU, OWNER, sorted([*EVERY_HOLDER, NEU]), None)]
        assert logged == 1

    def test_a_handover_waiting_on_the_row_is_withdrawn_in_words(self, mongo_replica_set_url: str):
        """The holders hold a date for the handover, and a removal's own mail says nothing of it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await hand_over(database, client)
            await database[Collection.OUTBOX].delete_many({})
            await remove(database, client, ANNA_ID)

            return await owed(database)

        assert on_a_league(mongo_replica_set_url, body) == [
            ("revoked", "completed", ANNA, OWNER, EVERY_HOLDER, None),
            ("handover", "withdrawn", ANNA, OWNER, EVERY_HOLDER, None),
        ]

    def test_the_owners_row_goes_by_no_removal(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            return await refusal_of(remove(database, client, OWNER_ID))

        assert on_a_league(mongo_replica_set_url, body) == Code.GRANT_OWNER

    def test_a_removal_that_aborts_at_its_notice_leaves_the_grant(self, mongo_replica_set_url: str):
        """A notice written outside its change's transaction would survive the change's abort, and the other way about."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[int, int]:
            with pytest.raises(RuntimeError):
                await remove(database, client, BERND_ID, outbox=cast(AsyncCollection, Aborting(database[Collection.OUTBOX], "insert_many")))

            return await database[Collection.GRANTS].count_documents({"_id": BERND_ID}), await database[Collection.OUTBOX].count_documents({})

        assert on_a_league(mongo_replica_set_url, body) == (1, 0)


class TestAHandover:
    def test_it_dates_the_row_and_tells_every_holder_while_the_tier_stays(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await hand_over(database, client)

            return (
                (await row_of(database, ANNA_ID))["owner_from"],
                await tiers(database),
                await owed(database),
                await acts_on(database, ANNA_ID),
            )

        owner_from, held, notices, acts = on_a_league(mongo_replica_set_url, body)

        assert owner_from == stored(NOW + timedelta(days=OWNER_WAIT_DAYS))
        assert (held[OWNER], held[ANNA]) == ("owner", "administration")
        # The date is all a holder has to stop the handover by.
        assert notices == [("handover", "started", ANNA, OWNER, EVERY_HOLDER, "2026-04-08T10:30:00Z")]
        assert acts == [("grant.handover_started", OWNER, ANNA)]

    def test_a_row_still_waiting_is_refused_so_an_addition_then_a_handover_waits_both(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            return await refusal_of(hand_over(database, client, NORA_ID))

        assert on_a_league(mongo_replica_set_url, body, grants=[WAITING]) == Code.GRANT_NOT_IN_EFFECT

    def test_the_owners_own_row_and_a_banned_address_are_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[str]:
            await database[Collection.BAN_LIST].insert_one({"address": BERND})

            return [await refusal_of(hand_over(database, client, OWNER_ID)), await refusal_of(hand_over(database, client, BERND_ID))]

        assert on_a_league(mongo_replica_set_url, body) == [Code.GRANT_OWNER, Code.GRANT_BARRED]

    def test_a_stop_takes_the_date_off_and_tells_every_holder(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await hand_over(database, client)
            await stop(database, client)

            return await row_of(database, ANNA_ID), await pass_at(database, client), await owed(database), await acts_on(database, ANNA_ID)

        row, handed_over, notices, acts = on_a_league(mongo_replica_set_url, body)

        assert "owner_from" not in row
        assert handed_over == 0
        assert notices[-1] == ("handover", "withdrawn", ANNA, OWNER, EVERY_HOLDER, None)
        assert acts[-1] == ("grant.handover_withdrawn", OWNER, ANNA)

    def test_a_row_waiting_on_no_handover_has_nothing_to_stop(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> None:
            with pytest.raises(DocumentNotFoundError):
                await stop(database, client)

        on_a_league(mongo_replica_set_url, body)


class TestThePass:
    def test_before_its_date_it_moves_nothing_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[int, dict[str, str], int]:
            await hand_over(database, client)
            before = (await row_of(database, ANNA_ID))["bounded_writes"]
            handed_over = await pass_at(database, client, NOW + timedelta(days=OWNER_WAIT_DAYS) - timedelta(seconds=1))

            return handed_over, await tiers(database), (await row_of(database, ANNA_ID))["bounded_writes"] - before

        handed_over, held, anchors = on_a_league(mongo_replica_set_url, body)

        assert (handed_over, held[OWNER], anchors) == (0, "owner", 0)

    def test_at_its_date_the_role_moves_under_the_index_and_everyone_is_told(self, mongo_replica_set_url: str):
        """Demoting first is what `uniq_grant_owner` asks: it is checked at each write, inside the transaction too."""

        moment = NOW + timedelta(days=OWNER_WAIT_DAYS)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await hand_over(database, client)
            handed_over = await pass_at(database, client, moment)
            logged = await database[Collection.ACTION_LOG].find_one({"action": "grant.handover_completed"})

            return handed_over, await tiers(database), await row_of(database, ANNA_ID), (await owed(database))[-1], logged

        handed_over, held, row, notice, logged = on_a_league(mongo_replica_set_url, body)

        assert handed_over == 1
        assert (held[OWNER], held[ANNA], held[BERND]) == ("administration", "owner", "administration")
        assert row["effective_from"] == stored(moment)
        assert "owner_from" not in row
        assert notice == ("handover", "completed", ANNA, None, EVERY_HOLDER, None)
        assert (logged["by"], logged["label"], logged["record_id"]) == ("system", ANNA, ANNA_ID)

    def test_the_swap_is_one_transaction(self, mongo_replica_set_url: str):
        """Half a swap leaves a league with no owner, which nothing in the application can repair."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> dict[str, str]:
            await hand_over(database, client)
            with pytest.raises(RuntimeError):
                await pass_at(database, client, outbox=cast(AsyncCollection, Aborting(database[Collection.OUTBOX], "insert_many")))

            return await tiers(database)

        held = on_a_league(mongo_replica_set_url, body)

        assert (held[OWNER], held[ANNA]) == ("owner", "administration")

    def test_a_stop_landing_beside_the_pass_keeps_the_role_with_the_owner(self, mongo_replica_set_url: str):
        """The rival is the owner's stop in the last hour: judged outside the transaction, the role moves after the owner stopped it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str | None, dict[str, str]]:
            await hand_over(database, client)
            racing = GrantsRunningARivalAfterTheFirstRead(database[Collection.GRANTS], lambda: stop(database, client))
            await pass_at(database, client, grants=racing)
            racing.assert_landed_inside(serially=1)

            return racing.rival_outcome, await tiers(database)

        outcome, held = on_a_league(mongo_replica_set_url, body)

        assert (outcome, held[OWNER]) == (COMMITTED, "owner")


class GrantsRunningARivalAfterTheFirstRead(InterleavedCollection):
    """The grants a judging transaction reads, a rival write run once after that read and before its anchor.

    So only the anchor can make the two conflict.
    """

    def __init__(self, collection: Any, rival: Rival) -> None:
        async def reported() -> None:
            self.rival_outcome = await outcome_of(rival())

        super().__init__(collection, reported)
        self.rival_outcome: str | None = None

    async def aggregate(self, *args: Any, **kwargs: Any) -> Any:
        cursor = await self._collection.aggregate(*args, **kwargs)
        await self.run_the_rival()

        return cursor


async def ban(database: AsyncDatabase, client: AsyncMongoClient, email: str = NEU_TYPED, *, grants: Any = None) -> Any:
    async def call() -> Any:
        return await ban_through_the_route(database, client, email=email, ban_reason=BAN_REASON, by=ANNA, today=TODAY, grants=grants)

    return await administering(ANNA, call)


class TestTheAnchorClosesEachRace:
    """Each outcome equals a serial order of the pair: with the list anchor gone, both commit."""

    def test_two_handovers_do_not_both_wait(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str | None, str, int]:
            racing = GrantsRunningARivalAfterTheFirstRead(database[Collection.GRANTS], lambda: hand_over(database, client, BERND_ID))
            outcome = await outcome_of(hand_over(database, client, grants=racing))
            racing.assert_landed_inside(serially=1)

            return racing.rival_outcome, outcome, await database[Collection.GRANTS].count_documents({"owner_from": {"$exists": True}})

        assert on_a_league(mongo_replica_set_url, body) == (COMMITTED, Code.GRANT_HANDOVER_WAITING, 1)

    def test_a_ban_landing_beside_an_addition_of_its_address_refuses_the_addition(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str | None, str, list[str]]:
            racing = GrantsRunningARivalAfterTheFirstRead(database[Collection.GRANTS], lambda: ban(database, client))
            outcome = await outcome_of(add(database, client, grants=racing))
            racing.assert_landed_inside(serially=1)

            return racing.rival_outcome, outcome, await addresses(database)

        assert on_a_league(mongo_replica_set_url, body) == (COMMITTED, Code.GRANT_BARRED, EVERY_HOLDER)

    def test_an_addition_landing_beside_a_ban_of_its_address_refuses_the_ban(self, mongo_replica_set_url: str):
        """The ban's retry judges again inside its callback: judged once outside it, the address ends up both banned and added."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str | None, str, int]:
            racing = GrantsRunningARivalAfterTheFirstRead(database[Collection.GRANTS], lambda: add(database, client))
            outcome = await outcome_of(ban(database, client, grants=racing))
            racing.assert_landed_inside(serially=1)

            return racing.rival_outcome, outcome, await database[Collection.BAN_LIST].count_documents({})

        assert on_a_league(mongo_replica_set_url, body) == (COMMITTED, Code.BAN_LIST_ADMIN, 0)


class TestAMove:
    def test_a_move_never_shortens_a_waiting_grant(self, mongo_replica_set_url: str):
        """`$set` would pull the date back to the switch, and an address change would skip the rest of the wait."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def move(session: AsyncClientSession) -> None:
                await move_the_grant_in_session(
                    await row_of(database, NORA_ID),
                    new_address="nora@neu.de",
                    grants_collection=database[Collection.GRANTS],
                    now=NOW,
                    session=session,
                )
                await move_the_grant_in_session(
                    await row_of(database, ANNA_ID),
                    new_address="anna@neu.de",
                    grants_collection=database[Collection.GRANTS],
                    now=NOW,
                    session=session,
                )

            async with client.start_session() as session:
                await session.with_transaction(move)

            return await row_of(database, NORA_ID), await row_of(database, ANNA_ID)

        nora, anna = on_a_league(mongo_replica_set_url, body, grants=[WAITING])

        assert (nora["address"], nora["effective_from"]) == ("nora@neu.de", stored(cast(datetime, WAITING["effective_from"])))
        # In effect, the date rises to the switch, so a session from before it holds nothing.
        assert (anna["address"], anna["effective_from"]) == ("anna@neu.de", stored(NOW))


def signed_in_at(email: str, auth_time: int) -> dict[str, str]:
    """One session's headers, its sign-in where it was made."""

    return {**ADMIN_KEY, **session_headers(email, auth_time=auth_time, factor=PASSKEY_FACTOR)}


def at_most(seconds_from_now: int) -> datetime:
    return datetime.now(UTC) + timedelta(seconds=seconds_from_now)


class TestTheMountedRouteReadsTheGrants:
    """`app/api/grants/guard.py :: verify_actor_is_admin` against a real collection: every other case calls the handler past it."""

    @pytest.mark.parametrize(
        ("effective_in_s", "status", "error_code"),
        [
            pytest.param(3600, 403, Code.ACTOR_NOT_ADMIN, id="still waiting"),
            pytest.param(-30, 401, Code.SESSION_REFUSED, id="took effect after the sign-in"),
            pytest.param(-120, 200, None, id="took effect before it"),
        ],
    )
    def test_the_date_decides_what_a_session_holds(self, mongo_replica_set_url: str, effective_in_s: int, status: int, error_code: str | None):
        """A passkey session a minute old: a waiting row must admit nobody, or the wait stops nothing it was written to stop."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[int, str | None]:
            await database[Collection.GRANTS].insert_one(grant_document(NORA_ID, NEU, "administration", effective_from=at_most(effective_in_s)))
            async with app_client(mongo_replica_set_url, app=_served()) as http:
                response = await http.get(f"/api/v{API_VERSION}/grants", headers=signed_in_at(NEU, int(time.time()) - 60))

            return response.status_code, response.json().get("error_code")

        assert on_a_league(mongo_replica_set_url, body) == (status, error_code)

    def test_a_handover_gives_the_role_at_the_pass_and_to_a_later_sign_in_alone(self, mongo_replica_set_url: str):
        """Waiting, the named administrator holds no owner's act; once it completed, their older session holds nothing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[tuple[int, str | None]]:
            await database[Collection.GRANTS].update_one({"_id": ANNA_ID}, {"$set": {"owner_from": at_most(-5)}})
            older = int(time.time()) - 60
            async with app_client(mongo_replica_set_url, app=_served()) as http:

                async def removing(address: str, auth_time: int) -> tuple[int, str | None]:
                    response = await http.delete(f"/api/v{API_VERSION}/grants/{BERND_ID}", headers=signed_in_at(address, auth_time))
                    return response.status_code, response.json().get("error_code")

                waiting = await removing(ANNA, older)
                await pass_at(database, client, datetime.now(UTC))
                gone = await removing(ANNA, older)
                demoted = await removing(OWNER, older)
                fresh = await removing(ANNA, int(time.time()) + 1)

            return [waiting, gone, demoted, fresh]

        assert on_a_league(mongo_replica_set_url, body) == [
            (403, Code.GRANT_ONLY_OWNER),
            (401, Code.SESSION_REFUSED),
            (403, Code.GRANT_ONLY_OWNER),
            (200, None),
        ]

    def test_a_removed_administrator_is_refused_on_the_very_next_request(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[int]:
            async with app_client(mongo_replica_set_url, app=_served()) as http:
                headers = StampedHeaders(BERND, ADMIN_KEY)
                before = await http.get(f"/api/v{API_VERSION}/grants", headers=headers)
                removed = await http.delete(f"/api/v{API_VERSION}/grants/{BERND_ID}", headers=StampedHeaders(OWNER, ADMIN_KEY))
                after = await http.get(f"/api/v{API_VERSION}/grants", headers=headers)

            return [before.status_code, removed.status_code, after.status_code]

        assert on_a_league(mongo_replica_set_url, body) == [200, 200, 403]

    def test_an_addition_over_http_is_attributed_to_the_token_s_administrator_everywhere(self, mongo_replica_set_url: str):
        """The only grant case reaching `get_actor_email`: a mixed-case identity is stored folded in the grant, the notice and the log alike."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[Any, ...]:
            async with app_client(mongo_replica_set_url, app=_served()) as http:
                response = await http.post(
                    f"/api/v{API_VERSION}/grants", headers=StampedHeaders(OWNER.upper(), ADMIN_KEY), json={"email": NEU_TYPED}
                )

            row = await database[Collection.GRANTS].find_one({"address": NEU})
            assert row is not None
            [(_, _, _, actor, _, _)] = await owed(database)

            return response.status_code, row["granted_by"], actor, await acts_on(database, row["_id"])

        assert on_a_league(mongo_replica_set_url, body) == (201, OWNER, OWNER, [("grant.added", OWNER, NEU)])
