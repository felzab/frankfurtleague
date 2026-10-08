"""
TESTS · the refusals a dependency answers before any handler, probed on every operation

`app/main.py :: DEPENDENCY_REFUSALS` publishes each dependency's code on the operations running it,
so the table is held against what a request actually meets: every operation is asked without a key,
with a wrong one, with its own and no actor, with its own and an administrator, with its own and an
actor who is none, with its own and a forged actor, with its own and an administrator signed in
past the step-up window, and with its own and a signed-in person, barred and not, against an
application holding no database, where each dependency answers before the handler runs.
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
from typing import Any

from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.core.exception_handlers import refused_codes
from app.core.exceptions import BaseAPIException, DocumentNotFoundException, WriteRefusalException
from app.core.security import (
    ACTOR_HEADER,
    STEP_UP_WINDOW_S,
    BanLookup,
    get_ban_lookup,
    verify_access_admin,
    verify_access_base,
    verify_access_system,
)
from app.main import DEPENDENCY_REFUSALS, RefusalDriver, create_app, dependency_refusals
from tests.actor_tokens import FOREIGN_SIGNING_KEY, SignedActor, actor_claims, sign
from tests.config import ADMIN_KEY, BASE_AUTH, SYSTEM_AUTH, build_test_config
from tests.core.app_source import APP_ROOT, BACKEND_ROOT, api_routes, declared, module_of, parsed
from tests.grants import admit

# Barred on the list `APP` answers a person's ban check from.
BARRED_PERSON = "gesperrt@beispielschule.de"


def _ban_answered_from_the_set(app: FastAPI) -> FastAPI:
    """`app`, a person route's ban read answered from `BARRED_PERSON` alone, as `tests/grants.py :: admit` answers the grants."""

    def answered_from_the_set() -> BanLookup:
        async def is_gesperrt(identifier: str) -> bool:
            return identifier == BARRED_PERSON

        return is_gesperrt

    app.dependency_overrides[get_ban_lookup] = answered_from_the_set

    return app


# Its actor check and a person's ban check answered without a database, so a request naming a
# non-administrator or a barred person meets its refusal there rather than the missing database behind it.
APP = _ban_answered_from_the_set(admit(create_app(build_test_config())))

TIER_KEYS: Mapping[Any, Mapping[str, str]] = {verify_access_base: BASE_AUTH, verify_access_admin: ADMIN_KEY, verify_access_system: SYSTEM_AUTH}
WRONG_KEY = {"Authorization": "Bearer wrong"}
ACTOR = SignedActor("admin@example.com")
# Verified and holding none of the grants `APP` answers from.
NOT_AN_ADMINISTRATOR = SignedActor("schueler@example.com")
# Shaped like a token and signed under a key nobody configured, so it fails verification.
FORGED_ACTOR = {ACTOR_HEADER: sign(actor_claims("admin@example.com"), private_key=FOREIGN_SIGNING_KEY)}
# The person lane's two: one the ban list holds, and one it does not, who passes to the missing database.
A_PERSON = SignedActor("schueler@example.com", lane="person")
A_BARRED_PERSON = SignedActor(BARRED_PERSON, lane="person")


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
    ): "the driver's `DuplicateKeyError`, published where a write can meet a unique index (`tests/core/test_duplicate_key_publication.py`)",
    (
        "app/core/concurrency.py",
        "gather_cancelling",
        "first",
    ): "whatever one of its caller's reads raised, re-raised as itself",
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
    #: The status and code a refusal built from values the module itself holds answers; `None` where
    #: an argument is a value only the running call has.
    answers: tuple[HTTPStatus, str] | None


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


_UNRESOLVED = object()


def _module_value(expression: ast.expr, table: symtable.SymbolTable, module: ModuleType) -> Any:
    """A literal, or a dotted name rooted in one global of the module; `_UNRESOLVED` for a value only the running scope holds."""

    if isinstance(expression, ast.Constant):
        return expression.value

    attributes: list[str] = []
    while isinstance(expression, ast.Attribute):
        attributes.append(expression.attr)
        expression = expression.value

    if not isinstance(expression, ast.Name) or not table.lookup(expression.id).is_global():
        return _UNRESOLVED

    target = vars(module)[expression.id] if expression.id in vars(module) else getattr(builtins, expression.id, _UNRESOLVED)
    for attribute in reversed(attributes):
        target = getattr(target, attribute, _UNRESOLVED)

    return target


def _table_of(table: symtable.SymbolTable, declaration: ast.FunctionDef | ast.AsyncFunctionDef) -> symtable.SymbolTable | None:
    """The declaration's own table wherever in the module it is nested."""

    for child in table.get_children():
        if child.get_name() == declaration.name and child.get_lineno() == declaration.lineno:
            return _scope_table(table, declaration)
        if (found := _table_of(child, declaration)) is not None:
            return found

    return None


def _returned_class(factory: Any) -> type[BaseException] | None:
    """The one class a factory's own `return` statements build, each read as a raise is, or `None`.

    Never its annotation, which pyright lets name a supertype: a refusal factory annotated
    `-> Exception` would raise a code nothing here holds.
    """

    path = module_of(factory)
    declaration = declared(factory)
    table = _table_of(symtable.symtable(path.read_text(encoding="utf-8"), str(path), "exec"), declaration)
    assert table is not None, f"no symbol table for `{declaration.name}`, so what it returns cannot be resolved"

    module = importlib.import_module(factory.__module__)
    built = {_raised_class(node.value, table, module) for node in _own_nodes(declaration) if isinstance(node, ast.Return)}

    return next(iter(built)) if len(built) == 1 else None


def _raised_class(exc: ast.expr | None, table: symtable.SymbolTable, module: ModuleType) -> type[BaseException] | None:
    """Read only where the callee's root name is global in its scope: a local or a closure's name is a value nothing here can follow."""

    if not isinstance(exc, ast.Call):
        return None

    target = _module_value(exc.func, table, module)
    if inspect.isfunction(target):
        return _returned_class(target)

    return target if isinstance(target, type) and issubclass(target, BaseException) else None


def _answers(
    exc: ast.expr | None, raised: type[BaseException] | None, table: symtable.SymbolTable, module: ModuleType
) -> tuple[HTTPStatus, str] | None:
    """The refusal built again from the raise's own arguments, where the module holds every one of them, and what it answers."""

    if (
        not isinstance(exc, ast.Call)
        or raised is None
        or not issubclass(raised, BaseAPIException)
        or not isinstance(_module_value(exc.func, table, module), type)
    ):
        return None

    arguments = [_module_value(argument, table, module) for argument in exc.args]
    keywords = {keyword.arg: _module_value(keyword.value, table, module) for keyword in exc.keywords if keyword.arg is not None}
    if _UNRESOLVED in arguments or _UNRESOLVED in keywords.values() or len(keywords) < len(exc.keywords):
        return None

    try:
        refusal = raised(*arguments, **keywords)
    except TypeError:
        return None

    return HTTPStatus(refusal.status_code), refusal.error_code


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
                raised = _raised_class(child.exc, table, module)
                found.append(_Raise(node=child, scope=scope, raised=raised, answers=_answers(child.exc, raised, table, module)))
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
            actors = (ACTOR, NOT_AN_ADMINISTRATOR, FORGED_ACTOR, STALE_ACTOR, A_PERSON, A_BARRED_PERSON)
            for headers in ({}, WRONG_KEY, own, *({**own, **actor} for actor in actors)):
                response = client.request(method, _url(route), headers=headers)
                if response.status_code in PROBED_STATUSES:
                    answers.add((HTTPStatus(response.status_code), response.json()["error_code"]))

    return found


def _derived(*drivers: RefusalDriver) -> dict[tuple[str, str], set[tuple[HTTPStatus, str]]]:
    return {
        operation: {(status, code) for status, codes in refusals.items() for code in codes}
        for operation, refusals in (dependency_refusals(APP, frozenset(drivers)) if drivers else dependency_refusals(APP)).items()
    }


def test_every_refusal_a_request_meets_is_one_the_table_publishes_on_its_operation():
    observed = _observed()
    derived = _derived()

    assert {
        operation: answers - derived.get(operation, set()) for operation, answers in observed.items() if answers - derived.get(operation, set())
    } == {}


def test_every_refusal_the_table_publishes_is_met_by_a_request():
    """The other way: a code published on an operation no request meets is a response that cannot occur.

    The probed entries alone: every other driver's refusal is met past the database these probes are refused at.
    """

    observed = _observed()
    derived = _derived(RefusalDriver.PROBE)

    assert {
        operation: codes - observed.get(operation, set()) for operation, codes in derived.items() if codes - observed.get(operation, set())
    } == {}
    assert len(derived) >= PROBED_OPERATIONS_FLOOR


STEP_UP_EXECUTION = Path(__file__).with_name("test_step_up_execution.py")

_HTTP_METHODS = frozenset({"get", "post", "put", "patch", "delete"})


def _template_pattern(template: ast.expr) -> re.Pattern[str] | None:
    """A class's `URL`, each interpolated value standing for one path segment's worth of characters."""

    parts = template.values if isinstance(template, ast.JoinedStr) else [template]
    pattern = ""
    for part in parts:
        if isinstance(part, ast.Constant) and isinstance(part.value, str):
            pattern += re.escape(part.value)
        elif isinstance(part, ast.FormattedValue):
            pattern += "[^/]+"
        else:
            return None

    return re.compile(pattern)


def _sent_past_the_step_up_window(node: ast.AST) -> ast.Call | None:
    """The request `node` sends to its class's `URL` from a sign-in past the step-up window, awaited or not."""

    call = node.value if isinstance(node, ast.Await) else node
    if (
        isinstance(call, ast.Call)
        and isinstance(call.func, ast.Attribute)
        and ast.unparse(call.func.value) == "http"
        and call.func.attr in _HTTP_METHODS
        and [ast.unparse(argument) for argument in call.args[:1]] == ["self.URL"]
        and any(keyword.arg == "headers" and ast.unparse(keyword.value) == "OLDER" for keyword in call.keywords)
    ):
        return call

    return None


_FUNCTIONS = (ast.FunctionDef, ast.AsyncFunctionDef)

# What else decides whether pytest collects a `Test` class, besides a decorator or a base: its
# `Class.collect`, read at release 9.1.1.
_COLLECTION_SWITCHES = frozenset({"__init__", "__new__", "__test__"})


def _bound_in(body: list[ast.stmt]) -> set[str]:
    targets = [target for statement in body if isinstance(statement, ast.Assign) for target in statement.targets]
    targets += [statement.target for statement in body if isinstance(statement, ast.AnnAssign)]

    return {statement.name for statement in body if isinstance(statement, _FUNCTIONS)} | {
        target.id for target in targets if isinstance(target, ast.Name)
    }


def _collected(body: list[ast.stmt]) -> Iterator[tuple[ast.ClassDef, list[ast.FunctionDef | ast.AsyncFunctionDef]]]:
    """Each class pytest collects from `body`, nested ones included, with the test methods it collects from that class.

    A class whose collection anything but its name decides fails here rather than being counted.
    """

    for suite in body:
        if not (isinstance(suite, ast.ClassDef) and suite.name.startswith("Test")):
            continue
        assert not (suite.bases or suite.keywords or _bound_in(suite.body) & _COLLECTION_SWITCHES), (
            f"{suite.name}'s collection is decided by more than its name, which this reader does not follow"
        )
        assert all(ast.unparse(decorator).startswith("pytest.mark.") for decorator in suite.decorator_list), (
            f"{suite.name} carries a decorator other than a mark, which may give it the constructor pytest skips a class for"
        )
        yield (
            suite,
            [
                method
                for method in suite.body
                if isinstance(method, _FUNCTIONS)
                and method.name.startswith("test")
                # pytest collects no fixture as a test, whatever its name.
                and not any("fixture" in ast.unparse(decorator) for decorator in method.decorator_list)
            ],
        )
        yield from _collected(suite.body)


def _refused_past_the_step_up_window(tests: list[ast.FunctionDef | ast.AsyncFunctionDef]) -> Iterator[ast.Call]:
    """Each such request whose answer `tests` hand to `refused`.

    A request merely sent counts nothing: the class's cases taking the older sign-in send one too, so
    an operation whose refusal case is gone would still read as driven.
    """

    for function in (node for test in tests for node in ast.walk(test)):
        if not isinstance(function, _FUNCTIONS):
            continue
        own = list(_own_nodes(function))
        bound = {
            statement.targets[0].id: request
            for statement in own
            if isinstance(statement, ast.Assign)
            and len(statement.targets) == 1
            and isinstance(statement.targets[0], ast.Name)
            and (request := _sent_past_the_step_up_window(statement.value)) is not None
        }
        for call in own:
            if isinstance(call, ast.Call) and ast.unparse(call.func) == "refused" and call.args:
                answer = call.args[0]
                request = bound.get(answer.id) if isinstance(answer, ast.Name) else _sent_past_the_step_up_window(answer)
                if request is not None:
                    yield request


def _driven_past_the_step_up_window() -> set[tuple[str, str]]:
    """Each operation the execution suite asserts refused from a sign-in past the step-up window, read off its source.

    Read rather than listed, so a class leaving the suite takes its operation out of the set.
    """

    served = [(route.path_format, method.lower()) for route in api_routes(APP) for method in route.methods or ()]
    driven: set[tuple[str, str]] = set()
    for suite, tests in _collected(ast.parse(STEP_UP_EXECUTION.read_bytes()).body):
        urls = [
            _template_pattern(statement.value)
            for statement in suite.body
            if isinstance(statement, ast.Assign) and [ast.unparse(target) for target in statement.targets] == ["URL"]
        ]
        for call in _refused_past_the_step_up_window(tests):
            assert isinstance(call.func, ast.Attribute)
            assert len(urls) == 1 and urls[0] is not None, f"{suite.name} names no URL this reader can match"
            matched = [(path, method) for path, method in served if method == call.func.attr and urls[0].fullmatch(path)]
            assert len(matched) == 1, f"{suite.name}'s {call.func.attr} matches {matched}, not one served operation"
            driven.add(matched[0])

    return driven


def test_the_execution_suite_drives_exactly_the_operations_a_handler_judged_refusal_is_published_on():
    """A handler taking the step-up check and never calling it still publishes the check's 401, which then cannot occur.

    `test_every_refusal_the_table_publishes_is_met_by_a_request` leaves these operations to that suite.
    """

    published = set(dependency_refusals(APP, {RefusalDriver.STEP_UP}))

    assert published, "no operation publishes a handler-judged refusal, so the comparison below is vacuous"
    assert _driven_past_the_step_up_window() == published


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


def test_every_refusal_a_handler_raises_is_one_its_responses_publish():
    """The case above admits a handler declaring any response, so each refusal its body raises is held to its own status and code.

    A code no value of the module holds cannot be compared, and fails as one published nowhere.
    """

    held = 0
    unpublished: list[str] = []
    for route in api_routes(APP):
        if not route.responses:
            continue
        path = module_of(route.endpoint)
        inside = {id(node) for node in ast.walk(declared(route.endpoint))}
        published = {(HTTPStatus(int(status)), code) for status, response in route.responses.items() for code in refused_codes(response)}
        for found in _raises(path):
            if id(found.node) in inside and found.raised is not None and _is_protocol_refusal(found.raised):
                held += 1
                if found.answers not in published:
                    unpublished.append(f"{path.relative_to(BACKEND_ROOT).as_posix()}:{found.node.lineno} answers {found.answers}")

    assert held, "no handler raises a refusal of its own, so the clause below is vacuous"
    assert unpublished == []


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
