import time
from copy import deepcopy
from typing import Any, Final

# Generous against a document that changes twice a year, and small against the day the frontend's
# own reference caches already tolerate for the same hand-edit case.
SAISON_CACHE_TTL_SECONDS: Final = 600.0

# A season id is exactly four characters, so this can never collide with one.
CURRENT_SAISON_CACHE_KEY: Final = "current"

# One process, one cache: a second uvicorn worker changes that arithmetic.
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
    """Store a FOUND document; a miss is never cached, so it keeps raising 404 from a fresh read."""

    _cache[key] = (time.monotonic(), deepcopy(document))


def invalidate_saison_cache() -> None:
    """Drop everything: reasoning about which keys a write could have changed is not worth the one `find_one` it would save."""

    _cache.clear()
