"""
SAISONS · the in-process season cache

Season documents, cached in this process and dropped by the season write path. ADR-0002 made the
current-season lookup the hot path of almost every read — `/spiele`, `/spieltage`, `/teams` and
`/saisons/current` all resolve an omitted `saison_id` through it, and `/teams` reads the season's
`rules` on every call besides — while the answer changes twice a year at most.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • Only found documents are stored. A miss is never cached: an id that named nothing must keep
    raising 404 from a fresh read, and "no active season" must stay the loud failure it is.
  • Every read returns a deep copy. The stored document is shared by every future hit, so a caller
    mutating its answer must corrupt nothing but its own copy.
  • The TTL is a bound, not the mechanism. The three write endpoints drop the whole cache as they
    save, so an edit made through the API is visible at once; the TTL exists for the write nothing
    observes — a hand edit in Compass — and keeps ADR-0035's property true through this layer too:
    staleness stays bounded by a cache lifetime, never by the life of the process.
  • One process, one cache. The backend runs a single uvicorn worker (`fl_backend/Dockerfile`), so
    the write-path drop reaches every cache there is. A second worker would change that arithmetic;
    the ADR records it as the assumption to re-check.

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/_decisions/0070-the-season-document-is-cached-in-process.md — the decision and the bound
  app/api/saisons/crud.py — the resolution point this cache sits behind
"""

import time
from copy import deepcopy
from typing import Any, Final

# Ten minutes. Generous against a document that changes twice a year, and small against the day the
# frontend's own reference caches already tolerate for the same hand-edit case (ADR-0035).
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
