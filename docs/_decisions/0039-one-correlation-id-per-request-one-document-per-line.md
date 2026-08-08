# ADR-0039 — One correlation id per request, and one JSON document per line on every surface

**Status:** Accepted
**Date:** 2026-08-05
**Surface:** frontend, backend, ops
**Supersedes:** —
**Superseded by:** —
**Source:** Roadmap item LOG-1, the survey of the three surfaces' logging, measured 2026-08-05
against the local stack.

## Context

A survey of the three surfaces' logging (roadmap item LOG-1, measured 2026-08-05 against the local
stack) found that no line of a successful request was correlated on any surface. The frontend minted
a trace id **per fetch call** — one page view produced eight distinct ids — and the id appeared in a
log only when a request failed. The backend had a real request scope but uvicorn's access log never
saw it. nginx had no logging configuration at all: no edge latency record, no id, nothing to join to
either application log.

Both services also claimed "one JSON document per line in production" in their module headers, and
both claims were false, because each service had a second writer its logging module did not
configure: uvicorn's plain-text handlers on the backend (installed by `fastapi run` _after_ the
application's, so they won), and Next.js's own multi-line `⨯ Error [...]` dumps on the frontend.
The streams were unparseable as JSON — the exact property the invariant existed to protect. Seven of
the eight documented error codes logged as a hard-coded fallback string, five exception handlers
carried no code at all, and the response body's only field was an id nothing on a successful path
ever recorded.

Two constraints shaped what a fix could look like:

- **A `"use cache"` execution belongs to no request.** Next.js refuses `headers()` and every other
  request API inside a cached scope, because the entry it fills is shared by later requests. Any
  design that promises "the page's id reaches every backend call" is therefore impossible for
  cached reads, not merely unimplemented.
- **The id appears verbatim in log lines on three surfaces**, so an attacker-chosen value is a log
  injection primitive unless every surface either mints or validates.

## Decision

**One correlation id per HTTP request, minted at the edge.** nginx sets `X-Correlation-ID` to its
own `$request_id` (32 lowercase hex) on every proxied request, unconditionally — a client-supplied
value is discarded. The backend honours a well-formed incoming id and mints otherwise; the frontend
propagates the id where a request scope exists and mints a compatible one for work no request owns.
A cache-fill fetch gets an id of its own, and the convention says so plainly rather than pretending
the join exists.

**Each service writes exactly one stream, one JSON document per line, sharing one field set** —
`timestamp` (ISO 8601 UTC, milliseconds, `Z`), `level` (`INFO`/`WARNING`/`ERROR`/…), `service`,
`correlation_id`, `message`, `error_code` where a failure has one, `error` as
`{name, message, stack}`. The second writers are brought under the convention, not documented
around: uvicorn runs with its access log off and its remaining loggers propagating to the
application's handler (the backend's own middleware writes the per-request line), and the frontend
installs a console shim in `instrumentation.register()` that wraps anything reaching `console.*` —
above all Next's own error dumps — into the same envelope.

**Every failure response is `{error_code, correlation_id}`, and every failure log line carries its
code as a structured field.** The code taxonomy (`REQ-*`, `DB-*`, `SRV-*` on the backend, `FE-*` on
the frontend) and the full field reference live in [`docs/logging.md`](../logging.md), which is the
maintained convention this ADR only argues for.

## Consequences

- The edge access line is the one record that exists for **every** request — a cached page serves
  without running application code, so nginx is the only surface that can see those at all.
- A cache-fill fetch's backend line cannot be joined to the page view that triggered the fill. This
  is the framework's own boundary: a shared cache entry belongs to no request. The fill's id still
  joins the frontend error to the backend line when the fill fails, which is the join that matters.
- The backend boots through `uvicorn` directly instead of `fastapi run`; lines uvicorn emits before
  the application module is imported fall back to plain stderr. They are boot noise, and the
  alternative — owning uvicorn's handler config wholesale — re-creates the two-format problem the
  moment uvicorn changes its defaults.
- Patching `console.*` is a runtime shim, and a Next.js major could change how its error printer
  writes. The shim is format-gated (`json` only), self-contained, and its removal degrades to the
  previous mixed stream rather than to silence.
- The backend's `LOG_FORMAT` now **defaults to `json`**: a production `.env` that omits the variable
  logs parseable output, and development opts into the console format explicitly.
- A client-supplied `X-Correlation-ID` is no longer honoured end-to-end (the stage-1 probe format
  `PROBE-AAA` would today be replaced at every surface). Correlation with an external caller's own
  ids is deliberately traded away for log-injection safety.

## Alternatives considered

- **Propagate the page-request id into cached fetches**, making "one id, everywhere" literally true.
  Impossible by construction: Next refuses request APIs inside `"use cache"`, and threading the id
  in as an argument would put it in the cache key, splitting the cache per request and destroying
  it. `"use cache: private"` exists for exactly this and was rejected too — it trades away the
  shared cache this site's read path is built on.
- **Keep per-fetch ids and log them on success as well.** Rejected: it measures the wrong unit. The
  reminder that opened the survey asked for "the trace id of this page view", and eight ids per view
  is what made that impossible.
- **Configure uvicorn's own access log format instead of disabling it.** Rejected: uvicorn's access
  logger cannot see the correlation id (it logs outside the middleware stack), so its line would be
  the one line per request that never joins.
- **A logging dependency (structlog, pino, next-logger) per service.** Rejected: both loggers exist
  and already emit JSON; what was broken was the contract between them and the writers beside them.
  Two dependencies would replace neither writer.
- **Honour any incoming `X-Correlation-ID` for cross-system correlation.** Rejected as a log
  injection primitive; the id is accepted only when it matches the well-formed hex shape.
