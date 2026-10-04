"""
TESTS · where a write can answer `DB-COMMON-002`, traced from each route's own source

Traced rather than declared in a table: nothing states which collections a route writes, so each
route's handler is followed through the application's helpers to the writes it makes. An insert into
a collection a unique index covers or naming its own `_id`, an upsert and a replacement can meet the
code; an update only where it can set one of that collection's index key or partial-filter fields,
and an update whose fields the trace cannot read counts as setting every one.
"""

import ast
import asyncio
import functools
import importlib
import inspect
import json
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass, field, replace
from pathlib import Path
from types import ModuleType
from typing import Annotated, Any, Literal

import pytest
from httpx2 import Response
from pydantic import BaseModel
from pymongo import MongoClient
from pymongo.errors import DuplicateKeyError
from starlette.requests import Request

from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.constraints import UNIQUE_INDEXES
from app.core.dependencies import DB
from app.core.exception_handlers import duplicate_key_exception_handler, refused_codes
from app.core.exceptions import DUPLICATE_KEY
from app.main import create_app
from tests.app_client import app_client
from tests.config import ADMIN_AUTH, build_test_config, grants_for_the_suite
from tests.core.app_source import (
    APP_ROOT,
    BACKEND_ROOT,
    COLLECTION_ARGUMENT_SUFFIX,
    DRIVER_WRITES,
    WRITE_HELPERS,
    Declaration,
    api_routes,
    app_calls,
    callee,
    declared,
    module_of,
    parsed,
    resolve_callee,
    scoped_calls,
    unfollowed_references,
)
from tests.database import a_clean_database_sync
from tests.worker import worker_database

CRUD = APP_ROOT / "core" / "crud.py"

BULK_INSERT = "post_many_to_db"
INSERTS = frozenset({"insert_live", "insert_one", "post_one_to_db"})
# Every collection carries a unique index on it that `UNIQUE_INDEXES` never lists, the server's own.
# An update cannot move it: the server refuses a change to `_id` as an immutable field, never as a duplicate.
ID_KEY = "_id"

DRIVER_INSERTS = frozenset({"insert_many", "insert_one"})
DRIVER_UPDATES = frozenset({"find_one_and_update", "update_many", "update_one"})
DRIVER_REMOVALS = frozenset({"delete_many", "delete_one", "find_one_and_delete"})
# The update operators whose document's KEYS are the fields they write. `$rename` names its target in
# a value, so it is absent, and any operator absent here counts as writing every field.
FIELD_OPERATORS = frozenset(
    {
        "$addToSet",
        "$bit",
        "$currentDate",
        "$inc",
        "$max",
        "$min",
        "$mul",
        "$pop",
        "$pull",
        "$pullAll",
        "$push",
        "$set",
        "$setOnInsert",
        "$unset",
    }
)
# The `dict` methods a held literal may be read through without the trace losing which keys it holds.
READING_METHODS = frozenset({"get", "items", "keys", "values"})
# A write's arguments a held literal may be handed as, which the helpers and the driver only read.
WRITTEN_ARGUMENTS = frozenset({"document", "documents", "update"})

UNIQUE_COLLECTIONS = frozenset(Collection(index.collection) for index in UNIQUE_INDEXES)
COLLECTION_NAMES = frozenset(str(member) for member in Collection)

READ_METHODS = frozenset({"GET", "HEAD"})
CONFLICT = "409"

# The operations the trace reached a unique index from on the tree this was written against, so an
# equality over two sets that both went empty still fails.
DECLARING_OPERATIONS_FLOOR = 40


def _filter_fields(expression: Any) -> Iterator[str]:
    """Every field a partial filter names, at any depth, its operators passed over."""

    if isinstance(expression, Mapping):
        for key, value in expression.items():
            if not key.startswith("$"):
                yield key
            yield from _filter_fields(value)
    elif isinstance(expression, list | tuple):
        for member in expression:
            yield from _filter_fields(member)


# Each covered collection's fields a write must set to meet one of its indexes: a key, or a field
# the partial filter reads, since setting one moves a row into what the index holds.
INDEX_FIELDS: Mapping[Collection, frozenset[str]] = {
    collection: frozenset(
        name
        for index in UNIQUE_INDEXES
        if Collection(index.collection) is collection
        for name in (*index.keys, *_filter_fields(index.partial_filter or {}))
    )
    for collection in UNIQUE_COLLECTIONS
}


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
# Where a dict literal spreads another (`**other`), standing in for the key the spread has none of.
SPREAD = _Marker("<spread>")

Values = tuple[Any, ...]


@dataclass(frozen=True)
class _Literal:
    """A dict literal, each key's possible spellings beside the values it may hold."""

    entries: tuple[tuple[Values, Values], ...]


@dataclass(frozen=True)
class _Prefix:
    """An f-string key read up to its first hole: the field it names starts with `text` and nothing more is known."""

    text: str


@dataclass(frozen=True)
class _Payload:
    """A request body of one model, bound where an endpoint's parameter is annotated with it."""

    schema: type[BaseModel]


@dataclass(frozen=True)
class _Dump:
    """What a `_Payload`'s `model_dump()` holds: a dict keyed by its fields."""

    fields: frozenset[str]


# A field path a write sets: spelled out, or an f-string's leading text.
FieldPath = str | _Prefix


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
    #: `insert`, `update`, `removal`, `whole` for a write setting every field it likes (a
    #: replacement, an upsert, a bulk write), or `through` for a helper writing by another helper.
    kind: Literal["insert", "update", "removal", "whole", "through"] = "whole"
    #: The paths an update sets, `None` where the trace cannot read them.
    sets: frozenset[FieldPath] | None = None
    #: What a `through` helper writes, judged in its place.
    inner: tuple[Write, ...] = field(default=(), compare=False)


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


def _model_dump(receiver: Any) -> Any:
    """A model's own fields and their aliases; a model keeping extra keys or serialising itself names keys no field declares."""

    if not isinstance(receiver, _Payload):
        return UNRESOLVED
    schema = receiver.schema
    if schema.model_config.get("extra") == "allow" or schema.__pydantic_decorators__.model_serializers:
        return UNRESOLVED

    names = {*schema.model_fields, *schema.model_computed_fields}
    for info in schema.model_fields.values():
        names |= {alias for alias in (info.alias, info.serialization_alias) if isinstance(alias, str)}
    return _Dump(frozenset(names))


def _own_nodes(declaration: Declaration) -> Iterator[ast.AST]:
    """Every node of `declaration`'s own body, a function, lambda or class declared inside it left out."""

    stack: list[ast.AST] = list(declaration.body)
    while stack:
        node = stack.pop()
        yield node
        stack += [
            child
            for child in ast.iter_child_nodes(node)
            if not isinstance(child, ast.FunctionDef | ast.AsyncFunctionDef | ast.Lambda | ast.ClassDef)
        ]


# Each composer's answer for one binding of its arguments, and the composers being read right now,
# so one reaching itself again answers `UNRESOLVED` rather than recursing.
_RETURNS: dict[tuple[int, str], Values] = {}
_READING: set[int] = set()


def _returns(function: Callable[..., Any], call: ast.Call, scope: Mapping[str, Values], module: ModuleType) -> Values:
    """Every value a function of the application's own can return, its parameters bound from `call`."""

    function = inspect.unwrap(function)
    if not function.__module__.startswith("app."):
        return (UNRESOLVED,)

    path = Path(inspect.getsourcefile(function) or "")
    found = [node for node in parsed(path).body if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef) and node.name == function.__name__]
    if len(found) != 1 or id(found[0]) in _READING:
        return (UNRESOLVED,)
    [declaration] = found

    bound = {argument.arg: _bound_value(call, argument, position, scope, module) for argument, position in _parameters(declaration)}
    key = (id(declaration), repr(sorted(bound.items())))
    if key not in _RETURNS:
        _READING.add(id(declaration))
        try:
            _RETURNS[key] = _return_values(declaration, bound, _module(path))
        finally:
            _READING.discard(id(declaration))

    return _RETURNS[key]


def _return_values(declaration: Declaration, bound: Mapping[str, Values], module: ModuleType) -> Values:
    own = list(_own_nodes(declaration))
    if any(isinstance(node, ast.Yield | ast.YieldFrom) for node in own):
        return (UNRESOLVED,)

    scope = _local_scope(declaration, bound, module)
    returned = [node.value for node in own if isinstance(node, ast.Return)]
    # Running off the end answers `None`, as a bare `return` does.
    falls_through = not returned or not isinstance(declaration.body[-1], ast.Return)

    return _distinct(
        iter(
            (
                *(value for node in returned for value in ((None,) if node is None else _values(node, scope, module))),
                *((None,) if falls_through else ()),
            )
        )
    )


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
            if value is UNRESOLVED or isinstance(value, _Literal | _Prefix | _Payload | _Dump)
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

    if isinstance(node, ast.Dict):
        return (
            _Literal(
                tuple(
                    ((SPREAD,) if key is None else _values(key, scope, module), _values(value, scope, module))
                    for key, value in zip(node.keys, node.values, strict=True)
                )
            ),
        )

    if isinstance(node, ast.JoinedStr):
        leading = ""
        for part in node.values:
            if not (isinstance(part, ast.Constant) and isinstance(part.value, str)):
                return (_Prefix(leading),)
            leading += part.value
        return (leading,)

    if isinstance(node, ast.IfExp):
        return _distinct(iter((*_values(node.body, scope, module), *_values(node.orelse, scope, module))))

    if isinstance(node, ast.Await):
        return _values(node.value, scope, module)

    if isinstance(node, ast.Call):
        if isinstance(node.func, ast.Attribute) and node.func.attr == "model_dump":
            return _distinct(_model_dump(receiver) for receiver in _values(node.func.value, scope, module))
        return _distinct(
            value
            for function in _values(node.func, scope, module)
            for value in (_returns(function, node, scope, module) if inspect.isfunction(inspect.unwrap(function)) else (UNRESOLVED,))
        )

    return (UNRESOLVED,)


def _read_only(node: ast.AST, parents: Mapping[int, ast.AST]) -> bool:
    """Whether a held dict, or anything read out of it, keeps the keys the trace read.

    Any use not named below may add one: an alias, a nested store, an argument to any call but a write.
    """

    parent = parents.get(id(node))
    if isinstance(parent, ast.Subscript) and node is parent.value:
        return isinstance(parent.ctx, ast.Load) and _read_only(parent, parents)
    if isinstance(parent, ast.Attribute):
        call = parents.get(id(parent))
        return parent.attr in READING_METHODS and isinstance(call, ast.Call) and call.func is parent and _read_only(call, parents)
    if isinstance(parent, ast.Dict) and node not in parent.keys:
        return _read_only(parent, parents)
    if isinstance(parent, ast.If | ast.IfExp | ast.While) and node is parent.test:
        return True
    if isinstance(parent, ast.IfExp | ast.BoolOp):
        return _read_only(parent, parents)
    if isinstance(parent, ast.Compare | ast.UnaryOp | ast.FormattedValue | ast.Return):
        return True
    if isinstance(parent, ast.keyword) and parent.arg in WRITTEN_ARGUMENTS:
        call = parents.get(id(parent))
        return isinstance(call, ast.Call) and callee(call) in WRITE_HELPERS | DRIVER_WRITES
    # A literal holding it, bound to a name, is that name's to answer for.
    return isinstance(parent, ast.Assign) and isinstance(node, ast.Dict) and all(isinstance(target, ast.Name) for target in parent.targets)


@functools.cache
def _changing_names(declaration: Declaration) -> frozenset[str]:
    """Every name `declaration` may change a held dict through, so a literal bound to one is no record of its keys."""

    parents = {id(child): node for node in ast.walk(declaration) for child in ast.iter_child_nodes(node)}
    changed: set[str] = set()
    for node in ast.walk(declaration):
        if not isinstance(node, ast.Name):
            continue
        if isinstance(node.ctx, ast.Load):
            if not _read_only(node, parents):
                changed.add(node.id)
        # A binding other than a plain assignment: `+=`, `|=`, a loop target, a walrus, an annotated one.
        elif not (isinstance(parents.get(id(node)), ast.Assign) and isinstance(node.ctx, ast.Store)):
            changed.add(node.id)

    return frozenset(changed)


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

    changing = _changing_names(declaration)
    return {
        name: tuple(UNRESOLVED if name in changing and isinstance(value, _Literal | _Dump) else value for value in values)
        for name, values in scope.items()
    }


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


def _bound_value(call: ast.Call, argument: ast.arg, position: int | None, scope: Mapping[str, Values], module: ModuleType) -> Values:
    value = _argument(call, argument.arg, position)
    return (UNRESOLVED,) if value is None else _values(value, scope, module)


def _module(path: Path) -> ModuleType:
    return importlib.import_module(".".join(path.relative_to(BACKEND_ROOT).with_suffix("").parts))


def _annotated_payloads(annotation: ast.expr | None, module: ModuleType) -> Values:
    """The models an endpoint parameter's annotation names, through `Annotated[...]` and a `|` union."""

    if annotation is None:
        return (UNRESOLVED,)
    if isinstance(annotation, ast.BinOp) and isinstance(annotation.op, ast.BitOr):
        return _distinct(iter((*_annotated_payloads(annotation.left, module), *_annotated_payloads(annotation.right, module))))
    if isinstance(annotation, ast.Subscript) and _values(annotation.value, {}, module) == (Annotated,):
        first = annotation.slice.elts[0] if isinstance(annotation.slice, ast.Tuple) else annotation.slice
        return _annotated_payloads(first, module)
    if isinstance(annotation, ast.Constant) and annotation.value is None:
        return (None,)

    return _distinct(
        _Payload(value) if isinstance(value, type) and issubclass(value, BaseModel) else UNRESOLVED for value in _values(annotation, {}, module)
    )


def _endpoint_scope(declaration: Declaration, module: ModuleType) -> dict[str, Values]:
    """An injected collection answers by its spelling, `DB` by its subscript, a body by its model, any other parameter the request's."""

    scope: dict[str, Values] = {}
    for argument, _ in _parameters(declaration):
        if isinstance(argument.annotation, ast.Name) and getattr(module, argument.annotation.id, None) is DB:
            scope[argument.arg] = (DATABASE,)
        elif not argument.arg.endswith(COLLECTION_ARGUMENT_SUFFIX):
            scope[argument.arg] = _annotated_payloads(argument.annotation, module)
    return scope


def _entries(value: Any) -> tuple[tuple[Values, Values], ...] | None:
    """A dict's keys beside their values, a literal's or a module constant's; `None` for anything else."""

    if isinstance(value, _Literal):
        return value.entries
    if isinstance(value, _Dump):
        return tuple(((name,), (UNRESOLVED,)) for name in value.fields)
    if isinstance(value, Mapping):
        return tuple(((key,), (held,)) for key, held in value.items())
    return None


def _paths(document: Values) -> frozenset[FieldPath] | None:
    """The field paths a document of fields names, `None` where one of its keys is unreadable."""

    found: set[FieldPath] = set()
    for value in document:
        entries = _entries(value)
        if entries is None:
            return None
        for keys, held in entries:
            for key in keys:
                if key is SPREAD:
                    spread = _paths(held)
                    if spread is None:
                        return None
                    found |= spread
                elif isinstance(key, str | _Prefix):
                    found.add(key)
                else:
                    return None

    return frozenset(found)


def _updated_paths(update: Values) -> frozenset[FieldPath] | None:
    """The field paths an update document sets; `None` for a replacement, `$rename`, a pipeline or anything unread.

    A composer answering `None` writes nothing there: its caller passes no `None` to a write.
    """

    found: set[FieldPath] = set()
    for value in update:
        if value is None:
            continue
        entries = _entries(value)
        if entries is None:
            return None
        for keys, operand in entries:
            if not all(isinstance(key, str) and key in FIELD_OPERATORS for key in keys):
                return None
            paths = _paths(operand)
            if paths is None:
                return None
            found |= paths

    return frozenset(found)


def _driver_write(
    call: ast.Call, method: str, collections: Values, site: tuple[str, int], scope: Mapping[str, Values], module: ModuleType
) -> Write:
    chooses_id = _chooses_id(call, method)
    if method in DRIVER_INSERTS:
        return Write(method, collections, site, chooses_id, kind="insert")
    if method in DRIVER_REMOVALS:
        return Write(method, collections, site, chooses_id, kind="removal")

    upsert = _argument(call, "upsert", None)
    if method in DRIVER_UPDATES and (upsert is None or (isinstance(upsert, ast.Constant) and upsert.value is False)):
        update = _argument(call, "update", 1)
        return Write(
            method,
            collections,
            site,
            chooses_id,
            kind="update",
            sets=None if update is None else _updated_paths(_values(update, scope, module)),
        )

    return Write(method, collections, site, chooses_id)


def _write_at(call: ast.Call, chain: tuple[Declaration, ...], path: Path, scope: Mapping[str, Values], module: ModuleType) -> Write | None:
    """The write one call makes, `None` for a call making none.

    A helper of `app/core/crud.py` is read off its signature: an `update` sets its fields, a document
    inserts, and anything else is judged by the writes it makes through others.
    """

    site = (path.relative_to(BACKEND_ROOT).as_posix(), call.lineno)
    if isinstance(call.func, ast.Attribute) and call.func.attr in DRIVER_WRITES:
        return _driver_write(call, call.func.attr, _values(call.func.value, scope, module), site, scope, module)

    resolved = resolve_callee(call, chain, path)
    if resolved is None or resolved[1] != CRUD or resolved[0].name not in WRITE_HELPERS:
        return None

    target, target_path = resolved
    argument = _argument(call, "collection", None)
    collections = (UNRESOLVED,) if argument is None else _values(argument, scope, module)
    chooses_id = _chooses_id(call, target.name)
    taken = {parameter.arg for parameter, _ in _parameters(target)}

    if "update" in taken:
        update = _argument(call, "update", None)
        return Write(
            target.name,
            collections,
            site,
            chooses_id,
            kind="update",
            sets=None if update is None else _updated_paths(_values(update, scope, module)),
        )
    if taken & {"document", "documents"}:
        return Write(target.name, collections, site, chooses_id, kind="insert")

    bound = {parameter.arg: _bound_value(call, parameter, position, scope, module) for parameter, position in _parameters(target)}
    return Write(target.name, collections, site, chooses_id, kind="through", inner=tuple(_writes(target, target_path, bound, set())))


def _writes(declaration: Declaration, path: Path, bound: Mapping[str, Values], seen: set[tuple[Any, ...]]) -> Iterator[Write]:
    """Every write `declaration` reaches, a `app/core/crud.py` helper or the driver's own, each helper followed with its arguments bound.

    Nested functions are read with the one declaring them: a transaction's callback is handed to the
    driver, never called by name.
    """

    module = _module(path)
    scope = _local_scope(declaration, bound, module)
    nested = {id(node) for node in ast.walk(declaration) if node is not declaration}

    for chain, call in scoped_calls(declaration, (declaration,)):
        write = _write_at(call, chain, path, scope, module)
        if write is not None:
            yield write
        if isinstance(call.func, ast.Attribute) and call.func.attr in DRIVER_WRITES:
            continue

        resolved = resolve_callee(call, chain, path)
        if resolved is None:
            continue

        target, target_path = resolved
        if id(target) in nested:
            continue

        # Followed on into a helper as well, which is how the log row every write files is reached.
        arguments = {argument.arg: _bound_value(call, argument, position, scope, module) for argument, position in _parameters(target)}
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


def _meets(path: FieldPath, index_field: str) -> bool:
    """Whether setting `path` can change `index_field`: one is the other, or holds it, a leading text matching either way."""

    if isinstance(path, _Prefix):
        return index_field.startswith(path.text) or path.text.startswith(index_field)
    return path == index_field or path.startswith(f"{index_field}.") or index_field.startswith(f"{path}.")


def _reaches(write: Write) -> bool:
    if write.chooses_id:
        return True
    if write.kind == "through":
        return any(map(_reaches, write.inner))

    fields = frozenset(name for collection in write.collections if collection in UNIQUE_COLLECTIONS for name in INDEX_FIELDS[collection])
    if not fields or write.kind == "removal":
        return False
    if write.kind != "update" or write.sets is None:
        return True
    return any(_meets(path, name) for path in write.sets for name in fields)


def _reaches_a_unique_index(writes: tuple[Write, ...]) -> bool:
    return any(map(_reaches, writes))


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


def _is_a_write(call: ast.Call) -> bool:
    # A helper called through its module too, which `resolve_callee` cannot follow: counted here, it
    # is a write no route's trace reaches.
    return callee(call) in WRITE_HELPERS or (isinstance(call.func, ast.Attribute) and callee(call) in DRIVER_WRITES)


def _write_unreached(module: str, call: ast.Call) -> Write:
    """The write at one call site no route reaches, read in the function holding it as an endpoint is read."""

    path = BACKEND_ROOT / module
    [chain] = [chain for chain, found in scoped_calls(parsed(path), ()) if found is call]
    holder = _module(path)
    scope = _local_scope(chain[-1], _endpoint_scope(chain[-1], holder), holder) if chain else {}
    write = _write_at(call, chain, path, scope, holder)
    site = (module, call.lineno)

    # Through its module, so no declaration resolves: read as setting every field of what it names.
    return write if write is not None else Write(callee(call), (UNRESOLVED,), site)


def test_every_write_the_application_makes_is_reached_from_a_route():
    """Two listings by different routes: every call site under `app/`, against those the trace reached from a route.

    A site no route reaches stands only where its own write meets no unique index, having nothing to publish.
    """

    made = {
        (module, call.lineno): call
        for module, _, call in app_calls()
        if module != CRUD.relative_to(BACKEND_ROOT).as_posix() and _is_a_write(call)
    }
    reached = {write.site for _, writes in _write_operations().values() for write in writes}
    # A person's day count: reached through a dependency, which no trace follows, and an upsert on
    # `_id` alone, which the server retries rather than refuses.
    counted = {
        (module, call.lineno)
        for module, scope, call in app_calls()
        if module == "app/core/drosselung.py" and scope == "drosseln" and callee(call) in DRIVER_WRITES
    }
    unreached = made.keys() - reached - counted

    assert made, "no write call site was found, so the comparison below holds over nothing"
    assert len(counted) == 1, f"the day count is {len(counted)} writes, where the exemption below names one"
    assert sorted(site for site in unreached if _reaches(_write_unreached(site[0], made[site]))) == [], (
        "writes no route's trace reaches and a unique index can refuse, so a route making them publishes nothing about it"
    )


def test_no_write_helper_is_held_as_a_value():
    """A callback or a partial writes where no call site names the helper, so neither listing above would see the write."""

    assert unfollowed_references(WRITE_HELPERS, skip=frozenset({CRUD})) == []


def test_the_draws_bulk_inserts_reach_a_unique_index_on_their_own():
    """Without the watermark's write, which reaches `saisons`' index and would declare the draw's 409 whether or not a batch counts."""

    _, writes = _write_operations()[f"POST /api/v{API_VERSION}/saisons/{{saison_id}}/spielplan"]
    bulk = tuple(write for write in writes if write.helper == BULK_INSERT)

    assert bulk and _reaches_a_unique_index(bulk)


def test_an_insert_naming_its_own_id_reaches_the_id_index():
    """The season's create is the one insert choosing its `_id`.

    `saisons` carries a listed index as well, so the write is moved onto a collection carrying none.
    """

    _, writes = _write_operations()[f"POST /api/v{API_VERSION}/saisons"]
    [chosen] = [write for write in writes if write.chooses_id]
    uncovered = next(member for member in Collection if member not in UNIQUE_COLLECTIONS)

    assert _reaches_a_unique_index((replace(chosen, collections=(uncovered,)),))
    assert not _reaches_a_unique_index((replace(chosen, collections=(uncovered,), chooses_id=False),))


class _AddressPayload(BaseModel):
    email: str


# A module whose composer writes `status`, one of `saisons`' index fields and none of `registrierungen`'.
COMPOSERS = "app.api.registrierungen.services"


def _update_reaches(source: str, collection: Collection, scope: Mapping[str, Values] | None = None) -> bool:
    """Whether an update spelled as `source`, read in `COMPOSERS`' module, reaches `collection`'s unique indexes."""

    module = importlib.import_module(COMPOSERS)
    update = _values(ast.parse(source, mode="eval").body, scope or {}, module)
    return _reaches(Write("patch_one_in_db", (collection,), (COMPOSERS, 0), kind="update", sets=_updated_paths(update)))


@pytest.mark.parametrize(
    ("source", "collection", "scope", "reaches"),
    [
        ('{"$set": {"vorname": name}, "$inc": {"bounded_writes": 1}}', Collection.SPIELER, None, False),
        ('{"$set": {"vorname": name, "email": None}}', Collection.SPIELER, None, True),
        ('{"$unset": {"widerrufen_am": ""}}', Collection.EINLADUNGEN, None, True),
        ('{"$set": {f"kontakte.{slot}.einwilligung": block}}', Collection.SAISON_TEAMS, None, False),
        # Only the leading text is known, and `saison_` may go on to `saison_id`.
        ('{"$set": {f"saison_{slot}": block}}', Collection.SAISON_TEAMS, None, True),
        ('{"$set": {f"{slot}.name": name}}', Collection.SPIELE, None, True),
        ('{"$set": payload.model_dump(mode="json")}', Collection.SPIELER, {"payload": (_Payload(_AddressPayload),)}, True),
        ('{"$set": {**payload.model_dump(), "vorname": name}}', Collection.SCHIEDSRICHTER, {"payload": (_Payload(_AddressPayload),)}, False),
        ('compose_ablehnung_update(von=name, grund=None, today="2026-01-01")', Collection.REGISTRIERUNGEN, None, False),
        ('compose_ablehnung_update(von=name, grund=None, today="2026-01-01")', Collection.SAISONS, None, True),
        # What the trace cannot read reaches: an unknown document, a rename's target, a replacement.
        ('{"$set": unknown}', Collection.SPIELER, {"unknown": (UNRESOLVED,)}, True),
        ('{"$rename": {"alt": "neu"}}', Collection.SPIELER, None, True),
        ('{"vorname": name}', Collection.SPIELER, None, True),
    ],
)
def test_an_update_reaches_an_index_exactly_where_it_can_set_one_of_its_fields(
    source: str, collection: Collection, scope: Mapping[str, Values] | None, reaches: bool
):
    """The shapes the trace reads an update's fields from, each beside a collection it does and does not reach."""

    assert _update_reaches(source, collection, scope) is reaches


@pytest.mark.parametrize(
    "change",
    [
        "changes['email'] = None",
        "changes['$set']['email'] = None",
        "changes.update(email=None)",
        "changes['$set'].update(email=None)",
        "alias = changes\n    alias['email'] = None",
        "inner = changes['$set']\n    inner['email'] = None",
        "add_address(changes)",
        "changes |= {'email': None}",
    ],
)
def test_a_literal_the_function_may_change_after_binding_counts_as_writing_every_field(change: str):
    """Each way a key lands after the literal was read, which would otherwise pass as never written."""

    source = f"def compose(name):\n    changes = {{'$set': {{'vorname': name}}}}\n    {change}\n    return changes\n"
    [declaration] = ast.parse(source).body
    assert isinstance(declaration, ast.FunctionDef)
    module = importlib.import_module(COMPOSERS)

    assert _updated_paths(_return_values(declaration, {"name": (UNRESOLVED,)}, module)) is None
    # The same function with the change read rather than made keeps its keys.
    [unchanged] = ast.parse(source.replace(f"    {change}\n", "    assert changes['$set'].get('vorname') is not None\n")).body
    assert isinstance(unchanged, ast.FunctionDef)
    assert _updated_paths(_return_values(unchanged, {"name": (UNRESOLVED,)}, module)) == frozenset({"vorname"})


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
            headers = ADMIN_AUTH
            first = await http.post(SAISONS, json=dict(payload), headers=headers)
            second = await http.post(SAISONS, json=dict(payload), headers=headers)
            return first, second

    return asyncio.run(_both())


@pytest.mark.db
def test_a_season_created_twice_answers_the_published_duplicate_key(mongo_replica_set_url: str, saison):
    """The `_id` index refuses the second create, which no index `UNIQUE_INDEXES` lists would."""

    client = MongoClient(mongo_replica_set_url)
    try:
        a_clean_database_sync(client, mongo_replica_set_url, DUPLICATE_SEASON_DATABASE)[Collection.BERECHTIGUNGEN].insert_many(
            grants_for_the_suite()
        )
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
    first, second = _posted_twice(mongo_replica_set_url, payload)

    assert first.status_code == 201, first.json()
    assert (second.status_code, second.json()["error_code"]) == (int(CONFLICT), DUPLICATE_KEY)
