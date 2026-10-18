"""
TESTS · where a route can answer `DB-COMMON-001`, traced from each route's own source

Traced rather than declared in a table, as `tests/core/test_duplicate_key_publication.py` traces the
duplicate key: each handler is followed through the application's own functions to a `raise` of
`DocumentNotFoundException`, and a call inside a `try` whose handler absorbs that exception reaches
nothing. A handler holding a bare `raise` hands the exception on, so it absorbs nothing.
"""

import ast
import functools
from collections.abc import Iterator, Mapping
from pathlib import Path
from typing import Any

import pytest

from app.core.exception_handlers import refused_codes
from app.core.exceptions import DOCUMENT_NOT_FOUND, DocumentNotFoundException
from app.main import create_app
from tests.config import build_test_config
from tests.core.app_source import (
    APP_ROOT,
    BACKEND_ROOT,
    REMOVAL_HELPERS,
    WRITE_HELPERS,
    Declaration,
    api_routes,
    callee,
    declared,
    handed_callbacks,
    module_of,
    parsed,
    resolve_callee,
    resolve_reference,
    scoped_calls,
    scoped_references,
    session_handoffs,
    session_parameters,
)

NOT_FOUND = "404"
EXCEPTION = DocumentNotFoundException.__name__
# A handler naming any of these catches the miss: `except Exception` absorbs it as surely as its own name.
CAUGHT_BY = frozenset(ancestor.__name__ for ancestor in DocumentNotFoundException.__mro__)
ID_KEY = "_id"

# The driver's own calls that can take a document away, a bulk write among them.
DRIVER_REMOVALS = frozenset({"bulk_write", "delete_many", "delete_one", "find_one_and_delete"})

# The operations the trace reached a raise from on the tree this was written against, so an equality
# over two sets that both went empty still fails.
DECLARING_OPERATIONS_FLOOR = 40


def _parents(declaration: Declaration) -> dict[int, ast.AST]:
    return {id(child): node for node in ast.walk(declaration) for child in ast.iter_child_nodes(node)}


def _caught_names(handler: ast.ExceptHandler) -> set[str]:
    caught = handler.type
    names = caught.elts if isinstance(caught, ast.Tuple) else [caught] if caught is not None else []

    return {name.id for name in names if isinstance(name, ast.Name)}


def _names_the_exception(handler: ast.ExceptHandler) -> bool:
    return EXCEPTION in _caught_names(handler)


def _absorbs(handler: ast.ExceptHandler) -> bool:
    """A handler catching the exception, by its own class, an ancestor's or a bare `except`, and never handing it on."""

    catches = handler.type is None or bool(_caught_names(handler) & CAUGHT_BY)

    return catches and not any(isinstance(node, ast.Raise) and node.exc is None for node in ast.walk(handler))


def _caught(node: ast.AST, parents: dict[int, ast.AST]) -> bool:
    """Whether `node` sits in the body of a `try` one of whose handlers absorbs the exception."""

    child, parent = node, parents.get(id(node))
    while parent is not None:
        if isinstance(parent, ast.Try) and any(child is statement for statement in parent.body) and any(map(_absorbs, parent.handlers)):
            return True
        child, parent = parent, parents.get(id(parent))

    return False


def _raises_here(node: ast.AST) -> bool:
    """A `raise DocumentNotFoundException(...)`, or a bare `raise` inside a handler naming it."""

    if not isinstance(node, ast.Raise):
        return False
    if node.exc is None:
        return True
    call = node.exc

    return isinstance(call, ast.Call) and isinstance(call.func, ast.Name) and call.func.id == EXCEPTION


Site = tuple[Path, int]


@functools.cache
def _step(path: Path, lineno: int) -> tuple[bool, tuple[Site, ...]]:
    """Whether one declaration raises the miss in its own body unabsorbed, and the declarations its uncaught references name."""

    declaration = next(
        node for node in ast.walk(parsed(path)) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.lineno == lineno
    )
    parents = _parents(declaration)

    raises = any(
        (node.exc is not None or _in_a_handler_naming_it(node, parents)) and not _caught(node, parents)
        for node in ast.walk(declaration)
        if isinstance(node, ast.Raise) and _raises_here(node)
    )
    calls = {id(call.func): (chain, call) for chain, call in scoped_calls(declaration, (declaration,))}
    reached: list[Site] = []
    # Every name and attribute rather than a call's bare callee alone: a raising helper held as a value,
    # `fetch = pull_one_from_db`, or read off its module raises under a name no call spells.
    for chain, node in scoped_references(declaration, (declaration,)):
        if (isinstance(node, ast.Name) and not isinstance(node.ctx, ast.Load)) or _caught(node, parents):
            continue
        if (held := calls.get(id(node))) is not None and _cannot_miss(held[1], held[0], path):
            continue
        resolved = resolve_reference(node, chain, path)
        if resolved is not None and not _only_compared(node, parents, chain, path):
            reached.append((resolved[1], resolved[0].lineno))

    return raises, tuple(reached)


def _only_compared(node: ast.Name | ast.Attribute, parents: dict[int, ast.AST], chain: tuple[Declaration, ...], path: Path) -> bool:
    """An argument whose receiving function reads its parameter in comparisons alone, so never calls it.

    `app/api/identitaet/crud.py :: _runs` asks whether a step belongs to the erasure's scope by its
    function, and `resolve_subject` hands it steps that raise the miss.
    """

    parent = parents.get(id(node))
    call = parents.get(id(parent)) if isinstance(parent, ast.keyword) else parent
    if not isinstance(call, ast.Call) or not isinstance(call.func, (ast.Name, ast.Attribute)) or node is call.func:
        return False
    receiver = resolve_reference(call.func, chain, path)
    if receiver is None:
        return False

    target = receiver[0]
    positional = [argument.arg for argument in [*target.args.posonlyargs, *target.args.args]]
    index = next((index for index, argument in enumerate(call.args) if argument is node), None)
    parameter = parent.arg if isinstance(parent, ast.keyword) else positional[index] if index is not None and index < len(positional) else None
    if parameter is None:
        return False

    within = _parents(target)
    reads = [read for read in ast.walk(target) if isinstance(read, ast.Name) and read.id == parameter and isinstance(read.ctx, ast.Load)]

    return bool(reads) and all(isinstance(within.get(id(read)), ast.Compare) for read in reads)


@functools.cache
def _can_raise(path: Path, lineno: int) -> bool:
    """Whether any declaration the one at `path` and `lineno` reaches raises the miss.

    A search rather than a recursion: functions calling each other would recurse without end, and a
    declaration met again shows no raise it has not shown.
    """

    seen: set[Site] = set()
    frontier: list[Site] = [(path, lineno)]
    while frontier:
        site = frontier.pop()
        if site in seen:
            continue
        seen.add(site)
        raises, reached = _step(*site)
        if raises:
            return True
        frontier += reached

    return False


@functools.cache
def _transaction_sessions() -> Mapping[int, frozenset[str]]:
    """Each function running inside a transaction, by identity, with the parameters holding its session.

    A callback handed to `with_transaction`, and a function such a callback calls with its own session.
    """

    held: dict[int, set[str]] = {}
    for _, callback in handed_callbacks():
        held.setdefault(id(callback), set()).update(name for name, _ in session_parameters(callback))
    for handoff in session_handoffs():
        if handoff.in_session:
            held.setdefault(id(handoff.declaration), set()).add(handoff.parameter)

    return {declaration: frozenset(names) for declaration, names in held.items()}


def _keyword(call: ast.Call, name: str) -> ast.expr | None:
    return next((keyword.value for keyword in call.keywords if keyword.arg == name), None)


def _own_nodes(holder: Declaration) -> Iterator[ast.AST]:
    """Every node of `holder`'s own scope: a nested function, lambda or class binds its names in a scope of its own."""

    pending = list(ast.iter_child_nodes(holder))
    while pending:
        node = pending.pop()
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)):
            continue
        yield node
        pending.extend(ast.iter_child_nodes(node))


def _bindings(name: str, holder: Declaration) -> list[ast.AST]:
    """Every place `holder`'s own scope binds `name`, a parameter and a `nonlocal` or `global` handing it elsewhere included."""

    parameters = [*holder.args.posonlyargs, *holder.args.args, *holder.args.kwonlyargs, holder.args.vararg, holder.args.kwarg]

    return [argument for argument in parameters if argument is not None and argument.arg == name] + [
        node
        for node in _own_nodes(holder)
        if (isinstance(node, ast.Name) and node.id == name and not isinstance(node.ctx, ast.Load))
        or (isinstance(node, (ast.Nonlocal, ast.Global)) and name in node.names)
    ]


def _removes_itself(call: ast.Call) -> bool:
    return callee(call) in REMOVAL_HELPERS or (isinstance(call.func, ast.Attribute) and call.func.attr in DRIVER_REMOVALS)


@functools.cache
def _removers() -> frozenset[int]:
    """Every application function whose own body removes a document, or calls by a name `resolve_callee` follows one that does."""

    removing: set[int] = set()
    calling: dict[int, set[int]] = {}
    for path in sorted(APP_ROOT.rglob("*.py")):
        for chain, call in scoped_calls(parsed(path), ()):
            if not chain:
                continue
            if _removes_itself(call):
                removing.add(id(chain[-1]))
            elif (resolved := resolve_callee(call, chain, path)) is not None:
                calling.setdefault(id(chain[-1]), set()).add(id(resolved[0]))

    while grown := {holder for holder, called in calling.items() if holder not in removing and called & removing}:
        removing |= grown

    return frozenset(removing)


def _may_remove_from(node: ast.AST, collection: str, chain: tuple[Declaration, ...], path: Path) -> bool:
    """A driver removal on `collection`, a call reaching any removal, or an unresolved call handed `collection`.

    Judged by what a function reaches, not what it is handed: a closure removes from a collection never passed to it.
    """

    if not isinstance(node, ast.Call):
        return False
    if isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name) and node.func.value.id == collection:
        return node.func.attr in DRIVER_REMOVALS
    if (resolved := resolve_callee(node, chain, path)) is not None:
        return id(resolved[0]) in _removers()

    return any(isinstance(value, ast.Name) and value.id == collection for value in [*node.args, *(keyword.value for keyword in node.keywords)])


def _cannot_miss(call: ast.Call, chain: tuple[Declaration, ...], path: Path) -> bool:
    """A write filtered on `{"_id": row["_id"]}` alone, `row` read from that collection in the same transaction.

    A rival's delete after that read costs a write conflict and a retry of the whole callback, never
    a write matching nothing.
    """

    holder = chain[-1]
    db_filter = _keyword(call, "db_filter")
    session = _keyword(call, "session")
    written_to = _keyword(call, "collection")
    if not (
        callee(call) in WRITE_HELPERS
        and isinstance(session, ast.Name)
        and session.id in _transaction_sessions().get(id(holder), ())
        and isinstance(written_to, ast.Name)
        and isinstance(db_filter, ast.Dict)
        and len(db_filter.keys) == 1
        and isinstance(key := db_filter.keys[0], ast.Constant)
        and key.value == ID_KEY
        and isinstance(row := db_filter.values[0], ast.Subscript)
        and isinstance(row.value, ast.Name)
        and isinstance(row.slice, ast.Constant)
        and row.slice.value == ID_KEY
    ):
        return False

    reads = [
        node.value.value if isinstance(node.value, ast.Await) else node.value
        for node in _own_nodes(holder)
        if isinstance(node, ast.Assign) and [ast.unparse(target) for target in node.targets] == [row.value.id]
    ]
    # Bound once in the callback's own scope, by the read: a parameter, or a second binding, holds a row no read here decided.
    if len(_bindings(row.value.id, holder)) != 1 or len(reads) != 1 or not isinstance(read := reads[0], ast.Call):
        return False

    # The collection read is the collection written, one name at both calls that the callback never rebinds,
    # and the callback removes nothing from it: its own delete is no rival's, and sends nothing round.
    if callee(read) == "find_one" and isinstance(read.func, ast.Attribute):
        read_from = read.func.value
    elif callee(read) == "pull_one_from_db":
        read_from = _keyword(read, "collection")
    else:
        return False
    read_session = _keyword(read, "session")

    return (
        isinstance(read_from, ast.Name)
        and read_from.id == written_to.id
        and not [binding for binding in _bindings(written_to.id, holder) if not isinstance(binding, ast.arg)]
        and not any(_may_remove_from(node, written_to.id, chain, path) for node in _own_nodes(holder))
        and isinstance(read_session, ast.Name)
        and read_session.id == session.id
    )


def _in_a_handler_naming_it(node: ast.AST, parents: dict[int, ast.AST]) -> bool:
    parent = parents.get(id(node))
    while parent is not None:
        if isinstance(parent, ast.ExceptHandler):
            return _names_the_exception(parent)
        parent = parents.get(id(parent))

    return False


@functools.cache
def _routes() -> tuple[Any, ...]:
    return tuple(api_routes(create_app(build_test_config())))


def _operations(route: Any) -> Iterator[str]:
    return (f"{method} {route.path_format}" for method in sorted(route.methods or ()))


def _reaching_operations() -> set[str]:
    return {
        operation
        for route in _routes()
        if _can_raise(module_of(route.endpoint), declared(route.endpoint).lineno)
        for operation in _operations(route)
    }


def _declaring_operations() -> set[str]:
    return {
        operation
        for route in _routes()
        for status, response in route.responses.items()
        if str(status) == NOT_FOUND and DOCUMENT_NOT_FOUND in refused_codes(response)
        for operation in _operations(route)
    }


def test_a_route_declares_its_404_exactly_where_it_can_raise_the_miss():
    """Both ways: a declaration nothing raises publishes a code that cannot occur, and a raise with none hides one that can."""

    reaching = _reaching_operations()
    declaring = _declaring_operations()

    assert sorted(reaching - declaring) == [], "these can raise `DB-COMMON-001` and declare no 404 for it"
    assert sorted(declaring - reaching) == [], "these declare a 404 for `DB-COMMON-001` and raise it nowhere"
    assert len(reaching) >= DECLARING_OPERATIONS_FLOOR


def test_every_raise_of_the_miss_is_one_the_trace_reads():
    """Raised by name, so the trace sees it: a raise of an alias or of a value built elsewhere would reach no declaration."""

    raises = [
        f"{path.relative_to(BACKEND_ROOT).as_posix()}:{node.lineno}"
        for path in sorted(APP_ROOT.rglob("*.py"))
        for node in ast.walk(parsed(path))
        if isinstance(node, ast.Raise) and node.exc is not None and EXCEPTION in ast.unparse(node.exc) and not _raises_here(node)
    ]

    assert raises == []


# Two functions calling each other, the second raising the miss only where the variant says so.
MUTUAL_CALLS = "def first():\n    return second()\n\n\ndef second():\n    {body}\n    return first()\n"


@pytest.mark.parametrize(("body", "raises"), [("pass", False), (f"raise {EXCEPTION}()", True)])
def test_a_cycle_of_calls_is_followed_once_and_still_reaches_a_raise(tmp_path: Path, body: str, raises: bool):
    """Mutual recursion terminates, and a raise on the far side of the cycle is still reached from either end."""

    module = tmp_path / "mutual.py"
    module.write_bytes(MUTUAL_CALLS.format(body=body).encode())
    first, second = (node for node in parsed(module).body if isinstance(node, ast.FunctionDef))

    assert _can_raise(module, first.lineno) is raises
    assert _can_raise(module, second.lineno) is raises


# `holder` names a raising helper one way per variant: `helper` raises here, `pull_one_from_db` in the application.
NAMED_HELPER = f"""\
from app.core import crud


def helper():
    raise {EXCEPTION}()


def compares(run):
    return run is None


def calls(run):
    return run()


def holder():
    {{body}}
"""


@pytest.mark.parametrize(
    ("body", "raises"),
    [
        ("helper()", True),
        ("fetch = helper\n    return fetch()", True),
        ("return crud.pull_one_from_db", True),
        ("return calls(helper)", True),
        ("return compares(helper)", False),
        ("return None", False),
    ],
)
def test_a_raising_helper_is_reached_however_it_is_named(tmp_path: Path, body: str, raises: bool):
    """Held as a value, read off its module or handed on, it may be called; a function only compared is not."""

    module = tmp_path / "named.py"
    module.write_bytes(NAMED_HELPER.format(body=body).encode())
    holder = next(node for node in parsed(module).body if isinstance(node, ast.FunctionDef) and node.name == "holder")

    assert _can_raise(module, holder.lineno) is raises
