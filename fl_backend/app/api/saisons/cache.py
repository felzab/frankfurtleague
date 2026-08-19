"""
SAISONS · the in-process season cache

Season documents, cached in this process and dropped by the season write path as it saves. An
omitted `saison_id` means the current season, which makes that lookup the hot path of almost every
read while the answer changes twice a year at most; the TTL only bounds the one write nothing
observes — a hand edit in Compass — leaving that staleness bounded by a cache lifetime rather than
by an invalidation endpoint.

Invariants:
- Only found documents are stored: a miss keeps raising 404 from a fresh read, never a cached one.
- Every read returns a deep copy — the stored document is shared by every future hit.
- One process, one cache: a second uvicorn worker changes that arithmetic.

See:
- app/api/saisons/crud.py — the resolution point this cache sits behind
"""

import time
from copy import deepcopy
from typing import Any, Final

# Ten minutes. Generous against a document that changes twice a year, and small against the day the
# frontend's own reference caches already tolerate for the same hand-edit case.
SAISON_CACHE_TTL_SECONDS: Final = 600.0

# The key for "whichever season is active". A season id is exactly four characters, so this can
# never collide with one.
CURRENT_SAISON_CACHE_KEY: Final = "current"

_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def read_cached_saison(key: str) -> dict[str, Any] | None:
    """The cached document under `key`, as a copy — or `None` on a miss or an expired entry."""

    entry = _cache.get(key)
    if entry is None:
        return None

    stored_at, document = entry
    if time.monotonic() - stored_at > SAISON_CACHE_TTL_SECONDS:
        del _cache[key]
        return None

    return deepcopy(document)


def store_cached_saison(key: str, document: dict[str, Any]) -> None:
    """Store a found document under `key`. The copy is taken here, so the caller's dict stays its own."""

    _cache[key] = (time.monotonic(), deepcopy(document))


def invalidate_saison_cache() -> None:
    """
    Drop everything.

    Called by every season write — create, patch and activate — because reasoning about which keys a
    write could have changed is not worth the queries it would save: the next read refills the cache
    with one `find_one`.
    """

    _cache.clear()
