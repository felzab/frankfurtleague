import asyncio
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Iterable, Mapping, MutableMapping

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo.database import Database
from pymongo.mongo_client import MongoClient

from app.core.constraints import apply_constraints

Validators = dict[str, Any]

# A module global rather than a fixture: what reads it is the plain `on_a_*` helper each suite
# defines, and the whole db tier runs in one process.
_BUILT: dict[tuple[str, str], tuple[bool, Validators]] = {}

_DRIFT = (
    "'{database}' carries a schema this session did not build ({moved}). A test whose body narrows a validator"
    " must say so where it seeds -- pass `mutates_schema=True` -- or what it changed poisons every test after it."
)


def _validators(infos: Iterable[Mapping[str, Any]]) -> Validators:
    """Each collection's validator, out of the one `listCollections` round trip the clear already needs."""

    return {info["name"]: (info.get("options") or {}).get("validator") for info in infos}


def _moved(baseline: Validators, present: Validators) -> list[str]:
    """The collections a body changed the validator of, or dropped, since the build."""

    gone = sorted(baseline.keys() - present.keys())
    narrowed = sorted(name for name, validator in present.items() if name in baseline and baseline[name] != validator)

    return gone + narrowed


def _reusable(key: tuple[str, str], constraints: bool) -> Validators | None:
    """The baseline to clear against, or `None` when this database has to be built."""

    built = _BUILT.get(key)
    if built is None or built[0] != constraints:
        return None

    return built[1]


async def _build(client: AsyncIOMotorClient, database: AsyncIOMotorDatabase, constraints: bool, collections: Iterable[str]) -> Validators:
    await client.drop_database(database.name)
    if constraints:
        await apply_constraints(database)
    for collection in collections:
        await database.create_collection(collection)

    return _validators(await (await database.list_collections()).to_list(length=None))


async def _clear(database: AsyncIOMotorDatabase, baseline: Validators) -> None:
    """Isolation without rebuilding a schema no test changed: every collection that exists is emptied.

    A body that changed one instead is caught here, on the NEXT test, rather than passing quietly.
    """

    present = _validators(await (await database.list_collections()).to_list(length=None))
    if moved := _moved(baseline, present):
        raise AssertionError(_DRIFT.format(database=database.name, moved=", ".join(moved)))

    # Concurrently: ten sequential round trips is most of what building the schema once saves.
    await asyncio.gather(*(database[collection].delete_many({}) for collection in present))
    # A collection a body created is emptied from here on, and its validator watched like the rest.
    baseline.update(present)


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

    `mutates_schema=True` is the opt-out for a body that narrows a validator: what it leaves is
    recorded nowhere, so the next caller rebuilds.
    """

    # One per call: Motor binds to the loop it first ran on, and every caller opens its own.
    client = AsyncIOMotorClient(url)
    try:
        key = (str(url), name)
        database = client[name]

        baseline = _reusable(key, constraints)
        if baseline is not None:
            await _clear(database, baseline)
        else:
            baseline = await _build(client, database, constraints, collections)

        # A body about to narrow a validator starts from the schema every other test sees, and leaves
        # nothing recorded -- so the next caller rebuilds rather than inheriting what it did.
        if mutates_schema:
            _BUILT.pop(key, None)
        else:
            _BUILT[key] = (constraints, baseline)

        yield client, database
    finally:
        client.close()


def _infos(database: Database) -> list[MutableMapping[str, Any]]:
    return list(database.list_collections())


def a_clean_database_sync(client: MongoClient, url: str, name: str) -> Database:
    """`a_clean_database` for a fixture holding a pymongo client -- none installs a validator, so there is no opt-out to offer."""

    key = (str(url), name)
    database = client[name]
    built = _BUILT.get(key)

    if built is None or built[0]:
        client.drop_database(name)
        _BUILT[key] = (False, _validators(_infos(database)))

        return database

    present = _validators(_infos(database))
    if moved := _moved(built[1], present):
        raise AssertionError(_DRIFT.format(database=name, moved=", ".join(moved)))

    for collection in present:
        database[collection].delete_many({})
    built[1].update(present)

    return database
