# Logging and error handling — the convention

**Verified against:** `b5324b8`, 2026-08-08
**Governing decision:** [ADR-0039](_decisions/0039-one-correlation-id-per-request-one-document-per-line.md)

The one description of how a request is followed across nginx, the frontend and the backend, what a
log line looks like on each surface, and what an error code is. Cross-cutting, so it lives at the
root like the [glossary](glossary.md); each surface spec cites it rather than restating it.

| Section                                     | Answers                                          |
| ------------------------------------------- | ------------------------------------------------ |
| [The correlation id](#the-correlation-id)   | What the id is, who mints it, who validates it   |
| [The stream contract](#the-stream-contract) | What a log line is on each surface               |
| [Error codes](#error-codes)                 | The taxonomy, the full table, the response shape |
| [Finding an incident](#finding-an-incident) | How to get from a symptom to the right lines     |
| [Client-side crashes](#client-side-crashes) | The one browser-to-log path                      |
| [Development logging](#development-logging) | How each surface logs outside the containers     |
| [Invariants](#invariants)                   | The rules the tests pin                          |

---

## The correlation id

**One id per HTTP request: 32 lowercase hex, minted at the edge.** nginx sets `X-Correlation-ID` to
its own `$request_id` on every proxied request and discards anything the client sent — an
attacker-chosen id would otherwise appear verbatim in three surfaces' logs.

| Surface  | Behaviour                                                                                                                                               | Where                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| nginx    | Mints unconditionally, logs it, forwards it to both upstreams                                                                                           | `nginx/prod.conf :: proxy_set_header X-Correlation-ID`                             |
| Backend  | Honours a well-formed incoming id, mints otherwise, echoes it on the response, binds it to a ContextVar every log record reads                          | `fl_backend/app/core/middlewares.py :: CorrelationIdMiddleware`                    |
| Frontend | Every dynamic caller seeds a request scope from the incoming headers; `apiClient` reads it and sends it upstream, minting only where no scope can exist | `fl_frontend/src/shared/utils/correlationScope.ts :: runWithIncomingCorrelationId` |

A well-formed id is `[a-f0-9]{8,64}` — both validators (`fl_backend/app/core/middlewares.py ::
WELL_FORMED_ID`, `fl_frontend/src/core/correlation.ts :: isWellFormedCorrelationId`) refuse anything
else, so a malformed or hostile header is replaced, never propagated.

**The cache-fill boundary.** A `"use cache"` execution is shared by later requests, so Next refuses
request APIs inside one and no page-request id can exist there. A cached read's backend fetch
therefore carries a freshly minted id of its own (`fl_frontend/src/core/api.ts :: apiClient`). The
consequences, stated plainly:

- A **cache hit** issues no request and produces no application log line at all. The nginx access
  line is the only record of that page view — which is why the edge logs every request.
- A **cache fill**'s backend access line joins to the frontend error if the fill fails (the error
  carries the fill's id), but never to the page view that happened to trigger the fill.
- An **uncached read inside a page render** runs under the real request id, because it seeds the
  scope explicitly. One query is in this position —
  `fl_frontend/src/features/admin/queries.ts :: getAdminSpieleActionRequired`, uncached by
  [ADR-0013](_decisions/0013-admin-action-required-uncached.md) — and being uncached is exactly
  what makes the seeding legal: `headers()` is a request API, so the same call inside a `"use cache"`
  scope raises `next-request-in-use-cache` rather than failing quietly.
- A **server action** (every admin write) and a **route handler** likewise run with the real request
  id end-to-end: their backend lines carry the same id as the nginx line.

**Everything dynamic seeds through one seam**,
`fl_frontend/src/shared/utils/correlationScope.ts :: runWithIncomingCorrelationId`. It reads the
edge-minted id off the incoming headers, validates it, and runs its caller under it. It lives in
`shared/` rather than beside the storage in `core/requestScope.ts` for a packaging reason worth
knowing before moving it: `core/logging.ts` is reachable from the Edge middleware bundle through
`core/auth.ts` and `src/proxy.ts`, and `next/headers` is a request-only API that must not be bundled
for that runtime.

Lines written outside any request — boot, lifecycle — carry the sentinel `SYSTEM`, so the
`correlation_id` key exists on every line.

## The stream contract

**Each service writes one stream, one JSON document per line, in production.** The selector is
`LOG_FORMAT` (`json` | `console`) on both services; the backend **defaults to `json`**
(`fl_backend/app/core/config.py :: log_format`), the frontend requires the variable and validates it
as an enum (`fl_frontend/src/core/config.ts :: LOG_FORMAT`). Both normalise case, so `JSON` selects
what `json` selects.

Shared fields, identical names and meanings on every surface:

| Field            | Content                                                            |
| ---------------- | ------------------------------------------------------------------ |
| `timestamp`      | ISO 8601, UTC, millisecond precision, `Z` suffix                   |
| `level`          | `DEBUG` / `INFO` / `WARNING` / `ERROR` / `CRITICAL` — never `WARN` |
| `service`        | `fl_backend` / `fl_frontend` / `nginx`                             |
| `correlation_id` | The request's id, or `SYSTEM` outside any request                  |
| `message`        | Human-readable text                                                |
| `error_code`     | Present on every failure line — see [Error codes](#error-codes)    |
| `error`          | `{name, message, stack}` when an exception is attached             |

Per-surface extras: the backend adds `module`/`line` and the access-line fields
(`method`, `path`, `status`, `duration_ms`); nginx adds `duration_s`, `upstream_duration_s`,
`bytes`, `client`, `x_forwarded_for`, `host`, `referer`, `user_agent`; the frontend adds whatever a
call site passes (`digest`, `route`, `fetch_correlation_id`).

How each surface keeps its stream to one format:

- **Backend:** uvicorn runs with `--no-access-log` and a log config that propagates its loggers to
  the application handler (`fl_backend/Dockerfile :: CMD`,
  `fl_backend/app/core/uvicorn_logging.json`); the per-request line is written by
  `CorrelationIdMiddleware` instead, which is what puts the id and `duration_ms` on it.
- **Frontend:** the logger writes to stdout directly, and a console shim installed at startup wraps
  everything else that reaches `console.*` — Next's own `⨯ Error` dumps included — into the same
  envelope with `source: "console"` (`fl_frontend/src/core/consoleShim.ts :: installConsoleShim`).
- **nginx:** the `fl_json` `log_format` with `escape=json`, set on every server block. The **error
  log is the one deliberate exception** to one-format-per-service: nginx's `error_log` format is not
  configurable, stays plain text, and stays at its default level — it is rare, and a parser skips
  non-`{` lines.

**Boot lines are outside the contract, knowingly.** What a process prints before its logging is
configured cannot be governed by it: uvicorn's pre-import lines fall back to plain stderr, and
Next's startup banner prints before `register()` installs the shim. Both are a handful of lines per
boot; a parser skips non-`{` lines.

Retention is Docker's `json-file` driver, 3 × 10 MB per service (`docker-compose.yml ::
x-logging`). There is no aggregation and no index; reading production logs is `ssh` plus
`docker compose logs`.

**The logs live and die with the container, so a deploy starts them from empty.** The driver writes
to `/var/lib/docker/containers/<container-id>/<container-id>-json.log` on the host, and that
directory is removed with its container. `stop` and `start` keep the file — the container survives —
while anything that **replaces** a container discards it: `docker compose down`, and the
`up -d --force-recreate` that `scripts/deploy.sh` runs on every deploy. Copy anything worth keeping
off the host **before** deploying:

```bash
docker compose logs --no-color --timestamps backend > backend-$(date +%F).log
```

## Error codes

**Every failure response body is `{error_code, correlation_id}` and nothing else** — messages,
validation details and stack traces go to the log, never the wire
(`fl_backend/app/core/exception_handlers.py :: error_response`). **Every failure log line carries
its code as the `error_code` field.**

The taxonomy: `<AREA>-<SUBJECT>-<NNN>`, where the area names the side that must act. `REQ-*` — the
request was wrong; `DB-*` — the database refused or failed; `SRV-*` — the server itself failed;
`FE-*` — a frontend-side failure class. A new failure mode gets a new code, never a reused one.

Backend codes (`fl_backend/app/core/exceptions.py`, handlers in
`fl_backend/app/core/exception_handlers.py`):

**The transport codes come first, then the domain refusals grouped by the aggregate that owns them, then
the database and server codes.** That split is the one
[ADR-0066](_decisions/0066-the-domain-model-is-declared-and-conformance-checked.md) draws and the
conformance test keys on: a code raised under `app/api/` is a domain rule and has a row in
`fl_backend/app/core/domain.py :: RULES`, while the six that live in `app/core/` describe who you are,
whether the body parses, and whether an id is an ObjectId. **That table is the source for what each rule
refuses and where it is implemented; this one is the source for the code and its status.**

Every domain refusal is a 409 and there is one reason for it: nothing about the payload is malformed, so
the same request would have succeeded against a different state of the database
(`fl_backend/app/core/exceptions.py :: DocumentConflictException`).

| Code                  | Status | Meaning                                                                                                   |
| --------------------- | ------ | --------------------------------------------------------------------------------------------------------- |
| `REQ-AUTH-001`        | 401    | No bearer credentials presented                                                                           |
| `REQ-AUTH-002`        | 401    | `base` key invalid                                                                                        |
| `REQ-AUTH-003`        | 401    | `system` key invalid                                                                                      |
| `REQ-AUTH-004`        | 401    | `admin` key invalid                                                                                       |
| `REQ-VAL-001`         | 422    | Request payload or parameters failed validation                                                           |
| `REQ-OID-001`         | 400    | A malformed ObjectId reached a handler                                                                    |
| `REQ-RULES-001`       | 409    | `number_of_groups` × `qualifiers_per_group` is not a power of two the phase set holds (ADR-0065)          |
| `REQ-RULES-002`       | 409    | `number_of_groups` would drop below a group that still holds teams                                        |
| `REQ-RULES-003`       | 409    | `teams_per_group` would drop below the fullest group's occupancy                                          |
| `REQ-RULES-004`       | 409    | `qualifiers_per_group` would drop below a placing a bracket slot already names                            |
| `REQ-RULES-005`       | 409    | A finished season's points and qualifier count are frozen, because the table derives from them (ADR-0026) |
| `REQ-RULES-006`       | 409    | A narrowing would leave a matchday holding more fixtures than its phase accounts for (ADR-0065)           |
| `REQ-RULES-007`       | 409    | `qualifiers_per_group` exceeds `teams_per_group`                                                          |
| `REQ-ACTIVATE-001`    | 409    | The outgoing season still holds fixtures that are neither played nor cancelled (ADR-0033)                 |
| `REQ-ENTER-001`       | 409    | A team was entered into a season that is not `future`                                                     |
| `REQ-ENTER-002`       | 409    | A team was entered into, or moved to, a group the season does not run                                     |
| `REQ-ENTER-003`       | 409    | A team was entered into, or moved to, a group already holding `teams_per_group` rows                      |
| `REQ-ENTER-004`       | 409    | A group change reached a team whose fixtures the started season has already drawn                         |
| `REQ-RETIRE-001`      | 409    | A club entered in an `active` or `future` season was asked to retire                                      |
| `REQ-SPIELTAG-002`    | 409    | A matchday's new phase accounts for fewer matches than the matchday already holds (ADR-0065)              |
| `REQ-SPIELTAG-003`    | 409    | A season whose knockout phase has started was asked for a new matchday                                    |
| `REQ-DATE-002`        | 409    | A matchday's span falls outside its season's                                                              |
| `REQ-DATE-003`        | 409    | A matchday's span would shrink below a date one of its own fixtures holds                                 |
| `REQ-DATE-004`        | 409    | A season's span would shrink below a live matchday's own                                                  |
| `REQ-RETIRE-002`      | 409    | A matchday holding a played match was asked to retire, which would unpublish that result                  |
| `REQ-DATE-001`        | 409    | A fixture's date falls outside the span of the matchday it belongs to                                     |
| `REQ-CLASH-001`       | 409    | A venue or a referee would serve two fixtures less than four hours apart                                  |
| `REQ-WIRING-001`      | 409    | Bracket wiring the season cannot hold reached the match write path (ADR-0046)                             |
| `REQ-ELIGIBILITY-001` | 409    | A disqualified team was newly fielded on a match (ADR-0052)                                               |
| `REQ-ELIGIBILITY-002` | 409    | A newly fielded team holds no `saison_teams` row for the fixture's season (ADR-0052)                      |
| `REQ-RESULT-001`      | 409    | A side carrying goals on a played fixture was emptied rather than switched (ADR-0051)                     |
| `REQ-SPIELTAG-001`    | 409    | A team would play two fixtures of one Spieltag, and the clash cannot be moved (ADR-0052)                  |
| `REQ-RETIRE-003`      | 409    | A venue still booked for an unplayed fixture was asked to retire                                          |
| `REQ-RETIRE-004`      | 409    | A referee still assigned to an unplayed fixture was asked to retire                                       |
| `REQ-SQUAD-001`       | 409    | A squad row names a team holding no junction row for that season                                          |
| `REQ-SQUAD-002`       | 409    | A squad number this write would newly take from another player in the same team                           |
| `DB-CONN-001`         | 503    | Database client unavailable                                                                               |
| `DB-CONN-002`         | 503    | The readiness ping could not reach MongoDB (`/system/is_ready`)                                           |
| `DB-COMMON-001`       | 404    | No document matched the filter                                                                            |
| `DB-COMMON-002`       | 409    | A unique index refused the write                                                                          |
| `DB-FAIL-001`         | 500    | A database operation crashed                                                                              |
| `SRV-VAL-001`         | 500    | A server-side model failed validation outside request parsing — a data bug, not a caller bug              |
| `SRV-FAIL-001`        | 500    | Unhandled crash                                                                                           |

Frontend codes (`fl_frontend/src/core/errors.ts`, plus the call sites named):

| Code            | Meaning                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| `FE-API-001`    | The API answered with a bad status (`APIBadStatusError`; `serverErrorCode` carries the backend's code) |
| `FE-API-002`    | The API answered with an unparseable or schema-violating body (`APIMalformedDataError`)                |
| `FE-NET-001`    | The network did not answer, timeout included (`APINetworkError`, `isTimeout` distinguishes)            |
| `FE-RSC-001`    | Unhandled server-side error, logged by `fl_frontend/src/core/instrumentation.ts :: onRequestError`     |
| `FE-ACT-001`    | An admin mutation threw something that is not a typed API error (`shared/utils/adminMutation.ts`)      |
| `FE-ACT-002`    | A write committed and its cache invalidation did not — a stale read, never a failed write (ADR-0051)   |
| `FE-AUTH-001`   | Auth.js reported an access denial (`fl_frontend/src/core/auth.ts`)                                     |
| `FE-AUTH-002`   | Auth.js reported any other error (`fl_frontend/src/core/auth.ts`)                                      |
| `FE-CLIENT-001` | A browser-side crash reported through the ingest route (`src/app/api/client-error/route.ts`)           |

**An admin mutation never lets a typed API error escape.** `runAdminMutation` logs the failure with
its codes and returns the `FormState` the caller toasts — a 409 is an ordinary outcome of a create
(ADR-0032), and before this boundary existed it escalated past the toast into the whole error page.
It wraps both entry points: the eight server actions and the undo route handler
([ADR-0055](_decisions/0055-the-undo-is-a-route-handler-until-e592-is-fixed.md)).

## Finding an incident

- **A reported error page.** The page shows a digest, and **a digest names an error class, not an
  incident** — Next derives it from the message, so every `APINetworkError` shares one digest. Take
  the digest plus the time and route, find the matching `FE-RSC-001` line, and its
  `correlation_id`/`fetch_correlation_id` open the nginx and backend lines for that exact request.
- **A slow page.** The nginx line carries `duration_s` and `upstream_duration_s` for every request;
  the backend line carries `duration_ms`. An edge duration without a matching upstream duration is
  nginx or the network; a large backend `duration_ms` is the application.
- **Uptime monitoring.** A total backend outage serves the error page with **HTTP 200** — the error
  boundary streams after headers are sent, so the status is not a health signal. Monitor
  `GET /api/v0/system/is_live` through the edge instead: it is deliberately unguarded
  (`fl_backend/app/core/security.py`) and answers from the backend itself.

## Client-side crashes

A client component cannot reach the server-only logger, so a browser-side crash would be recorded
nowhere. The error boundary (`fl_frontend/src/app/error.tsx`) posts crashes **without a digest** —
the client-error kind — to `POST /api/client-error`, which validates a strictly bounded payload and
writes the one `FE-CLIENT-001` line (`fl_frontend/src/app/api/client-error/route.ts`). The route is
public and unauthenticated by design, which is why nginx rate-limits it exactly like sign-in
(`nginx/prod.conf :: zone=clienterr`) and why every field is length-capped. Its log line carries the
ingest request's own id — the browser cannot know the crashed request's — so the join to the crash
is the digest, the path and the time.

## Development logging

The format is selected by environment, never by build — `console` is the development format by
convention, not by enforcement.

| Surface   | Command                                           | Format                                          |
| --------- | ------------------------------------------------- | ----------------------------------------------- |
| Frontend  | `pnpm dev` in `fl_frontend/`                      | `console` via `fl_frontend/.env`                |
| Backend   | `uv run fastapi dev app/asgi.py` in `fl_backend/` | `console` via `LOG_FORMAT` in `fl_backend/.env` |
| All three | `./scripts/local.sh`                              | The production stream, exactly as deployed      |

Both console formats share one line shape — padded level, timestamp, `<correlation_id>`, dash,
message — so the two dev streams read as one convention.

**There is no nginx in dev, and every line still carries an id.** Whichever service receives the
request mints it instead: the backend's middleware for a direct API call,
`fl_frontend/src/core/api.ts :: apiClient` for a frontend-originated one. The rule is identical on
every surface — honour a well-formed incoming id, mint one otherwise — so dev differs only in
**who** mints, never in whether a line is correlated. What dev cannot demonstrate is a
**cross-service** join for a page render, because no component there sees both hops;
`./scripts/local.sh` is where that is exercised.

On Windows, prefix the backend command with `PYTHONUTF8=1` when redirecting its output — the CLI
banner is not encodable in the default code page ([`scripts/README.md`](../scripts/README.md),
Troubleshooting).

## Invariants

| #   | Invariant                                                                              | Enforced by                                                                                                     | Breaks how                                                                                |
| --- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| L1  | One JSON document per line per service in the `json` format                            | `fl_backend/tests/core/test_logging.py`; `fl_frontend/src/core/logFormat.test.ts`                               | A raw multi-line write makes the whole stream unparseable downstream                      |
| L2  | The JSON field set matches across surfaces                                             | the same two suites, asserting names and shapes                                                                 | Two streams need two parsers, and a join on `correlation_id` silently returns nothing     |
| L3  | An id is honoured only when well-formed, and minted otherwise                          | `fl_backend/tests/core/test_logging.py :: TestResolveCorrelationId`; `fl_frontend/src/core/correlation.test.ts` | A client-chosen string appears verbatim in three surfaces' logs                           |
| L4  | Every failure response is `{error_code, correlation_id}`, the code the exception's own | `fl_backend/tests/api/test_error_responses.py`                                                                  | The log grepped for a documented code finds a fallback string instead                     |
| L5  | Every request gets exactly one backend access line, id and duration on it              | `fl_backend/tests/api/test_error_responses.py :: TestAccessLine`                                                | Successful requests vanish from the record again                                          |
| L6  | A thrown API error never escapes a server action                                       | `fl_frontend/src/shared/utils/actionError.test.ts`                                                              | Next redacts the throw to a digest and the admin sees the error page instead of the toast |
| L7  | The `X-Correlation-ID` a visitor sends is discarded at the edge                        | `nginx/prod.conf :: proxy_set_header X-Correlation-ID` (unconditional)                                          | Log injection by header                                                                   |
