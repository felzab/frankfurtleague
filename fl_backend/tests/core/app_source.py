"""
CORE · the application's own source, read as syntax or as the routes it mounts, for the sweeps holding a convention across every module

Every sweep over the whole of `app/` is cached for the run and answers a value no caller can change:
each parametrised case asks again, and every caller is handed the one shared object, so a list one
caller reshaped would be the next caller's answer.

Invariants:
- Nothing inside a test process changes the file set under `app/` or rebinds `APP_ROOT`, or a
  cached sweep answers the first tree.
- Nothing edits `application()`'s app -- an override, a route, an exception handler, a middleware,
  its `state`, the document `app.openapi()` hands out -- or every module reading it later in the
  process meets the edit.
"""

import ast
import functools
import inspect
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute, iter_route_contexts
from starlette.routing import Host, Mount

from app.core.collections import Collection
from app.main import create_app
from tests.config import build_test_config

BACKEND_ROOT = Path(__file__).resolve().parents[2]
APP_ROOT = BACKEND_ROOT / "app"

Declaration = ast.FunctionDef | ast.AsyncFunctionDef

# `app/core/crud.py`'s two removals, and so every way a document leaves this database.
REMOVAL_HELPERS = frozenset({"delete_many_from_db", "erase_many_from_db"})

# The operators leaving a field BOUNDED. `$ne` and `$not` are out, each being satisfied by almost
# every row carrying the key, and `$exists` because it is satisfied by exactly all of them.
BOUNDED_COMPARISONS = frozenset({"$lt", "$lte", "$gt", "$gte", "$in", "$eq"})

# `app/core/crud.py`'s writing half: a call to one of these is where a document changes.
WRITE_HELPERS = frozenset(
    {
        "anchor_by_id_in_db",
        "anchor_in_db",
        "insert_live",
        "patch_many_in_db",
        "patch_one_in_db",
        "post_many_to_db",
        "post_one_to_db",
        "set_inactive_since",
    }
)

# The driver's own writes, on a collection a module holds rather than through `app/core/crud.py`.
DRIVER_WRITES = frozenset(
    {
        "bulk_write",
        "delete_many",
        "delete_one",
        "find_one_and_delete",
        "find_one_and_replace",
        "find_one_and_update",
        "insert_many",
        "insert_one",
        "replace_one",
        "update_many",
        "update_one",
    }
)

# How a removal's `collection=` argument spells the collection it runs on, every router declaring
# its dependencies this way.
COLLECTION_ARGUMENT_SUFFIX = "_collection"


@functools.cache
def parsed(file: Path) -> ast.Module:
    """Cached across the sweeps that read it, several of which read the same file."""

    return ast.parse(file.read_text(encoding="utf-8"))


def module_of(function: Callable[..., Any]) -> Path:
    """The file declaring `function`, resolved through the import so a module that moves needs no path written here."""

    return Path(inspect.getsourcefile(function) or "")


def declared(function: Callable[..., Any]) -> ast.FunctionDef | ast.AsyncFunctionDef:
    """One imported function as its own source declares it, which is what lets a check read the code rather than the object."""

    found = [
        node
        for node in ast.walk(parsed(module_of(function)))
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == function.__name__
    ]

    assert len(found) == 1, f"{function.__name__} is declared {len(found)} times, so a sweep over its body proves nothing"

    return found[0]


def callee(call: ast.Call) -> str:
    """The name at a call site: the attribute where a driver method is called on a collection, the bare name for a helper."""

    if isinstance(call.func, ast.Attribute):
        return call.func.attr

    return call.func.id if isinstance(call.func, ast.Name) else ""


def carries_session(call: ast.Call) -> bool:
    """Whether one call site joins the transaction around it -- the keyword whose absence reads or commits outside it.

    A literal `None` counts as absent: a deliberate escape is a helper's parameter, never a `None` spelled at the read.
    """

    return any(
        keyword.arg == "session" and not (isinstance(keyword.value, ast.Constant) and keyword.value.value is None) for keyword in call.keywords
    )


def scoped_calls(node: ast.AST, chain: tuple[Declaration, ...]) -> Iterator[tuple[tuple[Declaration, ...], ast.Call]]:
    """The whole chain rather than the innermost scope: a bare name at a call site resolves against every scope around it."""

    for child in ast.iter_child_nodes(node):
        if isinstance(child, ast.Call):
            yield chain, child

        inner = (*chain, child) if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)) else chain
        yield from scoped_calls(child, inner)


def calls_in(node: ast.AST, scope: str) -> Iterator[tuple[str, ast.Call]]:
    """Every call under `node`, each paired with the innermost function around it, so a nested helper answers for its own."""

    for chain, call in scoped_calls(node, ()):
        yield (chain[-1].name if chain else scope), call


@functools.cache
def app_calls() -> tuple[tuple[str, str, ast.Call], ...]:
    """Every call the application makes, with the module and the function around it."""

    return tuple(
        (path.relative_to(BACKEND_ROOT).as_posix(), scope, call)
        for path in sorted(APP_ROOT.rglob("*.py"))
        for scope, call in calls_in(parsed(path), "<module>")
    )


def dict_keys(node: ast.AST) -> frozenset[str]:
    """Every key a literal names, at any depth, so a field nested under `$and` is seen too."""

    return frozenset(
        key.value
        for found in ast.walk(node)
        if isinstance(found, ast.Dict)
        for key in found.keys
        if isinstance(key, ast.Constant) and isinstance(key.value, str)
    )


def bounds_its_field(value: ast.expr) -> bool:
    """Whether one filter entry's value BOUNDS its key: a plain value, or a dict of `BOUNDED_COMPARISONS` alone.

    The dict arm exists because activation is not sequential, so a sweep keyed on equality strands
    every ban whose own season nobody activated.
    """

    if not isinstance(value, ast.Dict):
        return True

    operators = [key.value for key in value.keys if isinstance(key, ast.Constant) and isinstance(key.value, str)]

    # Length-checked against the dict's own keys, so a `**` spread -- which parses as a `None` key --
    # cannot pass as an operator set this reader never saw.
    return bool(operators) and len(operators) == len(value.keys) and set(operators) <= BOUNDED_COMPARISONS


@dataclass(frozen=True)
class Removal:
    """One removal the application makes, read off its own call site."""

    helper: str
    collection: str
    #: The INNERMOST function around the call, so a removal moved into a nested helper is attributed
    #: there rather than to the callback holding it.
    scope: str
    #: The filter's top-level keys that `bounds_its_field` accepts. A key left to `$exists` or to an
    #: unbounded operator names the field and bounds nothing, so it is not among these.
    keyed_on: frozenset[str]
    #: Every key the filter names at any depth, operators included.
    names: frozenset[str]


@functools.cache
def removals() -> tuple[Removal, ...]:
    """Every removal the application makes.

    Both arguments LITERAL, which is every removal here: one composed into a variable is refused
    outright rather than skipped, a sweep that quietly sees less being the failure this file is for.
    """

    found: list[Removal] = []
    for module, scope, call in app_calls():
        if callee(call) not in REMOVAL_HELPERS:
            continue

        arguments = {keyword.arg: keyword.value for keyword in call.keywords}
        where = f"{module} :: {scope}"

        collection = arguments.get("collection")
        assert isinstance(collection, ast.Name), f"{where}: a removal names its collection with no plain argument, so nothing can place it"

        named = collection.id.removesuffix(COLLECTION_ARGUMENT_SUFFIX)
        assert named in {str(member) for member in Collection}, f"{where}: `{collection.id}` is no collection this database holds"

        db_filter = arguments.get("db_filter")
        assert isinstance(db_filter, ast.Dict), f"{where}: a removal composes its filter elsewhere, so nothing here can say what bounds it"

        found.append(
            Removal(
                helper=callee(call),
                collection=named,
                scope=scope,
                keyed_on=frozenset(
                    key.value
                    for key, value in zip(db_filter.keys, db_filter.values, strict=True)
                    if isinstance(key, ast.Constant) and isinstance(key.value, str) and bounds_its_field(value)
                ),
                names=dict_keys(db_filter),
            )
        )

    return tuple(found)


# The driver call that runs a whole callback in one transaction. Every transaction in the
# application is opened this way, and the writes sit in the callback rather than under it.
TRANSACTION_RUNNER = "with_transaction"

# Where `app/core/transactions.py :: JudgedSession` hands the driver its wrapper of each callback.
FORWARDING_RUNNER = ("app/core/transactions.py", "with_transaction")


@dataclass(frozen=True)
class TransactionalCallback:
    """One `with_transaction` callback, and the writes made anywhere inside it, each with whether it carries the session."""

    where: str
    writes: tuple[tuple[str, bool], ...]


@functools.cache
def _callbacks() -> tuple[tuple[Path, str, tuple[Declaration, ...], Declaration], ...]:
    """One finder for every sweep reading a transaction's callbacks, so none can quietly stop seeing a callback another still reads."""

    found: list[tuple[Path, str, tuple[Declaration, ...], Declaration]] = []
    for path in sorted(APP_ROOT.rglob("*.py")):
        module = path.relative_to(BACKEND_ROOT).as_posix()
        tree = parsed(path)

        for outer, call in scoped_calls(tree, ()):
            if callee(call) != TRANSACTION_RUNNER:
                continue

            # The helper's own run of every caller's callback inside the actor's judge: each callback
            # it is handed is found where its caller hands it, and this one writes nothing of its own.
            if module == FORWARDING_RUNNER[0] and outer and outer[-1].name == FORWARDING_RUNNER[1]:
                continue

            handed = call.args[0].id if call.args and isinstance(call.args[0], ast.Name) else ""

            # Resolved per callback rather than by indexing the module: `__init__` repeats across
            # classes, and a name that is not handed to a transaction is nothing to this sweep.
            found_names = [node for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == handed]
            assert len(found_names) == 1, (
                f"{module}: `{TRANSACTION_RUNNER}` is handed `{handed}`, which resolves to {len(found_names)} functions"
            )

            found.append((path, module, outer, found_names[0]))

    return tuple(found)


@functools.cache
def transactional_callbacks(session_taking: frozenset[str]) -> tuple[TransactionalCallback, ...]:
    """Every callback the application runs inside a transaction.

    Its own LEXICAL body: a helper declared inside it answers here, while one it calls at module
    level does not.
    """

    found: list[TransactionalCallback] = []
    for _, module, _, callback in _callbacks():
        # Every depth, not the top scope alone: a write moved into a helper declared inside the
        # callback still runs in the transaction, and attributing it there takes it out of this
        # sweep's view.
        own = [inner for _, inner in calls_in(callback, callback.name)]

        found.append(
            TransactionalCallback(
                where=f"{module} :: {callback.name}",
                writes=tuple((callee(inner), carries_session(inner)) for inner in own if callee(inner) in session_taking),
            )
        )

    return tuple(found)


def _declared_directly_in(scope: ast.Module | Declaration) -> dict[str, Declaration]:
    """Every function one scope's own body declares, by name."""

    return {node.name: node for node in scope.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}


def _bound_to_a_value_in(scope: ast.Module | Declaration) -> frozenset[str]:
    """Every name one scope binds to a value rather than to a declaration.

    A call on one of these reaches whatever its caller passed, and following that would take a call
    graph: `app/api/bewerbungen/zustellung_router.py :: _apply` takes its predicate as `judge`.
    """

    parameters = {argument.arg for argument in _parameters_of(scope)}
    assigned = {target.id for node in scope.body if isinstance(node, ast.Assign) for target in node.targets if isinstance(target, ast.Name)} | {
        node.target.id for node in scope.body if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name)
    }

    return frozenset(parameters | assigned)


def _parameters_of(scope: ast.Module | Declaration) -> list[ast.arg]:
    """Every parameter one scope declares, a module declaring none."""

    if isinstance(scope, ast.Module):
        return []

    arguments = scope.args

    return [
        argument
        for argument in [*arguments.posonlyargs, *arguments.args, *arguments.kwonlyargs, arguments.vararg, arguments.kwarg]
        if argument is not None
    ]


@functools.cache
def _imports_by_name(tree: ast.Module) -> dict[str, tuple[str, str]]:
    """Each name a module's `from` imports bind, to its source module and name.

    Once a tree: the traces resolve thousands of callees, and a walk per lookup costs nearly all
    their time. The first binding in walk order wins.
    """

    bound: dict[str, tuple[str, str]] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            for alias in node.names:
                bound.setdefault(alias.asname or alias.name, (node.module or "", alias.name))

    return bound


def _imported_declaration(name: str, tree: ast.Module) -> tuple[Declaration, Path] | None:
    """One name's declaration where the module imports it from `app/`, or `None` where nothing under `app/` declares it."""

    imported = _imports_by_name(tree).get(name)
    if imported is None:
        return None

    dotted, original = imported
    if not dotted.startswith("app."):
        return None

    candidate = BACKEND_ROOT.joinpath(*dotted.split("."))
    origin = candidate.with_suffix(".py") if candidate.with_suffix(".py").exists() else candidate / "__init__.py"
    found = _declared_directly_in(parsed(origin)).get(original) if origin.exists() else None

    return (found, origin) if found is not None else None


def resolve_callee(call: ast.Call, chain: tuple[Declaration, ...], module: Path) -> tuple[Declaration, Path] | None:
    """LEXICALLY, because a name is not unique here.

    Read by name, `judge` reaches the session-taking one in `app/api/spiele/admin_router.py` at a call
    to the figure-taking one nested in the season patch.
    """

    return resolve_name(call.func.id, chain, module) if isinstance(call.func, ast.Name) else None


def resolve_name(name: str, chain: tuple[Declaration, ...], module: Path) -> tuple[Declaration, Path] | None:
    """The declaration a bare name read inside `chain` stands for, as `resolve_callee` reads a call's."""

    for scope in reversed(chain):
        found = _declared_directly_in(scope).get(name)
        if found is not None:
            return found, module

        if name in _bound_to_a_value_in(scope):
            return None

    tree = parsed(module)
    found = _declared_directly_in(tree).get(name)

    return (found, module) if found is not None else _imported_declaration(name, tree)


def _dotted(node: ast.expr) -> list[str] | None:
    if isinstance(node, ast.Name):
        return [node.id]
    if not isinstance(node, ast.Attribute):
        return None

    inner = _dotted(node.value)

    return None if inner is None else [*inner, node.attr]


def scoped_references(node: ast.AST, chain: tuple[Declaration, ...]) -> Iterator[tuple[tuple[Declaration, ...], ast.Name | ast.Attribute]]:
    """Every name and attribute read under `node`, with every function around it, as `scoped_calls` pairs a call."""

    for child in ast.iter_child_nodes(node):
        if isinstance(child, (ast.Name, ast.Attribute)):
            yield chain, child

        inner = (*chain, child) if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)) else chain
        yield from scoped_references(child, inner)


def _scoped_async_withs(node: ast.AST, chain: tuple[Declaration, ...]) -> Iterator[tuple[tuple[Declaration, ...], ast.AsyncWith]]:
    for child in ast.iter_child_nodes(node):
        if isinstance(child, ast.AsyncWith):
            yield chain, child

        inner = (*chain, child) if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)) else chain
        yield from _scoped_async_withs(child, inner)


@functools.cache
def application() -> FastAPI:
    """One build a process for every module reading what the application mounts.

    Every xdist worker imports every module at collection, the tier's `-m` filtering only after, so a
    build per module is paid by each worker for each module.
    """

    return create_app(build_test_config())


def dependency_calls(dependant: Dependant) -> Iterator[Callable[..., Any]]:
    """Every dependency an operation runs, a dependency's own among them."""

    for dependency in dependant.dependencies:
        if dependency.call is not None:
            yield dependency.call
        yield from dependency_calls(dependency)


def api_routes(app: FastAPI) -> Iterator[APIRoute]:
    """Every route the application serves, nested includes opened.

    Read and never edited: each is the object its module-level router holds, which every `create_app`
    in a process shares.
    """

    for context in iter_route_contexts(app.routes):
        # A mounted application's routes are opened by nothing here, so every sweep reading this would
        # pass over them: refused rather than skipped.
        if isinstance(context.original_route, (Mount, Host)):
            raise AssertionError(f"{context.original_route!r} mounts routes no sweep reading `api_routes` sees")
        if isinstance(context.original_route, APIRoute):
            yield context.original_route
