# Backend — overview

**Scope:** `fl_backend/`

A FastAPI application over MongoDB. **No browser reaches a route here that reads or writes application
data**: the edge forwards one path to this service, the liveness probe, which takes no key and touches
no database. Every other caller is the Next.js container over the Docker network, which is why
authentication is shared API keys plus headers naming the person acting, rather than user
sessions, and why this service sets no cache headers of its own.

## How it is organised

| Folder             | Holds                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `app/main.py`      | The composition root, `create_app`: the routers, the middleware and the published OpenAPI document         |
| `app/core/`        | What every slice shares: configuration, the database and its constraints, security, errors, logging        |
| `app/shared/`      | Schemas and helpers more than one slice needs                                                              |
| `app/api/<slice>/` | One slice per entity or concern — its routers, `schemas.py`, `services.py` and `crud.py`, as it needs them |
| `tests/`           | The test suite, in two tiers (below)                                                                       |
| `openapi.json`     | The published contract, which `app/openapi_document.py` writes from the routes, committed                  |

A slice carries only the files it needs. **A router declares one access tier**, so a slice reached at
two tiers has two routers: `router.py` for its reads, at the tier its readers need, `admin_router.py`
for the administration, and further routers named for their caller, such as
`bewerbungen/public_router.py` for the public application form or a `sweep_router.py` for a
retention pass. `app/main.py` mounts them all, each under its slice's tag, which with the handler's
name makes the operation's id in `openapi.json`.

## Authorization

**An access tier's guard sits on the `APIRouter`**, so an endpoint reaches the wrong tier only by
being written in the wrong file. `fl_backend/app/core/security.py` holds the guards:

- **`base`** — the public pages' reads, and the forms a visitor submits.
- **`admin`** — every other read and write. An administrator's router also checks the actor's
  address against a stored grant (`Berechtigung`) on every request; a signed-in person's router binds
  the record that admits them (their `Funktion`) instead.
- **`system`** — the frontend process's own calls: the retention sweeps, the mail delivery events and
  the subject lookup.

Each guard presents its key as a bearer scheme of its own, `BaseKey`, `AdminKey` or `SystemKey`, so
an operation's `security` in `openapi.json` names the tier it takes.

The actor travels as three headers on an admin-key call, `X-FL-Actor`, `X-FL-Auth-Time` and
`X-FL-Auth-Factor`: the address, when its session was made, and by which factor
(`fl_backend/app/core/security.py :: get_session_actor`). The address travels as UTF-8,
percent-encoded as `encodeURIComponent` spells it, since a header value is ASCII; any other spelling
is refused as naming nobody. The admin key and the private network are
what make them believed. **`system/router.py` holds the two routes with no guard**:
`/system/is_live`, both the container healthcheck and the public uptime probe, since a probe that
needs a secret fails for the wrong reasons, and the service's root `/`.

## Data access

**The application refuses to start unless MongoDB answers and its indexes build**
(`fl_backend/app/core/db.py :: lifespan`, `fl_backend/app/core/constraints.py`). Nothing in the
database refuses a document's shape: each collection's record model states it
(`fl_backend/app/core/readback.py :: RECORD_MODELS`), and `python -m app.core.readback` reads every
stored document back through it after a migration paste.

**Every write that records a domain fact goes through the helpers in
`fl_backend/app/core/crud.py`**, while a router may read through the driver directly. The helpers
are keyword-only and accept a session, which is what lets a read inside a transaction see that
transaction's own writes. A request making more than one write makes them in one transaction, so
a refusal anywhere takes everything already written back with it. Every helper write except an
anchor (`fl_backend/app/core/crud.py :: anchor_in_db` and `:: anchor_by_id_in_db`), which changes
nothing a reader sees, records what it replaced or removed on the action log (`Aktion`,
`fl_backend/app/core/recording.py`), attributed to the actor its router bound.

**The domain's relations are [`../domain.md`](../domain.md)'s**, and each write enforces the
rules it is refused under where it writes. The league table is computed from the matches on each
read of `GET /teams` and stored nowhere.

## Errors

**Every failure answers `{error_code, trace_id}`**, a refused payload adding which field each
refusal sits on, and never the submitted value or a stack trace. A code names one failure rather
than a status class, and `fl_backend/app/core/codes.py :: Code` is every code's one spelling:
`fl_backend/openapi.json` lists them once, as the failure body's `error_code` on the one shared
response each status refers to, and never per operation. The status
follows RFC 9110: 409 where the target's current state refuses the request, 422 where the payload
contradicts itself, 404 where what it names does not exist, 403 only where the caller's own
authority or standing does. Every refusal is one `APIError(status, code)`
(`fl_backend/app/core/exceptions.py`), and the handlers are
`fl_backend/app/core/exception_handlers.py`.

## Time

Dates and times are German wall-clock (`Europe/Berlin`), carried as strings. Match dates are
`YYYY-MM-DD` and compared as strings, which works because the format sorts lexicographically, and is
why the format is not negotiable.

## Configuration

`fl_backend/app/core/config.py :: get_config` reads the variables from the environment and each
credential from its own file under `SECRETS_DIR`; a required one missing refuses the start.

## Tests

`uv run pytest` in `fl_backend/` runs the default tier, which needs no database.
`uv run pytest -m db` runs the tier marked `@pytest.mark.db`, against a real `mongod` it starts in
Docker; `fl_backend/pyproject.toml :: addopts` deselects that marker by default.
`fl_backend/tests/README.md` lists what each support module provides.

## Read next

- [`../domain.md`](../domain.md) — the model these routes implement, and what a write owes its neighbours
- [`../glossary.md`](../glossary.md) — the German domain vocabulary
- [`../frontend/overview.md`](../frontend/overview.md) — the client behind every application route
- [`../ops/overview.md`](../ops/overview.md) — the container this runs in
