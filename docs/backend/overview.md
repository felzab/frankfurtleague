# Backend — overview

**Verified against:** `179f802`, 2026-08-02
**Scope:** `fl_backend/`

A FastAPI application over MongoDB. It is a **read-mostly API with one real write path**: nine routers,
of which eight only read, and one — `admin` — performs every mutation the product supports.

The single fact that explains most of its shape: **no browser ever talks to this service.** nginx routes
`/api` here, but the only client is the Next.js container making server-side calls. That is why
authentication is three shared API keys rather than user sessions, why there is no CORS story worth
speaking of, and why caching lives entirely in the frontend.

## How it is organised

```
fl_backend/
├── main.py            uvicorn entry point (thin — imports app.main)
├── app/
│   ├── main.py        FastAPI app, middleware, router registration
│   ├── core/          infrastructure: config · db · security · crud · dependencies
│   │                  exceptions · exception_handlers · middlewares · logging
│   ├── api/<entity>/  one package per entity: router · schemas · services · crud
│   └── shared/        schemas reused across entities (addresses, kontakt, custom types)
└── tests/             pytest — schema-constraint tests, no running server needed
```

`api/<entity>/` is the repeating unit. `router.py` declares endpoints and does orchestration;
`schemas.py` holds the Pydantic models; `services.py` holds pure query-building and computation. Not
every entity has all four files — `services.py` exists only where there is real logic to hold.

There are nine routers: `admin`, `saisons`, `schiedsrichter`, `spiele`, `spieler`, `spielorte`,
`spieltage`, `system`, `teams`. All are mounted under `/api/v{API_VERSION}`.

## Authorization

Three bearer keys, not user identities:

| Key      | Guards                                | Used by                |
| -------- | ------------------------------------- | ---------------------- |
| `base`   | the seven read routers                | every normal page load |
| `admin`  | the whole `admin` router              | admin mutations        |
| `system` | `/system/is_ready` and `/system/info` | health and diagnostics |

Comparison is constant-time (`secrets.compare_digest`). Guards are applied **at router level**, so a
new endpoint inherits its router's protection rather than needing its own decorator — the one design
choice here that actively prevents a class of mistake.

`/system/is_live` is deliberately unguarded: it is the container healthcheck, and a healthcheck that
needs a secret is a healthcheck that fails for the wrong reasons.

## Data access

Motor, async throughout, with the client created once in the FastAPI `lifespan` and attached to
`app.state`. Collections are injected as typed dependencies (`SpieleCollection`, `TeamsCollection`, …)
rather than reached for directly.

**The application crashes at startup if MongoDB is unreachable.** `lifespan` pings the server and
re-raises anything that fails. This is intentional: a container that starts without a database is a
container that serves errors, and the healthcheck would rather it never come up.

All raw database access goes through six helpers in `core/crud.py`. One of them carries a trap worth
knowing before you read any write code: **`patch_one_in_db` returns the document as it was _before_ the
update** — its `return_document` defaults to `ReturnDocument.BEFORE`. The venue and referee patches
pass `ReturnDocument.AFTER` explicitly, because they fan the new values out into every match embedding
them; a caller that forgets would fan out the values it just replaced.

## Time

Dates and times are German wall-clock, injected as strings via
`get_german_date_str` / `get_german_time_str` (`Europe/Berlin`). Match dates are `YYYY-MM-DD` strings
and are compared as strings — which works because the format sorts lexicographically, and is why the
format is not negotiable.

## Errors

Every failure is a `BaseAPIException` carrying an `error_code` alongside a message
(`REQ-AUTH-002`, `DB-CONN-001`, `DB-COMMON-001`), so a log line names a specific failure rather than a
status class. Three exist today: authorization (401), database unavailable (503, with `Retry-After`),
and document not found (404).

## Testing

`fl_backend/tests/` holds 111 test functions which expand to **247 cases** under parametrisation, run by
`pytest`. They test **schema constraints** — that the models reject what they should — plus the rules
encoded in `build_team_pipeline`, and need no running server or database.

Tests live in a separate `tests/` tree rather than beside the code, unlike the frontend. That is
Python's convention and it has a reason: a `tests` package inside `app/` would be importable as
`app.tests` and would ship with the application. `--import-mode=importlib` is what additionally lets
`tests/` work without `__init__.py` files and lets two test modules share a basename.

That focus is the point: the frontend mirrors roughly forty backend validation constraints in Zod
rather than enforcing them itself, and those constraints had no regression net until these tests
existed. `pnpm verify` on the frontend runs nothing against the backend, so `scripts/verify.sh` runs
ruff and pytest as a separate step.

**What the no-database boundary excludes, and it matters more since ADR-0026:** the league table is
computed by an aggregation pipeline, so the tests can assert what the pipeline _says_ and never what
MongoDB _returns_ for it. See [`../../fl_backend/tests/README.md`](../../fl_backend/tests/README.md).

## Read next

- [`spec.md`](spec.md) — endpoint inventory, contracts, invariants
- [`../glossary.md`](../glossary.md) — the German domain vocabulary
- [`../frontend/overview.md`](../frontend/overview.md) — the only client
