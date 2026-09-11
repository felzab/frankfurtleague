# Frontend — overview

**Scope:** `fl_frontend/`

A Next.js application on the App Router, with React, HeroUI and Tailwind. It is both the website and,
in effect, the system's application server: **no browser reaches FastAPI for application data** — the
edge routes every `/api` path but the backend's liveness probe here
([`../ops/spec.md`](../ops/spec.md) I13). Every application read is a server-side fetch made from this
container, which is why the page-level caching and its tag invalidation live here rather than in the
backend.

## How it is organised

**Routes under `src/app/` are thin**: fetch, then hand off to a feature component. **Slices** are the
unit of organisation — one directory per business entity under `src/features/`, holding only the
modules it needs ([`spec.md`](spec.md) §1.1). Within a slice, components sit in category folders —
`views`, `collections`, `forms`, `modals`, `providers`, `ui` — with one extra level permitted for a
multi-section form; nothing nests deeper and nothing sits flat in `components/`.

`src/core/` imports neither `src/shared/` nor `src/features/`, and `src/shared/` does not import
`src/features/` — **enforced by ESLint**, not convention ([`spec.md`](spec.md) I9). `admin` is the
deliberate exception to slice independence, an **aggregator** that legitimately imports from other
slices, which is why the lint is scoped to `src/core/` and `src/shared/` rather than banning
cross-feature imports generally. There are no
barrel files and exports are named ([`spec.md`](spec.md) I10, I11).

**That rule says what may import what, and not which of the two folders a module belongs in.**
`src/core/` is what the server process is and what every surface needs before a page exists —
configuration, the API client, auth, mail, logging, the domain constants a schema and an email both
read. `src/shared/` is what a rendered page is built from — components, hooks and the utilities
those call. **No lint decides it**: ESLint reads an import graph rather than what a module is for,
so the test is applied when the module is written and the rule stays scoped to the direction
([`spec.md`](spec.md) I9).

**Where I9 forecloses the answer, the test is not consulted.** A module some `core` module imports
cannot sit in `shared`, and a module importing anything from `shared` cannot sit in `core` — so a
test-only reader a `core` test needs belongs in `core` however little it resembles the server
process (`fl_frontend/src/core/treeWalk.ts`, `fl_frontend/src/core/stdoutCapture.ts`), and a
route-handler spine reaching a `shared` utility belongs in `shared` however much it resembles one
(`fl_frontend/src/shared/utils/publicRoute.ts`). **The test decides only what I9 leaves open**, and
a module whose importers all sit outside both folders is always open.

**Neither folder invents grouping subfolders to express membership** — a second nesting level is
refused ([`../../.claude/CLAUDE.md`](../../.claude/CLAUDE.md) §7), so a module whose folder is
arguable is argued about rather than filed under a new name.

## Data flow

Reads are cached with `"use cache"`, and a write is a server action that invalidates tags. The
function-by-function table, the reads deliberately left uncached, the tag design and what an edit made
straight in MongoDB costs are [`spec.md`](spec.md) §1.2–§1.5.

Backend and frontend models are **hand-mirrored** — Pydantic on one side, Zod on the other, with no
generation step. This is the main drift risk in the codebase and the first thing to check when
behaviour looks impossible; what holds the two together is [`spec.md`](spec.md) I17.

## Rendering

Data-fetching pages call `await connection()` before fetching. This looks like it defeats static
rendering and is deliberate: the Docker builder stage has **no reachable backend**, so a page that
tried to prerender its data would fail the image build rather than merely render slowly
([`spec.md`](spec.md) I6).

## Styling

**HeroUI is imported component by component**, because that package's entry pulls in everything it
ships and Tailwind does not tree-shake CSS imported from a dependency. The cost is one maintenance
rule, and the checklist for it — both stylesheets included — is [`spec.md`](spec.md) §1.11.

`browserslist` in `fl_frontend/package.json` is Tailwind's own support matrix rather than a guess
about the audience: the stylesheet uses `oklch()`, `color-mix()` and `@property`, so a browser below
that line cannot render this app at all. It does **not** govern Next's own polyfill bundle
([`spec.md`](spec.md) §4).

## Authentication and authorization

Auth.js, with a Resend magic-link provider. **This is the one place the frontend touches MongoDB
directly** — a separate `authjs` database, no business entities — and it exists because the Auth.js
adapter has no HTTP transport and sits on the hot path of every authorization check. Application data
goes through FastAPI without exception.

**Admin is an email allowlist, not a stored role.** `ALLOWED_ADMIN_EMAILS` is checked at sign-in and
again when the session is built, both through `fl_frontend/src/core/auth.ts :: isUserAdmin`, where the
policy is defined. `getAdminSession()` is the single gate server code reaches it through, and its
return value has to be checked — [`spec.md`](spec.md) I8 says what happens when it is not.

**Route protection is layered**: `fl_frontend/src/proxy.ts` guards `/admin/:path*`, and
`fl_frontend/src/features/admin/components/providers/AdminAuthGuard.tsx :: AdminAuthGuard` — rendered
inside the admin layout's `Suspense` boundary, so the shell still prerenders — checks independently,
so rendering fails closed even if the matcher stops matching. What ends a session early is a
revocation out of band rather than a lifetime expiring ([`spec.md`](spec.md) §4).

## Read next

- [`spec.md`](spec.md) — the cache design, the copy rules, the contracts and the invariants
- [`../glossary.md`](../glossary.md) — the German domain vocabulary
- [`../backend/overview.md`](../backend/overview.md) — the API this consumes
- [`../ops/overview.md`](../ops/overview.md) — the container this runs in
