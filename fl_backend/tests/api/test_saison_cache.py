"""
The in-process season cache: what it serves, what it copies, and what drops it (ADR-0070).

Default tier — the "collection" is a counting stub, because what is under test is the cache's
contract, not Mongo: a hit issues no query, a returned document is a copy and not the stored one,
a 404 is never cached, and the TTL turns a stale entry back into a miss.
"""

import asyncio
from typing import Any, cast

import pytest
from motor.motor_asyncio import AsyncIOMotorCollection

from app.api.saisons import cache
from app.api.saisons.cache import (
    CURRENT_SAISON_CACHE_KEY,
    SAISON_CACHE_TTL_SECONDS,
    invalidate_saison_cache,
    read_cached_saison,
    store_cached_saison,
)
from app.api.saisons.crud import pull_current_saison, pull_saison_id_and_rules
from app.core.exceptions import DocumentNotFoundException

RULES = {
    "win_points": 3,
    "draw_points": 1,
    "number_of_groups": 4,
    "teams_per_group": 4,
    "qualifiers_per_group": 2,
    "erlaubte_stufen": ["E1", "E2"],
}

SAISON_DOC: dict[str, Any] = {"_id": "2026", "status": "active", "rules": dict(RULES)}


class CountingCollection:
    """Answers `find_one` with a fixed document — or `None` — and counts how often it is asked."""

    def __init__(self, document: dict[str, Any] | None) -> None:
        self.document = document
        self.find_one_calls = 0

    async def find_one(self, filter: dict[str, Any], projection: dict[str, Any]) -> dict[str, Any] | None:
        self.find_one_calls += 1
        return None if self.document is None else dict(self.document)


def as_collection(stub: CountingCollection) -> AsyncIOMotorCollection:
    return cast(AsyncIOMotorCollection, stub)


@pytest.fixture(autouse=True)
def empty_cache():
    """Every test starts and ends with a clean cache — module state must not leak between tests."""
    invalidate_saison_cache()
    yield
    invalidate_saison_cache()


class TestTheCacheContract:
    def test_a_stored_document_reads_back_equal(self):
        store_cached_saison("2026", dict(SAISON_DOC))

        assert read_cached_saison("2026") == SAISON_DOC

    def test_a_read_is_a_copy_not_the_stored_document(self):
        store_cached_saison("2026", dict(SAISON_DOC))

        first = read_cached_saison("2026")
        assert first is not None
        first["rules"]["win_points"] = 99

        second = read_cached_saison("2026")
        assert second is not None
        assert second["rules"]["win_points"] == 3

    def test_the_store_copies_too(self):
        mine = dict(SAISON_DOC)
        store_cached_saison("2026", mine)
        mine["status"] = "past"

        cached = read_cached_saison("2026")
        assert cached is not None
        assert cached["status"] == "active"

    def test_an_expired_entry_is_a_miss(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(cache.time, "monotonic", lambda: 1000.0)
        store_cached_saison("2026", dict(SAISON_DOC))

        monkeypatch.setattr(cache.time, "monotonic", lambda: 1000.0 + SAISON_CACHE_TTL_SECONDS + 1)

        assert read_cached_saison("2026") is None

    def test_invalidate_clears_every_key(self):
        store_cached_saison("2026", dict(SAISON_DOC))
        store_cached_saison(CURRENT_SAISON_CACHE_KEY, dict(SAISON_DOC))

        invalidate_saison_cache()

        assert read_cached_saison("2026") is None
        assert read_cached_saison(CURRENT_SAISON_CACHE_KEY) is None


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
