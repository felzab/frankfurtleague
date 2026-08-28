# Frontend — overview

**Verified against:** `1455c46b`, 2026-08-28\
**Scope:** `fl_frontend/`

A Next.js application on the App Router, with React, HeroUI and Tailwind. It is both the website and, in
effect, the system's application server: **no browser reaches FastAPI for application data.** The edge
carries one exact-match path to that service, the liveness probe, and routes every other `/api` path here
([`../ops/spec.md`](../ops/spec.md) I13). Every application read is a server-side fetch made from this
container, which is why the page-level caching and its tag invalidation live here rather than in the backend.

## How it is organised

```
src/
├── app/                routes only — thin. Fetch, then hand off to a feature component
├── core/               infrastructure: api · auth · config · db · errors · logging · correlation · schemas · providers
├── features/           one slice per business entity
├── shared/             cross-slice components, hooks, types, utils
├── instrumentation.ts  Next's instrumentation entry: the startup environment gate and the server error hook
└── proxy.ts            the admin route guard
```

**Slices** are the unit of organisation: one directory per business entity under `src/features/`, holding
its own `queries.ts`, `mutations.ts`, `actions.ts`, `schemas.ts`, `types.ts` and `components/`, and only the
files it needs. Which slices exist and which modules each holds is [`spec.md`](spec.md) §1.1. Within a slice,
components sit in category folders — `views`, `collections`, `forms`, `modals`, `providers`, `ui` — with one
extra level permitted for a multi-section form; nothing nests deeper and nothing sits flat in `components/`.

`core` imports neither `shared` nor `features`, and `shared` does not import `features` — **enforced by
ESLint**, not convention ([`spec.md`](spec.md) I9). `admin` is the deliberate exception to slice independence,
an **aggregator** that legitimately imports from other slices, which is why the lint is scoped to `core` and
`shared` rather than banning cross-feature imports generally. There are no barrel files and exports are named
(I10, I11), so import from the file you mean.

## Data flow

A page calls a slice's `getX()` from `queries.ts`, which is cached, declares its cache tags and delegates to
`apiClient` (`fl_frontend/src/core/api.ts`) — so nothing reaches a component unvalidated. Writes go the other
way: a form calls a **server action** in `actions.ts`, which checks the admin session, validates the payload,
reaches the backend through `mutations.ts`, then invalidates tags ([`spec.md`](spec.md) §1.3).

Backend and frontend models are **hand-mirrored** — Pydantic on one side, Zod on the other, with no
generation step. This is the main drift risk in the codebase and the first thing to check when behaviour
looks impossible; what holds the two together is [`spec.md`](spec.md) I17.

Reads are cached with `"use cache"`. The function-by-function table, the reads deliberately left uncached,
the tag design and what an edit made straight in MongoDB costs are [`spec.md`](spec.md) §1.2–§1.5.

## Rendering

Data-fetching pages call `await connection()` before fetching. This looks like it defeats static rendering
and is deliberate: the Docker builder stage has **no reachable backend**, so a page that tried to prerender
its data would fail the image build rather than merely render slowly ([`spec.md`](spec.md) I6).

## Styling

`fl_frontend/src/app/globals.css` is the style entry point for every route — the token layer, the `@theme`
mapping, the utility recipes, the focus exceptions and the HeroUI import block.
**`fl_frontend/src/app/admin/admin.css` is a second, smaller one**, imported by the admin layout and
therefore loaded only under `/admin`, holding the component stylesheets no public route can reach.

**HeroUI is imported component by component**, because that package's entry pulls in everything it ships and
Tailwind does not tree-shake CSS imported from a dependency. The cost is one maintenance rule, and the
checklist for it — both stylesheets included — is [`spec.md`](spec.md) §1.11.

`browserslist` in `fl_frontend/package.json` is Tailwind's own support matrix rather than a guess about the
audience: the stylesheet uses `oklch()`, `color-mix()` and `@property`, so a browser below that line cannot
render this app at all. It does **not** govern Next's own polyfill bundle ([`spec.md`](spec.md) §4).

## Copy and metadata

The site addresses its reader as `Du` — informal, capitalised, never `Sie` — with a second register on top of
that for refusal copy ([`spec.md`](spec.md) §1.12). Every public route sets its own `title`, `description`
and canonical, and `metadataBase` in the root layout is what lets the canonicals be paths (§1.13).

## Authentication and authorization

Auth.js with a Resend magic-link provider and a MongoDB adapter. Two things are unusual and intentional.

First, this is the **one place the frontend touches MongoDB directly**: a separate `authjs` database, no
business entities, and it exists because the adapter has no HTTP transport and sits on the hot path of every
authorization check. Application data goes through FastAPI without exception.

Second, **admin is an email allowlist**, not a stored role. `ALLOWED_ADMIN_EMAILS` is checked at sign-in and
again when the session is built. `getAdminSession()` is the single definition of that policy, and its return
value has to be checked — [`spec.md`](spec.md) I8 says what happens when it is not.

Route protection is layered: `fl_frontend/src/proxy.ts` guards `/admin/:path*`, and
`fl_frontend/src/features/admin/components/providers/AdminAuthGuard.tsx :: AdminAuthGuard` — rendered inside
the admin layout's `Suspense` boundary, so the shell still prerenders — checks independently, so rendering
fails closed even if the matcher stops matching. Session and magic-link lifetimes are shortened from the
library defaults, and what ends a session early is [`spec.md`](spec.md) §4.

## Read next

- [`spec.md`](spec.md) — the cache design, the contracts and the invariants
- [`../glossary.md`](../glossary.md) — the German domain vocabulary
- [`../backend/overview.md`](../backend/overview.md) — the API this consumes
- [`../ops/overview.md`](../ops/overview.md) — the container this runs in
