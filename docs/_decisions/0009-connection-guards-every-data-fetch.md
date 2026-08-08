# ADR-0009 — `await connection()` guards every page data fetch

**Status:** Accepted
**Date:** 2026-07-29 (wording amended 2026-07-31)
**Surface:** frontend, ops
**Supersedes:** —
**Superseded by:** —
**Source:** Rule A1 of the ratified-rules register CLAUDE.md carried, extracted into this folder 2026-07-29

## Context

Thirteen pages call `await connection()` before fetching data, which opts them out of static rendering.
This reads as defeating the point of the App Router and of partial prerendering, and it is the first
thing anyone would try to remove to "restore prerendering".

## Decision

**`connection()` precedes every page data fetch, and stays.**

The requirement is that it precede the fetch — **not** that it sit in the page's default export. Where a
page splits static chrome from a `Suspense`-wrapped data hole (`admin/schiedsrichter`,
`admin/spielorte`), it lives in the in-file async child that performs the fetch.

## Consequences

**Removing these calls breaks the build, not just performance.** The Docker builder stage has no
reachable backend: `SKIP_ENV_VALIDATION=true`, a placeholder `MONGODB_URI`, and **no `API_URL` at all**.
A page that tried to prerender its data would call `apiClient` at build time and fail
`docker compose build` on every data-fetching page.

So this is a hard constraint imposed by the deployment model, not a performance trade-off.

Very little is actually lost. The layouts already provide the static-shell / dynamic-hole split, so
partial prerendering does its job at the layout level, and the `"use cache"` layer delivers the
performance a prerender would have — a cache hit issues no request.

The related constraint that a reader trips over separately: **before deleting a `"use client"`
directive, check the file for render props.** A Server Component may not pass a function to a Client
Component, and on a dynamic route neither `tsc` nor `next build` catches it — the build never renders
the page — so it throws at request time. `SaisontabelleView` keeps its directive for exactly this
reason, verified against a probe route.

## Alternatives considered

**Remove the guards and let the pages prerender.** Rejected: the build fails. This was verified rather
than assumed.

**Give the builder stage a reachable backend.** Rejected: it would mean standing up FastAPI and MongoDB
inside the image build, making the build depend on a database and turning a hermetic build into an
integration test.

**Fetch at build time from a static fixture.** Rejected: the prerendered pages would then ship
last-build's fixtures rather than real data, which is worse than dynamic rendering with a warm cache.
