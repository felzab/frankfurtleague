# ADR-0002 — An omitted `saison_id` means the current season, resolved in the backend

**Status:** Accepted
**Date:** 2026-07-31
**Surface:** backend, frontend
**Supersedes:** —
**Superseded by:** —
**Source:** remediation ledger question Q4, implemented as BE-1

## Context

Every page that reads Spiele, Teams or Spieltage needed a season id. The frontend resolved it by calling
`getCurrentSaison()` first and then issuing the real query — two round trips in series, on eight routes,
in front of the most common page loads in the application.

The season lookup could not be parallelised with the query that needed its result.

## Decision

**`GET /spiele`, `GET /teams` and `GET /spieltage` resolve `saison_id` to the current season when the
parameter is absent.** The resolution happens in the route handler.

`GET /spieler` is deliberately excluded: it is narrowed by `team_id` instead, so a season default would
add a database lookup on its hot path and narrow nothing.

## Consequences

The serialised pre-query lookup disappears. `resolveSaisonId` now returns `undefined` for an absent or
malformed parameter and passes it straight through — `apiClient` drops undefined params rather than
serialising them, so no call site had to change shape.

**"No parameter" now means _current season_, not _all seasons_.** Any caller wanting every season must
ask explicitly. This is the single most surprising consequence and the one most likely to trip someone
up.

**This is why the base cache tags must be invalidated unconditionally** — see
[ADR-0001](0001-two-granular-cache-tags.md). The default read path now sends no season, so the busiest
cache entries carry only the base tag.

For `GET /teams` it does something extra and load-bearing: it flips the junction join to strict. Without
a season the `$lookup` returns one row per season a team ever played in, and a team with no row at all
survives the unwind with `gruppe` and `statistik` unset — which then fails response validation.

Sequencing mattered: the backend change had to ship before the frontend stopped sending the parameter,
or the frontend would have sent nothing to a backend that still required something. It did, in Wave 7.

## Alternatives considered

**A Pydantic field default on `saison_id`.** The obvious shape, and impossible: a field default is a
constant evaluated at import time, and the current season is a database query. This is why the
resolution sits in the handler and must stay there.

**Keep resolving in the frontend, but in parallel with the page's other queries.** Rejected: the season
id is an _input_ to the query that needs it, so there is nothing to parallelise — the dependency is
real, not an artefact of how the code was written. Moving the default server-side removes the
dependency instead of hiding it.

**Default in the frontend's `apiClient` instead.** Rejected: it would put domain knowledge ("what is the
current season") into the transport layer, and every other consumer of the API would still need its own
answer.
