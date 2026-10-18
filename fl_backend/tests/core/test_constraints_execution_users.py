import re
import secrets
from collections.abc import Awaitable, Callable
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import pytest
from bson import ObjectId
from pydantic import SecretStr
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.core import constraints
from app.core.collections import Collection
from app.core.constraints import probe_collmod_privilege, probe_privileges, report_identity
from tests.config import build_test_config
from tests.database import on_the_seed_loop
from tests.worker import worker_database

pytestmark = pytest.mark.db

# Each body creates the user it asserts on, so each call needs a dropped database and a client of
# its own.
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
    assert verdicts["listCollections"] == "granted"


def test_the_privilege_probe_says_denied_where_the_replay_could_not_list_the_validators(mongo_url: str):
    """A role holding every write and `collMod` but not `listCollections`: the app runs, and the replay after a restore judges no line."""
    username = f"limited_{secrets.token_hex(4)}"
    rolename = f"no_listing_{secrets.token_hex(4)}"
    password = secrets.token_hex(16)

    async def body(database: AsyncDatabase) -> list[tuple[str, str]]:
        actions = ["find", "insert", "update", "remove", "collMod", "createIndex", "createCollection"]
        await database.command(
            "createRole", rolename, privileges=[{"resource": {"db": DATABASE_NAME, "collection": ""}, "actions": actions}], roles=[]
        )
        await database.command("createUser", username, pwd=password, roles=[{"role": rolename, "db": DATABASE_NAME}])
        limited = AsyncMongoClient(mongo_url, username=username, password=password, authSource=DATABASE_NAME)
        try:
            return await probe_privileges(limited[DATABASE_NAME])
        finally:
            await limited.close()
            await database.command("dropUser", username)
            await database.command("dropRole", rolename)

    verdicts = dict(on_a_fresh_client(mongo_url, body))
    assert (verdicts["find"], verdicts["collMod"]) == ("granted", "granted")
    assert verdicts["listCollections"].startswith("DENIED")


def test_the_privilege_probe_says_denied_for_a_readwrite_user(mongo_url: str):
    """`readWrite` grants `createIndex` but not `collMod`: such a user builds every index, attaches no validator, and the app will not start."""
    username = f"limited_{secrets.token_hex(4)}"
    password = secrets.token_hex(16)

    async def body(database: AsyncDatabase) -> str:
        await database.command("createUser", username, pwd=password, roles=[{"role": "readWrite", "db": DATABASE_NAME}])
        limited = AsyncMongoClient(mongo_url, username=username, password=password, authSource=DATABASE_NAME)
        try:
            return await probe_collmod_privilege(limited[DATABASE_NAME])
        finally:
            await limited.close()
            await database.command("dropUser", username)

    assert on_a_fresh_client(mongo_url, body).startswith("DENIED")


def as_user(url: str, username: str, password: str) -> str:
    """The url with this user's credentials in place of the server's own, authenticated against this module's database."""

    parts = urlsplit(url)
    query = "&".join(filter(None, [parts.query, f"authSource={DATABASE_NAME}"]))

    return urlunsplit(parts._replace(netloc=f"{username}:{password}@{parts.netloc.rpartition('@')[2]}", query=query))


WRITES = ["find", "insert", "update", "remove", "createIndex", "createCollection"]


@pytest.mark.parametrize(
    ("offending", "closing"),
    [
        pytest.param(False, "NOT clean. Grant the privileges marked FAIL above before applying.", id="clean-data"),
        pytest.param(True, "NOT clean. Grant the privileges marked FAIL above, and correct the data, before applying.", id="offending-data"),
    ],
)
@pytest.mark.parametrize(
    ("actions", "denied"),
    [
        pytest.param([*WRITES, "listCollections"], "collMod", id="collMod"),
        pytest.param([*WRITES, "collMod"], "listCollections", id="listCollections"),
    ],
)
def test_the_check_exits_2_and_reads_not_clean_where_a_privilege_is_denied(
    mongo_url: str,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    actions: list[str],
    denied: str,
    offending: bool,
    closing: str,
):
    """The run and not the probe alone: an operator reads the exit and the closing line, and a FAIL above a clean one is missed."""
    username = f"limited_{secrets.token_hex(4)}"
    rolename = f"short_of_{denied}_{secrets.token_hex(4)}"
    password = secrets.token_hex(16)

    async def body(database: AsyncDatabase) -> int:
        if offending:
            # Accepted: the database is unconstrained, as before a first apply, and a bare id is short of
            # every field the validator requires.
            await database[Collection.AKTIONEN].insert_one({"_id": ObjectId()})
        await database.command(
            "createRole", rolename, privileges=[{"resource": {"db": DATABASE_NAME, "collection": ""}, "actions": actions}], roles=[]
        )
        await database.command("createUser", username, pwd=password, roles=[{"role": rolename, "db": DATABASE_NAME}])
        configured = build_test_config().model_copy(
            update={"mongodb_uri": SecretStr(as_user(mongo_url, username, password)), "db_base_name": DATABASE_NAME}
        )
        monkeypatch.setattr(constraints, "get_config", lambda: configured)
        try:
            return await constraints._run(check=True)
        finally:
            await database.command("dropUser", username)
            await database.command("dropRole", rolename)

    exit_code = on_a_fresh_client(mongo_url, body)
    out = capsys.readouterr().out

    assert exit_code == 2
    assert f"FAIL  {denied}" in out
    # The validator section's row, which a verdict returned before the data sections would never print.
    assert bool(re.search(rf"^ +FAIL  {Collection.AKTIONEN} +1 of +1$", out, re.MULTILINE)) == offending
    assert closing in out
    assert "Clean —" not in out


def test_the_identity_report_names_the_user_and_its_roles(mongo_url: str):
    """A correct role on the wrong credential refuses exactly like a broken role, which no privilege probe can see."""
    username = f"named_{secrets.token_hex(4)}"
    password = secrets.token_hex(16)

    async def body(database: AsyncDatabase) -> tuple[str, list[str]]:
        await database.command("createUser", username, pwd=password, roles=[{"role": "readWrite", "db": DATABASE_NAME}])
        named = AsyncMongoClient(mongo_url, username=username, password=password, authSource=DATABASE_NAME)
        try:
            return await report_identity(named[DATABASE_NAME])
        finally:
            await named.close()
            await database.command("dropUser", username)

    identity, roles = on_a_fresh_client(mongo_url, body)
    assert identity == username
    assert f"readWrite@{DATABASE_NAME}" in roles
