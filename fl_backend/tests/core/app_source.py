import ast
import functools
import inspect
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterator

from app.core.collections import Collection

BACKEND_ROOT = Path(__file__).resolve().parents[2]
APP_ROOT = BACKEND_ROOT / "app"

# `app/core/crud.py`'s two removals, and so every way a document leaves this database.
REMOVAL_HELPERS = frozenset({"delete_many_from_db", "erase_many_from_db"})

# `app/core/crud.py`'s writing half: a call to one of these is where a document changes.
WRITE_HELPERS = frozenset({"insert_live", "patch_many_in_db", "patch_one_in_db", "post_many_to_db", "post_one_to_db", "set_inactive_since"})

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


def calls_in(node: ast.AST, scope: str) -> Iterator[tuple[str, ast.Call]]:
    """Every call under `node`, each paired with the innermost function around it, so a nested helper answers for its own."""

    for child in ast.iter_child_nodes(node):
        if isinstance(child, ast.Call):
            yield scope, child

        inner = child.name if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)) else scope
        yield from calls_in(child, inner)


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


@dataclass(frozen=True)
class TransactionalCallback:
    """One `with_transaction` callback, and the writes it makes ITSELF, each with whether it carries the session."""

    where: str
    writes: tuple[tuple[str, bool], ...]


def transactional_callbacks(session_taking: frozenset[str]) -> list[TransactionalCallback]:
    """Every callback the application runs inside a transaction.

    Its OWN body: a write a helper it calls makes answers under that helper, and following those
    would take a call graph rather than a sweep.
    """

    found: list[TransactionalCallback] = []
    for path in sorted(APP_ROOT.rglob("*.py")):
        module = path.relative_to(BACKEND_ROOT).as_posix()
        tree = parsed(path)

        for _, call in calls_in(tree, "<module>"):
            if callee(call) != TRANSACTION_RUNNER:
                continue

            handed = call.args[0].id if call.args and isinstance(call.args[0], ast.Name) else ""

            # Resolved per callback rather than by indexing the module: `__init__` repeats across
            # classes, and a name that is not handed to a transaction is nothing to this sweep.
            found_names = [node for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == handed]
            assert len(found_names) == 1, (
                f"{module}: `{TRANSACTION_RUNNER}` is handed `{handed}`, which resolves to {len(found_names)} functions"
            )
            callback = found_names[0]

            found.append(
                TransactionalCallback(
                    where=f"{module} :: {handed}",
                    writes=tuple(
                        (callee(inner), any(keyword.arg == "session" for keyword in inner.keywords))
                        for scope, inner in calls_in(callback, handed)
                        if scope == handed and callee(inner) in session_taking
                    ),
                )
            )

    return found
