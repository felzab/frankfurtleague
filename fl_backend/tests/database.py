import asyncio
import atexit
from collections.abc import AsyncIterator, Coroutine, Iterable, Mapping, Sequence
from contextlib import asynccontextmanager
from typing import Any

import pymongo
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.database import Database
from pymongo.mongo_client import MongoClient

from app.core.constraints import apply_constraints

# One collection's enforcement: its validator, both validation modes, and every index it carries.
Enforcement = dict[str, Any]
Schema = dict[str, Enforcement]

# A module global rather than a fixture: what reads it is the plain `on_a_*` helper each suite
# defines, and the tier -- one worker of it, under `-n` -- runs in one process.
_BUILT: dict[tuple[str, str], tuple[bool, Schema]] = {}

# Module globals for `_BUILT`'s reason, torn down by `_release`.
_LOOP: asyncio.AbstractEventLoop | None = None
_CLIENTS: dict[str, AsyncMongoClient] = {}

# Bounds each close in `_release`. A serial `pytest -m db` has stopped the containers by the time
# that runs, so an unbounded close waits pymongo's 30 s selection default per client, after the
# reporter has already printed.
_CLOSE_TIMEOUT_S = 2.0


def _release() -> None:
    """At interpreter exit, nothing else outliving the tier to close what its seeds share."""

    if _LOOP is None:
        return

    for client in _CLIENTS.values():
        # `close` selects a server to end the client's sessions, so a deadline is the only thing
        # bounding it. The error one raises is swallowed inside `close`: an `endSessions` failure
        # is one a driver must ignore.
        with pymongo.timeout(_CLOSE_TIMEOUT_S):
            # Run on the tier's loop while it is still open: `close` is a coroutine, so a bare call
            # would close nothing and leave a warning where the connections should have gone.
            _LOOP.run_until_complete(client.close())
    _CLIENTS.clear()

    # What a per-call `asyncio.run` does at its own end: an async generator left open is finalised
    # while the loop it belongs to still runs, rather than at collection with no loop to run on.
    _LOOP.run_until_complete(_LOOP.shutdown_asyncgens())
    _LOOP.close()


def on_the_seed_loop(seed: Coroutine[Any, Any, Any]) -> Any:
    """A client's connections belong to the loop that opened them, so ONE lasting loop is what lets every seed share one client.

    `run_until_complete` copies the context into a task the same way, so a `ContextVar` a body sets still reaches no other test.
    """

    global _LOOP

    if _LOOP is None:
        _LOOP = asyncio.new_event_loop()
        atexit.register(_release)

    return _LOOP.run_until_complete(seed)


def shared_client(url: str) -> AsyncMongoClient:
    """One client per url for the whole tier: a topology handshake costs a client to open, not a seed to run.

    Public because a module reading a seeded corpus needs that client without `a_clean_database`'s clearing.
    """

    client = _CLIENTS.get(url)
    if client is None:
        client = AsyncMongoClient(url)
        _CLIENTS[url] = client

    return client


_DRIFT = (
    "'{database}' carries enforcement this session did not build ({moved}). A body that narrows a validator, or adds or drops"
    " an index, must say so where it seeds -- pass `mutates_schema=True` -- or what it changed poisons every test after it."
)

_DRIFT_SYNC = (
    "'{database}' carries enforcement this session did not build ({moved}). This fixture reads the schema where it seeds, so what"
    " left it ran EARLIER in this database and the test named here only inherited it. A body that narrows a validator, or adds or"
    " drops an index, takes a database no other test shares -- this one is `build_test_config`'s, which every app under test reads."
)


def _data(infos: Iterable[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    """Views and `system.*` are listed beside real collections and answer neither a validator nor `delete_many`.

    The exclusion is not coverage: `_foreign` reports what it drops but MongoDB's own, so a body that leaves one is refused.
    """

    return [info for info in infos if info.get("type") == "collection" and not str(info["name"]).startswith("system.")]


def _foreign(infos: Iterable[Mapping[str, Any]]) -> list[str]:
    """What `_data` drops that a session can still have built: `listCollections` types a view `view`, a time-series collection `timeseries`.

    `system.*` stays dropped: `system.views` and a time-series' `system.buckets.*` both type as
    `collection`, so MongoDB's own bookkeeping is not a second finding.
    """

    return [str(info["name"]) for info in infos if info.get("type") != "collection" and not str(info["name"]).startswith("system.")]


def _indexes(specs: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    """`v` dropped: an index's format version tracks the server rather than anything a test body did."""

    return {spec["name"]: {key: list(value.items()) if key == "key" else value for key, value in spec.items() if key != "v"} for spec in specs}


def _enforcement(info: Mapping[str, Any], specs: Iterable[Mapping[str, Any]]) -> Enforcement:
    options = info.get("options") or {}

    return {
        "validator": options.get("validator"),
        # Both modes, not the validator alone: `warn` turns every refusal this tier asserts into an
        # acceptance while the validator itself compares byte-identical.
        "level": options.get("validationLevel"),
        "action": options.get("validationAction"),
        # `listCollections` cannot see an index and `delete_many` does not touch one, so without this
        # a dropped unique index silently changes what a neighbour's duplicate insert does.
        "indexes": _indexes(specs),
    }


async def _index_specs(database: AsyncDatabase, name: str) -> Sequence[Mapping[str, Any]]:
    """`list_indexes` hands its cursor back through a coroutine, so a gather over it needs a call of its own to await twice."""

    return await (await database[name].list_indexes()).to_list(length=None)


async def _schema(database: AsyncDatabase) -> tuple[Schema, list[str]]:
    """One `listCollections` answers both halves: what a baseline compares against, and what `_foreign` counts beside it."""

    listed = await (await database.list_collections()).to_list(length=None)
    infos = _data(listed)
    # Concurrently: one `listIndexes` per collection is the whole added cost of naming the culprit.
    specs = await asyncio.gather(*(_index_specs(database, info["name"]) for info in infos))

    return {info["name"]: _enforcement(info, found) for info, found in zip(infos, specs, strict=True)}, _foreign(listed)


def _schema_sync(database: Database) -> tuple[Schema, list[str]]:
    listed = list(database.list_collections())

    return {info["name"]: _enforcement(info, database[info["name"]].list_indexes()) for info in _data(listed)}, _foreign(listed)


def _enforces(enforcement: Enforcement) -> bool:
    """Whether a collection carries more than an ordinary insert creates, which is itself and an `_id_` index."""

    return enforcement["validator"] is not None or bool(enforcement["indexes"].keys() - {"_id_"})


def _moved(baseline: Schema, present: Schema, foreign: Iterable[str]) -> list[str]:
    """Every collection whose enforcement differs from what the last call left, and every namespace that is not a collection at all."""

    gone = baseline.keys() - present.keys()
    changed = {name for name, found in present.items() if name in baseline and found != baseline[name]}
    # An addition counts too: a `constraints=False` database starts empty, so a validator a body
    # builds onto a collection it seeded is compared against nothing at all.
    added = {name for name, found in present.items() if name not in baseline and _enforces(found)}
    # A view counts whatever the baseline holds: `_data` drops it, so no comparison can reach one and
    # the body that left it was never asked for `mutates_schema=True`.
    return sorted(gone | changed | added | set(foreign))


def _guard(message: str, name: str, baseline: Schema, present: Schema, foreign: Iterable[str]) -> None:
    if moved := _moved(baseline, present, foreign):
        raise AssertionError(message.format(database=name, moved=", ".join(moved)))


def _reusable(key: tuple[str, str], constraints: bool, collections: Iterable[str]) -> Schema | None:
    """The baseline to clear against, or `None` when this database has to be built.

    `collections` is verified rather than assumed: a caller asking for one a built database never
    got would otherwise be handed a database without it.
    """

    built = _BUILT.get(key)
    if built is None or built[0] != constraints or not set(collections) <= built[1].keys():
        return None

    return built[1]


async def _build(client: AsyncMongoClient, database: AsyncDatabase, constraints: bool, collections: Iterable[str]) -> Schema:
    await client.drop_database(database.name)
    if constraints:
        await apply_constraints(database)
    # What a caller asks of `collections` is that they EXIST -- a transaction cannot create one --
    # and a constrained build has already made every validated collection, which `create_collection`
    # would then refuse by name.
    made = set(await database.list_collection_names())
    for collection in collections:
        if collection not in made:
            await database.create_collection(collection)

    built, _ = await _schema(database)

    return built


async def _clear(database: AsyncDatabase, baseline: Schema) -> None:
    """Isolation without rebuilding a schema no test changed: every collection the last call left is emptied."""

    # Concurrently: ten sequential round trips is most of what building the schema once saves.
    # Collected rather than propagated at the first, so no sibling is still running at `client.close()`.
    for outcome in await asyncio.gather(*(database[name].delete_many({}) for name in baseline), return_exceptions=True):
        if isinstance(outcome, BaseException):
            raise outcome


@asynccontextmanager
async def a_clean_database(
    url: str,
    name: str,
    *,
    constraints: bool = True,
    collections: Iterable[str] = (),
    mutates_schema: bool = False,
) -> AsyncIterator[tuple[AsyncMongoClient, AsyncDatabase]]:
    """The tier's client for this url, and a database emptied for this test on a schema built once.

    `mutates_schema=True` is the opt-out for a body that narrows a validator or moves an index: what
    it leaves is recorded nowhere, so the next caller rebuilds.
    """

    # Shared, and bound to `on_the_seed_loop`'s loop, which every seed runs on; closing it belongs to
    # `_release` at exit, so a body that raises leaves the next test a client rather than none.
    client = shared_client(url)
    key = (str(url), name)
    database = client[name]

    baseline = _reusable(key, constraints, collections)
    # Dropped before either path runs: a build or a clear that raises would otherwise leave an
    # entry describing a database that no longer matches it, failing the next test for this one.
    _BUILT.pop(key, None)

    if baseline is None:
        baseline = await _build(client, database, constraints, collections)
    else:
        await _clear(database, baseline)

    yield client, database

    # After the body rather than before the next one, so the test pytest names is the one that
    # moved the schema -- and so being last, or alone under `-k`, cannot exempt a body from this.
    if not mutates_schema:
        present, foreign = await _schema(database)
        _guard(_DRIFT, name, baseline, present, foreign)
        _BUILT[key] = (constraints, present)


def a_clean_database_sync(client: MongoClient, url: str, name: str, *, constraints: bool = True) -> Database:
    """`a_clean_database` for a fixture holding a pymongo client, which returns before its test body runs.

    Its check therefore runs at the next seed and refuses with `_DRIFT_SYNC` rather than `_DRIFT`.
    """

    key = (str(url), name)
    database = client[name]
    built = _BUILT.get(key)
    _BUILT.pop(key, None)

    if built is None or built[0] != constraints:
        client.drop_database(name)
        if constraints:
            # Through the tier's own loop and its async client rather than a synchronous rebuild of
            # the same work: `apply_constraints` is the one declaration of what a constrained
            # database carries, and a second copy of it here could disagree with production.
            on_the_seed_loop(apply_constraints(shared_client(url)[name]))
        rebuilt, _ = _schema_sync(database)
        _BUILT[key] = (constraints, rebuilt)

        return database

    present, foreign = _schema_sync(database)
    _guard(_DRIFT_SYNC, name, built[1], present, foreign)
    for collection in present:
        database[collection].delete_many({})
    _BUILT[key] = (constraints, present)

    return database
