# Logging — overview

**Scope:** the log streams of nginx, the frontend and the backend, the trace that joins them, and the
browser's crash reports.

Each of the three services writes its own log, and in production every application line and every
edge access line is one JSON document; the edge's error log is plain text (below). One request is
followed across all three by its trace id, which the edge mints: a symptom on one surface is found
on the others by searching for that id.

## How it is organised

| Surface  | Writes                                                                                                    | Where                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| nginx    | One access line per request in the `fl_json` format on stdout, and nginx's plain-text error log on stderr | `nginx/shared/http.conf`, `nginx/shared/site.conf`                                               |
| Frontend | Its own lines through one logger; Next's and a library's output prints as it prints                       | `fl_frontend/src/core/logging.ts`                                                                |
| Backend  | One access line per request, a line per server failure, and every library's lines in the same envelope    | `fl_backend/app/core/middlewares.py :: TraceContextMiddleware`, `fl_backend/app/core/logging.py` |

The frontend writes JSON from a production build, the image's and the local stack's alike, and a
plain line under `next dev`, by the runtime's own `NODE_ENV`. The backend writes JSON whenever its
output is not a terminal, which a container never is.

## Following one request

**The trace is W3C `traceparent`, minted at the edge.** nginx takes its own `$request_id` as the
trace id and discards whatever header a visitor sent, so no id an attacker chose reaches a log.
Every later hop keeps the trace id: the frontend validates the header and forwards it to the
backend, which validates it again, and each line the backend writes carries the trace id alone. A
header that is not version `00` with lowercase hex is replaced by a fresh trace rather than passed
on. Nothing echoes the trace on a response except a failure body, `{error_code, trace_id, fields}`, which
is how a reader goes from a code a page showed to the lines behind it.

**A cached read runs under a trace of its own.** A `"use cache"` result is shared by later
requests, so no page request's trace can reach the backend call that filled it: the fill mints a
trace of its own and writes no line for it. A failed fill reaches the page's crash line, whose
`fetch_trace_id` names the fill's trace beside the page request's `trace_id`. A cache hit makes no
request at all, so the edge's access line is the only record of that page view.
Server actions, route handlers and the uncached reads a page makes run under the page request's
trace end to end (`fl_frontend/src/core/traceScope.ts`).

**A line written outside any request carries `SYSTEM`** as its trace.

**The backend writes one line per request**, `http.answered`, with its method, path, status and
duration, and the `error_code` of a refused request's failure body. A server failure adds a line of
its own with its code. When no handler answered the failure, Starlette re-raises it for uvicorn,
which logs the stack on its own line, `Exception in ASGI application`, right after the request's
two; it carries `SYSTEM`, the request's trace having ended with its access line. Neither probe,
`/api/v0/system/is_live` nor `/api/v0/system/is_ready`, writes a line while it is answered with a
success; a failed answer writes its line as any request does.

## What a line holds

Every JSON line opens with `timestamp`, `level`, `service`, `trace_id` and `message`. A backend
message is a constant `<slice>.<event>`, and each value travels as a field of its own after `module`
and `line`; a line carrying a stack adds `error`, holding the exception's `name`, `message` and
`stack`. A log line names the field a request got wrong and never the value submitted for it, since
that value can be personal data. The backend's formatter, on every line it writes, and the
frontend's logger, on the frontend's own lines, write `[address]` in place of anything shaped like an
email address.

**The edge's access line writes the path and never the query**, because a mailed link's token and a
mailed address travel there (`nginx/shared/http.conf :: log_format fl_json`). Beside it stand the
method, the status, both durations, the bytes sent, the visitor's address and the browser
identifier. nginx's error log is plain text, since the open-source build offers no other format, and
a line there repeats the request line whole, its query with it. A refusal writes no error line, and
a link page's location writes none at all (`nginx/shared/site.conf`).

**An error code is its reason's name in lower snake case**, such as `version_stale`. Every code a
failure body carries is a member of `fl_backend/app/core/codes.py :: Code`, its value the member's
own name, which `fl_backend/openapi.json` lists once as the failure body's `error_code`. A line
only the log carries names its event by its key alone, such as `db.unreachable`.

## Where the logs are, and how long they stay

- **In production, every service logs to the host's journal** through Docker's `journald` driver,
  each line tagged with its container's name (`docker-compose.yml :: x-logging`). A replaced
  container's lines stay there, so a deploy loses none.
- **The journal's age limit is the host's own setting**, which no file in this repository holds
  ([`../ops/runbooks.md`](../ops/runbooks.md) §7).
- **The backend's `journal.act` lines** stand in the journal alone, at least one per erasure,
  withdrawal and objection, naming its records: the list of what a restore undid
  ([`../ops/runbooks.md`](../ops/runbooks.md) §13).
- **The local and end-to-end stacks** log to Docker's `json-file` driver, capped by size
  (`docker-compose.local.yml :: x-logging`), since Docker Desktop has no journald.

Reading production's logs is `ssh` and then `docker compose logs <service>` in the checkout, or
`journalctl` on the host; nothing aggregates or indexes them.

## A crash in the browser

A client component cannot reach the server's logger. Every error boundary therefore posts its crash
to `POST /api/client-error` (`fl_frontend/src/app/api/client-error/route.ts`), which writes one
`client.crash_reported` line; the bot-check widget reports a failure the same way. The route is public, so
nginx rate-limits it and the route caps every field. A failure rendered on the server is logged as
`system.request_crashed` with a digest instead.

## In development

`next dev` writes the frontend's line as `LEVEL message {fields as JSON}`, with a stack on the lines
after it (`fl_frontend/src/core/logging.ts`). The backend writes
`LEVEL timestamp module:line - message key=value…` to a terminal, as under `fastapi dev`, with no
colour and the stack below it. With no nginx in front, whichever service receives the request mints
the trace. `./scripts/ops/local.sh` runs the whole stack with the production format.

## Read next

- [`../ops/overview.md`](../ops/overview.md) — the containers and the edge that write these streams
- [`../backend/overview.md`](../backend/overview.md) — the failure body a code arrives in
