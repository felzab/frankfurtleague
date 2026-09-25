"""
TESTS · where a route can answer `DB-COMMON-001`, traced from each route's own source

Traced rather than declared in a table, as `tests/core/test_duplicate_key_publication.py` traces the
duplicate key: each handler is followed through the application's own functions to a `raise` of
`DocumentNotFoundException`, and a call inside a `try` whose handler absorbs that exception reaches
nothing. A handler holding a bare `raise` hands the exception on, so it absorbs nothing.
"""

import ast
import functools
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from app.core.exception_handlers import refused_codes
from app.core.exceptions import DOCUMENT_NOT_FOUND, DocumentNotFoundException
from app.main import create_app
from tests.config import build_test_config
from tests.core.app_source import APP_ROOT, BACKEND_ROOT, Declaration, api_routes, declared, module_of, parsed, resolve_callee, scoped_calls

NOT_FOUND = "404"
EXCEPTION = DocumentNotFoundException.__name__

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


@functools.cache
def _can_raise(path: Path, lineno: int) -> bool:
    declaration = next(
        node
        for node in ast.walk(parsed(path))
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.lineno == lineno
    )
    parents = _parents(declaration)

    for node in ast.walk(declaration):
        if _raises_here(node) and (node.exc is not None or _in_a_handler_naming_it(node, parents)) and not _caught(node, parents):
            return True

    for chain, call in scoped_calls(declaration, (declaration,)):
        resolved = resolve_callee(call, chain, path)
        if resolved is None or _caught(call, parents):
            continue
        target, target_path = resolved
        # A function calling itself, directly or through another, adds no raise it does not hold already.
        if (target_path, target.lineno) == (path, lineno):
            continue
        if _can_raise(target_path, target.lineno):
            return True

    return False


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
