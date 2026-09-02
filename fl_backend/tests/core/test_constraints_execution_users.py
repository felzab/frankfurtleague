import secrets
from typing import Any, Awaitable, Callable

import pytest
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.core.constraints import probe_collmod_privilege, probe_privileges, report_identity
from tests.database import on_the_seed_loop
from tests.worker import worker_database

pytestmark = pytest.mark.db

# The constraints suite's limited-user bodies, beside `test_constraints_execution.py`: each creates
# the user its verdict is asserted against, which is what needs a database dropped and a client
# opened per call.
DATABASE_NAME = worker_database("fl_constraints_users_test")

Body = Callable[[AsyncDatabase], Awaitable[Any]]


def on_a_fresh_client(url: str, body: Body) -> Any:
    """A client of this call's own, this module alone creating and dropping the users a client authenticates as.

    Unconstrained, which is the production ordering: a privilege is probed before a schema is applied.
    """

    async def _run() -> Any:
        client = AsyncMongoClient(url)
        try:
            # Dropped on the way IN, never out: what isolates a call is the drop the next one makes,
            # and a second drop buys nothing.
            await client.drop_database(DATABASE_NAME)
            return await body(client[DATABASE_NAME])
        finally:
            await client.close()

    return on_the_seed_loop(_run())


def test_every_needed_privilege_is_reported_independently(mongo_url: str):
    """A `readWrite` user holds `find` and lacks `collMod`: the mixed verdict an all-or-nothing answer would hide."""
    username = f"limited_{secrets.token_hex(4)}"
    password = secrets.token_hex(16)

    async def body(database: AsyncDatabase) -> list[tuple[str, str]]:
        await database.command("createUser", username, pwd=password, roles=[{"role": "readWrite", "db": DATABASE_NAME}])
        # Keywords over the url's own root credentials, which is what pymongo does with both given.
        limited = AsyncMongoClient(mongo_url, username=username, password=password, authSource=DATABASE_NAME)
        try:
            return await probe_privileges(limited[DATABASE_NAME])
        finally:
            await limited.close()
            await database.command("dropUser", username)

    verdicts = dict(on_a_fresh_client(mongo_url, body))
    assert verdicts["find"] == "granted"
    assert verdicts["collMod"].startswith("DENIED")


def test_the_privilege_probe_says_denied_for_a_readwrite_user(mongo_url: str):
    """`readWrite` grants `createIndex` but not `collMod`: such a user builds every index, attaches no validator, and the app will not start."""
    username = f"limited_{secrets.token_hex(4)}"
    password = secrets.token_hex(16)

    async def body(database: AsyncDatabase) -> str:
        await database.command("createUser", username, pwd=password, roles=[{"role": "readWrite", "db": DATABASE_NAME}])
        # Keywords over the url's own root credentials, which is what pymongo does with both given.
        limited = AsyncMongoClient(mongo_url, username=username, password=password, authSource=DATABASE_NAME)
        try:
            return await probe_collmod_privilege(limited[DATABASE_NAME])
        finally:
            await limited.close()
            await database.command("dropUser", username)

    assert on_a_fresh_client(mongo_url, body).startswith("DENIED")


def test_the_identity_report_names_the_user_and_its_roles(mongo_url: str):
    """A correct role on the wrong credential refuses exactly like a broken role, which no privilege probe can see."""
    username = f"named_{secrets.token_hex(4)}"
    password = secrets.token_hex(16)

    async def body(database: AsyncDatabase) -> tuple[str, list[str]]:
        await database.command("createUser", username, pwd=password, roles=[{"role": "readWrite", "db": DATABASE_NAME}])
        # Keywords over the url's own root credentials, which is what pymongo does with both given.
        named = AsyncMongoClient(mongo_url, username=username, password=password, authSource=DATABASE_NAME)
        try:
            return await report_identity(named[DATABASE_NAME])
        finally:
            await named.close()
            await database.command("dropUser", username)

    identity, roles = on_a_fresh_client(mongo_url, body)
    assert identity == username
    assert f"readWrite@{DATABASE_NAME}" in roles
