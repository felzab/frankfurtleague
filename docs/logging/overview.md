# Logging — overview

**Scope:** the log streams of nginx, the frontend and the backend, the trace that joins them, and the
browser's crash reports.

Each of the three services writes one stream, and in production every line of it is one JSON
document. One request is followed across all three by its trace id, which the edge mints: a symptom
on one surface is found on the others by searching for that id.

## How it is organised

| Surface  | Writes                                                                                                       | Where                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| nginx    | One access line per request in the `fl_json` format, and a plain-text error log                              | `nginx/shared/http.conf`, `nginx/shared/site.conf`; both logs are host files under `/var/log/frankfurtleague/nginx/` |
| Frontend | Its own lines through one logger, and everything else reaching `console.*` wrapped into the same envelope    | `fl_frontend/src/core/logging.ts`, `fl_frontend/src/core/consoleShim.ts`, `fl_frontend/src/core/logFormat.ts`        |
| Backend  | One access line per request from the trace middleware, and the application's lines through the custom logger | `fl_backend/app/core/middlewares.py :: TraceContextMiddleware`, `fl_backend/app/core/logging.py`                     |

`LOG_FORMAT` selects `json` or `console` on both application services; production runs `json`.

## Following one request

**The trace is W3C `traceparent`, minted at the edge.** nginx takes its own `$request_id` as the
trace id and discards whatever header a visitor sent, so no id an attacker chose reaches a log.
Every later hop keeps the trace id and mints a span of its own: the frontend validates the header,
forwards it to the backend under its own span, and the backend validates it again. A header that is
not version `00` with lowercase hex is replaced by a fresh trace rather than passed on. Nothing
echoes the trace on a response except a failure body, `{error_code, trace_id}`, which is how a
reader goes from a code a page showed to the lines behind it.

**A cached read runs under a trace of its own.** A `"use cache"` result is shared by later
requests, so no page request's trace can reach the backend call that filled it. The frontend logs
one `INFO` line under the fill's trace, its `cache_fill` field naming the cached function. A cache
hit makes no request at all, so the edge's access line is the only record of that page view.
Server actions, route handlers and the uncached reads a page makes run under the page request's
trace end to end (`fl_frontend/src/shared/utils/traceScope.ts`).

**A line written outside any request carries `SYSTEM`** as both its trace and its span.

## What a line holds

Every JSON line opens with `timestamp`, `level`, `service`, `trace_id`, `span_id` and `message`,
in that order on all three surfaces, and a failure line adds its `error_code`. A log line names the
field a request got wrong and never the value submitted for it, since that value can be personal
data. The edge's access line logs `[redacted]` in place of any query carrying a `token`, an
`email` or a `q` parameter (`nginx/shared/http.conf :: map $request_uri $credential_free_uri`),
because a mailed link's token and a mailed address travel there. nginx's error log is plain text,
since the open-source build offers no other format, and it can repeat such a URL.

**An error code reads `<AREA>-<SUBJECT>-<NNN>`.** A domain rule's code is declared at
`fl_backend/app/core/domain.py :: RULES`, and `fl_backend/openapi.json` publishes every code an
operation refuses with; the codes only a log line carries are spelled where they are raised.

## Where the logs are, and how long they stay

- **The application services** log to Docker's `json-file` driver, capped by size
  (`docker-compose.yml :: x-logging`). Replacing a container discards its log, and every deploy
  replaces both, so `scripts/ops/deploy.sh :: copy_streams` copies both streams to the host first.
- **The edge's two logs** are bind-mounted host files, which the host ages and rotates
  ([`../ops/runbooks.md`](../ops/runbooks.md) §7).
- **The backend's erasure journal** is the one part of a stream copied out while it runs:
  `scripts/ops/export_journal.sh` collects it hourly into a file per day, because a restore replays
  each erasure from it.

Reading production logs is `ssh` and `docker compose logs`, or those copies; nothing aggregates or
indexes them.

## A crash in the browser

A client component cannot reach the server's logger. Every error boundary therefore posts its crash
to `POST /api/client-error` (`fl_frontend/src/app/api/client-error/route.ts`), which writes one
`FE-CLIENT-001` line; the bot-check widget reports a failure the same way. The route is public, so
nginx rate-limits it and the route caps every field. A failure rendered on the server is logged as
`FE-RSC-001` with a digest instead, and the error page's report link
(`fl_frontend/src/shared/components/ui/CrashReportLink.tsx`) carries that digest, the route and the
time, which together find the line.

## In development

`LOG_FORMAT=console` writes one human-readable line shape on both services,
`LEVEL timestamp origin - message key=value…`, with an attached stack indented below it
(`fl_frontend/src/core/logFormat.ts`, `fl_backend/app/core/logging.py`). With no nginx in front,
whichever service receives the request mints the trace. `./scripts/ops/local.sh` runs the whole
stack with the production format.

## Read next

- [`../ops/overview.md`](../ops/overview.md) — the containers and the edge that write these streams
- [`../backend/overview.md`](../backend/overview.md) — the failure body a code arrives in
