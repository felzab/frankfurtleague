"""
TESTS · the refusals a dependency answers before any handler, probed on every operation

`app/main.py :: DEPENDENCY_REFUSALS` publishes each dependency's code on the operations running it,
so the table is held against what a request actually meets: every operation is asked without a key,
with a wrong one, with its own and no actor, with its own and an administrator, with its own and an
actor who is none, with its own and a forged actor, and with its own and an administrator signed in
past the enrolment window, against an application holding no database, where each dependency
answers before the handler runs.
"""

import ast
import functools
import re
from collections.abc import Iterator, Mapping
from http import HTTPStatus
from typing import Any

from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.core.exceptions import BaseAPIException, DocumentNotFoundException, WriteRefusalException
from app.core.security import ACTOR_HEADER, verify_access_admin, verify_access_base, verify_access_system
from app.main import DEPENDENCY_REFUSALS, create_app, dependency_refusals
from app.shared.schemas.bounds import ENROLMENT_WINDOW_MINUTES
from tests.actor_tokens import FOREIGN_SIGNING_KEY, SignedActor, actor_claims, sign
from tests.config import ADMIN_KEY, BASE_AUTH, SYSTEM_AUTH, build_test_config
from tests.core.app_source import APP_ROOT, BACKEND_ROOT, api_routes, declared, module_of, parsed
from tests.grants import admit

# Its actor check answered without a database, so a request naming a non-administrator meets its
# refusal there rather than the missing database behind it.
APP = admit(create_app(build_test_config()))

TIER_KEYS: Mapping[Any, Mapping[str, str]] = {verify_access_base: BASE_AUTH, verify_access_admin: ADMIN_KEY, verify_access_system: SYSTEM_AUTH}
WRONG_KEY = {"Authorization": "Bearer wrong"}
ACTOR = SignedActor("admin@example.com")
# Verified and holding none of the grants `APP` answers from.
NOT_AN_ADMINISTRATOR = SignedActor("schueler@example.com")
# Shaped like a token and signed under a key nobody configured, so it fails verification.
FORGED_ACTOR = {ACTOR_HEADER: sign(actor_claims("admin@example.com"), private_key=FOREIGN_SIGNING_KEY)}


class _StaleActor(Mapping[str, str]):
    """An administrator whose passkey sign-in is past the enrolment window and inside the administrator's, signed when read."""

    def __getitem__(self, name: str) -> str:
        claims = actor_claims("admin@example.com")
        return sign({**claims, "auth_time": claims["iat"] - ENROLMENT_WINDOW_MINUTES * 60 - 1}) if name == ACTOR_HEADER else {}[name]

    def __iter__(self) -> Iterator[str]:
        return iter((ACTOR_HEADER,))

    def __len__(self) -> int:
        return 1


STALE_ACTOR = _StaleActor()

# What a path parameter is filled with: an id the `objectid` convertor matches, and a word for anything else.
_PARAMETER = re.compile(r"\{(\w+)(?::(\w+))?\}")
AN_OBJECT_ID = "0" * 23 + "1"

# Spelled here rather than read off the table, which a status moved in it alone would move too. A
# bodiless probe meets no other 400, 401, 403 or 503: an absent body is a 422, and the handler never runs.
PROBED_STATUSES = frozenset({HTTPStatus.BAD_REQUEST, HTTPStatus.UNAUTHORIZED, HTTPStatus.FORBIDDEN, HTTPStatus.SERVICE_UNAVAILABLE})

# The operations a dependency refused on the tree this was written against, so an equality over two
# maps that both went empty still fails.
PROBED_OPERATIONS_FLOOR = 100

# The two refusal classes whose codes reach the document by another route, each held there.
PUBLISHED_ELSEWHERE: Mapping[type[BaseAPIException], str] = {
    WriteRefusalException: "a rule's code, published from `RULES` (`tests/core/test_rule_publication.py`)",
    DocumentNotFoundException: "a miss, published by its handler's `responses=` (`tests/core/test_not_found_publication.py`)",
}


def _subclasses(cls: type) -> Iterator[type]:
    for subclass in cls.__subclasses__():
        yield subclass
        yield from _subclasses(subclass)


# Derived, so a refusal class added anywhere the application imports is swept until it is named above:
# a raise of one outside the table's dependencies answers a code the table never publishes.
PROTOCOL_EXCEPTIONS = frozenset(cls.__name__ for cls in _subclasses(BaseAPIException) if cls not in PUBLISHED_ELSEWHERE)


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
            actors = (ACTOR, NOT_AN_ADMINISTRATOR, FORGED_ACTOR, STALE_ACTOR)
            for headers in ({}, WRONG_KEY, own, *({**own, **actor} for actor in actors)):
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


def _raised_in(function: Any) -> set[str]:
    return {
        node.exc.func.id
        for node in ast.walk(declared(function))
        if isinstance(node, ast.Raise) and isinstance(node.exc, ast.Call) and isinstance(node.exc.func, ast.Name)
    }


def test_the_derived_refusal_classes_hold_every_class_the_tables_dependencies_raise():
    """Read off the dependencies' own raises, a second route to the set: a derivation that went empty would sweep nothing, green."""

    raised = set().union(*(_raised_in(dependency) for dependency in DEPENDENCY_REFUSALS))

    assert raised, "no raise is read off the table's dependencies, so the clause below is vacuous"
    assert raised <= PROTOCOL_EXCEPTIONS


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
