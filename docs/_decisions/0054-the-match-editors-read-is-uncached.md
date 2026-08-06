# ADR-0054 — The match editor's read is uncached

**Status:** Accepted
**Date:** 2026-08-06
**Surface:** frontend
**Supersedes:** —
**Superseded by:** —
**Source:** The undo offer reporting "An unexpected response was received from the server" while its
write never reached the backend, reproduced by the owner on Next 16.2.12 and again on 16.3.0.

## Context

`getSpiel` was a `"use cache"` read carrying the `spiele` tag, which every match write invalidates.
That is what made the undo unusable, and the mechanism is a collision between three things this
repository decided separately and correctly.

**`cacheComponents` prerenders an App Shell per route** — the static frame, with the dynamic parts left
as holes to be filled per request. That half-finished render is a **postponed state**.

**`/admin/spiele/[spiel_id]` has no `generateStaticParams`,** which
[ADR-0011](0011-no-generate-static-params.md) rules out. Next therefore cannot know which fixture ids
exist and builds that route's shell with **fallback params** — placeholders standing in for a real id.

**Neither is a problem alone.** They meet on the revalidation path: the undo runs `updateTag("spiele")`
from `/admin`, having already left the editor, and that invalidates this route's cached entry. Next
re-renders it holding a postponed state **and** fallback params, asserts the combination is impossible,
and throws `Invariant: postponed state should not be provided when fallback params are provided` — an
error whose own text says it is a bug in Next.js.

**The damage is not the crash, it is where the crash lands.** It happens while the server action's
response is streaming, so the response is truncated mid-flight. The client cannot parse it, neither the
success nor the failure handler runs, and the admin sees a button that did nothing — while the backend
log shows no `PATCH` at all, because the write never happened. `docs/frontend/spec.md` records the
shape as invariant **I22**.

**Two things were tried first and neither is the answer.** The page was already reshaped so `params`
resolves inside a `<Suspense>` boundary, which is the documented fix for the top-level-await route into
the same invariant; it is correct, it stays, and it does not cover the revalidation route. Next was
then upgraded 16.2.12 → 16.3.0, whose release moves exactly this machinery — legacy PPR codepaths
removed (#94955), `appShells` on by default under `cacheComponents` (#94516), fallback params computed
and passed differently (#95066, #96210). The owner retested on 16.3.0 and the failure is unchanged.

## Decision

**`getSpiel` is not cached.** No `"use cache"`, no `cacheTag`, no `cacheLife` — the read goes to the
API on every request.

With nothing tagged on this route, `updateTag("spiele")` has no entry here to invalidate, so the
revalidation that produced the crash no longer has a reason to re-render this segment, and the
invariant becomes unreachable rather than merely rarer.

**It is the second uncached read in the app, and it joins the first for the first reason rather than
this one.** `getAdminSpieleActionRequired` is uncached because admin-authorized data does not belong in
a cache shared across requests. That argument covers `getSpiel` on its own merits: it is behind a
session, it is read by one person, and the surface that **edits** a fixture is the last place a stale
copy is acceptable. The invariant is what forced the change; it is not the only thing that justifies
it.

**Everything else about the write path is unchanged.** `patchAdminSpielDataAction` and
`undoAdminSpielEditAction` still invalidate `spiele`, `teams` and their season-scoped tags — the public
lists, the landing page and the league table are all cached and all still need it
([ADR-0001](0001-cache-tag-design.md)). What changed is that one read no longer subscribes.

## Consequences

**One backend round-trip per opening of the edit page**, paid by one admin on a page that is already
doing a round-trip's worth of work. `GET /spiele/{id}` is a single-document read.

**The undo's write can complete.** The response is no longer truncated, so the client sees the result
it was written to handle — including the failure paths, which until now could not be distinguished
from the transport dying.

**`await connection()` stays** ([ADR-0009](0009-connection-guards-every-data-fetch.md)). It is not
redundant now that the read is uncached: it is what keeps the image build from executing this fetch,
and removing it is on CLAUDE.md's never-list.

**The same exposure remains on two public routes, and this decision does not address them.**
`/dashboard/teams/[team_id]` and `/dashboard/spieler/[team_id]` are dynamic segments with no
`generateStaticParams`, reading `getTeam`, which is cached and tagged `teams` — and every match write
invalidates `teams`. The shape that crashed the admin route is therefore present on both. It has not
been observed there, and the fix applied here is deliberately **not** copied to them: those reads are
public, hot, and cached for good reasons
([ADR-0026](0026-team-statistics-are-derived-from-spiele.md),
[ADR-0029](0029-the-league-table-counts-the-gruppenphase.md)), so uncaching them would trade a rare
crash for a permanent cost on the busiest pages. Recorded here as a known risk with a named trigger:
if either route produces `FE-RSC-001`, that is this same invariant and it needs its own decision.

## Alternatives considered

**Give `getSpiel` a narrower tag** so a season-wide `updateTag("spiele")` misses it. Rejected on
correctness before cost: a match write resolves the whole bracket and rewrites fixtures the request
never named ([ADR-0042](0042-a-bracket-edge-is-the-source-not-the-label.md)), so nothing narrower than
`spiele` actually describes what one write invalidates. A tag that missed the revalidation would also
miss the edit, and the editor would reopen showing the fixture as it was.

**Wait for a Next.js fix.** It is Next's own bug by its own error text. Rejected as a plan rather than
as a hope: 16.3.0 was released and retested and did not fix it, and until it is fixed the admin cannot
take back a save — which is the one control ADR-0051 built instead of a confirmation dialog.

**Add `generateStaticParams` to remove the fallback params.** Rejected: ADR-0011 forbids it, and the
reasons stand — the id space is a database table, and enumerating it at build time would put a
build-time snapshot in front of a surface whose whole point is that it is current.

## See also

- [ADR-0011](0011-no-generate-static-params.md) — why the segment has no `generateStaticParams`
- [ADR-0001](0001-cache-tag-design.md) — the tag design the write path still uses
- [ADR-0051](0051-a-voided-result-is-named-before-it-is-lost.md) — the undo this failure disabled
- `docs/frontend/spec.md`, invariant I22 — the boundary rule and this failure's signature
