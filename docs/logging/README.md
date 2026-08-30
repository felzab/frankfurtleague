# Logging

**Verified against:** `6adfac16`, 2026-08-30

**Folder purpose:** how a request is followed across nginx, the frontend and the backend — what a
log line is on each surface, what an error code means, and how to get from a symptom to the right
lines.

## Folder overview

| Read                               | For                                                             |
| ---------------------------------- | --------------------------------------------------------------- |
| [`spec.md`](spec.md)               | The correlation id, the stream contract, the invariants         |
| [`error-codes.md`](error-codes.md) | Every `error_code` either service emits, and the response shape |

## Finding an incident

- **A reported error page.** The page shows a digest, and **a digest names an error class, not an
  incident** — Next derives it from the message, so every `APINetworkError` shares one. Take the
  digest plus the time and route, find the matching `FE-RSC-001` line, and its `correlation_id` and
  `fetch_correlation_id` open the nginx and backend lines for that exact request. The error page's
  report link pre-fills those three coordinates
  (`fl_frontend/src/shared/components/ui/Error.tsx`), so a reader's report arrives with the search
  already narrowed.
- **A slow page.** The nginx line carries `duration_s` and `upstream_duration_s`; the backend line
  carries `duration_ms`. An edge duration with no matching upstream duration is nginx or the
  network; a large backend `duration_ms` is the application.
- **Uptime monitoring.** A total backend outage still serves HTTP 200, because the error boundary
  streams after the headers are sent. Monitor
  `GET https://frankfurtleague.de/api/v0/system/is_live` instead — the apex host and no trailing slash,
  since either variation answers a redirect a monitor reads as green ([`../ops/spec.md`](../ops/spec.md)
  §3). It is the one backend path the edge carries (that page's I13), and the probe is deliberately
  unguarded (`fl_backend/app/api/system/router.py :: check_is_live`), so it answers from the backend
  itself.

## Read next

- [`spec.md`](spec.md) — start here if the question is what a line contains or who mints the id.
