import asyncio
import atexit
import io
from collections.abc import AsyncIterator, Coroutine, Iterable, Iterator, Mapping, Sequence
from contextlib import asynccontextmanager, contextmanager, redirect_stdout
from datetime import UTC, datetime, timedelta
from typing import Any

import pymongo
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.database import Database
from pymongo.mongo_client import MongoClient
from pymongo.uri_parser import parse_uri

from app.core.constraints import TTL_INDEXES, apply_constraints
from app.readback import read_back

# MongoDB's code for a document a `$jsonSchema` refused, which the driver names nowhere: a case forcing a
# failure mid-transaction installs one. Asserted on rather than caught broadly, so an unrelated failure
# cannot pass as the refusal a case drives.
DOCUMENT_VALIDATION_FAILED = 121

# One collection's enforcement: any validator a case installed, both validation modes, and every index it carries.
Enforcement = dict[str, Any]
Schema = dict[str, Enforcement]

# One database: the servers a url names and the database's name. A url's options never enter it, so
# two spellings of one server -- a case adding `appName` for a fail point -- share one baseline;
# keyed apart, the second spelling's rebuild drops what the first one's baseline still lists.
_Key = tuple[tuple[tuple[str, int], ...], str]

# A module global rather than a fixture: what reads it is the plain `on_a_*` helper each suite
# defines, and the tier -- one worker of it, under `-n` -- runs in one process.
_BUILT: dict[_Key, tuple[bool, Schema]] = {}

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


# Each seed's bound. A rival a case runs inside a write that then waits on that write's own transaction deadlocks until
# MongoDB aborts the transaction at its 60 s lifetime limit, and the retry that follows passes the case. Under that limit,
# the case fails under its own name; above the slowest seeds of the tier, which wait out a whole request deadline, no
# seed that would finish is cut.
SEED_BOUND_S = 30.0

_UNFINISHED = (
    "this seed ran past {bound:.0f} s and was cancelled. A rival run inside a write that waits on that write's own transaction"
    " deadlocks until MongoDB aborts it at its lifetime limit: run the rival before the write it contends with."
)


def on_the_seed_loop(seed: Coroutine[Any, Any, Any]) -> Any:
    """A client's connections belong to the loop that opened them, so ONE lasting loop is what lets every seed share one client.

    `run_until_complete` copies the context into a task the same way, so a `ContextVar` a body sets still reaches no other test.
    """

    global _LOOP

    if _LOOP is None:
        _LOOP = asyncio.new_event_loop()
        atexit.register(_release)

    return _LOOP.run_until_complete(_bounded(seed))


async def _bounded(seed: Coroutine[Any, Any, Any]) -> Any:
    """Past the bound the seed is cancelled and unwound before this raises, so its sessions abort their transactions here."""

    bound = asyncio.timeout(SEED_BOUND_S)
    try:
        async with bound:
            return await seed
    except TimeoutError as timeout:
        # A `TimeoutError` the body raised itself passes as it was.
        if bound.expired():
            raise TimeoutError(_UNFINISHED.format(bound=SEED_BOUND_S)) from timeout
        raise


def shared_client(url: str) -> AsyncMongoClient:
    """One client per url for the whole tier: a topology handshake costs a client to open, not a seed to run.

    Public because a module reading a seeded corpus needs that client without `a_clean_database`'s clearing.
    """

    client = _CLIENTS.get(url)
    if client is None:
        # `poll`, the mode the driver picks for a process frozen between calls: `_LOOP` stands still
        # between seeds, and a streaming check outliving its timeout there clears the pool on resume,
        # cancelling the next seed's operations.
        client = AsyncMongoClient(url, serverMonitoringMode="poll")
        _CLIENTS[url] = client

    return client


_DRIFT = (
    "'{database}' carries enforcement this session did not build ({moved}). A body that installs a validator, or adds or drops"
    " an index, must say so where it seeds -- pass `mutates_schema=True` -- or what it changed poisons every test after it."
)

_EXPIRED = (
    "'{database}.{collection}' holds {count} row(s) whose `{key}`, the earliest {earliest}, lies past its retention on the real"
    " clock: MongoDB's TTL monitor deletes such a row on its next pass, once a minute, under a case still reading it, which fails"
    " one run in many. Write the case on a clock a century ahead, as `tests/outbox.py :: MAIL_NOW` does."
)

_REFUSED = (
    "'{database}' holds documents their collection's record model refuses, as `python -m app.readback` would after a"
    " deploy:\n{lines}\nA seed holds the shape a write stores, so a case never passes on a document no write leaves; a"
    " write leaving one is a defect. A body storing one on purpose names why in `stores_a_refused_shape`."
)


def _expired_pipeline(key: str, seconds: int) -> list[Mapping[str, Any]]:
    """A TTL index's rows its monitor may already delete, against the real clock: only a date expires, as a `$lt` on one reads."""

    return [
        {"$match": {key: {"$lt": datetime.now(UTC) - timedelta(seconds=seconds)}}},
        {"$group": {"_id": None, "count": {"$sum": 1}, "earliest": {"$min": f"${key}"}}},
    ]


def _expired_message(name: str, collection: str, key: str, found: Sequence[Mapping[str, Any]]) -> str | None:
    if not found:
        return None

    return _EXPIRED.format(database=name, collection=collection, count=found[0]["count"], key=key, earliest=found[0]["earliest"].isoformat())


async def _expired_rows(database: AsyncDatabase) -> list[str]:
    """Each shipped TTL index's expired rows, as `_EXPIRED` words them."""

    async def expired(collection: str, key: str, seconds: int) -> str | None:
        found = await (await database[collection].aggregate(_expired_pipeline(key, seconds))).to_list(length=None)
        return _expired_message(database.name, collection, key, found)

    return [message for message in await asyncio.gather(*(expired(ttl.collection, ttl.key, ttl.seconds) for ttl in TTL_INDEXES)) if message]


async def _refused_records(client: AsyncMongoClient, name: str) -> str | None:
    """Every document the read-back refuses, as it names them, through its own judgement rather than a copy of it."""

    printed = io.StringIO()
    with redirect_stdout(printed):
        refused = await read_back(client, name)

    return printed.getvalue() if refused else None


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


def _key(url: str, name: str) -> _Key:
    return tuple(sorted(parse_uri(url)["nodelist"])), name


def _reusable(key: _Key, constraints: bool) -> Schema | None:
    """The baseline to clear against, or `None` when this database has to be built."""

    built = _BUILT.get(key)
    if built is None or built[0] != constraints:
        return None

    return built[1]


async def _build(client: AsyncMongoClient, database: AsyncDatabase, constraints: bool) -> Schema:
    await client.drop_database(database.name)
    if constraints:
        await apply_constraints(database)

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
    mutates_schema: bool = False,
    stores_a_refused_shape: str | None = None,
) -> AsyncIterator[tuple[AsyncMongoClient, AsyncDatabase]]:
    """The tier's client for this url, and a database emptied for this test on a schema built once.

    `mutates_schema=True` is the opt-out for a body that installs a validator or moves an index: what
    it leaves is recorded nowhere, so the next caller rebuilds. Every document the body leaves is read back through its
    record model (`_refused_records`), unless `stores_a_refused_shape` names why it stores one on purpose. On the shipped
    schema, a body leaving a row its TTL index has already expired is refused (`_expired_rows`).
    """

    # Shared, and bound to `on_the_seed_loop`'s loop, which every seed runs on; closing it belongs to
    # `_release` at exit, so a body that raises leaves the next test a client rather than none.
    client = shared_client(url)
    key = _key(url, name)
    database = client[name]

    baseline = _reusable(key, constraints)
    # Dropped before either path runs: a build or a clear that raises would otherwise leave an
    # entry describing a database that no longer matches it, failing the next test for this one.
    _BUILT.pop(key, None)

    if baseline is None:
        baseline = await _build(client, database, constraints)
    else:
        await _clear(database, baseline)

    yield client, database

    # After the body rather than before the next one, so the test pytest names is the one that
    # moved the schema -- and so being last, or alone under `-k`, cannot exempt a body from this.
    if not mutates_schema:
        present, foreign = await _schema(database)
        _guard(_DRIFT, name, baseline, present, foreign)
        _BUILT[key] = (constraints, present)

    if stores_a_refused_shape is None and (refused := await _refused_records(client, name)):
        raise AssertionError(_REFUSED.format(database=name, lines=refused))

    # Every run rather than the one a monitor's pass happens to land in: a row the shipped retention has already expired
    # stands here only until that pass, which is all that made a case written on a past clock flake.
    if constraints and (expired := await _expired_rows(database)):
        raise AssertionError("\n".join(expired))


@contextmanager
def a_clean_database_sync(
    client: MongoClient, url: str, name: str, *, constraints: bool = True, stores_a_refused_shape: str | None = None
) -> Iterator[Database]:
    """`a_clean_database` for a fixture holding a pymongo client: the database emptied on entry, its checks run on exit.

    A module fixture holds it open while its cases read, so what the module seeded and wrote is judged once they are done.
    Entered and left on the seed loop, a step at a time, so both share one judgement of a clean database.
    """

    entered = a_clean_database(url, name, constraints=constraints, stores_a_refused_shape=stores_a_refused_shape)
    on_the_seed_loop(entered.__aenter__())
    try:
        yield client[name]
    except BaseException as failure:
        # The failure the body raised, handed in as `async with` would, so the checks are skipped and it surfaces as itself.
        on_the_seed_loop(entered.__aexit__(type(failure), failure, failure.__traceback__))
        raise
    on_the_seed_loop(entered.__aexit__(None, None, None))
