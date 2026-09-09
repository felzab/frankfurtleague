import ast
import functools
import inspect
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterator

from app.core.collections import Collection

BACKEND_ROOT = Path(__file__).resolve().parents[2]
APP_ROOT = BACKEND_ROOT / "app"

Declaration = ast.FunctionDef | ast.AsyncFunctionDef

# `app/core/crud.py`'s two removals, and so every way a document leaves this database.
REMOVAL_HELPERS = frozenset({"delete_many_from_db", "erase_many_from_db"})

# `app/core/crud.py`'s writing half: a call to one of these is where a document changes.
WRITE_HELPERS = frozenset({"insert_live", "patch_many_in_db", "patch_one_in_db", "post_many_to_db", "post_one_to_db", "set_inactive_since"})

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
# `read_session` are sessions, and a `session` on something else is not one.
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


def app_calls() -> Iterator[tuple[str, str, ast.Call]]:
    """Every call the application makes, with the module and the function around it."""

    for path in sorted(APP_ROOT.rglob("*.py")):
        module = path.relative_to(BACKEND_ROOT).as_posix()
        yield from ((module, scope, call) for scope, call in calls_in(parsed(path), "<module>"))


def dict_keys(node: ast.AST) -> frozenset[str]:
    """Every key a literal names, at any depth, so a field nested under `$and` is seen too."""

    return frozenset(
        key.value
        for found in ast.walk(node)
        if isinstance(found, ast.Dict)
        for key in found.keys
        if isinstance(key, ast.Constant) and isinstance(key.value, str)
    )


@dataclass(frozen=True)
class Removal:
    """One removal the application makes, read off its own call site."""

    helper: str
    collection: str
    #: The INNERMOST function around the call, so a removal moved into a nested helper is attributed
    #: there rather than to the callback holding it.
    scope: str
    #: The filter's top-level keys, each compared to a VALUE. A key whose value is a dict of
    #: operators names the field and bounds nothing, so it is not among these.
    keyed_on: frozenset[str]
    #: Every key the filter names at any depth, operators included.
    names: frozenset[str]


def removals() -> list[Removal]:
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
                    if isinstance(key, ast.Constant) and isinstance(key.value, str) and not isinstance(value, ast.Dict)
                ),
                names=dict_keys(db_filter),
            )
        )

    return found


# The driver call that runs a whole callback in one transaction. Every transaction in the
# application is opened this way, and the writes sit in the callback rather than under it.
TRANSACTION_RUNNER = "with_transaction"

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


def _callbacks() -> Iterator[tuple[Path, str, tuple[Declaration, ...], Declaration]]:
    """One finder for both sweeps below, so neither can quietly stop seeing a callback the other still reads."""

    for path in sorted(APP_ROOT.rglob("*.py")):
        module = path.relative_to(BACKEND_ROOT).as_posix()
        tree = parsed(path)

        for outer, call in scoped_calls(tree, ()):
            if callee(call) != TRANSACTION_RUNNER:
                continue

            handed = call.args[0].id if call.args and isinstance(call.args[0], ast.Name) else ""

            # Resolved per callback rather than by indexing the module: `__init__` repeats across
            # classes, and a name that is not handed to a transaction is nothing to this sweep.
            found_names = [node for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == handed]
            assert len(found_names) == 1, (
                f"{module}: `{TRANSACTION_RUNNER}` is handed `{handed}`, which resolves to {len(found_names)} functions"
            )

            yield path, module, outer, found_names[0]


def transactional_callbacks(session_taking: frozenset[str]) -> list[TransactionalCallback]:
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

    return found


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


def _imported_declaration(name: str, tree: ast.Module) -> tuple[Declaration, Path] | None:
    """One name's declaration where the module imports it from `app/`, or `None` where nothing under `app/` declares it."""

    for node in ast.walk(tree):
        if not isinstance(node, ast.ImportFrom):
            continue

        for alias in node.names:
            if (alias.asname or alias.name) != name:
                continue

            dotted = node.module or ""
            if not dotted.startswith("app."):
                return None

            candidate = BACKEND_ROOT.joinpath(*dotted.split("."))
            origin = candidate.with_suffix(".py") if candidate.with_suffix(".py").exists() else candidate / "__init__.py"
            found = _declared_directly_in(parsed(origin)).get(alias.name) if origin.exists() else None

            return (found, origin) if found is not None else None

    return None


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


def _bound_at(call: ast.Call, parameter: str, position: int | None) -> Binding:
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
                binding = _bound_at(call, parameter, position)
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

    frontier = [(handoff.declaration, handoff.declared_in, handoff.parameter) for handoff in session_handoffs() if handoff.in_session]
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
                reads.append((callee(call), _bound_at(call, "session", None).argument in carried))

            resolved = resolve_callee(call, chain, path)
            if resolved is None:
                continue

            called, called_in = resolved
            frontier += [
                (called, called_in, name)
                for name, position in session_parameters(called)
                if _bound_at(call, name, position).argument in carried
            ]

        found.append(
            SessionCarrier(
                where=f"{path.relative_to(BACKEND_ROOT).as_posix()} :: {declaration.name}({parameter})",
                called=declaration.name,
                reads=tuple(reads),
            )
        )

    return tuple(sorted(found, key=lambda carrier: carrier.where))
