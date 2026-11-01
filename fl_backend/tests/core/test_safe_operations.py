"""
CORE · a POST that writes nothing says so in the published contract, and no other POST does

The frontend sends an operation the document marks safe as a read (`fl_frontend/orval.config.ts :: transportOf`), so
a write marked safe clears no cached read and drains no mail, with nothing failing. Read from each operation's
source: the handler, every dependency it runs and every function of the application their calls reach, each callee
resolved through the globals and closure of the function calling it. A class called or named in a call reaches every
method it defines, and every branch counts, so a read reaching a write on any arm is refused.

What the walk cannot see:
- a call on an object whose class no reached call names, a callee held in a collection and called through a local
  (`app/api/identitaet/crud.py :: LOESCHUNG_STEPS`), a module-level function handed to another by name and never
  called by it, or one reached through `getattr` or a string;
- a branch on a parameter: the fixture save's `dry_run` writes nothing on one arm of a write, which its
  `x-safe-when` states and the save's execution tests hold;
- a write the driver is handed as a raw `command`, which nothing in the application sends.
"""

import ast
import functools
import inspect
import textwrap
from collections.abc import Callable, Iterator
from pathlib import Path
from types import FunctionType, MethodType, ModuleType
from typing import Any

import pytest
from fastapi.routing import APIRoute

import app
from app.core.routing import SAFE, SAFE_WHEN
from tests.core.app_source import api_routes, application, dependency_calls

# The driver's write methods (https://pymongo.readthedocs.io/en/stable/api/pymongo/asynchronous/collection.html), named
# by attribute whatever object holds them, so a write is seen however its collection reached the function.
DRIVER_WRITES = frozenset(
    {
        "insert_one",
        "insert_many",
        "replace_one",
        "update_one",
        "update_many",
        "delete_one",
        "delete_many",
        "find_one_and_delete",
        "find_one_and_replace",
        "find_one_and_update",
        "bulk_write",
        "drop",
        "rename",
    }
)

# The aggregation stages writing their output to a collection.
WRITING_STAGES = frozenset({"$out", "$merge"})

APP_ROOT = Path(app.__file__).parent

(SAFE_KEY,) = SAFE
(SAFE_WHEN_KEY,) = SAFE_WHEN


def _is_ours(item: object) -> bool:
    return (getattr(item, "__module__", None) or "").startswith("app.")


def _functions_of(item: object) -> Iterator[FunctionType]:
    """The application's own functions behind a reference: a function, a bound method, a partial, a class's methods."""

    if isinstance(item, functools.partial):
        yield from _functions_of(item.func)
    elif isinstance(item, MethodType):
        yield from _functions_of(item.__func__)
    elif isinstance(item, (staticmethod, classmethod)):
        yield from _functions_of(item.__func__)
    elif isinstance(item, property):
        for accessor in (item.fget, item.fset, item.fdel):
            yield from _functions_of(accessor)
    elif isinstance(item, FunctionType):
        unwrapped = inspect.unwrap(item)
        # A file of the application's own, which leaves out a method a library generates for one of its classes, a
        # dataclass's `__init__` or a model's, whose source is a string and which writes nothing.
        if isinstance(unwrapped, FunctionType) and Path(unwrapped.__code__.co_filename).is_relative_to(APP_ROOT):
            yield unwrapped
    elif isinstance(item, type):
        if _is_ours(item):
            for member in vars(item).values():
                # Its callables alone: a member that is an instance of the class itself, an enum's, would lead back.
                if not isinstance(member, item):
                    yield from _functions_of(member)
    elif _is_ours(type(item)) and not isinstance(item, ModuleType):
        # An instance, such as a dependency object: its class's methods are what a call on it runs.
        yield from _functions_of(type(item))


@functools.cache
def _syntax(function: FunctionType) -> ast.AST:
    return ast.parse(textwrap.dedent(inspect.getsource(function)))


def _names_in_scope(function: FunctionType) -> dict[str, Any]:
    closure = dict(zip(function.__code__.co_freevars, (cell.cell_contents for cell in function.__closure__ or ()), strict=True))
    return {**function.__globals__, **closure}


def _resolved(node: ast.expr, scope: dict[str, Any]) -> object | None:
    """What a name or a dotted attribute chain refers to, where its root is a global or a closure; else `None`."""

    if isinstance(node, ast.Name):
        return scope.get(node.id)
    if isinstance(node, ast.Attribute):
        owner = _resolved(node.value, scope)
        return None if owner is None else getattr(owner, node.attr, None)
    return None


def _writes_in(function: FunctionType) -> Iterator[str]:
    """Each driver write or writing stage in one function's own source, where it stands."""

    for node in ast.walk(_syntax(function)):
        if isinstance(node, ast.Attribute) and node.attr in DRIVER_WRITES:
            yield f"{function.__module__}.{function.__qualname__} calls `{node.attr}`"
        elif isinstance(node, ast.Constant) and node.value in WRITING_STAGES:
            yield f"{function.__module__}.{function.__qualname__} names `{node.value}`"


def _called(function: FunctionType) -> Iterator[FunctionType]:
    """What one function's calls run, its nested functions' and lambdas' among them.

    Calls alone, never every name: the erasure preview names each erasure step to ask whether its scope runs it
    (`app/api/identitaet/crud.py :: _runs`), and following that name would call the preview a write.
    """

    scope = _names_in_scope(function)
    for node in ast.walk(_syntax(function)):
        if isinstance(node, ast.Call):
            callee = _resolved(node.func, scope)
            if callee is not None:
                yield from _functions_of(callee)


def writes_reached(roots: list[Callable[..., Any]]) -> list[str]:
    """Every write the roots reach through the application's own source."""

    seen: set[FunctionType] = set()
    pending = [function for root in roots for function in _functions_of(root)]
    writes: list[str] = []
    while pending:
        function = pending.pop()
        if function in seen:
            continue
        seen.add(function)
        writes.extend(_writes_in(function))
        pending.extend(_called(function))

    return sorted(writes)


DOCUMENT = application().openapi()

POST_ROUTES = sorted(
    (route for route in api_routes(application()) if route.include_in_schema and "POST" in (route.methods or ())),
    key=lambda route: route.path,
)


def _operation(route: APIRoute) -> dict[str, Any]:
    return DOCUMENT["paths"][route.path_format]["post"]


def _roots(route: APIRoute) -> list[Callable[..., Any]]:
    return [route.endpoint, *dependency_calls(route.dependant)]


@pytest.mark.parametrize("route", POST_ROUTES, ids=lambda route: route.path)
def test_a_post_is_marked_safe_exactly_where_it_reaches_no_write(route: APIRoute):
    """Both ways: a write marked safe misses the cache clear, and a read left unmarked clears it on every call."""

    writes = writes_reached(_roots(route))
    marked = _operation(route).get(SAFE_KEY) is True

    if marked:
        assert writes == [], f"POST {route.path} is marked safe and writes: {writes}"
    else:
        assert writes != [], f"POST {route.path} reaches no write, so the document must mark it `{SAFE_KEY}`"


def test_the_marks_stand_only_where_the_frontend_reads_them():
    """Each mark where the generated client can act on it.

    `x-safe` on a POST alone, since every other method's safety is its own, and `x-safe-when` naming a boolean query
    parameter the operation takes, which the client reads off the URL it sends.
    """

    for path, operations in DOCUMENT["paths"].items():
        for method, operation in operations.items():
            if SAFE_KEY in operation:
                assert (method, operation[SAFE_KEY]) == ("post", True), f"{method.upper()} {path} marks `{SAFE_KEY}`"
            if SAFE_WHEN_KEY in operation:
                parameter = operation[SAFE_WHEN_KEY]
                kinds = {(each["in"], each["schema"].get("type")) for each in operation.get("parameters", []) if each["name"] == parameter}
                assert kinds == {("query", "boolean")}, f"{method.upper()} {path} is safe when `{parameter}`, which is no boolean query"
