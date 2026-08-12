# Frontend — overview

**Verified against:** `d6dd386`, 2026-08-12\
**Scope:** `fl_frontend/`

A Next.js 16 application on the App Router, React 19, HeroUI v3 and Tailwind v4. It is both the website
and, in effect, the system's application server: **the browser never talks to FastAPI directly.** Every
application read is a server-side fetch made from this container, which is why the entire caching design
lives here rather than in the backend.

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

**Slices** are the unit of organisation: one directory per business entity under `src/features/`,
holding its own `queries.ts`, `mutations.ts`, `actions.ts`, `schemas.ts`, `types.ts` and `components/`,
and only the files it actually needs. Which slices exist and which modules each holds is
[`spec.md`](spec.md) §1.1. Within a slice, components sit in category folders — `views`, `collections`,
`forms`, `modals`, `providers`, `ui` — with one extra level permitted for a multi-section form; nothing
nests deeper and nothing sits flat in `components/`.

Two boundaries are **enforced by ESLint**, not convention: `core` may not import from `shared` or
`features`, and `shared` may not import from `features` ([`spec.md`](spec.md) I9). Where a shared
component needs feature data it takes it through props or children. `admin` is the deliberate exception
to slice independence — an **aggregator** that legitimately imports from other slices, which is why the
lint is scoped to `core` and `shared` rather than banning cross-feature imports generally
([ADR-0008](../_decisions/0008-admin-is-an-aggregator-slice.md)).

**There are no barrel files** ([`spec.md`](spec.md) I10,
[ADR-0003](../_decisions/0003-no-barrel-files.md)) and **exports are named** except where Next.js
requires a default ([`spec.md`](spec.md) I11). Import from the file you mean.

## Data flow

A page calls a slice's `getX()` from `queries.ts`. That function is cached, declares its cache tags, and
delegates to `apiClient` (`fl_frontend/src/core/api.ts`), which adds a bearer key and a correlation id,
enforces a timeout across both the request and the body read, and validates the response with Zod before
returning it — nothing reaches a component unvalidated. Writes go the other way: a form calls a **server
action** in `actions.ts`, which checks the admin session, validates the payload with Zod, calls
`mutations.ts` to reach the backend, and then invalidates cache tags ([`spec.md`](spec.md) §1.3).

Backend and frontend models are **hand-mirrored** — Pydantic on one side, Zod on the other, with no
generation step. This is the main drift risk in the codebase and the first thing to check when
behaviour looks impossible; what holds the two together is [`spec.md`](spec.md) I17.

## Caching

Reads are cached with `"use cache"`, and lifetimes reflect how volatile the data is: matches for hours,
reference data for days, system endpoints for minutes. The function-by-function table is
[`spec.md`](spec.md) §1.2, which reads are deliberately uncached is there too, the tag design is §1.4,
and what an edit made straight in MongoDB costs is §1.5.

## Rendering

Data-fetching pages call `await connection()` before fetching. This looks like it defeats static
rendering and is deliberate: the Docker builder stage has **no reachable backend**, so a page that tried
to prerender its data would fail the image build rather than merely render slowly
([`spec.md`](spec.md) I6, [ADR-0006](../_decisions/0006-connection-guards-every-data-fetch.md)).

## Styling

`fl_frontend/src/app/globals.css` is the style entry point for every route: the token layer, the
`@theme` mapping, the focus exceptions, and the HeroUI import block.
**`fl_frontend/src/app/admin/admin.css` is a second, smaller one**, imported by the admin layout and
therefore loaded only under `/admin`, holding the component stylesheets no public route can reach
([ADR-0016](../_decisions/0016-admin-only-css-split.md), which measures what that keeps out of a public page).

**HeroUI is imported component-by-component, not as `@import "@heroui/styles"`**: that package's entry
pulls in every component it ships, and **Tailwind does not tree-shake CSS imported from a dependency**
([ADR-0013](../_decisions/0013-per-component-heroui-css.md)). The cost of that mechanism is one
maintenance rule, and it is the whole reason the import block carries a header: **a component whose CSS
is not imported renders unstyled and fails nothing** — not `tsc`, not `next build`, not ESLint. The
checklist that rule comes down to, both stylesheets included, is [`spec.md`](spec.md) §1.11.

`browserslist` in `package.json` is Tailwind v4's own support matrix (Chrome/Edge 111, Firefox 128,
Safari and iOS 16.4). It is not a guess about the audience: the stylesheet uses `oklch()`, `color-mix()`
and `@property`, so a browser below that line cannot render this app at all. It does **not** govern
Next's own polyfill bundle, which is [`spec.md`](spec.md) §4's.

## Copy and metadata

The site addresses its reader as `Du` — informal, capitalised, never `Sie` — with a second register on
top of that for refusal copy; which strings the rules reach, and why nothing mechanical can hold them,
is [`spec.md`](spec.md) §1.12. Every route sets its own `title`, `description` and canonical, and
`metadataBase` in the root layout is what lets the canonicals be paths; what an unset value ends up
claiming, and why no route ships a `keywords` array, is §1.13.

## Authentication and authorization

Auth.js with a Resend magic-link provider and a MongoDB adapter. Two things are unusual and intentional.

First, this is the **one place the frontend touches MongoDB directly**: a separate `authjs` database, no
business entities, and it exists because the adapter has no HTTP transport and sits on the hot path of
every authorization check. Application data goes through FastAPI without exception
([ADR-0007](../_decisions/0007-authjs-owns-a-direct-mongoclient.md)).

Second, **admin is an email allowlist**, not a stored role. `ALLOWED_ADMIN_EMAILS` is checked at sign-in
and again when the session is built. `getAdminSession()` is the single definition of that policy, and
its return value has to be checked — [`spec.md`](spec.md) I8 says what happens when it is not.

Session and magic-link lifetimes are both shortened from the library defaults
(`fl_frontend/src/core/auth.ts`); what ends a session before its lifetime does is [`spec.md`](spec.md)
§4. Route protection is layered: `fl_frontend/src/proxy.ts` guards `/admin/:path*`, and
`fl_frontend/src/features/admin/components/providers/AdminAuthGuard.tsx :: AdminAuthGuard` — which the
admin layout renders inside its `Suspense` boundary, so the shell still prerenders — checks
independently, so rendering fails closed even if the matcher stops matching.

## Read next

- [`spec.md`](spec.md) — the cache design, the contracts and the invariants
- [`../glossary.md`](../glossary.md) — the German domain vocabulary
- [`../backend/overview.md`](../backend/overview.md) — the API this consumes
- [`../ops/overview.md`](../ops/overview.md) — the container this runs in
