"""
TESTS · where a write can answer `DB-COMMON-002`, traced from each route's own source

Traced rather than declared in a table: nothing states which collections a route writes, so each
route's handler is followed through the application's helpers to the `app/core/crud.py` writes it
makes, and a write reaching a collection a unique index covers is where the code can occur. By
collection and never by field, so an update that touches no key field still counts.
"""

import ast
import asyncio
import functools
import importlib
import json
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Any

from pymongo.errors import DuplicateKeyError

from app.core.collections import Collection
from app.core.constraints import UNIQUE_INDEXES
from app.core.dependencies import DB
from app.core.exception_handlers import duplicate_key_exception_handler
from app.main import DUPLICATE_KEY, api_routes, create_app
from tests.config import build_test_config
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

CRUD = APP_ROOT / "core" / "crud.py"

# `insert_many` reports a duplicate as `BulkWriteError`, which is no `DuplicateKeyError`, so the
# draw answers it 500 `DB-FAIL-001`
# (`fl_backend/tests/api/test_error_responses.py :: test_a_bulk_writes_refused_document_never_reaches_the_line`).
BULK_INSERT = "post_many_to_db"
SINGLE_DOCUMENT_WRITES = WRITE_HELPERS - {BULK_INSERT}

UNIQUE_COLLECTIONS = frozenset(Collection(index.collection) for index in UNIQUE_INDEXES)
COLLECTION_NAMES = frozenset(str(member) for member in Collection)

READ_METHODS = frozenset({"GET", "HEAD"})
CONFLICT = "409"

# The operations the trace reached a unique index from on the tree this was written against, so an
# equality over two sets that both went empty still fails.
DECLARING_OPERATIONS_FLOOR = 49


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
        return _distinct(
            UNRESOLVED if value is UNRESOLVED else getattr(value, node.attr, UNRESOLVED) for value in _values(node.value, scope, module)
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
    """Every `app/core/crud.py` write `declaration` reaches, each helper followed with its own arguments bound.

    Nested functions are read with the one declaring them: a transaction's callback is handed to the
    driver, never called by name.
    """

    module = _module(path)
    scope = _local_scope(declaration, bound, module)
    nested = {id(node) for node in ast.walk(declaration) if node is not declaration}

    for chain, call in scoped_calls(declaration, (declaration,)):
        resolved = resolve_callee(call, chain, path)
        if resolved is None:
            continue

        target, target_path = resolved
        if target_path == CRUD:
            if target.name in WRITE_HELPERS:
                argument = _argument(call, "collection", None)
                collections = (UNRESOLVED,) if argument is None else _values(argument, scope, module)
                yield Write(target.name, collections, (path.relative_to(BACKEND_ROOT).as_posix(), call.lineno))
            continue

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
def _write_operations() -> Mapping[str, tuple[Any, tuple[Write, ...]]]:
    """Each operation that is not a read, with its route and every write the trace reaches from it."""

    found: dict[str, tuple[Any, tuple[Write, ...]]] = {}
    for route in api_routes(create_app(build_test_config())):
        endpoint = declared(route.endpoint)
        path = module_of(route.endpoint)
        writes = tuple(_writes(endpoint, path, _endpoint_scope(endpoint, _module(path)), set()))
        for method in sorted(set(route.methods or ()) - READ_METHODS):
            found[f"{method} {route.path_format}"] = (route, writes)

    return found


def _reaches_a_unique_index(writes: tuple[Write, ...]) -> bool:
    return any(write.helper in SINGLE_DOCUMENT_WRITES and UNIQUE_COLLECTIONS.intersection(write.collections) for write in writes)


def test_every_write_names_a_collection_the_trace_resolves():
    unresolved = sorted(
        {
            f"{operation}: {write.helper} at {write.site}"
            for operation, (_, writes) in _write_operations().items()
            for write in writes
            if UNRESOLVED in write.collections
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
        if callee(call) in WRITE_HELPERS and module != CRUD.relative_to(BACKEND_ROOT).as_posix()
    }
    reached = {write.site for _, writes in _write_operations().values() for write in writes}

    assert made, "no write call site was found, so the comparison below holds over nothing"
    assert sorted(made - reached) == [], "writes no route's trace reaches, so a route making them publishes nothing about their unique indexes"


def test_the_bulk_insert_is_traced_and_left_out():
    """The draw's bulk insert reaches unique indexes and answers `DB-FAIL-001`, so a trace counting it would publish the code there."""

    bulk = [write for _, writes in _write_operations().values() for write in writes if write.helper == BULK_INSERT]

    assert any(UNIQUE_COLLECTIONS.intersection(write.collections) for write in bulk)


def test_a_route_declares_its_409_exactly_where_a_write_reaches_a_unique_index():
    """Both ways: a declaration the trace does not reach publishes a code that cannot occur, and a reach with none hides one that can."""

    operations = _write_operations()
    reaching = {operation for operation, (_, writes) in operations.items() if _reaches_a_unique_index(writes)}
    declaring = {operation for operation, (route, _) in operations.items() if CONFLICT in {str(status) for status in route.responses}}

    assert sorted(reaching - declaring) == [], "these reach a unique index and declare no 409 for `DB-COMMON-002`"
    assert sorted(declaring - reaching) == [], "these declare a 409 for `DB-COMMON-002` and reach no unique index"
    assert len(reaching) >= DECLARING_OPERATIONS_FLOOR


def test_the_code_published_is_the_one_the_handler_answers_with():
    response = asyncio.run(duplicate_key_exception_handler(None, DuplicateKeyError("E11000 duplicate key error", 11000, None)))  # type: ignore[arg-type]

    assert (response.status_code, json.loads(bytes(response.body))["error_code"]) == (int(CONFLICT), DUPLICATE_KEY)
