"""
TESTS · where a write can answer `DB-COMMON-002`, traced from each route's own source

Traced rather than declared in a table: nothing states which collections a route writes, so each
route's handler is followed through the application's helpers to the writes it makes, and a write
reaching a collection a unique index covers, or inserting an `_id` its caller chose, is where the
code can occur. By collection and never by field, so an update that touches no key field still counts.
"""

import ast
import asyncio
import functools
import importlib
import json
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, replace
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
from httpx2 import Response
from pymongo import MongoClient
from pymongo.errors import DuplicateKeyError
from starlette.requests import Request

from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.constraints import UNIQUE_INDEXES
from app.core.dependencies import DB
from app.core.exception_handlers import duplicate_key_exception_handler, refused_codes
from app.core.exceptions import DUPLICATE_KEY
from app.core.security import ACTOR_HEADER
from app.main import api_routes, create_app
from tests.app_client import app_client
from tests.config import ADMIN_AUTH, build_test_config
from tests.core.app_source import (
    APP_ROOT,
    BACKEND_ROOT,
    COLLECTION_ARGUMENT_SUFFIX,
    WRITE_HELPERS,
    Declaration,
    app_calls,
    callee,
    declared,
    module_of,
    resolve_callee,
    scoped_calls,
)
from tests.database import a_clean_database_sync
from tests.worker import worker_database

CRUD = APP_ROOT / "core" / "crud.py"

# The driver's own writes, on a collection a module holds rather than through `app/core/crud.py`.
DRIVER_WRITES = frozenset(
    {
        "bulk_write",
        "delete_many",
        "delete_one",
        "find_one_and_delete",
        "find_one_and_replace",
        "find_one_and_update",
        "insert_many",
        "insert_one",
        "replace_one",
        "update_many",
        "update_one",
    }
)

# Any insert or update except a batch's: `insert_many` and `bulk_write` report a duplicate as
# `BulkWriteError`, which is no `DuplicateKeyError`, so the draw answers it 500 `DB-FAIL-001`
# (`fl_backend/tests/api/test_error_responses.py :: test_a_bulk_writes_refused_document_never_reaches_the_line`).
BULK_INSERT = "post_many_to_db"
KEY_WRITES = (WRITE_HELPERS - {BULK_INSERT}) | {
    "find_one_and_replace",
    "find_one_and_update",
    "insert_one",
    "replace_one",
    "update_many",
    "update_one",
}
INSERTS = frozenset({"insert_live", "insert_one", "post_one_to_db"})
# Every collection carries a unique index on it that `UNIQUE_INDEXES` never lists, the server's own.
ID_KEY = "_id"

UNIQUE_COLLECTIONS = frozenset(Collection(index.collection) for index in UNIQUE_INDEXES)
COLLECTION_NAMES = frozenset(str(member) for member in Collection)

READ_METHODS = frozenset({"GET", "HEAD"})
CONFLICT = "409"

# The operations the trace reached a unique index from on the tree this was written against, so an
# equality over two sets that both went empty still fails.
DECLARING_OPERATIONS_FLOOR = 50


class _Marker:
    def __init__(self, name: str) -> None:
        self.name = name

    def __repr__(self) -> str:
        return self.name


# A value the trace cannot follow, which a write naming it as its collection fails on rather than
# being passed over.
UNRESOLVED = _Marker("<unresolved>")
# What an endpoint's `DB` parameter holds: subscripted, it answers the collection its key names.
DATABASE = _Marker("<database>")

Values = tuple[Any, ...]


@dataclass(frozen=True)
class Write:
    helper: str
    collections: Values
    #: The module and the line of the call, so a write the routes reach and one the application
    #: makes are compared as the same call site.
    site: tuple[str, int]
    #: An insert whose document literal names its own `_id`, which a second insert can collide on
    #: whatever other index the collection carries.
    chooses_id: bool = False


def _chooses_id(call: ast.Call, helper: str) -> bool:
    document = _argument(call, "document", 0 if helper == "insert_one" else None)

    return (
        helper in INSERTS
        and isinstance(document, ast.Dict)
        and any(isinstance(key, ast.Constant) and key.value == ID_KEY for key in document.keys)
    )


def _distinct(values: Iterator[Any]) -> Values:
    found: list[Any] = []
    for value in values:
        if not any(value is seen or value == seen for seen in found):
            found.append(value)
    return tuple(found)


def _values(node: ast.expr, scope: Mapping[str, Values], module: ModuleType) -> Values:
    """Every value `node` can hold, `UNRESOLVED` standing for whatever the trace cannot follow.

    A mapping read by a key the trace cannot follow holds any of its values:
    `app/api/zustellung/router.py :: _apply` picks its collection off `ZIEL_PFADE` by the payload's kind.
    """

    if isinstance(node, ast.Constant):
        return (node.value,)

    if isinstance(node, ast.Name):
        if node.id in scope:
            return scope[node.id]
        # The spelling every router gives an injected collection (`tests/core/app_source.py :: COLLECTION_ARGUMENT_SUFFIX`).
        if node.id.endswith(COLLECTION_ARGUMENT_SUFFIX) and node.id.removesuffix(COLLECTION_ARGUMENT_SUFFIX) in COLLECTION_NAMES:
            return (Collection(node.id.removesuffix(COLLECTION_ARGUMENT_SUFFIX)),)
        return (getattr(module, node.id, UNRESOLVED),)

    if isinstance(node, ast.Attribute):
        # A collection's `database` is the handle `app/core/recording.py :: record_write` inserts through.
        return _distinct(
            DATABASE
            if isinstance(value, Collection) and node.attr == "database"
            else UNRESOLVED
            if value is UNRESOLVED
            else getattr(value, node.attr, UNRESOLVED)
            for value in _values(node.value, scope, module)
        )

    if isinstance(node, ast.Subscript):
        found: list[Any] = []
        for container in _values(node.value, scope, module):
            for key in _values(node.slice, scope, module):
                if container is DATABASE:
                    found.append(Collection(key) if key in COLLECTION_NAMES else UNRESOLVED)
                elif isinstance(container, Mapping):
                    found.extend(container.values() if key is UNRESOLVED else [container.get(key, UNRESOLVED)])
                else:
                    found.append(UNRESOLVED)
        return _distinct(iter(found))

    return (UNRESOLVED,)


def _local_scope(declaration: Declaration, bound: Mapping[str, Values], module: ModuleType) -> dict[str, Values]:
    """What each name inside `declaration` can hold, closures included, whatever order it is assigned in."""

    assignments = [
        (target.id, node.value)
        for node in ast.walk(declaration)
        if isinstance(node, ast.Assign)
        for target in node.targets
        if isinstance(target, ast.Name)
    ]

    scope = dict(bound)
    # One pass per assignment is enough for a chain of them to settle, each pass starting over so
    # a name read before its assignment was reached leaves nothing behind.
    for _ in assignments:
        settled = dict(bound)
        for name, value in assignments:
            settled[name] = _distinct(iter((*settled.get(name, ()), *_values(value, scope, module))))
        scope = settled

    return scope


def _parameters(declaration: Declaration) -> list[tuple[ast.arg, int | None]]:
    positional: list[tuple[ast.arg, int | None]] = [
        (argument, index) for index, argument in enumerate([*declaration.args.posonlyargs, *declaration.args.args])
    ]
    return positional + [(argument, None) for argument in declaration.args.kwonlyargs]


def _argument(call: ast.Call, name: str, position: int | None) -> ast.expr | None:
    for keyword in call.keywords:
        if keyword.arg == name:
            return keyword.value
    if position is not None and position < len(call.args) and not isinstance(call.args[position], ast.Starred):
        return call.args[position]
    return None


def _module(path: Path) -> ModuleType:
    return importlib.import_module(".".join(path.relative_to(BACKEND_ROOT).with_suffix("").parts))


def _endpoint_scope(declaration: Declaration, module: ModuleType) -> dict[str, Values]:
    """An injected collection answers by its spelling; `DB` by what it is subscripted with; any other parameter the request's."""

    scope: dict[str, Values] = {}
    for argument, _ in _parameters(declaration):
        if isinstance(argument.annotation, ast.Name) and getattr(module, argument.annotation.id, None) is DB:
            scope[argument.arg] = (DATABASE,)
        elif not argument.arg.endswith(COLLECTION_ARGUMENT_SUFFIX):
            scope[argument.arg] = (UNRESOLVED,)
    return scope


def _writes(declaration: Declaration, path: Path, bound: Mapping[str, Values], seen: set[tuple[Any, ...]]) -> Iterator[Write]:
    """Every write `declaration` reaches, a `app/core/crud.py` helper or the driver's own, each helper followed with its arguments bound.

    Nested functions are read with the one declaring them: a transaction's callback is handed to the
    driver, never called by name.
    """

    module = _module(path)
    scope = _local_scope(declaration, bound, module)
    nested = {id(node) for node in ast.walk(declaration) if node is not declaration}
    here = path.relative_to(BACKEND_ROOT).as_posix()

    for chain, call in scoped_calls(declaration, (declaration,)):
        if isinstance(call.func, ast.Attribute) and call.func.attr in DRIVER_WRITES:
            yield Write(call.func.attr, _values(call.func.value, scope, module), (here, call.lineno), _chooses_id(call, call.func.attr))
            continue

        resolved = resolve_callee(call, chain, path)
        if resolved is None:
            continue

        target, target_path = resolved
        # Followed on into the helper as well, which is how the log row every write files is reached.
        if target_path == CRUD and target.name in WRITE_HELPERS:
            argument = _argument(call, "collection", None)
            collections = (UNRESOLVED,) if argument is None else _values(argument, scope, module)
            yield Write(target.name, collections, (here, call.lineno), _chooses_id(call, target.name))

        if id(target) in nested:
            continue

        arguments = {
            argument.arg: (UNRESOLVED,) if (value := _argument(call, argument.arg, position)) is None else _values(value, scope, module)
            for argument, position in _parameters(target)
        }
        key = (target_path, target.lineno, repr(sorted(arguments.items())))
        if key in seen:
            continue
        seen.add(key)

        yield from _writes(target, target_path, arguments, seen)


@functools.cache
def _routes() -> tuple[Any, ...]:
    return tuple(api_routes(create_app(build_test_config())))


@functools.cache
def _write_operations() -> Mapping[str, tuple[Any, tuple[Write, ...]]]:
    """Each operation that is not a read, with its route and every write the trace reaches from it."""

    found: dict[str, tuple[Any, tuple[Write, ...]]] = {}
    for route in _routes():
        endpoint = declared(route.endpoint)
        path = module_of(route.endpoint)
        writes = tuple(_writes(endpoint, path, _endpoint_scope(endpoint, _module(path)), set()))
        for method in sorted(set(route.methods or ()) - READ_METHODS):
            found[f"{method} {route.path_format}"] = (route, writes)

    return found


def _declaring_operations() -> set[str]:
    """Every operation whose route's 409 names `DB-COMMON-002`, reads included, so a read declaring it is compared too."""

    return {
        f"{method} {route.path_format}"
        for route in _routes()
        for status, response in route.responses.items()
        if str(status) == CONFLICT and DUPLICATE_KEY in refused_codes(response)
        for method in route.methods or ()
    }


def _reaches_a_unique_index(writes: tuple[Write, ...]) -> bool:
    return any(write.helper in KEY_WRITES and (write.chooses_id or UNIQUE_COLLECTIONS.intersection(write.collections)) for write in writes)


def test_every_write_names_a_collection_the_trace_resolves():
    """A `Collection` member and nothing else: any other value is one no unique index is keyed on, and would pass as reaching none."""

    unresolved = sorted(
        {
            f"{operation}: {write.helper} at {write.site} names {write.collections}"
            for operation, (_, writes) in _write_operations().items()
            for write in writes
            if not all(isinstance(value, Collection) for value in write.collections)
        }
    )

    assert not unresolved, (
        f"the trace cannot say which collection these write, so it cannot say whether a unique index refuses them: {unresolved}"
    )


def test_every_write_the_application_makes_is_reached_from_a_route():
    """Two listings by different routes: every call site under `app/`, against those the trace reached from a route."""

    made = {
        (module, call.lineno)
        for module, _, call in app_calls()
        if module != CRUD.relative_to(BACKEND_ROOT).as_posix()
        if (isinstance(call.func, ast.Name) and callee(call) in WRITE_HELPERS)
        or (isinstance(call.func, ast.Attribute) and callee(call) in DRIVER_WRITES)
    }
    reached = {write.site for _, writes in _write_operations().values() for write in writes}

    assert made, "no write call site was found, so the comparison below holds over nothing"
    assert sorted(made - reached) == [], "writes no route's trace reaches, so a route making them publishes nothing about their unique indexes"


def test_the_bulk_insert_is_traced_and_left_out():
    """The draw's bulk insert reaches unique indexes and answers `DB-FAIL-001`, so a trace counting it would publish the code there."""

    bulk = [write for _, writes in _write_operations().values() for write in writes if write.helper == BULK_INSERT]

    assert any(UNIQUE_COLLECTIONS.intersection(write.collections) for write in bulk)


def test_an_insert_naming_its_own_id_reaches_the_id_index():
    """The season's create is the one insert choosing its `_id`.

    `saisons` carries a listed index as well, so the write is moved onto a collection carrying none.
    """

    _, writes = _write_operations()[f"POST /api/v{API_VERSION}/saisons"]
    [chosen] = [write for write in writes if write.chooses_id]
    uncovered = next(member for member in Collection if member not in UNIQUE_COLLECTIONS)

    assert _reaches_a_unique_index((replace(chosen, collections=(uncovered,)),))
    assert not _reaches_a_unique_index((replace(chosen, collections=(uncovered,), chooses_id=False),))


def test_a_route_declares_its_409_exactly_where_a_write_reaches_a_unique_index():
    """Both ways: a declaration the trace does not reach publishes a code that cannot occur, and a reach with none hides one that can.

    Over every route, so a read declaring one fails the second half.
    """

    reaching = {operation for operation, (_, writes) in _write_operations().items() if _reaches_a_unique_index(writes)}
    declaring = _declaring_operations()

    assert sorted(reaching - declaring) == [], "these reach a unique index and declare no 409 for `DB-COMMON-002`"
    assert sorted(declaring - reaching) == [], "these declare a 409 for `DB-COMMON-002` and reach no unique index"
    assert len(reaching) >= DECLARING_OPERATIONS_FLOOR


def test_the_code_published_is_the_one_the_handler_answers_with():
    request = Request({"type": "http", "method": "POST", "headers": []})
    response = asyncio.run(duplicate_key_exception_handler(request, DuplicateKeyError("E11000 duplicate key error", 11000, None)))

    assert (response.status_code, json.loads(bytes(response.body))["error_code"]) == (int(CONFLICT), DUPLICATE_KEY)


# A database of this case's own: the season it creates twice would stand in any shared corpus.
DUPLICATE_SEASON_DATABASE = worker_database("fl_duplicate_key_publication_test")
SAISONS = f"/api/v{API_VERSION}/saisons"


def _posted_twice(uri: str, payload: Mapping[str, Any]) -> tuple[Response, Response]:
    """Both creates on one client and one loop (`tests/app_client.py :: app_client`)."""

    async def _both() -> tuple[Response, Response]:
        config = build_test_config().model_copy(update={"db_base_name": DUPLICATE_SEASON_DATABASE})
        async with app_client(uri, config=config) as http:
            headers = {**ADMIN_AUTH, ACTOR_HEADER: "admin@example.com"}
            first = await http.post(SAISONS, json=dict(payload), headers=headers)
            second = await http.post(SAISONS, json=dict(payload), headers=headers)
            return first, second

    return asyncio.run(_both())


@pytest.mark.db
def test_a_season_created_twice_answers_the_published_duplicate_key(mongo_url: str, saison):
    """The `_id` index refuses the second create, which no index `UNIQUE_INDEXES` lists would."""

    client = MongoClient(mongo_url)
    try:
        a_clean_database_sync(client, mongo_url, DUPLICATE_SEASON_DATABASE)
    finally:
        client.close()

    stored = saison()
    payload = {
        "id": stored["_id"],
        "rules": stored["rules"],
        "start_date": stored["start_date"],
        "end_date": stored["end_date"],
        "bewerbung": {"offen": True, "von": "2025-11-01", "bis": "2025-12-15"},
        "registrierung": {"offen": False, "von": "2026-01-05", "bis": "2026-02-05"},
    }
    first, second = _posted_twice(mongo_url, payload)

    assert first.status_code == 201, first.json()
    assert (second.status_code, second.json()["error_code"]) == (int(CONFLICT), DUPLICATE_KEY)
