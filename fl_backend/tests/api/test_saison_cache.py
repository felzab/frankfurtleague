import ast
import asyncio
import inspect
import sys
import textwrap
from collections.abc import Iterable, Iterator, Mapping
from types import FunctionType, ModuleType
from typing import Any, cast

import pytest
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import ExecutionTimeout

import app
from app.api.saisons import cache
from app.api.saisons.cache import (
    CURRENT_SAISON_CACHE_KEY,
    SAISON_CACHE_TTL_SECONDS,
    dropping_the_saison_cache,
    invalidate_saison_cache,
    read_cached_saison,
    saison_cache_generation,
    store_cached_saison,
)
from app.api.saisons.crud import pull_current_saison, pull_saison_id_and_rules
from app.core import crud, dependencies
from app.core.exceptions import DocumentNotFoundException
from app.main import SYSTEM_ROUTERS, WRITE_ROUTERS
from tests.core.app_source import APP_ROOT, parsed

RULES = {
    "win_points": 3,
    "draw_points": 1,
    "number_of_groups": 4,
    "teams_per_group": 4,
    "qualifiers_per_group": 2,
    "tiebreak_order": "tordifferenz",
    "max_kadergroesse": 18,
    "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
    "erlaubte_stufen": ["E1", "E2"],
}

SAISON_DOC: dict[str, Any] = {"_id": "2026", "status": "active", "rules": dict(RULES)}

# The bracket a write reshapes, which is what `anzahl_spiele` counts from: a reader serving the pair
# above after this one landed reports the wrong number of matches per matchday.
REDRAWN_RULES: dict[str, Any] = {**RULES, "number_of_groups": 2, "teams_per_group": 8}
REDRAWN_SAISON_DOC: dict[str, Any] = {"_id": "2026", "status": "active", "rules": dict(REDRAWN_RULES)}


class CountingCollection:
    def __init__(self, document: dict[str, Any] | None) -> None:
        self.document = document
        self.find_one_calls = 0

    # `session` is accepted and ignored: `pull_one_from_db` forwards it on every read, so a fake
    # without it raises a TypeError that names the fake rather than the behaviour under test.
    async def find_one(self, filter: dict[str, Any], projection: dict[str, Any], session: Any = None) -> dict[str, Any] | None:
        self.find_one_calls += 1
        return None if self.document is None else dict(self.document)


class SuspendingCollection(CountingCollection):
    """A `find_one` that fixes its answer, announces it, then parks until released.

    The driver's window made deterministic: a query's answer is settled well before the awaiting
    caller is scheduled again.
    """

    def __init__(self, document: dict[str, Any]) -> None:
        super().__init__(document)
        self.answered = asyncio.Event()
        self.release = asyncio.Event()

    async def find_one(self, filter: dict[str, Any], projection: dict[str, Any], session: Any = None) -> dict[str, Any] | None:
        self.find_one_calls += 1
        answer = None if self.document is None else dict(self.document)

        self.answered.set()
        await self.release.wait()

        return answer


def as_collection(stub: CountingCollection) -> AsyncCollection:
    return cast(AsyncCollection, stub)


class TestTheCacheContract:
    def test_a_stored_document_reads_back_equal(self):
        store_cached_saison("2026", dict(SAISON_DOC), generation=saison_cache_generation())

        assert read_cached_saison("2026") == SAISON_DOC

    def test_a_read_is_a_copy_not_the_stored_document(self):
        store_cached_saison("2026", dict(SAISON_DOC), generation=saison_cache_generation())

        first = read_cached_saison("2026")
        assert first is not None
        first["rules"]["win_points"] = 99

        second = read_cached_saison("2026")
        assert second is not None
        assert second["rules"]["win_points"] == 3

    def test_the_store_copies_too(self):
        mine = dict(SAISON_DOC)
        store_cached_saison("2026", mine, generation=saison_cache_generation())
        mine["status"] = "past"

        cached = read_cached_saison("2026")
        assert cached is not None
        assert cached["status"] == "active"

    def test_an_expired_entry_is_a_miss(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(cache.time, "monotonic", lambda: 1000.0)
        store_cached_saison("2026", dict(SAISON_DOC), generation=saison_cache_generation())

        monkeypatch.setattr(cache.time, "monotonic", lambda: 1000.0 + SAISON_CACHE_TTL_SECONDS + 1)

        assert read_cached_saison("2026") is None

    def test_invalidate_clears_every_key(self):
        store_cached_saison("2026", dict(SAISON_DOC), generation=saison_cache_generation())
        store_cached_saison(CURRENT_SAISON_CACHE_KEY, dict(SAISON_DOC), generation=saison_cache_generation())

        invalidate_saison_cache()

        assert read_cached_saison("2026") is None
        assert read_cached_saison(CURRENT_SAISON_CACHE_KEY) is None

    def test_a_store_carrying_a_generation_the_drop_has_passed_is_refused(self):
        generation = saison_cache_generation()
        invalidate_saison_cache()

        store_cached_saison("2026", dict(SAISON_DOC), generation=generation)

        assert read_cached_saison("2026") is None

    def test_a_store_carrying_the_current_generation_lands(self):
        """The control: a guard that refused everything would pass the case above and cost every reader its round trip."""

        store_cached_saison("2026", dict(SAISON_DOC), generation=saison_cache_generation())

        assert read_cached_saison("2026") == SAISON_DOC


class TestTheResolversUseIt:
    def test_the_second_current_read_issues_no_query(self):
        stub = CountingCollection(dict(SAISON_DOC))

        async def _run() -> None:
            await pull_current_saison(saisons_collection=as_collection(stub))
            await pull_current_saison(saisons_collection=as_collection(stub))

        asyncio.run(_run())

        assert stub.find_one_calls == 1

    def test_the_current_fill_also_answers_by_id(self):
        stub = CountingCollection(dict(SAISON_DOC))

        async def _run() -> tuple[str, Any]:
            await pull_current_saison(saisons_collection=as_collection(stub))
            return await pull_saison_id_and_rules(saisons_collection=as_collection(stub), saison_id="2026")

        saison_id, rules = asyncio.run(_run())

        assert stub.find_one_calls == 1
        assert saison_id == "2026"
        assert rules.win_points == 3

    def test_a_missing_season_raises_and_caches_nothing(self):
        stub = CountingCollection(None)

        async def _attempt() -> None:
            await pull_current_saison(saisons_collection=as_collection(stub))

        with pytest.raises(DocumentNotFoundException):
            asyncio.run(_attempt())
        with pytest.raises(DocumentNotFoundException):
            asyncio.run(_attempt())

        # Both attempts reached the database: the 404 was never stored as an answer.
        assert stub.find_one_calls == 2

    def test_an_explicit_id_is_cached_on_its_own(self):
        stub = CountingCollection(dict(SAISON_DOC))

        async def _run() -> None:
            await pull_saison_id_and_rules(saisons_collection=as_collection(stub), saison_id="2026")
            await pull_saison_id_and_rules(saisons_collection=as_collection(stub), saison_id="2026")

        asyncio.run(_run())

        assert stub.find_one_calls == 1

    def test_invalidation_sends_the_next_read_back_to_the_database(self):
        stub = CountingCollection(dict(SAISON_DOC))

        async def _run() -> None:
            await pull_current_saison(saisons_collection=as_collection(stub))
            invalidate_saison_cache()
            await pull_current_saison(saisons_collection=as_collection(stub))

        asyncio.run(_run())

        assert stub.find_one_calls == 2

    def test_a_write_landing_mid_read_is_not_undone_by_the_readers_store(self):
        """The drop is worth nothing if a reader suspended across it can put its pre-write document back for a whole TTL."""
        stub = SuspendingCollection(dict(SAISON_DOC))

        async def _run() -> Any:
            reader = asyncio.create_task(pull_saison_id_and_rules(saisons_collection=as_collection(stub), saison_id="2026"))
            # Raced against the reader, never awaited alone: a reader answered from the cache never
            # queries, and a bare wait on the announcement then hangs the tier instead of failing it.
            announced = asyncio.create_task(stub.answered.wait())
            await asyncio.wait({reader, announced}, return_when=asyncio.FIRST_COMPLETED)
            if not stub.answered.is_set():
                announced.cancel()
                # A reader that raised before its query is no cache answer: its own error is the failure.
                if (error := reader.exception()) is not None:
                    raise error
                pytest.fail("the reader returned without querying the collection, so a cached entry answered it")

            # The write path, running in the window the reader is parked in.
            stub.document = dict(REDRAWN_SAISON_DOC)
            invalidate_saison_cache()

            stub.release.set()
            await reader

            _, rules = await pull_saison_id_and_rules(saisons_collection=as_collection(stub), saison_id="2026")

            return rules

        rules = asyncio.run(_run())

        assert (rules.number_of_groups, rules.teams_per_group) == (REDRAWN_RULES["number_of_groups"], REDRAWN_RULES["teams_per_group"])


WRITE_METHODS = frozenset({"POST", "PATCH", "PUT", "DELETE"})

# The injected parameter's name, which is what a call site spells and therefore what an AST sees. A
# helper taking the collection through names it the same, which is what lets one recogniser read both.
SAISONS_COLLECTION_PARAM = "saisons_collection"

# The dependency alias an endpoint's parameter carries. FastAPI injects by annotation rather than by
# name, so a parameter renamed keeps the season injected and drops the endpoint from a name-only
# recogniser.
SAISONS_COLLECTION_ANNOTATION = "SaisonsCollection"

# Spelled rather than read off the object, an `Annotated` alias carrying no name of its own, so the
# spelling is checked against the module the way `CRUD_WRITERS` is.
assert hasattr(dependencies, SAISONS_COLLECTION_ANNOTATION), (
    f"app/core/dependencies.py no longer spells {SAISONS_COLLECTION_ANNOTATION}, so the annotation route reads nothing"
)

# `app/core/crud.py`'s writing half, checked against that module below: a rename there would
# otherwise leave this sweep matching nothing and passing.
CRUD_WRITERS = ("patch_one_in_db", "patch_many_in_db", "post_one_to_db", "post_many_to_db", "set_inactive_since", "insert_live")

# A handler reaching past those helpers writes through the driver itself.
DRIVER_WRITERS = frozenset(
    {
        "bulk_write",
        "delete_many",
        "delete_one",
        "find_one_and_replace",
        "find_one_and_update",
        "insert_many",
        "insert_one",
        "replace_one",
        "update_many",
        "update_one",
    }
)

UNKNOWN_WRITERS = [name for name in CRUD_WRITERS if not hasattr(crud, name)]
assert not UNKNOWN_WRITERS, f"{UNKNOWN_WRITERS} are no longer in app/core/crud.py, so this sweep would see no write"


def _alias_targets(node: ast.AST) -> tuple[tuple[str, ...], str | None]:
    """The names a plain copy binds, and the name it copies from.

    A copy alone: anything computed carries no promise about which collection it holds.
    """

    if isinstance(node, ast.Assign) and isinstance(node.value, ast.Name):
        return tuple(target.id for target in node.targets if isinstance(target, ast.Name)), node.value.id
    if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and isinstance(node.value, ast.Name):
        return (node.target.id,), node.value.id

    return (), None


def _season_collection_names(tree: ast.AST) -> frozenset[str]:
    """Every name this source has bound to the seasons collection.

    Three routes, because each alone goes blind on a rename costing no behaviour: the injected
    parameter, a parameter the dependency alias annotates, and a plain copy of either.
    """

    names = {SAISONS_COLLECTION_PARAM}
    for node in ast.walk(tree):
        if isinstance(node, ast.arg) and isinstance(node.annotation, ast.Name) and node.annotation.id == SAISONS_COLLECTION_ANNOTATION:
            names.add(node.arg)

    # Re-walked until it settles: an alias copied from an alias is one too, in whatever order the
    # source spells the two.
    while True:
        copies: set[str] = set()
        for node in ast.walk(tree):
            targets, copied_from = _alias_targets(node)
            if copied_from in names:
                copies.update(targets)

        if copies <= names:
            return frozenset(names)
        names |= copies


def _writes_the_season(tree: ast.AST, *, names: frozenset[str] | None = None) -> bool:
    """Whether this source writes a `saisons` document, through a crud helper or the driver.

    `names` is the enclosing function's, for a block inside it that binds none of its own.
    """

    return _season_write_among(ast.walk(tree), names=_season_collection_names(tree) if names is None else names)


def _season_write_among(nodes: Iterable[ast.AST], *, names: frozenset[str]) -> bool:
    for node in nodes:
        if not isinstance(node, ast.Call):
            continue

        called = node.func
        if isinstance(called, ast.Name) and called.id in CRUD_WRITERS:
            targets = (keyword for keyword in node.keywords if keyword.arg == "collection")
            if any(isinstance(target.value, ast.Name) and target.value.id in names for target in targets):
                return True

        if isinstance(called, ast.Attribute) and called.attr in DRIVER_WRITERS:
            if isinstance(called.value, ast.Name) and called.value.id in names:
                return True

    return False


def _drops(node: ast.AST) -> bool:
    dropping = dropping_the_saison_cache.__name__

    return isinstance(node, (ast.With, ast.AsyncWith)) and any(
        isinstance(item.context_expr, ast.Call) and isinstance(item.context_expr.func, ast.Name) and item.context_expr.func.id == dropping
        for item in node.items
    )


def _writes_the_season_inside_the_drop(endpoint: Any) -> bool:
    """Whether a season write is reached from INSIDE `with dropping_the_saison_cache()`, never merely beside one.

    Followed into the callbacks the body names, which the handler nests and hands to
    `with_transaction` uncalled, and into this package's functions.
    """

    tree = ast.parse(textwrap.dedent(inspect.getsource(endpoint)))
    names = _season_collection_names(tree)
    namespace = vars(sys.modules[endpoint.__module__])
    nested = {node.name: node for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}

    for drop in (node for node in ast.walk(tree) if _drops(node)):
        pending: list[ast.AST] = [drop]
        followed: set[str] = set()
        while pending:
            block = pending.pop()
            if _writes_the_season(block, names=names):
                return True
            if any(
                _writes_the_season(reached)
                for called in _called_functions(ast.walk(block), namespace)
                for reached in _source_reached_by(called)
            ):
                return True

            for name in {node.id for node in ast.walk(block) if isinstance(node, ast.Name) and node.id in nested} - followed:
                followed.add(name)
                pending.append(nested[name])

    return False


def _outside_the_drops(block: ast.AST) -> Iterator[ast.AST]:
    """Every node under `block` but those inside a drop, and those of a nested definition, which run only where it is named."""

    pending = list(ast.iter_child_nodes(block))
    while pending:
        node = pending.pop()
        if _drops(node) or isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        yield node
        pending.extend(ast.iter_child_nodes(node))


def _writes_the_season_outside_the_drop(endpoint: Any) -> bool:
    """Whether any season write is reached WITHOUT passing through a drop, however many others sit inside one.

    Walked with every drop's subtree removed, into the nested callbacks the rest names and this
    package's functions the rest calls.
    """

    walked: set[Any] = set()
    pending_functions: list[Any] = [endpoint]
    while pending_functions:
        function = pending_functions.pop()
        if function in walked:
            continue
        walked.add(function)

        tree = ast.parse(textwrap.dedent(inspect.getsource(function)))
        names = _season_collection_names(tree)
        namespace = vars(sys.modules[function.__module__])
        nested = {node.name: node for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}

        blocks: list[ast.AST] = [tree.body[0]]
        followed: set[str] = set()
        while blocks:
            reached = list(_outside_the_drops(blocks.pop()))
            if _season_write_among(reached, names=names):
                return True
            pending_functions.extend(_called_functions(reached, namespace))

            for name in {node.id for node in reached if isinstance(node, ast.Name) and node.id in nested} - followed:
                followed.add(name)
                blocks.append(nested[name])

    return False


# Every function this sweep follows a call into is defined in this package: `inspect.getsource` has
# nothing to give for a builtin, and no library spells this application's own collection parameter.
APPLICATION_PACKAGE = app.__name__


def _called_functions(nodes: Iterable[ast.AST], namespace: Mapping[str, Any]) -> list[FunctionType]:
    """Every function of this package this source calls, resolved through the calling module's own namespace."""

    resolved: list[FunctionType] = []
    for node in nodes:
        if not isinstance(node, ast.Call):
            continue

        called = node.func
        # Both forms a call can name a function by, so neither is the one nobody checked: a bare
        # name, defined in the module or imported into it, and an attribute of an imported module.
        if isinstance(called, ast.Name):
            candidate = namespace.get(called.id)
        elif isinstance(called, ast.Attribute) and isinstance(called.value, ast.Name):
            holder = namespace.get(called.value.id)
            candidate = getattr(holder, called.attr, None) if isinstance(holder, ModuleType) else None
        else:
            # A name assembled at run time, a method, and a callable arriving through `Depends` are
            # none of the two forms, so a season write behind one stays outside this sweep's reach.
            continue

        if isinstance(candidate, FunctionType) and candidate.__module__.split(".")[0] == APPLICATION_PACKAGE:
            resolved.append(candidate)

    return resolved


def _source_reached_by(endpoint: Any) -> tuple[ast.AST, ...]:
    """The handler's own source and every helper it reaches, however deep.

    A refusal helper takes the season's own write inside its caller's transaction
    (`app/api/teams/crud.py :: refuse_a_full_gruppe`), where a handler-only sweep cannot see it.
    """

    reached: list[ast.AST] = []
    walked: set[Any] = set()
    pending: list[Any] = [endpoint]
    while pending:
        current = pending.pop()
        if current in walked:
            continue
        walked.add(current)

        # Dedented, so a handler that is not at column zero still parses.
        tree = ast.parse(textwrap.dedent(inspect.getsource(current)))
        reached.append(tree)
        pending.extend(_called_functions(ast.walk(tree), vars(sys.modules[current.__module__])))

    return tuple(reached)


def _season_write_handlers() -> dict[str, Any]:
    """Every write endpoint that writes a season, by function name, whichever tier serves it.

    Scoped to the writers, not to every write endpoint: a handler touching only the junction rows or
    the fixtures changes nothing the cached projection carries.
    """

    handlers: dict[str, Any] = {}
    # Both tiers, the rule being about writing a season rather than about who may: the retention
    # sweep stamps every season from a router of its own, which an admin-only walk cannot see.
    for router in (*WRITE_ROUTERS, *SYSTEM_ROUTERS):
        for route in router.routes:
            endpoint = getattr(route, "endpoint", None)
            if endpoint is None or not getattr(route, "methods", set()) & WRITE_METHODS:
                continue
            if any(_writes_the_season(tree) for tree in _source_reached_by(endpoint)):
                handlers[endpoint.__name__] = endpoint

    return handlers


SEASON_WRITE_HANDLERS = _season_write_handlers()

# Floored rather than non-empty: an endpoint the recogniser stopped seeing drops out of the parameter
# set instead of failing (`docs/_standard/standard.md` PRE-4), so a rename costing no behaviour can
# shrink the sweep and still report success.
SEASON_WRITE_HANDLER_FLOOR = 13

# Ahead of `pyproject.toml :: empty_parameter_set_mark`, which refuses an empty parametrize without
# naming what to look at when the recognition stops matching.
assert len(SEASON_WRITE_HANDLERS) >= SEASON_WRITE_HANDLER_FLOOR, (
    f"only {sorted(SEASON_WRITE_HANDLERS)} were seen writing a season, under the {SEASON_WRITE_HANDLER_FLOOR} this sweep reaches; "
    "lower the floor only for an endpoint deliberately removed -- otherwise the recogniser, not the handlers, is the likely cause"
)


class TestEverySeasonWriteDropsIt:
    @pytest.mark.parametrize("handler", sorted(SEASON_WRITE_HANDLERS))
    def test_a_handler_writing_a_season_runs_it_inside_the_drop(self, handler: str):
        """A source sweep, because the call leaves no trace on the wire: an execution test could only observe it through a stale read."""
        endpoint = SEASON_WRITE_HANDLERS[handler]
        dropping = dropping_the_saison_cache.__name__

        # Both halves: a handler reaching no write through the drop, and one reaching a second write
        # beside it, each leave the cache serving the season as it stood.
        assert _writes_the_season_inside_the_drop(endpoint), f"{handler} reaches no season write through `with {dropping}()`"
        assert not _writes_the_season_outside_the_drop(endpoint), (
            f"{handler} writes a season outside `with {dropping}()`, so the cache serves the old one"
        )

    def test_nothing_drops_it_but_the_one_mechanism(self):
        """A bare drop after the commit is the shape that skips a write whose answer was lost, and the sweep above would still pass it."""

        dropped = invalidate_saison_cache.__name__
        bare = [
            f"{path.relative_to(APP_ROOT).as_posix()}:{node.lineno}"
            for path in sorted(APP_ROOT.rglob("*.py"))
            if path != APP_ROOT / "api" / "saisons" / "cache.py"
            for node in ast.walk(parsed(path))
            if (isinstance(node, ast.Name) and node.id == dropped) or (isinstance(node, ast.Attribute) and node.attr == dropped)
        ]

        assert bare == []


class TestTheDropRunsHoweverTheWriteEnds:
    @pytest.mark.parametrize("raises", [True, False], ids=("a write that raised", "a write that committed"))
    def test_the_next_read_goes_back_to_the_database(self, raises: bool):
        """The raised arm is a commit whose answer was lost, which may stand.

        The read inside the block is a reader racing the write: a drop on entry would leave its
        pre-write copy served afterwards.
        """
        stub = CountingCollection(dict(SAISON_DOC))

        async def _run() -> None:
            try:
                with dropping_the_saison_cache():
                    await pull_current_saison(saisons_collection=as_collection(stub))
                    if raises:
                        raise ExecutionTimeout("timed out", 50, {"ok": 0, "code": 50, "errorLabels": ["UnknownTransactionCommitResult"]})
            except ExecutionTimeout:
                pass
            await pull_current_saison(saisons_collection=as_collection(stub))

        asyncio.run(_run())

        assert stub.find_one_calls == 2
