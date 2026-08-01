# ADR-0011 — No `generateStaticParams` on the two dynamic segments

**Status:** Accepted
**Date:** 2026-07-29
**Surface:** frontend, ops
**Supersedes:** —
**Superseded by:** —
**Source:** CLAUDE.md §9 A6

## Context

`dashboard/teams/[team_id]` and `dashboard/spieler/[team_id]` are dynamic segments with no
`generateStaticParams`. Adding it is the standard move for a known, finite set of ids, and teams are
exactly that.

## Decision

**No `generateStaticParams` on either segment.**

## Consequences

Three independent reasons, any one of which is sufficient:

**It would call `getTeams()` at build time**, which throws `APINetworkError` in the Docker builder
stage — there is no reachable backend there. Same constraint as
[ADR-0009](0009-connection-guards-every-data-fetch.md), and it fails the image build rather than
degrading gracefully.

**The prerender set is `teams × seasons`** and grows every season, forever. What looks like a bounded
set is bounded only for the current season.

**The pages are `saison_id`-parameterised through `searchParams`**, which `generateStaticParams` cannot
enumerate — it produces route segments, not query strings. So even a successful prerender would cover
one season's worth of a page that is meant to be viewable for any season.

`cacheLife("days")` on `getTeams` already delivers most of the benefit: the first request for a team
warms the cache and the rest are served from it.

## Alternatives considered

**Prerender only the current season's teams.** Rejected: it still calls the API at build time, so the
build-stage problem is unchanged, and it would produce a page that is static for one season and dynamic
for every other — an inconsistency a reader would have to discover.

**Prerender with `dynamicParams` allowing the rest.** Same build-time problem, and the same
`searchParams` gap.
