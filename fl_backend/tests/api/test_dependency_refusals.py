"""
TESTS · the refusals a dependency answers before any handler, probed on every operation

`app/main.py :: DEPENDENCY_REFUSALS` publishes each dependency's code on the operations running it,
so the table is held against what a request actually meets: every operation is asked without a key,
with a wrong one, with its own and no actor, and with its own and an actor, against an application
holding no database, where each dependency answers before the handler runs.
"""

import ast
import functools
import re
from collections.abc import Iterator, Mapping
from http import HTTPStatus
from typing import Any

from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.core.exceptions import DatabaseUnavailableException, MalformedRequestException, RequestAuthorizationException
from app.core.security import ACTOR_HEADER, verify_access_admin, verify_access_base, verify_access_system
from app.main import DEPENDENCY_REFUSALS, create_app, dependency_refusals
from tests.config import ADMIN_AUTH, BASE_AUTH, SYSTEM_AUTH, build_test_config
from tests.core.app_source import APP_ROOT, BACKEND_ROOT, api_routes, declared, module_of, parsed

APP = create_app(build_test_config())

TIER_KEYS: Mapping[Any, Mapping[str, str]] = {verify_access_base: BASE_AUTH, verify_access_admin: ADMIN_AUTH, verify_access_system: SYSTEM_AUTH}
WRONG_KEY = {"Authorization": "Bearer wrong"}
ACTOR = {ACTOR_HEADER: "admin@example.com"}

# What a path parameter is filled with: an id the `objectid` convertor matches, and a word for anything else.
_PARAMETER = re.compile(r"\{(\w+)(?::(\w+))?\}")
AN_OBJECT_ID = "0" * 23 + "1"

# Spelled here rather than read off the table, which a status moved in it alone would move too. A
# bodiless probe meets no other 400, 401 or 503: an absent body is a 422, and the handler never runs.
PROBED_STATUSES = frozenset({HTTPStatus.BAD_REQUEST, HTTPStatus.UNAUTHORIZED, HTTPStatus.SERVICE_UNAVAILABLE})

# The operations a dependency refused on the tree this was written against, so an equality over two
# maps that both went empty still fails.
PROBED_OPERATIONS_FLOOR = 100

# Raised by these alone: a raise of either anywhere else answers a code the table never publishes.
PROTOCOL_EXCEPTIONS = frozenset(
    {RequestAuthorizationException.__name__, MalformedRequestException.__name__, DatabaseUnavailableException.__name__}
)


def _url(route: APIRoute) -> str:
    return _PARAMETER.sub(lambda match: AN_OBJECT_ID if match[2] == "objectid" else "x", route.path)


def _guard_key(route: APIRoute) -> Mapping[str, str]:
    guards = {dependency.call for dependency in route.dependant.dependencies} & TIER_KEYS.keys()

    return TIER_KEYS[next(iter(guards))] if len(guards) == 1 else {}


@functools.cache
def _observed() -> dict[tuple[str, str], set[tuple[HTTPStatus, str]]]:
    client = TestClient(APP, raise_server_exceptions=False)
    found: dict[tuple[str, str], set[tuple[HTTPStatus, str]]] = {}
    for route in api_routes(APP):
        if not route.include_in_schema:
            continue
        own = _guard_key(route)
        for method in sorted(route.methods or ()):
            answers = found.setdefault((route.path_format, method.lower()), set())
            for headers in ({}, WRONG_KEY, own, {**own, **ACTOR}):
                response = client.request(method, _url(route), headers=headers)
                if response.status_code in PROBED_STATUSES:
                    answers.add((HTTPStatus(response.status_code), response.json()["error_code"]))

    return found


def _derived() -> dict[tuple[str, str], set[tuple[HTTPStatus, str]]]:
    return {
        operation: {(status, code) for status, codes in refusals.items() for code in codes}
        for operation, refusals in dependency_refusals(APP).items()
    }


def test_every_refusal_a_request_meets_is_one_the_table_publishes_on_its_operation():
    observed = _observed()
    derived = _derived()

    assert {
        operation: answers - derived.get(operation, set()) for operation, answers in observed.items() if answers - derived.get(operation, set())
    } == {}


def test_every_refusal_the_table_publishes_is_met_by_a_request():
    """The other way: a code published on an operation no request meets is a response that cannot occur."""

    observed = _observed()
    derived = _derived()

    assert {
        operation: codes - observed.get(operation, set()) for operation, codes in derived.items() if codes - observed.get(operation, set())
    } == {}
    assert len(derived) >= PROBED_OPERATIONS_FLOOR


def _own_nodes(node: ast.AST) -> Iterator[ast.AST]:
    """Every node inside `node` and outside any function it declares, which answers for its own."""

    for child in ast.iter_child_nodes(node):
        if not isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
            yield child
            yield from _own_nodes(child)


def test_every_raise_of_a_protocol_refusal_sits_in_a_dependency_the_table_names_or_in_a_handler_declaring_it():
    """Read off every raise under `app/`, a population the table never feeds."""

    answering = {(module_of(dependency), declared(dependency).name) for dependency in DEPENDENCY_REFUSALS} | {
        (module_of(route.endpoint), route.endpoint.__name__) for route in api_routes(APP) if route.responses
    }

    stray = [
        f"{path.relative_to(BACKEND_ROOT).as_posix()}:{node.lineno}"
        for path in sorted(APP_ROOT.rglob("*.py"))
        for function in ast.walk(parsed(path))
        if isinstance(function, (ast.FunctionDef, ast.AsyncFunctionDef)) and (path, function.name) not in answering
        for node in _own_nodes(function)
        if isinstance(node, ast.Raise)
        and isinstance(node.exc, ast.Call)
        and isinstance(node.exc.func, ast.Name)
        and node.exc.func.id in PROTOCOL_EXCEPTIONS
    ]

    assert stray == []
