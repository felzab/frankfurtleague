"""
TESTS · the refusals a dependency answers before any handler, probed on every operation

`app/main.py :: DEPENDENCY_REFUSALS` publishes each dependency's code on the operations running it,
so the table is held against what a request actually meets: every operation is asked without a key,
with a wrong one, with its own and no actor, with its own and an administrator, with its own and an
actor who is none, with its own and a forged actor, and with its own and an administrator signed in
past the step-up window, against an application holding no database, where each dependency
answers before the handler runs.
"""

import ast
import builtins
import functools
import importlib
import inspect
import re
import symtable
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from http import HTTPStatus
from pathlib import Path
from types import ModuleType
from typing import Any, get_type_hints

from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.core.exceptions import BaseAPIException, DocumentNotFoundException, WriteRefusalException
from app.core.security import ACTOR_HEADER, STEP_UP_WINDOW_S, verify_access_admin, verify_access_base, verify_access_system
from app.main import DEPENDENCY_REFUSALS, create_app, dependency_refusals
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
    """An administrator whose passkey sign-in is past the step-up window, the wider of two, inside the administrator's; signed when read."""

    def __getitem__(self, name: str) -> str:
        claims = actor_claims("admin@example.com")
        return sign({**claims, "auth_time": claims["iat"] - STEP_UP_WINDOW_S - 1}) if name == ACTOR_HEADER else {}[name]

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


# The raises under `app/` with no class to read off them, each answering no request a refusal code
# would reach. Keyed on the raised expression's text, so a respelled one is read again, not excused.
UNREAD_RAISES: Mapping[tuple[str, str, str], str] = {
    (
        "app/core/constraints.py",
        "_apply_concurrently",
        "min(failures, key=lambda failure: failure[0])[1]",
    ): "the first-declared lane's own failure, re-raised while the application boots",
    (
        "app/core/crud.py",
        "post_many_to_db",
        "refusal",
    ): "the driver's `DuplicateKeyError`, published by collection (`tests/core/test_duplicate_key_publication.py`)",
}


def _is_protocol_refusal(raised: type[BaseException]) -> bool:
    """A subclass test rather than a list: a refusal class is swept wherever it is declared, until `PUBLISHED_ELSEWHERE` names it."""

    return issubclass(raised, BaseAPIException) and raised not in PUBLISHED_ELSEWHERE


@dataclass(frozen=True)
class _Raise:
    node: ast.Raise
    #: The innermost function or class around the raise, `<module>` outside every one.
    scope: str
    #: The class the raise instantiates, resolved through the module's own namespace; `None` for a
    #: bare re-raise and for anything no class can be read off.
    raised: type[BaseException] | None


def _module_at(path: Path) -> ModuleType:
    parts = path.relative_to(BACKEND_ROOT).with_suffix("").parts

    return importlib.import_module(".".join(parts[:-1] if parts[-1] == "__init__" else parts))


def _scope_table(table: symtable.SymbolTable, declaration: ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef) -> symtable.SymbolTable:
    """The declaration's own table, through the type-parameter scope a generic one is nested in."""

    for child in table.get_children():
        if child.get_name() == declaration.name and child.get_lineno() == declaration.lineno:
            if child.get_type() is symtable.SymbolTableType.TYPE_PARAMETERS:
                return _scope_table(child, declaration)
            return child

    raise AssertionError(f"no symbol table for `{declaration.name}`, so the names its raises spell cannot be resolved")


def _raised_class(exc: ast.expr | None, table: symtable.SymbolTable, module: ModuleType) -> type[BaseException] | None:
    """Read only where the callee's root name is global in its scope: a local or a closure's name is a value nothing here can follow."""

    if not isinstance(exc, ast.Call):
        return None

    attributes: list[str] = []
    callee = exc.func
    while isinstance(callee, ast.Attribute):
        attributes.append(callee.attr)
        callee = callee.value

    if not isinstance(callee, ast.Name) or not table.lookup(callee.id).is_global():
        return None

    target = vars(module)[callee.id] if callee.id in vars(module) else getattr(builtins, callee.id, None)
    for attribute in reversed(attributes):
        target = getattr(target, attribute, None)

    # A factory answers for the class its return annotation names, which pyright holds its body to.
    if inspect.isfunction(target):
        target = get_type_hints(target).get("return")

    return target if isinstance(target, type) and issubclass(target, BaseException) else None


@functools.cache
def _raises(path: Path) -> tuple[_Raise, ...]:
    # Imported only where there is a raise to resolve: `app/asgi.py` builds the application from the
    # environment as it is imported, and holds none.
    if not any(isinstance(node, ast.Raise) for node in ast.walk(parsed(path))):
        return ()

    module = _module_at(path)
    found: list[_Raise] = []

    def visit(node: ast.AST, scope: str, table: symtable.SymbolTable) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                visit(child, child.name, _scope_table(table, child))
                continue
            if isinstance(child, ast.Raise):
                found.append(_Raise(node=child, scope=scope, raised=_raised_class(child.exc, table, module)))
            visit(child, scope, table)

    visit(parsed(path), "<module>", symtable.symtable(path.read_text(encoding="utf-8"), str(path), "exec"))

    return tuple(found)


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


def _raised_in(function: Any) -> set[type[BaseException]]:
    inside = {id(node) for node in ast.walk(declared(function))}

    return {found.raised for found in _raises(module_of(function)) if id(found.node) in inside and found.raised is not None}


def test_the_derived_refusal_classes_hold_every_class_the_tables_dependencies_raise():
    """Read off the dependencies' own raises, a second route to the set: a derivation that went empty would sweep nothing, green."""

    raised = set().union(*(_raised_in(dependency) for dependency in DEPENDENCY_REFUSALS))

    assert raised, "no raise is read off the table's dependencies, so the clause below is vacuous"
    assert all(_is_protocol_refusal(cls) for cls in raised), raised


def test_every_raise_of_a_protocol_refusal_sits_in_a_dependency_the_table_names_or_in_a_handler_declaring_it():
    """Read off every raise under `app/`, a population the table never feeds."""

    answering = {(module_of(dependency), declared(dependency).name) for dependency in DEPENDENCY_REFUSALS} | {
        (module_of(route.endpoint), route.endpoint.__name__) for route in api_routes(APP) if route.responses
    }

    # A handler's transaction callback is the handler's own path: a refusal it raises aborts the
    # transaction and answers at the status the handler declares.
    callbacks = {
        id(nested)
        for path in sorted(APP_ROOT.rglob("*.py"))
        for function in ast.walk(parsed(path))
        if isinstance(function, (ast.FunctionDef, ast.AsyncFunctionDef)) and (path, function.name) in answering
        for nested in ast.walk(function)
        if nested is not function and isinstance(nested, (ast.FunctionDef, ast.AsyncFunctionDef))
    }

    refusals = {
        id(found.node)
        for path in sorted(APP_ROOT.rglob("*.py"))
        for found in _raises(path)
        if found.raised and _is_protocol_refusal(found.raised)
    }

    stray = [
        f"{path.relative_to(BACKEND_ROOT).as_posix()}:{node.lineno}"
        for path in sorted(APP_ROOT.rglob("*.py"))
        for function in ast.walk(parsed(path))
        if isinstance(function, (ast.FunctionDef, ast.AsyncFunctionDef))
        and (path, function.name) not in answering
        and id(function) not in callbacks
        for node in _own_nodes(function)
        if isinstance(node, ast.Raise) and id(node) in refusals
    ]

    assert stray == []


def test_every_raise_under_app_names_the_class_it_raises():
    """A raise with no class to read would pass the sweep above unseen.

    A pre-built refusal raised by its variable, or one raised through a local alias, answers a code nothing publishes.
    """

    unread = {
        (path.relative_to(BACKEND_ROOT).as_posix(), found.scope, ast.unparse(found.node.exc)): found.node.lineno
        for path in sorted(APP_ROOT.rglob("*.py"))
        for found in _raises(path)
        if found.node.exc is not None and found.raised is None
    }

    assert {site: line for site, line in unread.items() if site not in UNREAD_RAISES} == {}
    assert UNREAD_RAISES.keys() <= unread.keys(), "an exemption names a raise the tree no longer holds"
