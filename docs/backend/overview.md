# Backend — overview

**Scope:** `fl_backend/`

A FastAPI application over MongoDB. **No browser reaches a route here that reads or writes
application data**: the edge forwards two paths to this service, the liveness and the readiness
probe, which take no key; the readiness probe alone pings the database. Every other caller is the
Next.js container over the Docker network, which is why authentication is shared API keys plus
headers naming the person acting, rather than user sessions, and why this service sets no cache
headers of its own.

## How it is organised

| Folder             | Holds                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `app/main.py`      | The composition root, `create_app`: the routers, the middleware and the published OpenAPI document         |
| `app/core/`        | What every slice shares: configuration, the database and its constraints, security, errors, logging        |
| `app/shared/`      | Schemas and helpers more than one slice needs                                                              |
| `app/api/<slice>/` | One slice per entity or concern — its routers, `schemas.py`, `services.py` and `crud.py`, as it needs them |
| `tests/`           | The test suite, in two tiers (below)                                                                       |
| `openapi.json`     | The published contract, which `app/openapi_document.py` writes from the routes, committed                  |

A slice carries only the files it needs. **A router declares one access tier, and its file is named
for that tier**:

- `public_router.py`: the base key, for the public reads and the anonymous link writes alike
- `person_router.py`: a signed-in person's own records
- `admin_router.py`: the administration
- `system_router.py`: the frontend process's own calls, such as a retention pass

One file is named otherwise: `system/router.py`, the unguarded probes' (under Authorization). A
person's file serving two Funktionen holds one `APIRouter` per Funktion
(`spieler/person_router.py`). `app/main.py` mounts them all under `/api`, so a router's own prefix
opens with its slice's segment and never `/api`, and holds what all its routes share
(`/identity/self`). Each is mounted under its slice's tag, which with the handler's name makes the
operation's id in `openapi.json`.

## Addresses

**Every address is built by one rule**, which `fl_backend/tests/core/test_address_rule.py` holds
over the mounted routes, so a reader of a log line or a route table meets one shape:

1. `/api`, which carries no version: the one caller is the frontend built from the same commit.
2. The slice, which is the router's tag: `/teams`.
3. The records the call is about, each id after its collection's name. The slice's own record
   follows the slice directly (`/teams/{team_id}`), any other follows the name of its collection
   (`/aufstellungen/spiele/{spiel_id}/teams/{team_id}`).
4. `saisons/{saison_id}` last of those records where the address is season-scoped
   (`/teams/{team_id}/saisons/{saison_id}`), a part of the season's row after it
   (`/kontakte/{seat}`). In the saisons slice the season is the slice's own record and stands first
   (`/saisons/{saison_id}/teams/{team_id}`).
5. The act, in words with no id (`/confirmation/resend`, `/sweep`).

The signed-in person's own record takes `self` in the place of its id (`/spieler/self/saisons`),
since the session names it. **The tier is marked only where two tiers answer one method at one
address**, the administration's address then ending in `/admin`
(`/aufstellungen/spiele/{spiel_id}/teams/{team_id}/admin` beside the seat holder's): FastAPI serves
one route per method and path, and the first mounted would answer both. An id naming what the call
addresses is a path segment and a filter of a list a query, as
[the decisions record](../decisions.md)'s **routing** line requires: a malformed path id answers 404
and a query one 422.

## Write answers

**A write answers 204 with no body where its caller needs nothing back**, since a served field no
caller reads still has to be kept true. A write that answers something answers what its caller reads
next:

- A create answers `FLCreatedResponse`, the minted id the caller opens the new record by.
- An editor's save answers `FLVersionResponse`, the version its next save sends.
- A dry run or a pass answers the report its caller shows or counts, and a dry run whose caller
  reads only whether the write would be refused answers 204.
- An operation whose dry run answers a report answers it on its write too, where its caller may
  discard it, since its caller reads the report: the fixture save
  (`fl_backend/app/api/spiele/admin_router.py :: patch_spiel`) and the withdrawal
  (`fl_backend/app/api/identity/admin_router.py :: post_withdrawal`).
- A write behind the passkey touch whose typed input the backend judges is sent dry before the
  touch, so its refusal stands on a field while the input does, and its dry run answers 204 beside
  the write's own answer (`fl_backend/app/core/routing.py :: DRY_RUN_PASSED`): a create has no id to
  answer before it writes, and the caller sends the write on a pass. A touched write with no typed
  input, such as a removal or a re-send, takes no dry run, since its refusal has no field to stand
  on and no input to keep.

The shared models are in `fl_backend/app/shared/schemas/responses.py`.

## Authorization

**An access tier's guard sits on the `APIRouter`**, so an endpoint reaches the wrong tier only by
being written in the wrong file. `fl_backend/app/core/security.py` holds the three key guards and
reads the actor's headers. Each router passes its tier's guards as one constant, in the order they
run:

- **`base`** — the public pages' reads, and the forms a visitor submits (`BASE_TIER`).
- **`admin`** — every other read and write. An administrator's router also checks the actor's
  address against a stored grant (`Berechtigung`) on every request
  (`fl_backend/app/api/grants/guard.py :: ADMIN_TIER`); a signed-in person's router binds the record
  that admits them (their `Funktion`) instead (`PERSON_TIER`).
- **`system`** — the frontend process's own calls: the background passes, the Postausgang's hand-out
  and its delivery events, and the sign-in's reads of what one mailbox holds (`SYSTEM_TIER`).

Each guard presents its key as a bearer scheme of its own, `BaseKey`, `AdminKey` or `SystemKey`, so
an operation's `security` in `openapi.json` names the tier it takes.

The actor travels as three headers on an admin-key call, `X-FL-Actor`, `X-FL-Auth-Time` and
`X-FL-Auth-Factor`: the address, when its session was made, and by which factor
(`fl_backend/app/core/security.py :: get_session_actor`). The address travels as written, since
every sign-in address is ASCII, as RFC 9110 §5.5 asks of a header value; an empty one or one past
ASCII is refused as naming nobody. The admin key and the private network are what make them
believed. **`system/router.py` holds the two routes with no guard**: `/system/is_live`, the
container healthcheck and the public uptime probe, and `/system/is_ready`, which answers 503 where
the database does not answer a ping, for a monitor outside. A probe that needs a secret fails for
the wrong reasons.

## Data access

**The application refuses to start unless MongoDB answers and its indexes build**
(`fl_backend/app/core/db.py :: lifespan`, `fl_backend/app/core/constraints.py`). Nothing in the
database refuses a document's shape: each collection's record model states it
(`fl_backend/app/readback.py :: RECORD_MODELS`), and `python -m app.readback` reads every stored
document back through it after a migration has run.

**Every write that records a domain fact goes through the helpers in
`fl_backend/app/core/crud.py`**, while a router may read through the driver directly. The helpers
are keyword-only and accept a session, which is what lets a read inside a transaction see that
transaction's own writes. A request making more than one write makes them in one transaction, so a
refusal anywhere takes everything already written back with it. A background pass is the exception:
it takes its rows one at a time, each in a transaction of its own
(`fl_backend/app/core/transactions.py :: save_each`), save a clock whose one write no row can fail
alone, such as a plain deletion. A pass that fails part way therefore keeps what it finished, and
the next pass resumes from the stored state. A write helper records nothing: each recorded act adds
one line inside its transaction (`Aktion`, `fl_backend/app/core/recording.py :: record_act`).

**The domain's relations are [`../domain.md`](../domain.md)'s**, and each write enforces the rules
it is refused under where it writes. The league table is computed from the matches on each read of
the Tabelle (`GET /saisons/{saison_id}/tabelle`) and stored nowhere.

## Errors

**Every failure answers one body, `{error_code, trace_id, fields}`, whatever its status**, in the
shape of RFC 9457's problem details with this API's own members alone. `fields` names each body
field the refusal judged, each with its own `kind` and a domain rule's bounds as its `ctx`, and is
empty where it judged none. A bound can be another field of the same payload, such as a span's
start, but the body never carries the refused value or a stack trace. A code names one failure
rather than a status class, and `fl_backend/app/core/codes.py :: Code` is every code's one spelling.
`fl_backend/openapi.json` lists them once, as the failure body's `error_code` on the one shared
response every operation's `default` refers to, whatever the status. The status follows RFC 9110:
409 where the target's current state refuses the request, 422 where the payload contradicts itself,
404 where what it names does not exist, 403 only where the caller's own authority or standing does.
The handlers are `fl_backend/app/core/exception_handlers.py`.

**A request is judged in two passes, and each answers every fault it finds at once.** The first is
the parse: FastAPI validates the body against its model before the endpoint runs, and a body
breaking any field's rule answers `payload_refused` naming every such field. The second is the
endpoint's judge, which a well-formed body alone reaches. A judge asks its gates first, each through
`fl_backend/app/core/crud.py :: refuse`: a gate stops the write before any box means anything, such
as a record not found, a caller not allowed or a closed season. A gate is an `APIError`
(`fl_backend/app/core/exceptions.py`), and names at most the one field its sentence reads, such as
the record a retirement names in its path. Then the judge hands every independent check of a box to
one `refuse_faults` call, which raises one refusal naming each fault as its own entry. A box's fault
is a `FieldFault`, which nothing raises alone, and its code is one of `FieldCode`'s, each of which
the frontend words on its box. A check that means nothing once another failed sits in the same call
behind a guard on that check. The collected answer's code is its first fault's, and its status is
403 where any fault judged who asks, else 409 where any judged stored data, else 422.

## Time

A league date or kick-off is German wall-clock time (`Europe/Berlin`), carried as a `YYYY-MM-DD` or
`HH:MM:SS` string. It is compared as a string, which works because the format sorts
lexicographically, and is why the format is not negotiable. A moment, such as a deadline, a lock or
an action-log row's time, is a UTC instant
(`fl_backend/app/shared/schemas/custom.py :: FLUtcInstant`).

## Configuration

`fl_backend/app/core/config.py :: get_config` reads the variables from the environment and each
credential from its own file under `SECRETS_DIR`; a required one missing refuses the start.

## Tests

`uv run pytest` in `fl_backend/` runs the default tier, which needs no database.
`uv run pytest -m db` runs the tier marked `@pytest.mark.db`, against a real `mongod` it starts in
Docker; `fl_backend/pyproject.toml :: addopts` deselects that marker by default. Both need uv and
the Python `fl_backend/pyproject.toml :: requires-python` names, and the database tier a running
Docker daemon; `uv run pytest -m db <file>` runs one file of it. `fl_backend/tests/README.md` lists
what each support module provides.

## Read next

- [`../domain.md`](../domain.md) — the model these routes implement, and what a write owes its
  neighbours
- [`../glossary.md`](../glossary.md) — the German domain vocabulary
- [`../frontend/overview.md`](../frontend/overview.md) — the client behind every application route
- [`../ops/overview.md`](../ops/overview.md) — the container this runs in
