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
import copy
import dataclasses
import functools
import inspect
import operator
import re
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.routing import APIRoute, iter_route_contexts
from starlette.routing import BaseRoute, Host, Mount

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
    {"anchor_in_db", "insert_live", "patch_many_in_db", "patch_one_in_db", "post_many_to_db", "post_one_to_db", "set_inactive_since"}
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

# `app/core/crud.py`'s reading half: a call to one of these is where the application learns what it
# then judges against.
READ_HELPERS = frozenset({"aggregate_many_from_db", "pull_many_from_db", "pull_one_from_db"})

# The driver's own reads. Routers call these directly where a helper's contract does not fit -- a
# miss that is no 404, a count nothing needs the documents for -- so a sweep reading only the names
# above would pass over most of what a transaction judges.
DRIVER_READS = frozenset({"aggregate", "count_documents", "distinct", "find", "find_one"})

# How a removal's `collection=` argument spells the collection it runs on, every router declaring
# its dependencies this way.
COLLECTION_ARGUMENT_SUFFIX = "_collection"

# A session parameter is recognised by its ANNOTATION and never by its name: `figures_session` and
# `status_session` are sessions, and a `session` on something else is not one.
SESSION_TYPE_MODULE = "pymongo.asynchronous.client_session"

# An omitted argument leaves the callee's own default, which is outside the transaction exactly as a
# `None` spelled at the call is -- so it is reported rather than passed over.
NOTHING_BOUND = "<nothing>"

# A `**` spread may or may not carry the session, so such a call fails the clause over these rather
# than dropping out of the sweep.
SPREAD_AT_THE_CALL = "<spread at the call>"

# The clause in `app/core/crud.py`'s header naming the driver's own reads. Anchored on the prose
# around it rather than on every backtick in the header, which would also take `None` and
# `DocumentNotFoundException` from the paragraph above it.
CRUD_HEADER_READ_CLAUSE = re.compile(r"several routers call\s+(?P<names>.+?)\s+directly", re.DOTALL)


@functools.cache
def parsed(file: Path) -> ast.Module:
    """Cached across the sweeps that read it, several of which read the same file."""

    return ast.parse(file.read_text(encoding="utf-8"))


def driver_reads_named_by_the_crud_header() -> frozenset[str]:
    """Every read `app/core/crud.py`'s header claims a router makes directly, taken from its prose rather than from the code it describes."""

    header = ast.get_docstring(parsed(APP_ROOT / "core" / "crud.py"))
    assert header is not None, "`app/core/crud.py` carries no module header, so its claim about the driver's reads is gone"

    clause = CRUD_HEADER_READ_CLAUSE.search(header)
    assert clause is not None, "`app/core/crud.py`'s header no longer names the driver's reads where `CRUD_HEADER_READ_CLAUSE` looks"

    return frozenset(re.findall(r"`([^`]+)`", clause["names"]))


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


def crud_helpers_taking_a_session() -> frozenset[str]:
    """Every `app/core/crud.py` helper whose own signature takes a `session`, read off that signature.

    What holds the three name sets above complete: a helper none of them names is a call site every
    sweep here passes over in silence.
    """

    return frozenset(
        node.name
        for node in parsed(APP_ROOT / "core" / "crud.py").body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        if any(argument.arg == "session" for argument in [*node.args.args, *node.args.kwonlyargs])
    )


@functools.cache
def app_declares() -> frozenset[str]:
    """Every function the application declares, by name.

    What separates a call handing the session to a helper of the application's own -- which answers
    for its reads under its own declaration -- from one this file has no word for.
    """

    return frozenset(
        node.name
        for path in sorted(APP_ROOT.rglob("*.py"))
        for node in ast.walk(parsed(path))
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    )


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


def reads_the_database(call: ast.Call) -> bool:
    """Whether one call site reads this database.

    A helper answers by name alone. A driver read answers only where the receiver is a
    `*_collection` dependency, `find` being a method name anything at all may carry.
    """

    if callee(call) in READ_HELPERS:
        return True

    return (
        callee(call) in DRIVER_READS
        and isinstance(call.func, ast.Attribute)
        and isinstance(call.func.value, ast.Name)
        and call.func.value.id.endswith(COLLECTION_ARGUMENT_SUFFIX)
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


def unfollowed_references(names: frozenset[str], *, skip: frozenset[Path] = frozenset()) -> list[str]:
    """Every reference under `app/` to `names` that `resolve_callee` cannot follow: anything but a call's bare callee.

    Whole modules, since an alias held outside every traced function is one such reference too.
    """

    found: list[str] = []
    for path in sorted(APP_ROOT.rglob("*.py")):
        if path in skip:
            continue

        tree = parsed(path)
        followed = {id(node.func) for node in ast.walk(tree) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)}
        for node in ast.walk(tree):
            name = node.id if isinstance(node, ast.Name) else node.attr if isinstance(node, ast.Attribute) else None
            if name in names and id(node) not in followed:
                found.append(f"{path.relative_to(BACKEND_ROOT).as_posix()}:{getattr(node, 'lineno', 0)} `{ast.unparse(node)}`")

    return found


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

# What a callback's docstring says of the reads its judgement rests on. The promise a reader is
# given, so it is the promise a sweep has to be able to reach.
IN_SESSION_PROMISE = "in-session"


@dataclass(frozen=True)
class TransactionalCallback:
    """One `with_transaction` callback, and the reads and writes made anywhere inside it, each with whether it carries the session."""

    where: str
    writes: tuple[tuple[str, bool], ...]
    reads: tuple[tuple[str, bool], ...]
    #: Whether the docstring claims an in-session judgement. A claim no read here answers for is
    #: the one shape a clause over these can pass while proving nothing.
    promises_in_session: bool
    #: What hands `session=` on and is none of the above: neither read nor write nor a call to a
    #: helper of the application's own, and so a way to the database no set here names.
    unplaced: tuple[str, ...]


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
def handed_callbacks() -> tuple[tuple[Declaration | None, Declaration], ...]:
    """Each callback `_callbacks` finds beside the function handing it over, `None` at module level, both nodes of `parsed`'s trees."""

    return tuple((outer[-1] if outer else None, callback) for _, _, outer, callback in _callbacks())


@functools.cache
def transactional_callbacks(session_taking: frozenset[str]) -> tuple[TransactionalCallback, ...]:
    """Every callback the application runs inside a transaction.

    Its own LEXICAL body: a helper declared inside it answers here, while one it calls at module
    level answers under `session_carriers` below.
    """

    found: list[TransactionalCallback] = []
    for _, module, _, callback in _callbacks():
        # Every depth, not the top scope alone: a read moved into a helper declared inside the
        # callback still runs in the transaction, and attributing it there takes it out of this
        # sweep's view.
        own = [inner for _, inner in calls_in(callback, callback.name)]

        found.append(
            TransactionalCallback(
                where=f"{module} :: {callback.name}",
                writes=tuple((callee(inner), carries_session(inner)) for inner in own if callee(inner) in session_taking),
                reads=tuple((callee(inner), carries_session(inner)) for inner in own if reads_the_database(inner)),
                promises_in_session=IN_SESSION_PROMISE in (ast.get_docstring(callback) or ""),
                unplaced=tuple(
                    callee(inner)
                    for inner in own
                    if carries_session(inner)
                    and callee(inner) not in session_taking
                    and not reads_the_database(inner)
                    # A bare name, so a driver method the sets above do not name can never be
                    # excused by an application function that happens to share its spelling.
                    and not (isinstance(inner.func, ast.Name) and callee(inner) in app_declares())
                ),
            )
        )

    return tuple(found)


@functools.cache
def session_type_names() -> frozenset[str]:
    """Read off what the application imports rather than spelled here, so a driver rename cannot empty the sweeps below."""

    found = frozenset(
        alias.asname or alias.name
        for path in sorted(APP_ROOT.rglob("*.py"))
        for node in ast.walk(parsed(path))
        if isinstance(node, ast.ImportFrom) and node.module == SESSION_TYPE_MODULE
        for alias in node.names
    )

    assert found, f"nothing under `app/` imports from `{SESSION_TYPE_MODULE}`, so every session parameter is invisible to the sweeps below"

    return found


def _is_a_session(argument: ast.arg) -> bool:
    """Whether one parameter is annotated with a session type, a union counting like a bare one."""

    if argument.annotation is None:
        return False

    return bool({node.id for node in ast.walk(argument.annotation) if isinstance(node, ast.Name)} & session_type_names())


def session_parameters(declaration: Declaration) -> tuple[tuple[str, int | None], ...]:
    """Every session parameter one declaration takes, each with the position a caller may bind it at, `None` where it is keyword-only."""

    positional = [*declaration.args.posonlyargs, *declaration.args.args]

    return tuple((argument.arg, index) for index, argument in enumerate(positional) if _is_a_session(argument)) + tuple(
        (argument.arg, None) for argument in declaration.args.kwonlyargs if _is_a_session(argument)
    )


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

    if not isinstance(call.func, ast.Name):
        return None

    name = call.func.id

    for scope in reversed(chain):
        found = _declared_directly_in(scope).get(name)
        if found is not None:
            return found, module

        if name in _bound_to_a_value_in(scope):
            return None

    tree = parsed(module)
    found = _declared_directly_in(tree).get(name)

    return (found, module) if found is not None else _imported_declaration(name, tree)


@dataclass(frozen=True)
class Binding:
    """What one call binds to one parameter."""

    #: The argument as source, or one of the sentinels this module opens with where the call names none.
    argument: str
    #: By POSITION rather than by keyword. The arm a nested helper is reached through, and the one no
    #: other sweep here exercises: `carries_session` reads keywords alone.
    by_position: bool


def bound_at(call: ast.Call, parameter: str, position: int | None) -> Binding:
    """What one call binds to a named parameter.

    The explicit keyword first, then the position, and a `**` spread only where neither answered: read
    ahead of them, a spread would report a call that names the session outright.
    """

    for keyword in call.keywords:
        if keyword.arg == parameter:
            return Binding(argument=ast.unparse(keyword.value), by_position=False)

    if position is not None and len(call.args) > position:
        return Binding(argument=ast.unparse(call.args[position]), by_position=True)

    spread = any(keyword.arg is None for keyword in call.keywords)

    return Binding(argument=SPREAD_AT_THE_CALL if spread else NOTHING_BOUND, by_position=False)


@dataclass(frozen=True)
class SessionHandoff:
    """One call inside a transactional callback that binds a session parameter, and what it binds there."""

    where: str
    #: The name the call resolves to, which is what an exemption over these is keyed on.
    called: str
    parameter: str
    binding: Binding
    #: Whether what is bound is a session parameter of a scope at or inside the callback. A `None`, an
    #: omission and a spread are not, and neither is a session belonging to another transaction.
    in_session: bool
    #: What `session_carriers` follows on from here.
    declaration: Declaration
    declared_in: Path


@functools.cache
def session_handoffs() -> tuple[SessionHandoff, ...]:
    """What `carries_session` cannot judge.

    It reads the keyword a call SPELLS, and a helper handed `None` positionally still spells
    `session=` on every read in its own body.
    """

    found: list[SessionHandoff] = []
    for path, module, outer, callback in _callbacks():
        for chain, call in scoped_calls(callback, (*outer, callback)):
            resolved = resolve_callee(call, chain, path)
            if resolved is None:
                continue

            declaration, declared_in = resolved
            # At or inside the callback, never a scope around it: an endpoint holding a session of its
            # own would be a second transaction, and a judgement read through it is not this one's.
            carried = {parameter for scope in chain[len(outer) :] for parameter, _ in session_parameters(scope)}

            for parameter, position in session_parameters(declaration):
                binding = bound_at(call, parameter, position)
                found.append(
                    SessionHandoff(
                        where=f"{module} :: {callback.name}",
                        called=declaration.name,
                        parameter=parameter,
                        binding=binding,
                        in_session=binding.argument in carried,
                        declaration=declaration,
                        declared_in=declared_in,
                    )
                )

    # Source order, which `tests/core/test_write_shapes.py :: HANDED_OUTSIDE_THE_TRANSACTION` reads:
    # a sort here would make an in-session judgement and the re-judgement after it one pair either
    # way round.
    return tuple(found)


def _reads_the_database_by_name(call: ast.Call) -> bool:
    """The method name alone where `reads_the_database` wants a `*_collection` receiver, which `app/core/crud.py` never has.

    Safe over the set `session_carriers` resolves and nowhere else: a sweep over `app/` would take
    every `find` on a list with it.
    """

    return callee(call) in READ_HELPERS or (callee(call) in DRIVER_READS and isinstance(call.func, ast.Attribute))


@dataclass(frozen=True)
class SessionCarrier:
    """One declaration a transaction reaches by handing its session on, and every read that declaration's own body makes."""

    where: str
    #: The declaration's own name, which is what a derived floor over these compares.
    called: str
    reads: tuple[tuple[str, bool], ...]


@functools.cache
def session_carriers() -> tuple[SessionCarrier, ...]:
    """Every declaration the transaction's session reaches, each hand-off inside one followed on to a fixpoint.

    Where `transactional_callbacks` stops: it reads a callback's own lexical body, so a read a module
    away answers nowhere in it.
    """

    return _carriers_from(
        [(handoff.declaration, handoff.declared_in, handoff.parameter) for handoff in session_handoffs() if handoff.in_session]
    )


def _carriers_from(frontier: list[tuple[Declaration, Path, str]]) -> tuple[SessionCarrier, ...]:
    """Each declaration a session is handed to from `frontier`, followed on through every further hand-off."""

    seen: set[tuple[Path, str, str]] = set()
    found: list[SessionCarrier] = []

    while frontier:
        declaration, path, parameter = frontier.pop()
        if (path, declaration.name, parameter) in seen:
            continue

        seen.add((path, declaration.name, parameter))
        reads: list[tuple[str, bool]] = []

        for chain, call in scoped_calls(declaration, (declaration,)):
            # The parameter this declaration was REACHED through, never its every session parameter:
            # a read on a second one is a session nothing here has followed.
            carried = {parameter} | {name for scope in chain[1:] for name, _ in session_parameters(scope)}

            if _reads_the_database_by_name(call):
                reads.append((callee(call), bound_at(call, "session", None).argument in carried))

            resolved = resolve_callee(call, chain, path)
            if resolved is None:
                continue

            called, called_in = resolved
            frontier += [
                (called, called_in, name) for name, position in session_parameters(called) if bound_at(call, name, position).argument in carried
            ]

        found.append(
            SessionCarrier(
                where=f"{path.relative_to(BACKEND_ROOT).as_posix()} :: {declaration.name}({parameter})",
                called=declaration.name,
                reads=tuple(reads),
            )
        )

    return tuple(sorted(found, key=lambda carrier: carrier.where))


# What opens a session reading one point in time with no transaction: nothing hands it to
# `with_transaction`, so every sweep above passes over the reads inside it.
SNAPSHOT_OPENER = "start_session"


def _opens_a_snapshot(call: ast.Call) -> bool:
    return callee(call) == SNAPSHOT_OPENER and any(
        keyword.arg == "snapshot" and isinstance(keyword.value, ast.Constant) and keyword.value.value is True for keyword in call.keywords
    )


@dataclass(frozen=True)
class SnapshotBlock:
    """One `async with ... start_session(snapshot=True) as <name>:` block, and what its own body reads and hands on."""

    where: str
    #: Every read the body makes, with whether it carries the block's session.
    reads: tuple[tuple[str, bool], ...]
    #: Every session parameter of an application function the body calls, with whether the block's session is what it binds.
    handoffs: tuple[tuple[str, bool], ...]
    #: Where `snapshot_carriers` follows the session on from.
    seeds: tuple[tuple[Declaration, Path, str], ...]


def _scoped_async_withs(node: ast.AST, chain: tuple[Declaration, ...]) -> Iterator[tuple[tuple[Declaration, ...], ast.AsyncWith]]:
    for child in ast.iter_child_nodes(node):
        if isinstance(child, ast.AsyncWith):
            yield chain, child

        inner = (*chain, child) if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)) else chain
        yield from _scoped_async_withs(child, inner)


@functools.cache
def snapshot_blocks() -> tuple[SnapshotBlock, ...]:
    """Every snapshot session the application opens, read as `transactional_callbacks` reads a transaction's callback."""

    found: list[SnapshotBlock] = []
    for path in sorted(APP_ROOT.rglob("*.py")):
        module = path.relative_to(BACKEND_ROOT).as_posix()
        for chain, block in _scoped_async_withs(parsed(path), ()):
            for item in block.items:
                opener = item.context_expr
                if not (isinstance(opener, ast.Call) and _opens_a_snapshot(opener) and isinstance(item.optional_vars, ast.Name)):
                    continue

                name = item.optional_vars.id
                reads: list[tuple[str, bool]] = []
                handoffs: list[tuple[str, bool]] = []
                seeds: list[tuple[Declaration, Path, str]] = []
                for statement in block.body:
                    for inner_chain, call in scoped_calls(statement, chain):
                        if reads_the_database(call):
                            reads.append((callee(call), bound_at(call, "session", None).argument == name))

                        resolved = resolve_callee(call, inner_chain, path)
                        if resolved is None:
                            continue

                        declaration, declared_in = resolved
                        for parameter, position in session_parameters(declaration):
                            bound = bound_at(call, parameter, position).argument == name
                            handoffs.append((declaration.name, bound))
                            if bound:
                                seeds.append((declaration, declared_in, parameter))

                found.append(
                    SnapshotBlock(
                        where=f"{module} :: {chain[-1].name if chain else '<module>'}",
                        reads=tuple(reads),
                        handoffs=tuple(handoffs),
                        seeds=tuple(seeds),
                    )
                )

    return tuple(found)


@functools.cache
def snapshot_carriers() -> tuple[SessionCarrier, ...]:
    """Every declaration a snapshot session reaches by being handed on, followed as `session_carriers` follows a transaction's."""

    return _carriers_from([seed for block in snapshot_blocks() for seed in block.seeds])


# What `application()` built, each surface a caller can edit held apart so an edit is told from it.
_BUILT_ROUTES: list[BaseRoute] = []
_BUILT_STATE: dict[str, Any] = {}
_BUILT_HANDLERS: dict[Any, Any] = {}
_BUILT_MIDDLEWARE: list[Any] = []

# `app.openapi()` hands every reader the one document it cached on the app, so an edit to it is told
# from a read only against this copy.
_BUILT_DOCUMENT: dict[str, Any] = {}


@dataclass(frozen=True)
class _HeldAttributes:
    """One route's attributes, or its dependant's, as built, a container's members held apart so an edit in place is told too."""

    label: str
    owner: Any
    values: dict[str, Any]
    members: dict[str, Any]
    #: A slotted dataclass, which a dependant is: no `__dict__`, and no attribute it can gain.
    slotted: bool
    #: Every value read off in one call, and the values as built in the same order, so the
    #: common answer is one identity sweep run in C: the guard pays it per module, twice.
    read: Callable[[Any], tuple[Any, ...]]
    built: tuple[Any, ...]


# Every route the table reaches, nested includes opened, each with its dependant: the table's entries
# are the routers holding them, so an edit inside one leaves every entry's identity standing.
_BUILT_ROUTE_ATTRIBUTES: list[_HeldAttributes] = []


_MISSING = object()


def _attributes(owner: Any) -> dict[str, Any]:
    if dataclasses.is_dataclass(owner):
        return {field.name: getattr(owner, field.name) for field in dataclasses.fields(owner)}

    return dict(vars(owner))


def _members(value: Any) -> Any:
    """A copy of a mutable container's members, `None` for anything else, whose only edit is a rebinding."""

    if isinstance(value, list | set | dict):
        return copy.copy(value)

    return None


def _same_members(now: Any, built: Any) -> bool:
    if isinstance(built, dict):
        return now.keys() == built.keys() and all(now[key] is built[key] for key in built)
    if isinstance(built, set):
        return {id(member) for member in now} == {id(member) for member in built}

    return len(now) == len(built) and all(map(operator.is_, now, built, strict=True))


def _hold(label: str, owner: Any) -> _HeldAttributes:
    values = _attributes(owner)
    members = {name: held for name, value in values.items() if (held := _members(value)) is not None}
    names = tuple(values)
    getter = operator.attrgetter(*names)

    return _HeldAttributes(
        label,
        owner,
        values,
        members,
        slotted=dataclasses.is_dataclass(owner),
        # `attrgetter` answers one name with the bare value rather than a tuple of one.
        read=(lambda held: (getter(held),)) if len(names) == 1 else getter,
        built=tuple(values.values()),
    )


def _route_attributes(app: FastAPI) -> list[_HeldAttributes]:
    held: list[_HeldAttributes] = []
    seen: set[int] = set()
    for context in iter_route_contexts(app.routes):
        route = context.original_route
        if id(route) in seen:
            continue
        seen.add(id(route))
        label = f"{','.join(sorted(getattr(route, 'methods', None) or ()))} {getattr(route, 'path', repr(route))}"
        held.append(_hold(label, route))
        if (dependant := getattr(route, "dependant", None)) is not None:
            held.append(_hold(f"{label} dependant", dependant))

    return held


def _unchanged(held: _HeldAttributes) -> bool:
    owner = held.owner
    if not held.slotted and len(vars(owner)) != len(held.values):
        return False
    try:
        current = held.read(owner)
    except AttributeError:
        return False

    return all(map(operator.is_, current, held.built, strict=True)) and all(
        _same_members(held.values[name], members) for name, members in held.members.items()
    )


def _changed_attributes(held: _HeldAttributes) -> list[str]:
    if _unchanged(held):
        return []
    now = _attributes(held.owner)

    return sorted(
        name
        for name in now.keys() | held.values.keys()
        if now.get(name, _MISSING) is not held.values.get(name, _MISSING)
        or (name in held.members and not _same_members(now[name], held.members[name]))
    )


def _restore_attributes(held: _HeldAttributes) -> None:
    """Each container refilled in place rather than replaced, since the route's other holders keep that object."""

    if not held.slotted:
        for added in vars(held.owner).keys() - held.values.keys():
            delattr(held.owner, added)
    for name, value in held.values.items():
        setattr(held.owner, name, value)
        if isinstance(value, list):
            value[:] = held.members[name]
        elif isinstance(value, set | dict):
            value.clear()
            value.update(held.members[name])


@functools.cache
def application() -> FastAPI:
    """One build a process for every module reading what the application mounts.

    Every xdist worker imports every module at collection, the tier's `-m` filtering only after, so a
    build per module is paid by each worker for each module.
    """

    app = create_app(build_test_config())
    _BUILT_ROUTES[:] = app.routes
    _BUILT_STATE.clear()
    _BUILT_STATE.update({key: app.state[key] for key in app.state})
    _BUILT_HANDLERS.clear()
    _BUILT_HANDLERS.update(app.exception_handlers)
    _BUILT_MIDDLEWARE[:] = app.user_middleware
    _BUILT_ROUTE_ATTRIBUTES[:] = _route_attributes(app)
    # Published now rather than at the first reader's call, which could follow an edit to the routes
    # and cache a document no build publishes.
    _BUILT_DOCUMENT.clear()
    _BUILT_DOCUMENT.update(copy.deepcopy(app.openapi()))

    return app


def _changed_keys(held: Mapping[Any, Any], built: Mapping[Any, Any]) -> list[str]:
    """Every key added, dropped or rebound, by IDENTITY: a value swapped for an equal one is still another module's object."""

    missing = object()

    return sorted(
        str(getattr(key, "__name__", key)) for key in held.keys() | built.keys() if held.get(key, missing) is not built.get(key, missing)
    )


def undo_edits_to_application() -> list[str]:
    """What a caller changed on `application()`'s app, each undone so only the module making it is charged; empty where none was built."""

    if not application.cache_info().currsize:
        return []
    app = application()
    edits: list[str] = []
    if app.dependency_overrides:
        edits.append(f"dependency overrides for {sorted(getattr(call, '__name__', repr(call)) for call in app.dependency_overrides)}")
        app.dependency_overrides.clear()
    if changed := _changed_keys({key: app.state[key] for key in app.state}, _BUILT_STATE):
        edits.append(f"its state at {changed}")
        for key in list(app.state):
            del app.state[key]
        for key, value in _BUILT_STATE.items():
            app.state[key] = value
    if changed := _changed_keys(app.exception_handlers, _BUILT_HANDLERS):
        edits.append(f"its exception handlers for {changed}")
        app.exception_handlers.clear()
        app.exception_handlers.update(_BUILT_HANDLERS)
    if len(app.user_middleware) != len(_BUILT_MIDDLEWARE) or any(
        held is not built for held, built in zip(app.user_middleware, _BUILT_MIDDLEWARE, strict=False)
    ):
        edits.append("its middleware")
        app.user_middleware[:] = _BUILT_MIDDLEWARE
    if app.routes != _BUILT_ROUTES:
        edits.append("its route table")
        app.router.routes[:] = _BUILT_ROUTES
    if changed := [f"{held.label} {names}" for held in _BUILT_ROUTE_ATTRIBUTES if (names := _changed_attributes(held))]:
        edits.append(f"its routes at {'; '.join(changed)}")
        for held in _BUILT_ROUTE_ATTRIBUTES:
            _restore_attributes(held)
    if app.openapi_schema != _BUILT_DOCUMENT:
        edits.append("its published document")
        app.openapi_schema = copy.deepcopy(_BUILT_DOCUMENT)
    # Dropped whether or not an edit stands: Starlette keeps the stack it builds at the first request, so
    # an edit served and then put back leaves a stack built over it that nothing above sees.
    app.middleware_stack = None

    return edits


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
