# Backend — overview

**Scope:** `fl_backend/`

A FastAPI application over MongoDB. **No browser reaches a route here that reads or writes application
data.** The edge carries one exact-match path to this service, the liveness probe, which takes no key
and touches no database ([`../ops/spec.md`](../ops/spec.md) I13), so every caller of a route serving
application data is the Next.js container over the Docker network — which is why authentication is
shared API keys rather than user sessions, and why this service sets no cache headers of its own: what
reaches a reader cached was cached by the frontend or by the edge ([`../ops/spec.md`](../ops/spec.md)
§1.3). The one cache it keeps is internal — a TTL-bounded, process-local read of season documents
(`fl_backend/app/api/saisons/cache.py`), dropped whole on the write path.

## How it is organised

`app/api/<slice>/` is the repeating unit — usually one entity, and `kontakte` a concern crossing
every collection that holds a contact block. **A slice carries only the files it needs, its routers
included**, because a router declares one tier ([`spec.md`](spec.md) I7): a slice with nothing public
to offer declares no `router.py`, and `bewerbungen`, whose application form reads and writes at a
tier neither its `router.py` nor its `admin_router.py` carries, declares a third, `public_router.py`.

## Authorization

Three key tiers — `base` behind the public pages, `admin` for every other write and every read the
base tier may not make, `system` for health and diagnostics ([`spec.md`](spec.md) §1.1). Guards sit
on the `APIRouter` rather than on an endpoint
([`spec.md`](spec.md) I7), so an endpoint reaches the wrong authorization only by being written in
the wrong file. **What the file name does not settle is the tier**: a read router declares its own,
so a slice only the admin surfaces read is guarded `admin` throughout.

**`system` is the one slice whose router carries no guard** ([`spec.md`](spec.md) I7), so an endpoint
added there is unauthenticated until it declares its own. `/system/is_live` declares none
deliberately — it is the container healthcheck and the public uptime probe both, and a probe that
needs a secret fails for the wrong reasons.

## Data access

**The application refuses to start unless MongoDB answers and the database's own constraints apply**
([`spec.md`](spec.md) I9 and I15) — so the cluster cannot hold a set this repository does not
describe, and a constraint survives a restore.

**Those validators are a hand-written copy of the Pydantic models**, which keeps the rules where a
hand edit lands: `saison_teams` has write payloads but no stored-document model, and Compass is
reachable whatever the API offers. What holds the copy to its model is [`spec.md`](spec.md) I17; the
database user's `collMod` requirement is [`spec.md`](spec.md) §4.

**Shared database access goes through the helpers in `fl_backend/app/core/crud.py`.** The driver
helpers are keyword-only and take a session, which is what lets a read inside a transaction see that
transaction's own writes. The query and sort builders behind a list read are pure, so no resource
translates a filter term or a tie-break chain its own way. A handler reaches for the driver directly
only to iterate a cursor, to sort a single-document read, to count without reading the documents, or
where absence is a meaningful answer rather than a 404; the miss contract every helper keeps is
[`spec.md`](spec.md) I2.

## Time

Dates and times are German wall-clock (`Europe/Berlin`), injected as strings. Match dates are
`YYYY-MM-DD` and are compared as strings, which works because the format sorts lexicographically —
and is why the format is not negotiable.

## Errors

Every failure the application raises carries an `error_code`, so a log line names a specific failure
rather than a status class ([`docs/logging/error-codes.md`](../logging/error-codes.md)).

## Read next

- [`spec.md`](spec.md) — the endpoint inventory, the contracts, the test suite and the invariants
- [`../glossary.md`](../glossary.md) — the German domain vocabulary
- [`../frontend/overview.md`](../frontend/overview.md) — the client behind every application route
- [`../ops/overview.md`](../ops/overview.md) — the container this runs in
