# ADR-0035 — Reference-data staleness is bounded by cache lifetime, not by an endpoint

**Status:** Accepted
**Date:** 2026-08-04
**Surface:** frontend, ops
**Supersedes:** [ADR-0015](0015-backend-triggered-revalidation-route.md)
**Superseded by:** —
**Source:** owner's decision, 2026-08-04

## Context

`saisons`, `spieler` and `spieltage` have no frontend write surface and are cached with
`cacheLife("days")`, so an edit made directly in MongoDB is served stale until the cache entry
expires. ADR-0015 answered that with `POST /api/revalidate` — an in-network, key-authenticated
route that cleared the affected base tags, invoked by hand from inside the frontend container.

The route carried real weight for its size: a fixed resource enum, constant-time key comparison, a
resource→tags mapping that had to mirror the read paths' season resolution, a topology-dependent
security posture ("adding an nginx location publishes it") repeated across three documents, and an
operational procedure nobody could run without reading it up. Its only caller was an operator,
occasionally, and its entire benefit was compressing a staleness window of at most 24 hours.

## Decision

**The route is removed. Nothing invalidates the three reference caches; their staleness is bounded
by `cacheLife("days")` alone.**

When an out-of-band edit must be visible sooner than the daily expiry, recreate the frontend
container — the cache lives in the container's own filesystem, so a recreation starts empty:

```bash
# prod (Linux)
docker compose up -d --force-recreate frontend
```

That is coarser than the route was — it drops every cached page, not three tags — and that trade is
accepted: reference data changes a few times a year, and the first requests after a recreation
rebuild from the backend in seconds.

- **Never re-add an invalidation endpoint for the reference caches** while those resources have no
  admin write surface. The durable fix is a write path that invalidates as it saves (FB-3 / FB-6,
  via `updateTag` inside the action, per [ADR-0001](0001-two-granular-cache-tags.md)) — not a
  second out-of-band mechanism.
- **Staleness under 24 hours on `saisons`, `spieler` or `spieltage` is not a defect.** It is the
  documented cost of this decision.

## Consequences

- The frontend has no route handlers outside `/api/auth`, so nginx's routing table
  (`/api` → FastAPI, `/api/auth` → Next) no longer protects anything on the Next side beyond
  Auth.js itself.
- A season rollover performed by hand is either followed by a container recreation or becomes fully
  visible within a day (`docs/workflows/README.md`, season rollover).
- `INTERNAL_API_KEY_SYSTEM` stays: the frontend still uses it to call the backend's system
  endpoints ([ADR-0014](0014-keep-the-system-endpoints.md)); the route was one consumer, not the
  reason it exists.

## Alternatives considered

**Keep the route until FB-3/FB-6 land** — ADR-0015's own retirement plan. Rejected by the owner:
the interim mechanism costs documentation, security posture and an operational procedure to
compress a 24-hour window that a container recreation compresses too.

**Shorten the cache lifetimes.** Rejected for the same reason ADR-0015 rejected it: it discards the
caching benefit on the most stable data in the system every day of the year, for an event that
happens a few times a year.
