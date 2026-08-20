# Backend — overview

**Verified against:** `889c31dd`, 2026-08-19\
**Scope:** `fl_backend/`

A FastAPI application over MongoDB, with a read router and a write router per resource plus `system`. The
single fact that explains most of its shape: **no browser ever talks to this service.** nginx routes `/api`
here, but the only client is the Next.js container making server-side calls — which is why authentication is
shared API keys rather than user sessions, and why caching lives entirely in the frontend. The endpoint
inventory is [`spec.md`](spec.md) §1.1.

## How it is organised

```
fl_backend/
├── app/
│   ├── asgi.py        the process entry point — the ONE module that builds an app on import
│   ├── main.py        `create_app()`: middleware, router registration. Builds nothing on import
│   ├── core/          infrastructure: config · db · security · crud · dependencies · routing
│   │                  exceptions · exception_handlers · middlewares · logging
│   │                  collections · constraints · domain — the declarations read as data
│   ├── api/<entity>/  one package per entity: router · admin_router · schemas · services · crud
│   │                  saisons adds cache.py and schedule.py
│   └── shared/        schemas reused across entities (addresses, kontakt, custom types)
└── tests/             pytest — schema constraints by default; `-m db` adds a real mongod
```

`api/<entity>/` is the repeating unit: `router.py` declares endpoints and orchestrates, `schemas.py` holds
the Pydantic models, `services.py` holds pure query-building and computation, and `crud.py` holds
slice-level database access more than one endpoint needs. A slice carries only the files it needs. Every
entity package but `system` has both routers, all mounted under `/api/v{API_VERSION}`, a constant of the code
rather than a setting ([`spec.md`](spec.md) §1.5).

## Authorization

Bearer keys, not user identities:

| Key      | Guards                                | Used by                |
| -------- | ------------------------------------- | ---------------------- |
| `base`   | every read router                     | every normal page load |
| `admin`  | every write router                    | every mutation         |
| `system` | `/system/is_ready` and `/system/info` | health and diagnostics |

Guards sit on the `APIRouter` rather than on an endpoint, so an endpoint reaches the wrong authorization only
by being written in the wrong file ([`spec.md`](spec.md) I7). `/system/is_live` is deliberately unguarded: it
is the container healthcheck, and a healthcheck that needs a secret fails for the wrong reasons.

## Data access

Motor, async throughout, with the client created once in the FastAPI `lifespan` and attached to `app.state`.
Collections are injected as typed dependencies rather than reached for directly.

**The application refuses to start unless MongoDB answers and the database's own constraints apply.**
`lifespan` pings the server, then `core/constraints.py` reapplies every `$jsonSchema` validator and unique
index on every boot ([`spec.md`](spec.md) I9 and I15) — so the cluster cannot hold a set this repository does
not describe, and a constraint survives a restore. Those validators are a hand-written copy of the schema,
which keeps the rules where a hand edit lands: `saison_teams` and `saison_spieler` have write payloads but no
stored-document model, and Compass is reachable whatever the API offers. What holds the copy to its model is
[`spec.md`](spec.md) I17; the database user's `collMod` requirement is §4.

**Shared database access goes through the helpers in `core/crud.py`**, a module in sections. The driver
helpers are keyword-only and take a session, which is what lets a read inside a transaction see that
transaction's own writes. The query and sort builders behind a list read are pure, so no resource
translates a filter term or a tie-break chain its own way. The rest is what a write does beyond the driver
call: a refusal turned into the 409 it means, a retirement written as a date on `inactive_since`, a create
stamped live. A handler reaches for Motor directly only to iterate a cursor, to sort a single-document
read, to count without reading the documents, or where absence is a meaningful answer rather than a 404.
One contract governs the module: a `*_one_*` helper raises on a miss and never returns `None` —
[`spec.md`](spec.md) I2.

## Time

Dates and times are German wall-clock (`Europe/Berlin`), injected as strings. Match dates are `YYYY-MM-DD`
and are compared as strings, which works because the format sorts lexicographically — and is why the format
is not negotiable.

## Errors

Every failure is a `BaseAPIException` carrying an `error_code`, so a log line names a specific failure rather
than a status class. The subclasses, the handlers carrying codes of their own, the full table and the rule
that every failure response is `{error_code, correlation_id}` are
[`docs/logging/error-codes.md`](../logging/error-codes.md).

## Testing

`fl_backend/tests/` runs in **two tiers**: a default tier needing no database, and a `db` tier carrying
`@pytest.mark.db`, deselected by default, that runs against a real `mongod` ([`spec.md`](spec.md) §1.6, and
§4 for what the suite reaches only indirectly).

The frontend mirrors the backend's validation constraints in Zod rather than enforcing them itself, so this
suite is the only regression net under them — and the frontend's toolchain runs nothing against the backend,
which is why `scripts/verify.sh` runs ruff and pytest as a separate step.

## Read next

- [`spec.md`](spec.md) — the endpoint inventory, the contracts and the invariants
- [`../glossary.md`](../glossary.md) — the German domain vocabulary
- [`../frontend/overview.md`](../frontend/overview.md) — the only client
- [`../ops/overview.md`](../ops/overview.md) — the container this runs in
