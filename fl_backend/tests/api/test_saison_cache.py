import ast
import asyncio
import inspect
import textwrap
from typing import Any, cast

import pytest
from motor.motor_asyncio import AsyncIOMotorCollection

from app.api.saisons import cache
from app.api.saisons.cache import (
    CURRENT_SAISON_CACHE_KEY,
    SAISON_CACHE_TTL_SECONDS,
    invalidate_saison_cache,
    read_cached_saison,
    saison_cache_generation,
    store_cached_saison,
)
from app.api.saisons.crud import pull_current_saison, pull_saison_id_and_rules
from app.core import crud
from app.core.exceptions import DocumentNotFoundException
from app.main import WRITE_ROUTERS

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


def as_collection(stub: CountingCollection) -> AsyncIOMotorCollection:
    return cast(AsyncIOMotorCollection, stub)


@pytest.fixture(autouse=True)
def empty_cache():
    """Module state must not leak between tests."""
    invalidate_saison_cache()
    yield
    invalidate_saison_cache()


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
        invalidate_saison_cache()

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
            await stub.answered.wait()

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

# The injected parameter's name, which is what a call site spells and therefore what an AST sees.
SAISONS_COLLECTION_PARAM = "saisons_collection"

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


def _writes_the_season(tree: ast.AST) -> bool:
    """Whether a handler's body writes a `saisons` document, through a crud helper or the driver."""

    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue

        called = node.func
        if isinstance(called, ast.Name) and called.id in CRUD_WRITERS:
            targets = (keyword for keyword in node.keywords if keyword.arg == "collection")
            if any(isinstance(target.value, ast.Name) and target.value.id == SAISONS_COLLECTION_PARAM for target in targets):
                return True

        if isinstance(called, ast.Attribute) and called.attr in DRIVER_WRITERS:
            if isinstance(called.value, ast.Name) and called.value.id == SAISONS_COLLECTION_PARAM:
                return True

    return False


def _drops_the_cache(tree: ast.AST) -> bool:
    dropped = invalidate_saison_cache.__name__

    return any(isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == dropped for node in ast.walk(tree))


def _season_write_handlers() -> dict[str, ast.AST]:
    """Every write endpoint across the admin routers whose body writes a season, by function name.

    Scoped to the writers, not to every write endpoint: a handler touching only the junction rows or
    the fixtures changes nothing the cached projection carries.
    """

    handlers: dict[str, ast.AST] = {}
    for router in WRITE_ROUTERS:
        for route in router.routes:
            endpoint = getattr(route, "endpoint", None)
            if endpoint is None or not getattr(route, "methods", set()) & WRITE_METHODS:
                continue
            # Dedented, so a handler that is not at column zero still parses.
            tree = ast.parse(textwrap.dedent(inspect.getsource(endpoint)))
            if _writes_the_season(tree):
                handlers[endpoint.__name__] = tree

    return handlers


SEASON_WRITE_HANDLERS = _season_write_handlers()

# `empty_parameter_set_mark` defaults to skip, so a sweep that recognised nothing would pass in silence.
assert SEASON_WRITE_HANDLERS, "no admin endpoint was seen writing a season; did the dependency or the crud helpers get renamed?"


class TestEverySeasonWriteDropsIt:
    @pytest.mark.parametrize("handler", sorted(SEASON_WRITE_HANDLERS))
    def test_a_handler_writing_a_season_calls_the_invalidation(self, handler: str):
        """A source sweep, because the call leaves no trace on the wire: an execution test could only observe it through a stale read."""
        assert _drops_the_cache(SEASON_WRITE_HANDLERS[handler]), (
            f"{handler} writes a season without calling {invalidate_saison_cache.__name__}(), so the cache serves the old one"
        )
