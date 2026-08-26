import asyncio
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Iterable, Mapping

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo.database import Database
from pymongo.mongo_client import MongoClient

from app.core.constraints import apply_constraints

# One collection's enforcement: its validator, both validation modes, and every index it carries.
Enforcement = dict[str, Any]
Schema = dict[str, Enforcement]

# A module global rather than a fixture: what reads it is the plain `on_a_*` helper each suite
# defines, and the whole db tier runs in one process.
_BUILT: dict[tuple[str, str], tuple[bool, Schema]] = {}

_DRIFT = (
    "'{database}' carries enforcement this session did not build ({moved}). A body that narrows a validator, or adds or drops"
    " an index, must say so where it seeds -- pass `mutates_schema=True` -- or what it changed poisons every test after it."
)

# The pymongo path's own refusal: it checks where it seeds, so the body that moved the schema has
# already run and the test it names only inherited it. `mutates_schema` cannot reach back to that
# body; a database of its own can.
_DRIFT_SYNC = (
    "'{database}' carries enforcement this session did not build ({moved}). This fixture reads the schema where it seeds, so what"
    " left it ran EARLIER in this database and the test named here only inherited it. A body that narrows a validator, or adds or"
    " drops an index, takes a database no other test shares -- this one is `build_test_config`'s, which every app under test reads."
)


def _data(infos: Iterable[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    """Views and `system.*` are listed beside real collections and answer neither a validator nor `delete_many`."""

    return [info for info in infos if info.get("type") == "collection" and not str(info["name"]).startswith("system.")]


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


async def _schema(database: AsyncIOMotorDatabase) -> Schema:
    infos = _data(await (await database.list_collections()).to_list(length=None))
    # Concurrently: one `listIndexes` per collection is the whole added cost of naming the culprit.
    specs = await asyncio.gather(*(database[info["name"]].list_indexes().to_list(length=None) for info in infos))

    return {info["name"]: _enforcement(info, found) for info, found in zip(infos, specs, strict=True)}


def _schema_sync(database: Database) -> Schema:
    return {info["name"]: _enforcement(info, database[info["name"]].list_indexes()) for info in _data(database.list_collections())}


def _enforces(enforcement: Enforcement) -> bool:
    """Whether a collection carries more than an ordinary insert creates, which is itself and an `_id_` index."""

    return enforcement["validator"] is not None or bool(enforcement["indexes"].keys() - {"_id_"})


def _moved(baseline: Schema, present: Schema) -> list[str]:
    """Every collection whose enforcement differs from what the last call left.

    An addition counts too: a `constraints=False` database starts empty, so a validator a body
    builds onto a collection it seeded is compared against nothing at all.
    """

    gone = baseline.keys() - present.keys()
    changed = {name for name, found in present.items() if name in baseline and found != baseline[name]}
    added = {name for name, found in present.items() if name not in baseline and _enforces(found)}

    return sorted(gone | changed | added)


def _guard(message: str, name: str, baseline: Schema, present: Schema) -> None:
    if moved := _moved(baseline, present):
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


async def _build(client: AsyncIOMotorClient, database: AsyncIOMotorDatabase, constraints: bool, collections: Iterable[str]) -> Schema:
    await client.drop_database(database.name)
    if constraints:
        await apply_constraints(database)
    for collection in collections:
        await database.create_collection(collection)

    return await _schema(database)


async def _clear(database: AsyncIOMotorDatabase, baseline: Schema) -> None:
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
    constraints: bool = False,
    collections: Iterable[str] = (),
    mutates_schema: bool = False,
) -> AsyncIterator[tuple[AsyncIOMotorClient, AsyncIOMotorDatabase]]:
    """A client of this call's own, and a database emptied for this test on a schema built once.

    `mutates_schema=True` is the opt-out for a body that narrows a validator or moves an index: what
    it leaves is recorded nowhere, so the next caller rebuilds.
    """

    # One per call: Motor binds to the loop it first ran on, and every caller opens its own.
    client = AsyncIOMotorClient(url)
    try:
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
            present = await _schema(database)
            _guard(_DRIFT, name, baseline, present)
            _BUILT[key] = (constraints, present)
    finally:
        client.close()


def a_clean_database_sync(client: MongoClient, url: str, name: str) -> Database:
    """`a_clean_database` for a fixture holding a pymongo client, which returns before its test body runs.

    Its check therefore runs at the next seed and refuses with `_DRIFT_SYNC` rather than `_DRIFT`.
    """

    key = (str(url), name)
    database = client[name]
    built = _BUILT.get(key)
    _BUILT.pop(key, None)

    if built is None or built[0]:
        client.drop_database(name)
        _BUILT[key] = (False, _schema_sync(database))

        return database

    present = _schema_sync(database)
    _guard(_DRIFT_SYNC, name, built[1], present)
    for collection in present:
        database[collection].delete_many({})
    _BUILT[key] = (False, present)

    return database
