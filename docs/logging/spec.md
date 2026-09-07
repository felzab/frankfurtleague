# Logging — spec

**Scope:** the trace id and the second header the edge controls beside it, the log stream on all
three surfaces, the browser-crash path, and the development formats.

| Section                                            | Answers                                         |
| -------------------------------------------------- | ----------------------------------------------- |
| [1.1 The trace id](#11-the-trace-id)               | What the ids are, who mints them, who validates |
| [1.2 The stream contract](#12-the-stream-contract) | What a log line is on each surface              |
| [1.3 Client-side crashes](#13-client-side-crashes) | The one browser-to-log path                     |
| [1.4 Development logging](#14-development-logging) | The one console line both surfaces write        |
| [2. Invariants](#2-invariants)                     | The rules the tests pin                         |
| [3. Violation → remedy](#3-violation--remedy)      | A symptom, its cause, and what to do            |
| [4. Known-open](#4-known-open)                     | The accepted gaps                               |

## 1. Contract

### 1.1 The trace id

**One trace per HTTP request, carried by the W3C `traceparent` header and minted at the edge; one
span per hop, minted by that hop.** The header is `00-<trace id>-<span id>-<flags>` — 32, 16 and 2
lowercase hex. nginx mints the trace id as its own `$request_id` and its span as that id's first
sixteen hex, at server level, and discards anything the client sent: an attacker-chosen id would
otherwise appear verbatim in three surfaces' logs. **Every hop after the edge takes the trace id
and mints its own span** (L12): the frontend validates the header it receives, forwards
`00-<trace id>-<its span>-01` to the backend, and the backend validates in turn and forwards
nothing, being the last hop. Nothing is echoed on a response; the failure body carries the trace
id (L4), which is the one place a caller reads it back.

A `location` declaring any `proxy_set_header` of its own replaces the whole inherited set
([`docs/ops/spec.md`](../ops/spec.md) §1.3), and two do:
`nginx/prod.conf :: location = /api/v0/system/is_live`, which restates it in full, and
`nginx/prod.conf :: location /_next/static/`, which does not, so a static-asset request reaches
Next with neither header minted — and with a client-sent `traceparent` or `X-FL-Actor` passing
through as it arrived, since nginx forwards every request header no `proxy_set_header` names.
Harmless while that path serves files alone: no route handler seeds a scope there and nothing
writes. The edge's own access line carries `$request_id` and its span whatever a location does,
and the span is that id's first sixteen hex, so a search for the edge's span finds every line of
its trace.

| Surface  | Behaviour                                                                                                                                   | Where                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| nginx    | Mints the trace id and its own span on every request, logs both, proxies the header upstream                                                | `nginx/prod.conf :: proxy_set_header traceparent`, `:: map $request_id $edge_span` |
| Frontend | Seeds a request scope from the incoming header, trace kept and span minted; `apiClient` forwards it, minting a trace only outside any scope | `fl_frontend/src/core/trace.ts`, `fl_frontend/src/shared/utils/traceScope.ts`      |
| Backend  | Honours a well-formed header's trace id, mints otherwise, mints its span, binds both to a ContextVar every log record reads                 | `fl_backend/app/core/middlewares.py :: TraceContextMiddleware`                     |

**A well-formed header is version `00` exactly, with neither id all zeros**, and both validators
(`fl_backend/app/core/middlewares.py :: TRACEPARENT`, `fl_frontend/src/core/trace.ts`) refuse
anything else — an older bare id, uppercase hex, another version — so a malformed or hostile
header is replaced by a fresh trace rather than propagated (L3). The incoming span is read for
validity and never kept: a span names the hop that minted it, and a hop carrying another's would
put two lines under one span.

**One other header crosses that edge, and is cleared rather than minted.** nginx blanks `X-FL-Actor` at
server level just as it discards a client-supplied `traceparent`, under the same location rule above
(`nginx/prod.conf :: proxy_set_header X-FL-Actor`), so the only actor a REQUEST can name is the one the
frontend container sets from the signed-in session — `fl_frontend/src/core/api.ts :: apiClient` sends it on
admin-tier calls alone. It names **who** a write is attributed to rather than which request it belongs to,
and the guard refusing a write that carries no well-formed one is
[`docs/backend/spec.md`](../backend/spec.md) I41.

**The public application form's submit carries none, and is attributed without one.** No browser sends
the header, so the base-tier router binding it names
`fl_backend/app/core/recording.py :: PUBLIC_ACTOR` server-side instead — its own `Actor.kind` rather
than the system actor, which means a write no request made at all. A visitor is therefore named as the
public and never as an administrator, and what the row records is
[`docs/backend/spec.md`](../backend/spec.md) §1.1.

**The cache-fill boundary.** A `"use cache"` execution is shared by later requests, so Next refuses
request APIs inside one and no page-request trace can exist there; a cached read's backend fetch
carries a freshly minted trace of its own, and `fl_frontend/src/core/api.ts :: apiClient` writes one
`INFO` line under that trace, its `cache_fill` field naming the cached function and its arguments —
the only record of which function a fill served, since no page view's trace can reach it. What
follows:

- A **cache hit** issues no request and produces no application log line. The nginx access line is
  the only record of that page view, which is why the edge logs every request.
- A **cache fill**'s backend access line joins to the frontend error if the fill fails, because the
  error carries the fill's trace id — but never to the page view that triggered the fill.
- An **uncached read inside a page render** runs under the real request's trace, seeding the scope
  explicitly. The admin-tier reads are the ones in this position, outside any `"use cache"` scope
  and defined as a class in [`docs/frontend/spec.md`](../frontend/spec.md#12-cached-reads) — and being
  uncached is what makes the seeding legal, since `headers()` inside a `"use cache"` scope raises
  `next-request-in-use-cache` rather than failing quietly.
- A **server action** and a **route handler** run with the real request's trace end to end: their
  backend lines carry the same trace id as the nginx line, each under a span of its own.

**Everything dynamic seeds through one seam**, `fl_frontend/src/shared/utils/traceScope.ts`, which
sits apart from the storage in `fl_frontend/src/core/requestScope.ts` for a packaging reason
written at its own import.

Lines written outside any request carry the sentinel `SYSTEM` in both `trace_id` and `span_id`, so
each exists on every line — except where a caller mints a trace to correlate a failure standing
outside a request, which `fl_frontend/src/core/mail.ts :: sendMail` does and
`fl_frontend/src/core/logging.ts :: logger` prefers over the scope. **A line naming a real trace
names a real span**: the logger mints one where no scope holds it, so the sentinel never sits
beside a trace id.

### 1.2 The stream contract

**Each service writes one stream, one JSON document per line, in production.** The selector is
`LOG_FORMAT` (`json` | `console`) on both services; the backend **defaults to `json`**
(`fl_backend/app/core/config.py :: log_format`), the frontend requires the variable and validates it
as an enum (`fl_frontend/src/core/config.ts :: LOG_FORMAT`). Both normalise case.

**The fields, in this order on every surface** (L2):

| Field        | Content                                                            |
| ------------ | ------------------------------------------------------------------ |
| `timestamp`  | ISO 8601, UTC, millisecond precision, `Z` suffix                   |
| `level`      | `DEBUG` / `INFO` / `WARNING` / `ERROR` / `CRITICAL` — never `WARN` |
| `service`    | `fl_backend` / `fl_frontend` / `nginx`                             |
| `trace_id`   | The request's trace id, or `SYSTEM` outside any request            |
| `span_id`    | This hop's span id, or `SYSTEM` outside any request                |
| `message`    | Human-readable text                                                |
| `error_code` | Present on every failure line — see [error codes](error-codes.md)  |
| `error`      | `{name, message, stack}` when an exception is attached, last       |

Per-surface extras sit between `message` and `error`: the backend adds `module`/`line` directly
after `message` and the access-line fields (`method`, `path`, `status`, `duration_ms`); nginx adds
`duration_s`, `upstream_duration_s`, `bytes`, `client`, `realip_fallback`, `x_forwarded_for`,
`host`, `referer`, `user_agent`; the frontend adds whatever a call site passes (`digest`, `route`,
`fetch_trace_id`, `cache_fill`).

**`client` is the visitor and `x_forwarded_for` is that header as it arrived** — and
`realip_fallback` is `1` on a line where the rewrite behind `client` did not take, so `client` is
still the tunnel connector's address ([`docs/ops/spec.md`](../ops/spec.md) §1.3). The two addresses are
carried separately because a forwarding chain a client wrote is worth reading beside the address
the edge settled on, and neither is the other.

How each surface keeps its stream to one format:

- **Backend:** uvicorn's own access log is off and its loggers propagate to the application handler
  (`fl_backend/Dockerfile :: CMD`, `fl_backend/app/core/uvicorn_logging.json`);
  `TraceContextMiddleware` writes the per-request line instead, which is what puts both ids and
  `duration_ms` on it.
- **Frontend:** the logger writes to stdout directly, and under the JSON format a console shim
  installed at startup wraps everything else reaching `console.*` — Next's own `⨯ Error` dumps
  included, and nothing under the console format, where the logger writes through `console.*` itself — into the same
  envelope with `source: "console"`, through the logger, so a dependency's `console.debug` falls
  under `LOG_LEVEL` like the app's own lines (`fl_frontend/src/core/consoleShim.ts :: installConsoleShim`).
- **nginx:** the `fl_json` `log_format` with `escape=json`, set on every serving block, its
  `trace_id` the `$request_id` the header carries and its `span_id` the `$edge_span` map. `path` and
  `message` read `$logged_uri` rather than `$request_uri`, and `referer` reads `$logged_referer`
  rather than `$http_referer`: each is the raw value except on the Auth.js callback path, and on any
  query naming the sign-in token or the address it was mailed to, where a literal stands in (L11).
  The **error log is the one deliberate exception**: its format is not configurable, so it stays
  plain text at its default level. A parser skips non-`{` lines. **Nothing compares the
  `log_format`'s field names with this table**: a renamed field there is a hand-checked mirror, and
  so are the console format's quoting class, the console line's regex and L2's key order, each
  spelled once per surface with the other cited at it.
  **The access line is written to `/var/log/frankfurtleague/nginx/access.log`, a bind-mounted host
  file** ([`docs/ops/spec.md`](../ops/spec.md) §1.2), so `docker compose logs nginx` shows the error
  log alone and the host can bound the access log's age without touching the container.

**Boot lines are outside the contract, knowingly** — what a process prints before its logging is
configured cannot be governed by it. uvicorn's pre-import lines fall back to plain stderr and Next's
startup banner prints before `register()` installs the shim. **Two of the backend's failure lines
therefore carry no `error_code`**: the environment refusal, which fails while building the settings
the logger is configured from and so leaves the process as a traceback on stderr rather than a
document (`fl_backend/app/core/config.py :: get_config`); and the `uvicorn.error` record that
follows a lifespan refusal onto the stream in the envelope, which the framework writes rather than
the application.

Retention is Docker's `json-file` driver, 3 × 10 MB per service
(`docker-compose.yml :: x-logging`), and for a container's own stream that size is the whole bound —
nothing rotates a file the runtime holds open. The access log is a host file instead, bounded by age
([`docs/ops/spec.md`](../ops/spec.md) §1.1). There is no aggregation and no index.

**The logs live and die with the container, so a deploy starts the application services from empty.**
`stop` and `start` keep the file because the container survives; anything that **replaces** a container
discards it, including `docker compose down` and the `up -d --force-recreate frontend backend` that
`scripts/ops/deploy.sh` runs on every deploy. nginx is not in that set, and its access log is on the
host rather than in the container, so a recreate of the edge would not reach it either. **The deploy copies both application streams off first** (`scripts/ops/deploy.sh :: LOG_DIR`),
and that copy is the only record of the replaced build that survives a deploy whose rollback recreates
the pair a second time; a deploy made by hand owes the same copy before the recreate.

### 1.3 Client-side crashes

A client component cannot reach the server-only logger, so a browser-side crash would be recorded
nowhere. The error boundary (`fl_frontend/src/app/error.tsx`) posts crashes **without a digest** to
`POST /api/client-error`, which validates a strictly bounded payload and writes the one
`FE-CLIENT-001` line (`fl_frontend/src/app/api/client-error/route.ts`). The route is public and
unauthenticated by design, which is why nginx gives it a pair of `limit_req` zones of its own
(`nginx/prod.conf :: zone=clienterr`, `:: zone=clienterr48`; [`docs/ops/spec.md`](../ops/spec.md)
§1.3 argues the pairing) and why every field is length-capped. Its log line carries the ingest
request's own trace — the browser cannot know the crashed request's — so the join to the crash is the
route and the time. **A digest belongs to the other half of the split**: a failure rendered with one
is already recorded as `FE-RSC-001` by `fl_frontend/src/core/instrumentation.ts`, and the report a
visitor sends by hand carries the digest, the route and the time together
(`fl_frontend/src/shared/components/ui/Error.tsx :: reportBody`), which is why that form says in so
many words that a client crash has none.

### 1.4 Development logging

The format is selected by environment, never by build; `console` is the development format by
convention rather than by enforcement.

| Surface   | Command                                           | Format                                          |
| --------- | ------------------------------------------------- | ----------------------------------------------- |
| Frontend  | `pnpm dev` in `fl_frontend/`                      | `console` via `fl_frontend/.env`                |
| Backend   | `uv run fastapi dev app/asgi.py` in `fl_backend/` | `console` via `LOG_FORMAT` in `fl_backend/.env` |
| All three | `./scripts/ops/local.sh`                          | The production stream, exactly as deployed      |

**Both console formats write ONE line shape**, held by both suites
(`fl_backend/tests/core/test_logging.py :: TestConsoleFormatter`,
`fl_frontend/src/core/logFormat.test.ts`):

```text
{LEVEL:<8} {YYYY-MM-DD HH:MM:SS.mmm} {origin} - {message}[ key=value]...
    {each line of an attached error's stack, indented four spaces}
```

- `LEVEL` is left-aligned in a field of eight, one space before the timestamp, which is the
  process's local time to the millisecond; the surface's per-level colour wraps the level word alone.
- `origin` is `module:line` where the envelope carries them and the `service` name otherwise.
- The tail is one ` key=value` per envelope field in the envelope's order, `trace_id` and `span_id`
  first, never `timestamp`, `level`, `service`, `message`, `module`, `line` or `error`. A string is
  bare unless it is empty or carries one of the characters the two quoting classes spell identically
  — `=`, `"`, `'`, and every space or line break either language calls whitespace
  (`fl_frontend/src/core/logFormat.ts :: NEEDS_QUOTING`,
  `fl_backend/app/core/logging.py :: NEEDS_QUOTING`) — in which case it is a JSON string, non-ASCII
  kept as itself; every other value is its JSON with no space after a separator, so one envelope
  renders one line on both surfaces.
- An attached error contributes no pair; its stack follows on the lines after, each indented four
  spaces, or one line `name: message` where it has no stack.

One line per surface:

```text
INFO     2026-09-07 14:30:12.345 middlewares:63 - GET /api/v0/spiele?limit=5 -> 200 trace_id=4bf92f3577b34da6a3ce929d0e0e4736 span_id=00f067aa0ba902b7 method=GET path="/api/v0/spiele?limit=5" status=200 duration_ms=1.2
ERROR    2026-09-07 14:30:12.345 fl_frontend - Cache fill failed trace_id=4bf92f3577b34da6a3ce929d0e0e4736 span_id=53ce929d0e0e4736 error_code=FE-NET-001 endpoint=/saisons
    APINetworkError: fetch failed
        at apiClient (src/core/api.ts:150:11)
```

**There is no nginx in dev, and every line still carries both ids**: whichever service receives the
request mints the trace, under §1.1's rule unchanged, so dev differs only in **who** mints.

On Windows, redirecting the backend command's output needs `PYTHONUTF8=1` —
[`docs/ops/spec.md`](../ops/spec.md) §3 carries the symptom.

## 2. Invariants

| #   | Invariant                                                                                                                                           | Enforced by                                                                                                                                                                                                                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | One JSON document per line per service in the `json` format                                                                                         | `fl_backend/tests/core/test_logging.py`; `fl_frontend/src/core/logFormat.test.ts`                                                                                                                                                                                                                                                                                    |
| L2  | The JSON field set and its order match across surfaces, `trace_id` and `span_id` on every line                                                      | the same two suites, asserting names, order and shapes                                                                                                                                                                                                                                                                                                               |
| L3  | A `traceparent` is honoured only when well-formed — its trace id taken — and a fresh trace minted otherwise                                         | `fl_backend/tests/core/test_logging.py :: TestResolveTraceId`; `fl_frontend/src/core/trace.test.ts`                                                                                                                                                                                                                                                                  |
| L4  | Every failure response is `{error_code, trace_id}`, the code the exception's own                                                                    | `fl_backend/tests/api/test_error_responses.py`                                                                                                                                                                                                                                                                                                                       |
| L5  | Every request gets exactly one backend access line, both ids and duration on it                                                                     | `fl_backend/tests/api/test_error_responses.py :: TestAccessLine`                                                                                                                                                                                                                                                                                                     |
| L6  | A thrown API error never escapes a server action                                                                                                    | `fl_frontend/src/shared/utils/actionError.test.ts`                                                                                                                                                                                                                                                                                                                   |
| L7  | A visitor's `traceparent` is replaced by the edge's own — trace `$request_id`, span its first sixteen hex — on every path reaching application code | `nginx/prod.conf :: proxy_set_header traceparent` at server level, which every location declaring no `proxy_set_header` of its own inherits; the locations that declare one are 1.1's                                                                                                                                                                                |
| L8  | Every uncached admin-tier read seeds the request's trace scope                                                                                      | review — the class is defined in [`docs/frontend/spec.md`](../frontend/spec.md#12-cached-reads) §1.2                                                                                                                                                                                                                                                                 |
| L9  | A log line names a REJECTED FIELD, never the value submitted for it                                                                                 | `fl_backend/tests/api/test_error_responses.py :: TestValidationLoggingWithholdsTheValue`; `fl_backend/app/core/logging.py :: STRUCTURED_EXTRAS` bounds what travels as a field; `fl_frontend/src/core/mail.test.ts`, `fl_frontend/src/core/authLogging.test.ts` and `fl_frontend/src/features/bewerbungen/notifications.test.ts` hold the three frontend paths to it |
| L10 | The `X-FL-Actor` a visitor sends is cleared on every proxied path that reaches a write                                                              | `nginx/prod.conf :: proxy_set_header X-FL-Actor` at server level, which every location declaring no `proxy_set_header` of its own inherits and the liveness location restates (1.1)                                                                                                                                                                                  |
| L11 | A credential a URL carries never reaches the edge's access line, on the path field or on the referer (section 4)                                    | `nginx/prod.conf :: map $uri $logged_uri`, `:: map $request_uri $credential_free_uri` and `:: map $http_referer $logged_referer`, each byte-identical in `nginx/local.conf`, held so by `scripts/checks/check_nginx_mirror.py`; driven by `nginx/redaction_test.sh`                                                                                                  |
| L12 | Every hop mints its own span and forwards the trace id unchanged; no hop keeps an incoming span                                                     | `fl_backend/tests/api/test_error_responses.py :: TestAccessLine`; `fl_frontend/src/core/trace.test.ts`; nginx's by `nginx/redaction_test.sh`, which reads the edge's `span_id` off every access line                                                                                                                                                                 |

## 3. Violation → remedy

| Symptom                                                  | Cause                                                                                                                       | Remedy                                                                                                                                                                                                        |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A page view has an nginx line and no application line    | A cache hit issued no request                                                                                               | Working as intended (1.1). The edge line is the record                                                                                                                                                        |
| A frontend error's trace matches no page view            | A cache fill minted its own trace                                                                                           | Join on `fetch_trace_id`, not `trace_id`, and read the fill's `INFO` line for the function and arguments (1.1)                                                                                                |
| Two hops' lines share a trace and a span                 | A hop kept the span it received instead of minting one                                                                      | Mint at every hop (L12); the incoming span is validated and discarded                                                                                                                                         |
| The log page answers 500 right after a deploy            | A row written under the stored column's previous name lacks `trace_id`, which `FLAktion` requires                           | Run the rename in [`docs/ops/runbooks.md`](../ops/runbooks.md) §2, then `--check`                                                                                                                             |
| A total backend outage reports HTTP 200                  | The error boundary streams after headers are sent, so status is no health signal                                            | Monitor `GET https://frankfurtleague.de/api/v0/system/is_live`, the apex host with no trailing slash — either variation answers a redirect a monitor reads as green ([`docs/ops/spec.md`](../ops/spec.md) §3) |
| A request was slow and no line says where the time went  | Each hop meters its own span, and nothing joins the figures (1.2, `nginx/prod.conf :: log_format fl_json`)                  | An edge `duration_s` with an empty `upstream_duration_s` is nginx or the network; a large backend `duration_ms` is the application                                                                            |
| An application service's log lines vanish after a deploy | `up -d --force-recreate frontend backend` replaces both containers and their log files                                      | Read the deploy's copy under `scripts/ops/deploy.sh :: LOG_DIR` (1.2)                                                                                                                                         |
| One digest matches many unrelated incidents              | A digest names an error class, not an incident — Next derives it from the message                                           | Search on digest plus time plus route, then follow the `FE-RSC-001` line's trace; the error page's report link pre-fills them (`fl_frontend/src/shared/components/ui/Error.tsx :: reportHref`)                |
| Non-JSON lines appear in a stream                        | nginx's error log and both services' boot lines are outside the contract                                                    | Working as intended (1.2, section 4). A parser skips non-`{` lines                                                                                                                                            |
| A log line carries personal data                         | A handler logged a rejected value rather than the field that carried it                                                     | Log the field NAME; the value belongs in neither the message nor an extra (L9)                                                                                                                                |
| A sign-in token appears in nginx's error stream          | A callback request FAILED, and the error log repeats the whole request line — L11 governs the access line alone (section 4) | Treat that token as spent: it is single-use and short-lived (`fl_frontend/src/core/auth.ts :: Resend`). The stream dies with the container on the next deploy (1.2)                                           |
| A stored action holds a submitted value                  | L9 binds the log stream; the action log is a collection and keeps values on purpose                                         | Working as intended — a restore replays the document a write replaced, and a person's erasure destroys the values those rows hold ([`docs/backend/spec.md`](../backend/spec.md) I42)                          |

## 4. Known-open

| Item                                                                | State                                                                                                                                                                                                          |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No aggregation and no index                                         | Accepted — reading production logs is `ssh` plus `docker compose logs`, or the deploy's copies (1.2)                                                                                                           |
| A span joins nothing but its trace                                  | Accepted — no parent link and no timing travel with it, so the hops' lines join on `trace_id` alone and form no tree                                                                                           |
| nginx's error log is plain text at its default level                | Accepted — the format is not configurable (1.2)                                                                                                                                                                |
| Boot lines fall outside the one-document-per-line contract          | Accepted — nothing can govern what a process prints before its logging is set up                                                                                                                               |
| Dev cannot demonstrate a cross-service join                         | Accepted — no component there sees both hops; `./scripts/ops/local.sh` exercises it                                                                                                                            |
| The Auth.js callback route runs under no request scope              | Accepted — `fl_frontend/src/app/api/auth/[...nextauth]/route.ts` re-exports the library's own handlers, so a line raised there carries `SYSTEM`; the two sign-in actions seed one                              |
| A container's own output carries a credential with no URI around it | Accepted — L9 binds application code; the filter reaches a `mongodb://` URI's userinfo ([`docs/ops/spec.md`](../ops/spec.md) §1.7), and no pattern is trusted past it                                          |
| A host redacted out of a URI that carried no credential             | Accepted — a diagnostic loss on a line that hid nothing; bounding the match to spare it lets a real credential through ([`docs/ops/spec.md`](../ops/spec.md) §1.7)                                             |
| A URI spelling `token=` or `email=` loses its whole logged query    | Accepted — over-redaction is the safe direction; `/bestaetigung?token=` is the one such route and losing its query is the point (L11, `nginx/prod.conf :: $credential_free_uri`)                               |
| A percent-encoded parameter name defeats both request-line arms     | Accepted — `$request_uri` is never decoded, and both minters (Auth.js and `fl_frontend/src/features/bewerbungen/bestaetigungLink.ts`) spell `token=` literally, so no such spelling carries a credential (L11) |
| Cloudflare logs the request line at its own edge                    | Accepted — TLS terminates there, so the URL reaches Cloudflare before this edge redacts anything (L11); what it retains is settled in that dashboard                                                           |
