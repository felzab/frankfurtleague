# Frontend — overview

**Scope:** `fl_frontend/`

A Next.js application on the App Router, with React and Tailwind. It is both the website and, in
effect, the system's application server: **no browser reaches FastAPI for application data**. Every
application read is a server-side fetch made from this container, which is why the page caching and
its invalidation live here rather than in the backend.

## How it is organised

| Folder                   | Holds                                                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/`               | The routes: the public pages, `dashboard/` for the season pages, `bereich/` for every signed-in area                                                        |
| `src/kit/`               | The design system's components, built on React Aria Components                                                                                              |
| `src/core/`              | What the server process is and what every surface needs: configuration, the API client, auth, mail, logging, the string catalogue and the formatting module |
| `src/shared/`            | What a rendered page is built from beside the kit: components, hooks and the utilities those call                                                           |
| `src/features/<domain>/` | One slice per domain: its cached reads, server actions, schemas and the components of its pages                                                             |
| `src/proxy.ts`           | The request proxy in front of every signed-in area                                                                                                          |

**Routes are thin**: a page fetches, then hands off to its slice. A slice holds only the modules it
needs: `queries.ts` for reads, `mutations.ts` for the calls that write, `actions.ts` for the server
actions a form calls, `personActions.ts` for those a signed-in person's own pages call, `schemas.ts`
for its Zod schemas.

**Imports run one way.** `src/core/` imports neither `src/shared/` nor `src/features/`, and
`src/shared/` does not import `src/features/`; ESLint refuses both (`fl_frontend/eslint.config.mjs`).
Which of the two folders a module belongs in, that rule does not decide: `src/core/` is what the
server process is and what every surface needs before a page exists, and `src/shared/` is what a
rendered page is built from. A module some `src/core/` module imports belongs in `src/core/`, and one
importing anything from `src/shared/` cannot sit there. Exports are named and no folder has a barrel
file.

**Every lint rule holds new code from the start.** The old pages' existing violations are counted per
file and rule in `fl_frontend/eslint-suppressions.json`, which ESLint's
[bulk suppressions](https://eslint.org/docs/latest/use/suppressions) write and read. A file breaking
a rule more often than its count fails the lint, and so does a count larger than what the file still
breaks; the gate also fails a count kept for a file that no longer exists. A session rebuilding a
file removes that file's entries by running `pnpm exec eslint --prune-suppressions <its files>` in
`fl_frontend`, and commits the rewritten list with the rebuild. The editor's ESLint extension reads
the list only through ESLint's `applySuppressions` option, which ESLint 9 lacks, so on the installed
ESLint 9 it underlines an old page's counted violations as errors that `pnpm run lint` passes.

## Data flow

**Reads are cached with `"use cache"`, and a write is a server action.** Every cached scope carries
one tag, `fl_frontend/src/core/siteCache.ts :: SITE_CACHE_TAG`, and the save spines clear it after
every write that may stand (`fl_frontend/src/shared/utils/adminMutation.ts :: runGuardedMutation`,
and `fl_frontend/src/shared/utils/publicRoute.ts :: handlePublicRequest` for a route handler), so no
write names the reads it moves. The league's reads keep Next's `minutes` lifetime; the read of a
`Fassung` (`fl_frontend/src/core/einwilligung.ts :: getEinwilligungFassung`) keeps the longest,
since a label's words never change. **The administration's reads are not cached**: each runs through
`fl_frontend/src/shared/utils/adminRead.ts :: runAdminRead`, which judges the session first.

**A change no save makes, a background pass's or an edit made straight in MongoDB, is served stale
for at most the `minutes` lifetime**: the clear lives in the spines, and nothing clears the tag from
outside a request ([`../ops/runbooks.md`](../ops/runbooks.md#20-after-a-hand-edit-in-mongodb)).

**The backend's contract is generated** into `fl_frontend/src/core/generated/` from
`fl_backend/openapi.json` by `fl_frontend/orval.config.ts`: the wire types, one SDK function per
operation sent through `fl_frontend/src/core/transport.ts` with the key tier its `security` names,
and Zod schemas for request bodies and parameters alone. Every module opens with
`import 'server-only'`, so a client component may import a type from it with `import type` and
nothing else. A change to the backend's routes or models regenerates both with `pnpm run contract`
in `fl_frontend`, which exports the document and then runs Orval, committing what moves; the gate's
db scope runs the same script and fails a tree where either is stale. The slices' hand-written Zod
schemas in `schemas.ts` only name the answer's type for the calls made through
`fl_frontend/src/core/api.ts :: apiClient`, which parses no answer, so a disagreement between one
and the generated types is the first thing to check when behaviour looks impossible.

## Rendering

Data-fetching pages call `await connection()` before fetching. This looks like it defeats static
rendering and is deliberate: the Docker builder stage has **no reachable backend**, so a page that
tried to prerender its data would fail the image build.

## Styling and copy

Tailwind v4, configured in CSS: `src/app/globals.css` and the design tokens in `src/app/tokens.css`.
`browserslist` in `fl_frontend/package.json` is Tailwind's own support matrix, since the stylesheet
uses `oklch()`, `color-mix()` and `@property`; it does not govern Next's own polyfills.

**The kit's components take every wording prop as `fl_frontend/src/core/copy.ts :: Copy`**, so a
string reaches them only from the catalogue. The pages render HeroUI components and carry their own
strings and date formatting. How a string is written is [`copy.md`](copy.md).

## Authentication and authorization

Better Auth, with a passkey sign-in and a six-digit code mailed as the fallback; the administration
admits only a session a passkey signed in. **This is the one place the frontend touches MongoDB
directly**: a separate `auth` database holding sessions and passkeys and no league data
(`fl_frontend/src/core/authIndexes.ts :: MONGO_DB_NAME`, reached through
`fl_frontend/src/core/db.ts :: signInStore`), because the library's adapter has no HTTP transport
and sits on every authorization check. Application data goes through FastAPI without exception.

**Administration is a stored grant, read on every request.** A row of `berechtigungen`
(`Berechtigung`) makes an address an administrator; the frontend reads it through
`fl_frontend/src/core/verwaltung.ts :: verwaltungOf`, and the backend checks it again on every
administration request. A backend that cannot answer admits nobody, and a revoked grant admits
nothing from the next request on. Every admin server action runs through
`fl_frontend/src/shared/utils/adminMutation.ts :: runAdminMutation`, which opens on
`fl_frontend/src/core/auth.ts :: judgeAdminRequest`.

**Route protection is layered.** `src/proxy.ts` turns away a request to `/bereich` carrying no
session cookie before any read, and judges nothing further, as Next's and Better Auth's guidance has a
proxy check. The session, its sign-in factor and the grant are judged where the data is read: no
layout turns a session away, because Next renders a page whatever its layout decides.

**A person's sign-in is managed on one account page, `/bereich/konto`**, whichever area they hold:
every signed-in shell links it, and its passkeys and sign-ins change only behind a recent sign-in or
confirmation.

## Configuration and tests

`fl_frontend/src/core/config.ts` validates the environment at startup with one Zod schema and hands
each secret to the one module that may read it; a failure names the variables, never their values,
and the process exits. Tests sit beside the module they test as `*.test.ts`, a `*.db.test.ts` needing
the sign-in store's MongoDB; the scripts in `fl_frontend/package.json` run them.

## Read next

- [`copy.md`](copy.md) — how every string a visitor reads is written
- [`../glossary.md`](../glossary.md) — the German domain vocabulary
- [`../backend/overview.md`](../backend/overview.md) — the API this consumes
- [`../ops/overview.md`](../ops/overview.md) — the container this runs in
