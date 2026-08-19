# Logging — spec

**Verified against:** `889c31dd`, 2026-08-19\
**Scope:** the correlation id, the log stream on all three surfaces, the browser-crash path, and
the development formats.

| Section                                            | Answers                                        |
| -------------------------------------------------- | ---------------------------------------------- |
| [1.1 The correlation id](#11-the-correlation-id)   | What the id is, who mints it, who validates it |
| [1.2 The stream contract](#12-the-stream-contract) | What a log line is on each surface             |
| [1.3 Client-side crashes](#13-client-side-crashes) | The one browser-to-log path                    |
| [1.4 Development logging](#14-development-logging) | How each surface logs outside the containers   |
| [2. Invariants](#2-invariants)                     | The rules the tests pin                        |
| [3. Violation → remedy](#3-violation--remedy)      | A symptom, its cause, and what to do           |
| [4. Known-open](#4-known-open)                     | The accepted gaps                              |

## 1. Contract

### 1.1 The correlation id

**One id per HTTP request: 32 lowercase hex, minted at the edge.** nginx sets `X-Correlation-ID` to
its own `$request_id` on every proxied request and discards anything the client sent — an
attacker-chosen id would otherwise appear verbatim in three surfaces' logs.

| Surface  | Behaviour                                                                                                                                               | Where                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| nginx    | Mints unconditionally, logs it, forwards it to both upstreams                                                                                           | `nginx/prod.conf :: proxy_set_header X-Correlation-ID`                             |
| Backend  | Honours a well-formed incoming id, mints otherwise, echoes it on the response, binds it to a ContextVar every log record reads                          | `fl_backend/app/core/middlewares.py :: CorrelationIdMiddleware`                    |
| Frontend | Every dynamic caller seeds a request scope from the incoming headers; `apiClient` reads it and sends it upstream, minting only where no scope can exist | `fl_frontend/src/shared/utils/correlationScope.ts :: runWithIncomingCorrelationId` |

A well-formed id is `[a-f0-9]{8,64}`, and both validators
(`fl_backend/app/core/middlewares.py :: WELL_FORMED_ID`,
`fl_frontend/src/core/correlation.ts :: isWellFormedCorrelationId`) refuse anything else, so a
malformed or hostile header is replaced rather than propagated.

**The cache-fill boundary.** A `"use cache"` execution is shared by later requests, so Next refuses
request APIs inside one and no page-request id can exist there; a cached read's backend fetch
carries a freshly minted id of its own (`fl_frontend/src/core/api.ts :: apiClient`). What follows:

- A **cache hit** issues no request and produces no application log line. The nginx access line is
  the only record of that page view, which is why the edge logs every request.
- A **cache fill**'s backend access line joins to the frontend error if the fill fails, because the
  error carries the fill's id — but never to the page view that triggered the fill.
- An **uncached read inside a page render** runs under the real request id, seeding the scope
  explicitly. The admin-authed reads are the ones in this position, never cached and listed in
  [`docs/frontend/spec.md`](../frontend/spec.md#12-cached-reads) — and being uncached is what makes
  the seeding legal, since `headers()` inside a `"use cache"` scope raises
  `next-request-in-use-cache` rather than failing quietly.
- A **server action** and a **route handler** run with the real request id end to end: their backend
  lines carry the same id as the nginx line.

**Everything dynamic seeds through one seam**,
`fl_frontend/src/shared/utils/correlationScope.ts :: runWithIncomingCorrelationId`, which reads the
edge-minted id off the incoming headers, validates it, and runs its caller under it. It lives in
`shared/` rather than beside the storage in `core/requestScope.ts` for a packaging reason worth
knowing before moving it: `core/logging.ts` is reachable from the Edge middleware bundle through
`core/auth.ts` and `src/proxy.ts`, and `next/headers` is a request-only API that must not be bundled
for that runtime.

Lines written outside any request carry the sentinel `SYSTEM`, so `correlation_id` exists on every
line.

### 1.2 The stream contract

**Each service writes one stream, one JSON document per line, in production.** The selector is
`LOG_FORMAT` (`json` | `console`) on both services; the backend **defaults to `json`**
(`fl_backend/app/core/config.py :: log_format`), the frontend requires the variable and validates it
as an enum (`fl_frontend/src/core/config.ts :: LOG_FORMAT`). Both normalise case.

| Field            | Content                                                            |
| ---------------- | ------------------------------------------------------------------ |
| `timestamp`      | ISO 8601, UTC, millisecond precision, `Z` suffix                   |
| `level`          | `DEBUG` / `INFO` / `WARNING` / `ERROR` / `CRITICAL` — never `WARN` |
| `service`        | `fl_backend` / `fl_frontend` / `nginx`                             |
| `correlation_id` | The request's id, or `SYSTEM` outside any request                  |
| `message`        | Human-readable text                                                |
| `error_code`     | Present on every failure line — see [error codes](error-codes.md)  |
| `error`          | `{name, message, stack}` when an exception is attached             |

Per-surface extras: the backend adds `module`/`line` and the access-line fields (`method`, `path`,
`status`, `duration_ms`); nginx adds `duration_s`, `upstream_duration_s`, `bytes`, `client`,
`x_forwarded_for`, `host`, `referer`, `user_agent`; the frontend adds whatever a call site passes
(`digest`, `route`, `fetch_correlation_id`).

How each surface keeps its stream to one format:

- **Backend:** uvicorn runs with `--no-access-log` and a log config that propagates its loggers to
  the application handler (`fl_backend/Dockerfile :: CMD`,
  `fl_backend/app/core/uvicorn_logging.json`); `CorrelationIdMiddleware` writes the per-request line
  instead, which is what puts the id and `duration_ms` on it.
- **Frontend:** the logger writes to stdout directly, and a console shim installed at startup wraps
  everything else reaching `console.*` — Next's own `⨯ Error` dumps included — into the same
  envelope with `source: "console"` (`fl_frontend/src/core/consoleShim.ts :: installConsoleShim`).
- **nginx:** the `fl_json` `log_format` with `escape=json`, set on every serving block. The **error
  log is the one deliberate exception**: its format is not configurable, so it stays plain text at
  its default level. A parser skips non-`{` lines.

**Boot lines are outside the contract, knowingly** — what a process prints before its logging is
configured cannot be governed by it. uvicorn's pre-import lines fall back to plain stderr and Next's
startup banner prints before `register()` installs the shim.

Retention is Docker's `json-file` driver, 3 × 10 MB per service
(`docker-compose.yml :: x-logging`). There is no aggregation and no index.

**The logs live and die with the container, so a deploy starts them from empty.** `stop` and `start`
keep the file because the container survives; anything that **replaces** a container discards it,
including `docker compose down` and the `up -d --force-recreate` that `scripts/deploy.sh` runs on
every deploy. Copy anything worth keeping off the host **before** deploying:

```bash
docker compose logs --no-color --timestamps backend > backend-$(date +%F).log
```

### 1.3 Client-side crashes

A client component cannot reach the server-only logger, so a browser-side crash would be recorded
nowhere. The error boundary (`fl_frontend/src/app/error.tsx`) posts crashes **without a digest** to
`POST /api/client-error`, which validates a strictly bounded payload and writes the one
`FE-CLIENT-001` line (`fl_frontend/src/app/api/client-error/route.ts`). The route is public and
unauthenticated by design, which is why nginx rate-limits it exactly like sign-in
(`nginx/prod.conf :: zone=clienterr`) and why every field is length-capped. Its log line carries the
ingest request's own id — the browser cannot know the crashed request's — so the join to the crash
is the digest, the path and the time.

### 1.4 Development logging

The format is selected by environment, never by build; `console` is the development format by
convention rather than by enforcement.

| Surface   | Command                                           | Format                                          |
| --------- | ------------------------------------------------- | ----------------------------------------------- |
| Frontend  | `pnpm dev` in `fl_frontend/`                      | `console` via `fl_frontend/.env`                |
| Backend   | `uv run fastapi dev app/asgi.py` in `fl_backend/` | `console` via `LOG_FORMAT` in `fl_backend/.env` |
| All three | `./scripts/local.sh`                              | The production stream, exactly as deployed      |

Both console formats share one line shape — padded level, timestamp, `<correlation_id>`, dash,
message — so the two dev streams read as one convention.

**There is no nginx in dev, and every line still carries an id.** Whichever service receives the
request mints it: the backend's middleware for a direct API call,
`fl_frontend/src/core/api.ts :: apiClient` for a frontend-originated one. The rule is identical on
every surface — honour a well-formed incoming id, mint one otherwise — so dev differs only in
**who** mints.

On Windows, redirecting the backend command's output needs `PYTHONUTF8=1` —
[`docs/ops/spec.md`](../ops/spec.md) §3 carries the symptom.

## 2. Invariants

| #   | Invariant                                                                              | Enforced by                                                                                                     |
| --- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| L1  | One JSON document per line per service in the `json` format                            | `fl_backend/tests/core/test_logging.py`; `fl_frontend/src/core/logFormat.test.ts`                               |
| L2  | The JSON field set matches across surfaces                                             | the same two suites, asserting names and shapes                                                                 |
| L3  | An id is honoured only when well-formed, and minted otherwise                          | `fl_backend/tests/core/test_logging.py :: TestResolveCorrelationId`; `fl_frontend/src/core/correlation.test.ts` |
| L4  | Every failure response is `{error_code, correlation_id}`, the code the exception's own | `fl_backend/tests/api/test_error_responses.py`                                                                  |
| L5  | Every request gets exactly one backend access line, id and duration on it              | `fl_backend/tests/api/test_error_responses.py :: TestAccessLine`                                                |
| L6  | A thrown API error never escapes a server action                                       | `fl_frontend/src/shared/utils/actionError.test.ts`                                                              |
| L7  | The `X-Correlation-ID` a visitor sends is discarded at the edge                        | `nginx/prod.conf :: proxy_set_header X-Correlation-ID` (unconditional)                                          |
| L8  | Every uncached admin-authed read runs inside `runWithIncomingCorrelationId`            | review — the set is listed in [`docs/frontend/spec.md`](../frontend/spec.md#12-cached-reads) §1.2               |

## 3. Violation → remedy

| Symptom                                               | Cause                                                                             | Remedy                                                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| A page view has an nginx line and no application line | A cache hit issued no request                                                     | Working as intended (1.1). The edge line is the record                                    |
| A frontend error's id matches no page view            | A cache fill minted its own id                                                    | Join on `fetch_correlation_id`, not `correlation_id` (1.1)                                |
| A total backend outage reports HTTP 200               | The error boundary streams after headers are sent, so status is no health signal  | Monitor `GET /api/v0/system/is_live` through the edge (`fl_backend/app/core/security.py`) |
| Log lines vanish after a deploy                       | `up -d --force-recreate` replaces the container and its log file                  | Copy the stream off the host before deploying (1.2)                                       |
| One digest matches many unrelated incidents           | A digest names an error class, not an incident — Next derives it from the message | Search on digest plus time plus route, then follow the `FE-RSC-001` line's id             |
| Non-JSON lines appear in a stream                     | nginx's error log and both services' boot lines are outside the contract          | Working as intended (1.2, section 4). A parser skips non-`{` lines                        |

## 4. Known-open

| #   | Item                                                       | State                                                                            |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | No aggregation and no index                                | Accepted — reading production logs is `ssh` plus `docker compose logs`           |
| 2   | nginx's error log is plain text at its default level       | Accepted — the format is not configurable (1.2)                                  |
| 3   | Boot lines fall outside the one-document-per-line contract | Accepted — nothing can govern what a process prints before its logging is set up |
| 4   | Dev cannot demonstrate a cross-service join                | Accepted — no component there sees both hops; `./scripts/local.sh` exercises it  |
