# ADR-0015 — Backend-triggered revalidation through an in-network route

**Status:** Superseded by [ADR-0035](0035-reference-data-staleness-is-bounded-by-cache-lifetime.md)
**Date:** 2026-07-30
**Surface:** frontend, ops
**Supersedes:** —
**Superseded by:** [ADR-0035](0035-reference-data-staleness-is-bounded-by-cache-lifetime.md)
**Source:** remediation ledger question Q5, implemented as BE-3

## Context

`saisons`, `spieler` and `spieltage` have no frontend write surface — they are edited directly in
MongoDB, through Compass or an ad-hoc script — and are cached with `cacheLife("days")`.

An out-of-band edit was therefore served stale for **up to 24 hours**, with no way to clear it short of
redeploying.

The owner confirmed such edits do happen, occasionally.

## Decision

**Add `POST /api/revalidate` to the frontend.**

- Accepts a **resource name from a fixed enum** — `saisons` · `spieler` · `spieltage` — never a raw
  cache tag.
- Authenticates with `Bearer` + `INTERNAL_API_KEY_SYSTEM`, compared with `timingSafeEqual` after a
  length check.
- Calls `revalidateTag(resource, "max")` — the **coarse base tag only**.
- Called by hand from inside the frontend container (the invocation is documented in
  `docs/workflows/README.md`); no code path in the repository calls it.

## Consequences

**Its security rests on network topology, and that is deliberate.** nginx routes `/api` to FastAPI and
carves out only `/api/auth` for Next, so no external request can reach `/api/revalidate` at all. The
only possible caller is already inside the compose network.

**Adding an nginx location for this path would publish it.** That warning lives at the top of the route
file, in the ops spec as invariant I2, and here.

Two implementation constraints that are easy to get wrong:

- It must use `revalidateTag`, **not** `updateTag`. The latter throws in a Route Handler — it exists for
  read-your-own-writes inside a Server Action, which this is not.
- Taking a resource name rather than a tag means a caller cannot invalidate anything the route does not
  explicitly permit, even though the caller is already trusted.

The script runs the request _inside_ the container so the API key is read from the container's own
environment and never reaches a shell history.

Invalidation is coarse by choice. Granularity would mean reviving tags deleted under
[ADR-0001](0001-two-granular-cache-tags.md), and is only worth it if a full reference-data refresh
proves too blunt in practice — which it has not.

**This is retired when those three resources get a real write path** (ledger BE-4), at which point they
revalidate themselves like every other mutation and the script becomes unnecessary.

## Alternatives considered

**Shorten the cache lifetimes.** The obvious fix, and rejected as the wrong trade: it would discard the
caching benefit on genuinely stable reference data every day of the year, to handle an event that
happens a few times a year.

**Have FastAPI call the route after writing.** This is the intended end state and is exactly what BE-4
describes — but there is no backend write path for these three resources today, so there is nothing to
hook. The script is the interim.

**Expose the route publicly with a stronger secret.** Rejected: a secret is a weaker guarantee than
unreachability, and there is no caller outside the network that needs it.
