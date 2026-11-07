from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.database import AsyncDatabase

from app.api.action_log.crud import reattribute_administrator_in_session
from app.api.action_log.schemas import FLActionLogRecord
from app.core.collections import Collection
from app.core.recording import ACT_BY_KONTAKT, ACT_BY_SYSTEM, ERASED_ACTOR_MARKER, record_act
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_action_log_rows_test")


TEAM_OID = ObjectId("6890a1b2c3d4e5f607600001")

SEEDED_NAME = "Lessing"

FAIL_POINT = "failCommand"
REFUSED_COMMIT_APP = "act-refused-commit"
# A write conflict, which a commit refused under the transient label carries, and which the driver reruns the callback on.
WRITE_CONFLICT = 112
TRANSIENT = "TransientTransactionError"

ERASED_ADDRESS = "former@example.invalid"
OTHER_ADDRESS = "other@example.invalid"


ClientBody = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_replica_set(url: str, body: ClientBody) -> Any:
    """The client goes to the body too, a transaction needing a session only it can open; a standalone `mongod` refuses one."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            return await body(database, client)

    return on_the_seed_loop(_run())


class _ActFailed(Exception):
    """Raised inside the transaction, after the row, as a refused act is."""


def test_a_failed_act_leaves_no_row(mongo_replica_set_url: str):
    """A row outside the transaction would state an act that never happened, and the page would read as any other."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[dict[str, Any]]:
        async def act(session: AsyncClientSession) -> None:
            await record_act(collection=database[Collection.TEAMS], action="team.retired", by=ACT_BY_SYSTEM, session=session)
            raise _ActFailed

        async with client.start_session() as session:
            with pytest.raises(_ActFailed):
                await session.with_transaction(act)

        return [row async for row in database[Collection.ACTION_LOG].find()]

    assert on_a_replica_set(mongo_replica_set_url, body) == []


def test_an_erased_address_leaves_the_log_as_who_acted_and_as_a_grantee(mongo_replica_set_url: str):
    """The log outlives the person for twelve months, so a grant act's label left standing would name them for that long."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[tuple[str, str | None]]:
        async def rows_and_erasure(session: AsyncClientSession) -> None:
            teams = database[Collection.TEAMS]
            await record_act(collection=teams, action="team.retired", by=ERASED_ADDRESS, label=SEEDED_NAME, session=session)
            await record_act(collection=teams, action="grant.added", by=OTHER_ADDRESS, label=ERASED_ADDRESS, session=session)
            await record_act(collection=teams, action="team.reactivated", by=OTHER_ADDRESS, label=OTHER_ADDRESS, session=session)
            await reattribute_administrator_in_session(
                action_log_collection=database[Collection.ACTION_LOG],
                # A spelling the erasure was handed, which the log's fold must still meet.
                identifier=ERASED_ADDRESS.upper(),
                value=ERASED_ACTOR_MARKER,
                session=session,
            )

        async with client.start_session() as session:
            await session.with_transaction(rows_and_erasure)

        return [(row["by"], row["label"]) async for row in database[Collection.ACTION_LOG].find().sort("_id", 1)]

    assert on_a_replica_set(mongo_replica_set_url, body) == [
        (ERASED_ACTOR_MARKER, SEEDED_NAME),
        (OTHER_ADDRESS, ERASED_ACTOR_MARKER),
        (OTHER_ADDRESS, OTHER_ADDRESS),
    ]


def test_a_retried_transaction_leaves_one_row_of_the_stored_shape(mongo_replica_set_url: str):
    """The driver reruns an act whose commit is refused as transient, and an insert outside the transaction would stand once per attempt.

    The record model reads the row, as a drift between it and `record_act` is a page that cannot read its log.
    """

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[int, list[dict[str, Any]]]:
        refusing = AsyncMongoClient(mongo_replica_set_url, serverMonitoringMode="poll", appname=REFUSED_COMMIT_APP)
        refusal = {
            "failCommands": ["commitTransaction"],
            "appName": REFUSED_COMMIT_APP,
            "errorCode": WRITE_CONFLICT,
            "errorLabels": [TRANSIENT],
        }
        attempts = 0

        async def act(session: AsyncClientSession) -> None:
            nonlocal attempts
            attempts += 1
            teams = refusing[database.name][Collection.TEAMS]
            await record_act(
                collection=teams, action="spieler.changed", by=ACT_BY_KONTAKT, team=SEEDED_NAME, record_id=TEAM_OID, session=session
            )

        await client.admin.command("configureFailPoint", FAIL_POINT, mode={"times": 1}, data=refusal)
        try:
            async with refusing.start_session() as session:
                await session.with_transaction(act)
        finally:
            await client.admin.command("configureFailPoint", FAIL_POINT, mode="off")
            await refusing.close()

        return attempts, [row async for row in database[Collection.ACTION_LOG].find()]

    attempts, rows = on_a_replica_set(mongo_replica_set_url, body)

    assert len(rows) == 1
    FLActionLogRecord.model_validate(rows[0], extra="forbid")
    assert (rows[0]["by"], rows[0]["team"], rows[0]["record_id"]) == (ACT_BY_KONTAKT, SEEDED_NAME, TEAM_OID)
    # The premise last: the act ran twice, so one row is the rollback's work.
    assert attempts == 2
