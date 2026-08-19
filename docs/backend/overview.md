# Backend — overview

**Verified against:** `3f15ba0`, 2026-08-13\
**Scope:** `fl_backend/`

A FastAPI application over MongoDB, with a read router and a write router per resource plus `system`.
The single fact that explains most of its shape: **no browser ever talks to this service.** nginx
routes `/api` here, but the only client is the Next.js container making server-side calls — which is
why authentication is shared API keys rather than user sessions, and why caching lives entirely in the
frontend. The endpoint inventory is [`spec.md`](spec.md) §1.1.

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

`api/<entity>/` is the repeating unit. `router.py` declares endpoints and does orchestration;
`schemas.py` holds the Pydantic models; `services.py` holds pure query-building and computation; and
`crud.py` holds slice-level database access that more than one endpoint needs, or that is too large to
sit inside a handler. A slice carries only the files it needs: `services.py` where there is real logic
to hold, `crud.py` where more than one endpoint reaches the database the same way.

Every entity package under `app/api/` has a `router.py` and an `admin_router.py`, and all are mounted
under `/api/v{API_VERSION}`, which is a constant of the code rather than a setting
([`spec.md`](spec.md) §1.5).

## Authorization

Bearer keys, not user identities:

| Key      | Guards                                | Used by                |
| -------- | ------------------------------------- | ---------------------- |
| `base`   | every read router                     | every normal page load |
| `admin`  | every write router                    | every mutation         |
| `system` | `/system/is_ready` and `/system/info` | health and diagnostics |

Guards sit on the `APIRouter` rather than on an endpoint, so an endpoint reaches the wrong
authorization only by being written in the wrong file ([`spec.md`](spec.md) I7). `/system/is_live` is
deliberately unguarded: it is the container healthcheck, and a healthcheck that needs a secret is a
healthcheck that fails for the wrong reasons.

## Data access

Motor, async throughout, with the client created once in the FastAPI `lifespan` and attached to
`app.state`. Collections are injected as typed dependencies (`SpieleCollection`, `TeamsCollection`, …)
rather than reached for directly.

**The application refuses to start unless MongoDB answers and the database's own constraints apply.**
`lifespan` pings the server, then `core/constraints.py` reapplies every `$jsonSchema` validator and
unique index on every boot ([`spec.md`](spec.md) I9 and I15) — so the cluster cannot hold
a set this repository does not describe, and a constraint survives a restore. The validators are a
hand-written third copy of the schema rather than a generated one
([`spec.md`](spec.md) I17), which is what keeps the rules where a hand edit lands: `saison_teams` and
`saison_spieler` have write payloads but no stored-document model, and Compass is reachable whatever the
API offers. The database user's `collMod` requirement is [`spec.md`](spec.md) §4.

**Shared database access goes through the helpers in `core/crud.py`**; a handler needing a
session-scoped or projected read calls Motor directly. The one helper carrying a trap is
`patch_one_in_db`, whose `return_document` defaults to `ReturnDocument.BEFORE` —
[`spec.md`](spec.md) I2 states what depends on that and which handlers override it.

## Time

Dates and times are German wall-clock, injected as strings via
`get_german_date_str` / `get_german_time_str` (`Europe/Berlin`). Match dates are `YYYY-MM-DD` strings
and are compared as strings — which works because the format sorts lexicographically, and is why the
format is not negotiable.

## Errors

Every failure is a `BaseAPIException` carrying an `error_code` alongside a message
(`REQ-AUTH-002`, `DB-CONN-001`, `DB-COMMON-001`), so a log line names a specific failure rather than a
status class. The subclasses, the handlers in `app/core/exception_handlers.py` that carry codes of their
own, the full table, and the rule that every failure response is `{error_code, correlation_id}` are
[`docs/logging/error-codes.md`](../logging/error-codes.md).

## Testing

`fl_backend/tests/` runs in **two tiers**: a default tier that needs no
database, and a `db` tier carrying `@pytest.mark.db`, deselected by default, that runs against a real
`mongod`. What each tier executes is [`spec.md`](spec.md) §1.6, and what the suite reaches only
indirectly is [`spec.md`](spec.md) §4.

The frontend mirrors the backend's validation constraints in Zod rather than enforcing them itself, so
this suite is the only regression net under them. The frontend's toolchain runs nothing against the
backend, which is why `scripts/verify.sh` runs ruff and pytest as a separate step.

## Read next

- [`spec.md`](spec.md) — the endpoint inventory, the contracts and the invariants
- [`../glossary.md`](../glossary.md) — the German domain vocabulary
- [`../frontend/overview.md`](../frontend/overview.md) — the only client
- [`../ops/overview.md`](../ops/overview.md) — the container this runs in
