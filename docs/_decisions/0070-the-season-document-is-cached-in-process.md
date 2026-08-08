# ADR-0070 — The season document is cached in-process, dropped by its own write path, bounded by a TTL

**Status:** Accepted
**Date:** 2026-08-08
**Surface:** backend
**Supersedes:** —
**Superseded by:** —
**Source:** Roadmap item BE-10 (owner, 2026-08-02): nothing caches the season document, and every
request reads it.

## Context

[ADR-0002](0002-omitted-season-means-current.md) made an omitted `saison_id` mean the current season,
resolved in the handler — so `/spiele`, `/spieltage`, `/teams` and `/saisons/current` all route
through `pull_current_saison`, and most public traffic pays a Mongo round trip for an answer that
changes at a rollover, twice a year at most.
[ADR-0026](0026-team-statistics-are-derived-from-spiele.md) then widened the cost: `GET /teams`
scores its derived table from the season's `rules`, so it reads the season document on **every**
call, including calls that name a season explicitly. `pull_saison_id_and_rules` already folds both
halves into one query; the round trip itself was what remained.

The consideration that kept this open was invalidation. When the item was filed, a season was edited
by hand in Compass, and no code path could observe the edit. That has changed:
[ADR-0063](0063-a-matchday-list-is-the-seasons-skeleton.md) gave `PATCH /saisons/{saison_id}` and
`POST /saisons/{saison_id}/activate` admin pages, so the ordinary lifecycle of a season — created,
rules edited, activated — now runs entirely through a write path this service controls.

## Decision

**Season documents are cached in this process** (`app/api/saisons/cache.py`), keyed by season id and
by `"current"`, and every resolver in `app/api/saisons/crud.py` reads through the cache. A miss
fetches the **full document** — no projections, so the cache holds one shape and every caller picks
its keys from a deep copy. A 404 is never cached.

**The season write path drops the whole cache as it saves.** All three write endpoints — create,
patch, activate — call `invalidate_saison_cache()` after their write lands, unconditionally: the
rule "every season write drops the cache" costs one refilling `find_one` and needs no reasoning
about which keys a particular write could have touched. The activation drop sits outside the
transaction blocks, so an aborted rollover leaves nothing to unlearn.

**A TTL of ten minutes bounds what the drop cannot reach.** A hand edit in Compass goes around the
write path and would otherwise stay invisible for the life of the process — staleness without a
bound, which is precisely the property
[ADR-0035](0035-reference-data-staleness-is-bounded-by-cache-lifetime.md) refuses. With the TTL,
every layer's staleness is bounded by a cache lifetime: at most ten minutes here, at most a day in
the frontend's reference caches, and the remedies ADR-0035 documents (recreate the container, or
simply wait) keep working unchanged.

## Consequences

**The hot path loses its round trip.** A cache hit answers `pull_current_saison`,
`pull_current_saison_id` and `pull_saison_id_and_rules` without touching Mongo; the current-season
fill also stores the document under its own id, so a read naming the running season explicitly hits
the same entry.

**An API edit is visible at once; a Compass edit within ten minutes.** The first is the drop, the
second is the TTL. Nothing new is required of the operator, and no invalidation endpoint exists —
ADR-0035's refusal of one stands untouched.

**The cache is per-process, and the backend runs one process.** `fl_backend/Dockerfile` starts a
single uvicorn worker, so the write-path drop reaches every cache there is. Adding workers changes
that arithmetic: each process would carry its own cache, a write would drop only the handling
process's copy, and the TTL would become the real bound for the others. Re-read this decision before
adding `--workers`.

**Tests share the process too.** `tests/api/test_saison_cache.py` pins the contract — a hit issues
no query, reads and stores copy, a 404 is never cached, the TTL expires an entry — and clears the
cache around every test. A future test that writes `saisons` directly and then calls a resolver must
call `invalidate_saison_cache()` itself, exactly as a Compass edit would have to wait out the TTL.

## Alternatives considered

**A process-lifetime cache with no TTL.** The write-path drop covers every ordinary edit, and the
residual Compass case already tolerates a day of frontend staleness. Rejected because the staleness
it leaves is unbounded rather than long: a hand edit would stay invisible until the next deploy, and
"bounded by cache lifetime" — the property ADR-0035 built the operational story on — would silently
stop being true at this layer. Ten minutes of TTL buys the bound for one query per process per ten
minutes, which is not a cost worth reasoning about.

**A TTL alone, with no write-path drop.** Simpler — no coupling between the write router and the
cache — but a rollover would then serve the old season for up to the TTL from the very page that
performed it, and the admin pages' own invalidation model (each page clears what it changed,
ADR-0063) says writes observe their effects immediately. The drop is three one-line calls.

**Caching in the frontend instead.** The frontend already caches season reads for a day; the query
this decision removes is issued by the backend's own handlers resolving defaults and scoring tables,
which no frontend cache can reach.

**`functools.lru_cache` or an off-the-shelf TTL cache dependency.** The contract worth testing here
is not memoisation of a function but a keyed store with copy-out semantics, an unconditional drop,
and a named TTL — five short functions. A dependency would be more code to audit than it replaces.
