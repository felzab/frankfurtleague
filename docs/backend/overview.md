# Backend — overview

**Verified against:** `e73cc01`, 2026-08-02
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
└── tests/             pytest — schema constraints by default; `-m db` adds a real mongod
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

**It also crashes if the database's own constraints cannot be applied**, which happens in the same
place immediately after the ping. `core/constraints.py` declares a `$jsonSchema` validator for each of
the nine collections and four unique indexes, and reapplies all of them on every boot
([ADR-0027](../_decisions/0027-the-database-enforces-its-own-invariants.md)) — so the cluster can never
hold a set this repository does not describe, and a constraint survives a restore. Every collection now
has endpoints that write it
([ADR-0034](../_decisions/0034-the-write-path-is-resource-first-in-a-second-router.md)), but the rules
stay where the hand-edit lands: `saison_teams` and `saison_spieler` have no Pydantic model at all, and
Compass remains reachable whatever the API offers.

Two things about that module are easy to get wrong:

- **The validators are a hand-written third copy of the schema, and that is deliberate**
  ([ADR-0031](../_decisions/0031-the-third-copy-of-the-schema-is-checked-not-generated.md)). Generating
  them from the Pydantic models types every ObjectId reference as a string, because `CustomObjectId`
  emits a bare `{"type": "string"}` in JSON mode (BE-6) — which would bless the exact defect the
  validators exist to refuse. A default-tier test compares the two copies field-by-field instead, so a
  model changed without its validator fails `./scripts/verify.sh` naming the field.
- **The database user needs `collMod`**, a `dbAdmin` action that `readWrite` and
  `readWriteAnyDatabase` do not carry — though both do carry `createIndex`, so the indexes build and
  the validators do not. Run `python -m app.core.constraints --check` to see the answer, along with
  every document the validators would reject and every key group that would stop an index building. It
  writes nothing, and it is what to run before deploying a change to that file.

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

`fl_backend/tests/` runs in **two tiers** since
[ADR-0030](../_decisions/0030-a-real-mongod-behind-a-deselected-marker.md).

The **default tier** is **294 cases** under parametrisation and finishes in about 0.4 seconds. It
tests **schema constraints** — that the models reject what they should — plus the rules encoded in
`build_team_pipeline` and the database constraints read as data, and needs no running server, no
database and no Docker.

The **`db` tier** is **52 cases** carrying `@pytest.mark.db`, deselected by default and run with
`pytest -m db`. They start a real `mongod` and execute two things the default tier can only describe:
the league-table pipeline against a seeded corpus, because a pipeline is a dict MongoDB runs; and the
`$jsonSchema` validators, because `required` inside a nullable sub-schema, and `bsonType: "int"` faced
with a `80.0`, both behave in ways worth measuring rather than assuming.

Tests live in a separate `tests/` tree rather than beside the code, unlike the frontend. That is
Python's convention and it has a reason: a `tests` package inside `app/` would be importable as
`app.tests` and would ship with the application. `--import-mode=importlib` is what additionally lets
`tests/` work without `__init__.py` files and lets two test modules share a basename.

That focus is the point: the frontend mirrors roughly forty backend validation constraints in Zod
rather than enforcing them itself, and those constraints had no regression net until these tests
existed. `pnpm verify` on the frontend runs nothing against the backend, so `scripts/verify.sh` runs
ruff and pytest as a separate step.

**What is still uncovered:** routers, CRUD and authentication. That boundary belongs to the planned
backend audit, which wants one strategy across those layers — and which now inherits the `mongod`
fixture rather than having to invent one.
See [`../../fl_backend/tests/README.md`](../../fl_backend/tests/README.md).

## Read next

- [`spec.md`](spec.md) — endpoint inventory, contracts, invariants
- [`../glossary.md`](../glossary.md) — the German domain vocabulary
- [`../frontend/overview.md`](../frontend/overview.md) — the only client
