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

## Styling and the browser floor

`src/app/globals.css` is the style entry point for every route: the token layer, the `@theme` mapping,
the two focus exceptions, and the HeroUI import block. **`src/app/admin/admin.css` is a second, smaller
one**, imported by the admin layout and therefore loaded only under `/admin`. It holds the nine
component stylesheets no public route can reach — the date/time pickers, the calendar and the
autocomplete — which is 67 KB the public pages no longer download or parse (ADR-0023).

**HeroUI is imported component-by-component, not as `@import "@heroui/styles"`.** This is HeroUI's own
documented mechanism — the v3 release notes call it "ship only the CSS you use" — and it exists because
that package's entry pulls in every component it ships while **Tailwind does not tree-shake CSS imported
from a dependency**. The difference here is 715 KB of stylesheet against 329 KB, the surplus being
`range-calendar`, `color-swatch-picker`, `checkbox`, `radio` and two button-group variants that this app
never renders.

The cost of that mechanism is one maintenance rule, and it is the whole reason the block carries a
header: **a component whose CSS is not imported renders unstyled and fails nothing** — not `tsc`, not
`next build`, not ESLint. See [Adding a HeroUI component](#adding-a-heroui-component) below.

`browserslist` in `package.json` is Tailwind v4's own support matrix (Chrome/Edge 111, Firefox 128,
Safari and iOS 16.4). It is not a guess about the audience: the stylesheet uses `oklch()`, `color-mix()`
and `@property`, so a browser below that line cannot render this app at all. Raising the floor is worth
roughly 35 KB gzipped across the client chunks in reduced syntax down-levelling.

**It does not remove the polyfills PageSpeed reports under "Legacy JavaScript".** Those come from
`next/dist/build/polyfills/polyfill-module.js`, which Next injects unconditionally and browserslist does
not govern. Real size 1,380 bytes; Lighthouse's "14 KiB" is an estimate, and the audit is unscored.
There is no supported way to drop it — do not spend time on that diagnostic.

### Adding a HeroUI component

Importing the component in TSX is half the change. The other half, and **there are two stylesheets to
check, not one**: `src/app/globals.css` loads everywhere, `src/app/admin/admin.css` loads only under
`/admin` (ADR-0023).

1. **Decide which file it belongs in.** It goes in `admin.css` only if no public route can reach it —
   established from the import graph, following dynamic imports, not from folder names. `Select`,
   `ListBox` and `CloseButton` all look admin-shaped and are not. **When in doubt, `globals.css`**: the
   cost of guessing wrong that way is a few KB, the other way it is an unstyled admin form.
2. Add `@import "@heroui/styles/components/<name>.css" layer(components);` **at the position it occupies
   in `node_modules/@heroui/styles/dist/components/index.css`** — not at the end. HeroUI's file states
   the order is load-bearing: shared primitives first, then the components that compose them.
3. Check what the component renders _underneath_ it. A picker is a popover plus a listbox plus a button,
   and each has its own stylesheet. The quickest check is to render it and read `[data-slot]` in the DOM:
   any slot whose CSS is missing shows up as an unstyled box. **Sub-components can be public even when
   the parent is not** — that is why `close-button` and `list-box` stayed in `globals.css`.
4. **Grep both files before you finish.** A component in neither renders unstyled; a component in both
   ships to visitors who never see it.
5. Verify in the browser, not by reading the diff. Computed styles are the evidence — a border-radius, a
   padding and a background that are not the browser defaults. For an `admin.css` entry that means
   signing in and opening the admin page, because no public route will show the mistake.

## Metadata and indexing

Every route sets its own `title`, `description` and canonical; `metadataBase` in the root layout is what
lets the canonicals be paths. Two consequences worth knowing before editing metadata:

- **A route that sets no metadata inherits the root layout's, canonical included** — including the
  canonical URL, so an unset canonical claims to be the homepage rather than claiming nothing.
- **`openGraph` is inherited or replaced whole, never merged field-by-field.** The root layout therefore
  declares only the genuinely site-wide parts (`siteName`, `images`, `locale`, `type`); og:title and
  og:description resolve from each page's own title and description.
- **No route ships a `keywords` array.** Google has ignored the tag since 2009 and Bing reads an
  overstuffed one as a spam signal, so the twelve arrays that existed were maintenance with no reader.
  Ranking terms belong in the title and description. (ADR-0018.)

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
