# Frontend — overview

**Verified against:** `ba71aca`, 2026-08-01
**Scope:** `fl_frontend/`

A Next.js 16 application on the App Router, React 19, HeroUI v3 and Tailwind v4. It is both the website
and, in effect, the system's application server: **the browser never talks to FastAPI directly.** Every
application read is a server-side fetch made from this container, which is why the entire caching design
lives here rather than in the backend.

## How it is organised

```
src/
├── app/         routes only — thin. Fetch, then hand off to a feature component
├── core/        infrastructure: api · auth · config · db · errors · logging · schemas · providers
├── features/    twelve slices, one per business entity
├── shared/      cross-slice components, hooks, types, utils
└── proxy.ts     the admin route guard
```

**Slices** are the unit of organisation: `admin`, `auth`, `dashboard`, `meta`, `saisons`,
`schiedsrichter`, `spiele`, `spieler`, `spielorte`, `spieltage`, `system`, `teams`. A slice holds its
own `queries.ts`, `mutations.ts`, `actions.ts`, `schemas.ts`, `types.ts` and `components/`, and only the
files it actually needs — most slices are read-only and have no `actions.ts` at all.

Within a slice, components sit in category folders: `views`, `collections`, `forms`, `modals`,
`providers`, `ui`. One extra level is permitted for a multi-section form; nothing nests deeper and
nothing sits flat in `components/`.

Two boundaries are **enforced by ESLint**, not convention: `core` may not import from `shared` or
`features`, and `shared` may not import from `features`. Where a shared component needs feature data it
takes it through props or children.

`admin` is the deliberate exception to slice independence: it is an **aggregator**, and legitimately
imports from four other slices because its context genuinely needs several lookup lists at once. This
is why the import lint is scoped to `core` and `shared` rather than banning cross-feature imports
generally — a blanket rule would flag dozens of correct sites. (ADR-0012.)

**There are no barrel files anywhere, on purpose.** An `index.ts` re-exporting a slice defeats
tree-shaking across the server/client boundary, which is exactly what the build is configured to
preserve. Import from the file you mean. (ADR-0003.)

**Exports are named**, everywhere under `src/`. Default exports appear only where Next.js requires
them — `page`, `layout`, `error`, `loading`, `not-found`, `template`, `default`, and the `app/`
metadata files. A route needing a default re-exports one explicitly. The reason is that a named export
turns a filename/export mismatch or a misspelled import alias into a compile error instead of a silent
rename.

## Data flow

A page calls a slice's `getX()` from `queries.ts`. That function is cached, declares its cache tags, and
delegates to `apiClient` (`core/api.ts`), which adds a bearer key and a correlation id, enforces a
15-second timeout across both the request and the body read, and validates the response with Zod before
returning it. Nothing reaches a component unvalidated.

Writes go the other way: a form calls a **server action** in `actions.ts`, which checks the admin
session, validates the payload with Zod, calls `mutations.ts` to reach the backend, and then invalidates
cache tags.

Backend and frontend models are **hand-mirrored** — Pydantic on one side, Zod on the other, with no
generation step. This is the main drift risk in the codebase and the first thing to check when
behaviour looks impossible.

## Caching

Eleven functions carry `"use cache"`. Lifetimes reflect how volatile the data is: matches for hours,
reference data (teams, players, matchdays, seasons, venues, referees) for days, system endpoints for
minutes.

Only **four** cache tags can ever be invalidated by the app, because only four resources have a write
surface: matches, teams, venues and referees. Everything else is edited out of band and cleared by a
script.

Granular (per-season) tags exist for exactly two resources, `spiele` and `teams`. Twenty other granular
tags once existed and were deleted, because a tag that nothing can invalidate is not a caching strategy
— it is decoration that reads like coverage. The full argument, including why per-status tags cannot
work, is in [`spec.md`](spec.md) §4.

One query is deliberately **not** cached: `getAdminSpieleActionRequired`, because it returns
admin-authorized data and has no business in a shared cache. (ADR-0013.)

## Rendering and the `connection()` guard

Data-fetching pages call `await connection()` before fetching. This looks like it defeats static
rendering and is deliberate: the Docker builder stage has **no reachable backend**, so a page that
tried to prerender its data would fail `docker compose build`. The layouts already split static chrome
from `Suspense`-wrapped data holes, so partial prerendering still does its job, and the caching layer
delivers the performance the prerender would have. Removing these calls breaks the build, not just
performance. (ADR-0009.)

The requirement is that `connection()` precede the fetch — not that it sit in the page's default export.
Where a page splits chrome from a data hole, it lives in the in-file async child that does the fetching.

## Authentication

Auth.js with a Resend magic-link provider and a MongoDB adapter. Two things are unusual and intentional.

First, this is the **one place the frontend touches MongoDB directly**. It targets a separate `authjs`
database, touches no business entities, and exists because the adapter has no HTTP transport and sits on
the hot path of every authorization check. Application data goes through FastAPI without exception.
(ADR-0010.)

Second, **admin is an email allowlist**, not a stored role. `ALLOWED_ADMIN_EMAILS` is checked at sign-in
and again when the session is built. `getAdminSession()` is the single definition of that policy —
note that it neither throws nor redirects, so calling it without checking the return value guards
nothing.

Sessions last 8 hours and magic links 15 minutes, both shortened from the library defaults. There is no
in-app sign-out, so session lifetime is the only revocation mechanism.

Route protection is layered: `proxy.ts` guards `/admin/:path*`, and `app/admin/layout.tsx` checks
independently, so rendering fails closed even if the matcher stops matching.

## Read next

- [`spec.md`](spec.md) — cache tags, contracts, invariants
- [`../glossary.md`](../glossary.md) — the German domain vocabulary
- [`../backend/overview.md`](../backend/overview.md) — the API this consumes
