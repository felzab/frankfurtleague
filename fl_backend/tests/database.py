import asyncio
import io
from collections.abc import AsyncGenerator, Awaitable, Callable, Coroutine, Iterable, Mapping, Sequence
from contextlib import AsyncExitStack, asynccontextmanager, redirect_stdout
from contextvars import ContextVar
from datetime import UTC, datetime, timedelta
from typing import Any

import pymongo
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.periodic_executor import AsyncPeriodicExecutor
from pymongo.uri_parser import parse_uri

from app.core.concurrency import concurrently
from app.core.constraints import TTL_INDEXES, apply_constraints
from app.core.middlewares import REQUEST_DEADLINE_S
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

# Each database a module's corpus holds (`held_corpus`), which nothing else may clear while its cases read it.
_HELD: set[_Key] = set()

# A module global for `_BUILT`'s reason. A client belongs to the loop that opened it, so each is kept under its loop:
# every async case and fixture runs on the session's.
_CLIENTS: dict[tuple[asyncio.AbstractEventLoop, str], AsyncMongoClient] = {}

# Bounds each close. A serial `pytest -m db` may have stopped the containers by the time the session's
# loop closes its clients, so an unbounded close waits pymongo's 30 s selection default per client, after
# the reporter has already printed.
_CLOSE_TIMEOUT_S = 2.0

# MongoDB's default `transactionLifetimeLimitSeconds`: the server aborts a transaction open longer than this.
TRANSACTION_LIFETIME_S = 60.0

# The longest a case waits on purpose: `tests/core/test_request_deadline.py`'s press waits out a whole request deadline,
# and its case accepts an answer up to 10 s past it.
LONGEST_WAIT_S = REQUEST_DEADLINE_S + 10

# Each scope's bound: every async case, and each phase of a module's corpus (`held_corpus`). A rival a case runs inside a
# write that then waits on that write's own transaction deadlocks until MongoDB aborts the transaction at its lifetime
# limit, and the retry that follows passes the case. Under that limit, the case fails under its own name; above the
# longest wait, no case that would finish is cut.
CASE_BOUND_S = 30.0

assert LONGEST_WAIT_S < CASE_BOUND_S < TRANSACTION_LIFETIME_S, (
    "the case bound must cut no case that would finish, and fire before MongoDB aborts"
)

# How long a task a scope left behind gets to unwind once cancelled, before the scope names it as still running.
_DRAIN_S = 5.0

_UNFINISHED = (
    "{what} ran past {bound:.0f} s and was cancelled. Where it waits inside a write's transaction, the likely cause is a"
    " rival run inside that write which waits on the write's own transaction, a deadlock until MongoDB aborts it at its"
    " lifetime limit: run the rival before the write it contends with."
)

_LEFT_BEHIND = (
    "{what} left {count} task(s) running, cancelled here: {tasks}. A task left on the session's loop runs into the next"
    " case, writing into a database that case has just cleared: await, cancel or drain every task where it is started."
)

_UNSCOPED = (
    "a clean database was entered outside a case, where its checks judge what a fixture left rather than what the cases"
    " did: a module holds its corpus with `held_corpus` across its fixture's `yield`, and a case opens its own in its body."
)

_CLEARED_UNDER_A_CORPUS = (
    "'{database}' is held as a module's corpus, and something cleared it under the module's cases: give the case its own database."
)

_UNHELD = (
    "'{database}' was released in the task that seeded it, so the module's cases never ran inside it: hold `held_corpus`"
    " across the fixture's `yield`, so its checks judge what the cases left."
)

# Set while a case runs (`tests/conftest.py :: pytest_collection_modifyitems`): the deadline it runs under.
_CASE: ContextVar[asyncio.Timeout | None] = ContextVar("_CASE", default=None)


def case_deadline() -> float | None:
    """The loop time the running case is cancelled at, or `None` outside a case."""

    bound = _CASE.get()
    return None if bound is None else bound.when()


def _pymongos_own(task: asyncio.Task[Any]) -> bool:
    """A monitor of the driver's, which outlives the case that opened its client by design.

    pymongo starts each as `asyncio.create_task(self._run(), ...)` in `AsyncPeriodicExecutor.open`
    (`pymongo/periodic_executor.py`), its one long-lived task; matched by that coroutine's code, so a task the code under
    test starts over a driver call is not one.
    """

    return getattr(task.get_coro(), "cr_code", None) is AsyncPeriodicExecutor._run.__code__


async def _cancelled(before: set[asyncio.Task[Any]]) -> list[str]:
    """Every task started since `before` and still running, cancelled and drained, by its coroutine's name."""

    current = asyncio.current_task()
    left = [task for task in asyncio.all_tasks() - before if task is not current and not _pymongos_own(task)]
    for task in left:
        task.cancel()
    if left:
        await asyncio.wait(left, timeout=_DRAIN_S)

    return sorted(getattr(task.get_coro(), "__qualname__", repr(task)) for task in left)


async def _within[T](bound: asyncio.Timeout, work: Awaitable[T], what: str) -> T:
    try:
        async with bound:
            return await work
    except TimeoutError as timeout:
        # A `TimeoutError` the work raised itself passes as it was.
        if bound.expired():
            raise TimeoutError(_UNFINISHED.format(what=what, bound=CASE_BOUND_S)) from timeout
        raise


async def _scoped[T](work: Awaitable[T], what: str, *, a_case: bool) -> T:
    """`work` under `CASE_BOUND_S`, failing if it leaves a task of its own running; a case is marked as one while it runs.

    Past the bound the work is cancelled and unwound before this raises, so its sessions abort their transactions here.
    """

    bound = asyncio.timeout(CASE_BOUND_S)
    before = asyncio.all_tasks()
    token = _CASE.set(bound) if a_case else None
    try:
        return await _within(bound, work, what)
    finally:
        if token is not None:
            _CASE.reset(token)
        # On every path, the failing one included: what a failing case left would otherwise fail the next case.
        if left := await _cancelled(before):
            raise AssertionError(_LEFT_BEHIND.format(what=what, count=len(left), tasks=", ".join(left)))


async def bounded_case[T](case: Awaitable[T]) -> T:
    """A case's body, as `tests/conftest.py :: pytest_collection_modifyitems` runs every async one."""

    return await _scoped(case, "this case", a_case=True)


async def bounded[T](work: Awaitable[T], *, what: str = "this") -> T:
    """`work` outside a case, under the case's bound and its check on the tasks it leaves."""

    return await _scoped(work, what, a_case=False)


async def close_the_shared_clients() -> None:
    """Every client `shared_client` opened on the running loop, closed on it before it stops.

    On the loop, not after it: `close` is a coroutine, so a bare call would close nothing and leave a warning where the
    connections should have gone.
    """

    loop = asyncio.get_running_loop()
    for key in [key for key in _CLIENTS if key[0] is loop]:
        # `close` selects a server to end the client's sessions, so a deadline is the only thing
        # bounding it. The error one raises is swallowed inside `close`: an `endSessions` failure
        # is one a driver must ignore.
        with pymongo.timeout(_CLOSE_TIMEOUT_S):
            await _CLIENTS.pop(key).close()


def shared_client(url: str) -> AsyncMongoClient:
    """One client per url and loop: a topology handshake costs a client to open, not a case to run.

    Public because a module reading a seeded corpus needs that client without `a_clean_database`'s clearing. Called on a
    running loop, which is the one the client belongs to.
    """

    key = (asyncio.get_running_loop(), url)
    client = _CLIENTS.get(key)
    if client is None:
        # `poll`, the mode the driver picks for a process frozen between calls: the loop stands still
        # between cases, and a streaming check outliving its timeout there clears the pool on resume,
        # cancelling the next case's operations.
        client = AsyncMongoClient(url, serverMonitoringMode="poll")
        _CLIENTS[key] = client

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

    return [message for message in await concurrently(*(expired(ttl.collection, ttl.key, ttl.seconds) for ttl in TTL_INDEXES)) if message]


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
    """`list_indexes` hands its cursor back through a coroutine, so a run beside others needs a call of its own to await twice."""

    return await (await database[name].list_indexes()).to_list(length=None)


async def _schema(database: AsyncDatabase) -> tuple[Schema, list[str]]:
    """One `listCollections` answers both halves: what a baseline compares against, and what `_foreign` counts beside it."""

    listed = await (await database.list_collections()).to_list(length=None)
    infos = _data(listed)
    # Concurrently: one `listIndexes` per collection is the whole added cost of naming the culprit.
    specs = await concurrently(*(_index_specs(database, info["name"]) for info in infos))

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
    await concurrently(*(database[name].delete_many({}) for name in baseline))


@asynccontextmanager
async def a_clean_database(
    url: str,
    name: str,
    *,
    constraints: bool = True,
    mutates_schema: bool = False,
    stores_a_refused_shape: str | None = None,
) -> AsyncGenerator[tuple[AsyncMongoClient, AsyncDatabase]]:
    """The tier's client for this url, and a database emptied for this case on a schema built once, judged as it leaves.

    `mutates_schema=True` is the opt-out for a body that installs a validator or moves an index: what
    it leaves is recorded nowhere, so the next caller rebuilds. Every document the body leaves is read back through its
    record model (`_refused_records`), unless `stores_a_refused_shape` names why it stores one on purpose. On the shipped
    schema, a body leaving a row its TTL index has already expired is refused (`_expired_rows`). Entered in a case's
    body alone, so its checks judge what that case did.
    """

    if _CASE.get() is None:
        raise RuntimeError(_UNSCOPED)

    async with _cleaned(
        url, name, constraints=constraints, mutates_schema=mutates_schema, stores_a_refused_shape=stores_a_refused_shape
    ) as opened:
        yield opened


@asynccontextmanager
async def _cleaned(
    url: str,
    name: str,
    *,
    constraints: bool,
    mutates_schema: bool,
    stores_a_refused_shape: str | None,
) -> AsyncGenerator[tuple[AsyncMongoClient, AsyncDatabase]]:
    """`a_clean_database`'s body, which `held_corpus` enters in one task and leaves in another: it holds nothing a task owns."""

    # Shared, and bound to the running loop; closing it belongs to `close_the_shared_clients` as that loop
    # ends, so a body that raises leaves the next test a client rather than none.
    client = shared_client(url)
    key = _key(url, name)
    database = client[name]

    if key in _HELD:
        raise RuntimeError(_CLEARED_UNDER_A_CORPUS.format(database=name))

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


# One module's shared corpus: every collection it holds, each as its documents in an order two
# reads of an untouched database agree on.
Corpus = dict[str, list[str]]

_WROTE = (
    "'{database}' holds documents its seed did not put there ({moved}). A module sharing one corpus across its tests admits reads"
    " alone: a body that writes hands the next test a corpus nobody seeded, and fails it somewhere else entirely."
)


async def _corpus(database: AsyncDatabase) -> Corpus:
    """Views and `system.*` are listed beside real collections and hold nothing a seed put there."""

    names = [info["name"] for info in _data(await (await database.list_collections()).to_list(length=None))]
    found = await concurrently(*(database[name].find().to_list(length=None) for name in names))

    return {name: sorted(repr(document) for document in documents) for name, documents in zip(names, found, strict=True)}


def _moved_documents(seeded: Corpus, present: Corpus) -> list[str]:
    return sorted(name for name in seeded.keys() | present.keys() if seeded.get(name) != present.get(name))


async def _seeded[T](seed: Callable[[AsyncDatabase], Coroutine[Any, Any, T]], database: AsyncDatabase) -> T:
    """The seed in a task of its own, so a context variable it sets stays in that task's copy.

    A module fixture's own variables reach every case of the module, as pytest-asyncio carries a fixture's context into
    the cases; a seed's would bind them to whatever it left.
    """

    return await asyncio.create_task(seed(database))


@asynccontextmanager
async def held_corpus[T](
    url: str,
    name: str,
    seed: Callable[[AsyncDatabase], Coroutine[Any, Any, T]],
    *,
    constraints: bool = True,
    stores_a_refused_shape: str | None = None,
) -> AsyncGenerator[T]:
    """A module's corpus, seeded once and held across its fixture's `yield`: what `seed` returns, judged after the cases.

    A module fixture holds it as `async with held_corpus(...): yield ...`. After the module's cases, a case that moved a
    document fails the module, and then `a_clean_database`'s checks judge the schema, every document's shape and the
    expired rows the cases left, so the module that moved the schema is the one pytest names. Each phase runs under the
    case's bound, in the task pytest-asyncio runs the fixture's setup or its teardown in.
    """

    entered = asyncio.current_task()
    async with AsyncExitStack() as held:
        cleaned = _cleaned(url, name, constraints=constraints, mutates_schema=False, stores_a_refused_shape=stores_a_refused_shape)
        _, database = await bounded(held.enter_async_context(cleaned), what=f"clearing '{name}'")
        _HELD.add(key := _key(url, name))
        held.callback(_HELD.discard, key)
        result = await bounded(_seeded(seed, database), what=f"the seed of '{name}'")
        seeded = await bounded(_corpus(database), what=f"reading '{name}' as seeded")

        yield result

        if asyncio.current_task() is entered:
            raise RuntimeError(_UNHELD.format(database=name))

        moved = _moved_documents(seeded, await bounded(_corpus(database), what=f"reading '{name}' after its cases"))
        if moved:
            raise AssertionError(_WROTE.format(database=name, moved=", ".join(moved)))

        await bounded(held.aclose(), what=f"the checks of '{name}'")
