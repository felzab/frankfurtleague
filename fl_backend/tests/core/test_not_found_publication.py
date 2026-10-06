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
    WRITE_HELPERS,
    Declaration,
    api_routes,
    callee,
    declared,
    handed_callbacks,
    module_of,
    parsed,
    resolve_callee,
    scoped_calls,
    session_handoffs,
    session_parameters,
)

NOT_FOUND = "404"
EXCEPTION = DocumentNotFoundException.__name__
ID_KEY = "_id"

# The operations the trace reached a raise from on the tree this was written against, so an equality
# over two sets that both went empty still fails.
DECLARING_OPERATIONS_FLOOR = 40


def _parents(declaration: Declaration) -> dict[int, ast.AST]:
    return {id(child): node for node in ast.walk(declaration) for child in ast.iter_child_nodes(node)}


def _names_the_exception(handler: ast.ExceptHandler) -> bool:
    caught = handler.type
    names = caught.elts if isinstance(caught, ast.Tuple) else [caught] if caught is not None else []

    return any(isinstance(name, ast.Name) and name.id == EXCEPTION for name in names)


def _absorbs(handler: ast.ExceptHandler) -> bool:
    """A handler catching the exception and never handing it on."""

    return _names_the_exception(handler) and not any(isinstance(node, ast.Raise) and node.exc is None for node in ast.walk(handler))


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
    """Whether one declaration raises the miss in its own body unabsorbed, and the declarations its uncaught calls reach."""

    declaration = next(
        node for node in ast.walk(parsed(path)) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.lineno == lineno
    )
    parents = _parents(declaration)

    raises = any(
        (node.exc is not None or _in_a_handler_naming_it(node, parents)) and not _caught(node, parents)
        for node in ast.walk(declaration)
        if isinstance(node, ast.Raise) and _raises_here(node)
    )
    reached: list[Site] = []
    for chain, call in scoped_calls(declaration, (declaration,)):
        resolved = resolve_callee(call, chain, path)
        if resolved is None or _caught(call, parents) or _cannot_miss(call, chain[-1]):
            continue
        target, target_path = resolved
        reached.append((target_path, target.lineno))

    return raises, tuple(reached)


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


def _cannot_miss(call: ast.Call, holder: Declaration) -> bool:
    """A write filtered on `{"_id": row["_id"]}` alone, `row` read from that collection in the same transaction.

    A rival's delete after that read costs a write conflict and a retry of the whole callback, never
    a write matching nothing.
    """

    db_filter = _keyword(call, "db_filter")
    session = _keyword(call, "session")
    if not (
        callee(call) in WRITE_HELPERS
        and isinstance(session, ast.Name)
        and session.id in _transaction_sessions().get(id(holder), ())
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

    bindings = [
        node for node in ast.walk(holder) if isinstance(node, ast.Name) and node.id == row.value.id and not isinstance(node.ctx, ast.Load)
    ]
    reads = [
        node.value.value if isinstance(node.value, ast.Await) else node.value
        for node in ast.walk(holder)
        if isinstance(node, ast.Assign) and [ast.unparse(target) for target in node.targets] == [row.value.id]
    ]
    if len(bindings) != 1 or len(reads) != 1 or not isinstance(read := reads[0], ast.Call):
        return False

    # The collection read is the collection written, spelled the same at both calls.
    if callee(read) == "find_one" and isinstance(read.func, ast.Attribute):
        read_from = read.func.value
    elif callee(read) == "pull_one_from_db":
        read_from = _keyword(read, "collection")
    else:
        return False
    read_session = _keyword(read, "session")
    written_to = _keyword(call, "collection")

    return (
        read_from is not None
        and written_to is not None
        and ast.unparse(read_from) == ast.unparse(written_to)
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
