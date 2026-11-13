# Frontend — overview

**Scope:** `fl_frontend/`

A Next.js application on the App Router, with React and Tailwind. It is both the website and, in
effect, the system's application server: **no browser reaches FastAPI for application data**. Every
application read is a server-side fetch made from this container, which is why the page caching and
its invalidation live here rather than in the backend.

## How it is organised

| Folder                   | Holds                                                                                                                                                                                                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/`               | The routes: the public pages, `saisons/` for the season pages, `area/`, `admin/` and `account/` for the signed-in areas                                                                                                                                                     |
| `src/kit/`               | The design system's components, built on React Aria Components                                                                                                                                                                                                              |
| `src/core/`              | What the server process is and what every surface needs: configuration, the API client, auth, mail, logging, the string catalogue and the formatting module                                                                                                                 |
| `src/shared/`            | What a rendered page is built from beside the kit: hooks and utilities                                                                                                                                                                                                      |
| `src/features/<domain>/` | One slice per domain: its cached reads, server actions, schemas and the components of its pages                                                                                                                                                                             |
| `src/proxy.ts`           | The request proxy in front of every signed-in area                                                                                                                                                                                                                          |
| `src/test-support/`      | What the unit and database tests share and production never imports: doubles, fixtures, the test setup and the sweeps' tree walk                                                                                                                                            |
| `e2e/`                   | The Playwright journeys against the end-to-end stack, both browser projects' at its top and one project's under `desktop/`, `phone/` or `first-pass/`; the layout-shift guard and its sessions' setup under `layout/`; and `support/`, the fixtures and helpers they import |

**Routes are thin**: a page fetches, then hands off. A page's own write sits beside its route, in
one module per act or per record's acts (`saveSpiel.ts` beside the match editor, `kaderRowActs.ts`
beside a team's Kader). Every administration and person read lives in a slice's `queries.ts`, even
where one route alone calls it. A slice holds only the modules it needs: `queries.ts` for reads,
`mutations.ts` for a write that shapes its arguments before the generated client sends them (a
write passing them through calls the generated client itself), `actions.ts` or an act's own module
for its server actions (`features/saisons/createSaison.ts`), `personActions.ts` for those a
signed-in person's own pages call, `schemas.ts` for its Zod schemas.

**Imports run one way.** `src/core/` imports neither `src/shared/` nor `src/features/`,
`src/shared/` does not import `src/features/`, and `src/kit/` imports neither `src/features/` nor
`src/app/`; ESLint refuses all three (`fl_frontend/eslint.config.mjs`).
Which of the two folders a module belongs in, that rule does not decide: `src/core/` is what the
server process is and what every surface needs before a page exists, and `src/shared/` is what a
rendered page is built from. A module some `src/core/` module imports belongs in `src/core/`, and one
importing anything from `src/shared/` cannot sit there. Exports are named and no folder has a barrel
file.

## Data flow

**Reads are cached with `"use cache"`, and a write is a server action.** Every server action is built
by `fl_frontend/src/core/action.ts :: action`, which runs its lane's guard (the administrator's, a
person's seat or record, or the bot check), strips and parses the input against the generated schema,
and answers the kit's `ActionAnswer`, the backend's refusal code with it; the lint rule
`fl/server-action` (`fl_frontend/eslint-rules/server-action.mjs`) refuses an action built any other
way. Every cached scope carries one tag, `fl_frontend/src/core/siteCache.ts ::
SITE_CACHE_TAG`, so no write names the reads it moves. The builder clears it at the end of an action
exactly when the action's body sent a backend write that may have landed, on every lane. It reads
the count `fl_frontend/src/core/apiDispatch.ts :: dispatchRequest` keeps: each write is counted
before it is sent, since a write whose answer is lost may have landed, and taken back once its
answer is a 4xx carrying a code, the backend's refusal of it. A 5xx keeps the count, since the server
may fail after its commit, and a write that may stand answers one, `unknown_outcome` with a 500. An
action whose body sent no such write carries only its answer and renders no page again; one that
changes state outside the cache, the sign-in store's, calls `refresh()` itself. A write behind the
response clears nothing, so no league write moves there. The league's reads keep Next's `minutes` lifetime. **The
administration's reads are not cached**: each runs through
`fl_frontend/src/shared/utils/adminRead.ts :: runAdminRead`, which judges the session first.

**A change no save makes, a background pass's or an edit made straight in MongoDB, is served stale
for at most the `minutes` lifetime**: the clear lives in the spines, and nothing clears the tag from
outside a request ([`../ops/runbooks.md`](../ops/runbooks.md#20-after-a-hand-edit-in-mongodb)).

**The backend's contract is generated** into `fl_frontend/src/core/generated/` from
`fl_backend/openapi.json` by `fl_frontend/orval.config.ts`: the wire types, one SDK function per
operation sent through `fl_frontend/src/core/transport.ts` with the key tier its `security` names,
and Zod schemas for request bodies and parameters alone. The Zod module opens with
`import 'server-only'`, and the SDK is server-only through the transport it imports, so no client
component can send a call; the types module holds only the document's types and value lists, which
a client component imports like any other module. A change to the backend's routes or models
regenerates both with `pnpm run contract` in `fl_frontend`, which exports the document and then
runs Orval, committing what moves; the gate's db scope generates both into a scratch folder beside
the tree and fails a tree where either is stale. Each path parameter is percent-encoded where its
generated URL is built (Orval's `urlEncodeParameters`), so no call site encodes its own. An answer
is typed by the generated types and parsed nowhere. A form's action judges its input on the server
through `fl_frontend/src/core/action.ts` with the generated Zod schema, or a draft built from its
fields. A value list in any slice is the generated value, as in `z.enum(FLSaisonStatus)` or
`Object.values(FLSpielerStufe)`, never a copy.

## Rendering

**Every read waits for a real request with `await connection()` in the few functions the reads share**,
never in a page: the session reads (`fl_frontend/src/core/auth/session.ts :: readRequestSession` and the
sign-in landing's), `fl_frontend/src/core/traceScope.ts :: runWithIncomingTrace`, which every
admin, person and uncached public read passes, and each component that reaches a `"use cache"` read
or the clock before the URL or any of those. This looks like it defeats static rendering and is
deliberate: the Docker builder stage has **no reachable backend or sign-in store**, so a page that
tried to prerender its data would fail the image build, and a prefetched shell carries nothing a
read past the wait decides. A `"use cache"` body may not call it, so the wait stands at its caller.

**Every page arrives whole**: no `Suspense` boundary stands anywhere in the tree, so no part of a
page waits behind a placeholder of its own. A placeholder costs more than the read it stands for,
since React holds a boundary's reveal for 300 ms after the last one, and a page fade holds every
commit until it ends.

- Lint refuses `Suspense`, `next/dynamic` and any route's `loading.tsx` in production code.
- A page opened by address, by a reload or by a typed address, is one document. The server sends it
  once the whole page is rendered, and the browser paints it as it parses it.
- A slow device may paint that document in pieces while it parses, a table before its later rows.
- A page that finds nothing, is refused or throws while the server renders it arrives as Next's bare
  error document. Its body is empty, so the visitor sees a bare ground until the page's code runs
  and draws the segment's not-found or error page in its frame.
- The ground of a bare error document rendered per request, and of Next's own not-found document
  for an address no route matches, is in the device's own colour scheme: the head carries the root
  layout's `color-scheme` meta. On a light device, a visitor who chose the dark theme sees a white
  ground first.
- A bare error document prerendered at build time carries no such meta, since Next builds that
  shell without the page's viewport, so its ground is white on every device. Two stand in the
  build: the area's catch-all at `/area/<anything>`, which answers 404, and Next's global error
  document.
- A client navigation keeps the page it leaves until the next one is complete, since Next's router
  makes it a transition and a transition never hides content it has revealed. The page fade runs
  once, between two finished pages.
- The root layout (`fl_frontend/src/app/layout.tsx`) exports `instant = false`, which lifts the
  build's check that a route's prerendered shell holds something, for every route. It leaves the
  development server's check of a navigation between two pages below the root as Next sets it by
  default: `next dev` still checks such a navigation and warns.

**One fact says a navigation is under way**: the address it goes to, which
`fl_frontend/src/kit/WholePage.tsx :: WholePages`, placed around every route by the root layout,
sets as optimistic state inside the navigation's own transition, so it ends in the render that
commits the page. Every navigating control feeds it through `WholePage.tsx :: NavigationLink`, the one reader of
`next/link`, which lint holds, or `useNavigate` for a control navigating on its own press.

- Each frame places one `NavigationBar` at the top of its page area. It shows once a navigation has
  been pending 200 ms and goes at the commit; it is a visual sign alone.
- At the press, every list of links marks the entry the navigation goes to (`usePressed`), and a
  filter shows its new choice (`usePendingQuery`).
- While a navigation to another path is pending, the page's content, inside each frame's
  `PageContent`, is `inert`; the frame stays pressable, and a navigation staying on the path leaves
  the page live.
- `NavigationLink` never prefetches the sign-in, which the proxy's matcher skips on a prefetch.

## Styling and copy

Tailwind v4, configured in CSS: `src/app/globals.css` and the design tokens in `src/app/tokens.css`.
`browserslist` in `fl_frontend/package.json` is Tailwind's own support matrix, since the stylesheet
uses `oklch()`, `color-mix()` and `@property`; it does not govern Next's own polyfills.

**A block chooses its form by a container query on its own box, never by the screen's width**,
because the rail opens and closes under one viewport, so only the box says how much room a block
has. Lists, tables and bordered boxes, match rows, card grids and folds among them, stack below
42 rem (`@2xl`) and spread from it. A list of records is a table from 42 rem, and below it each row
stacks: the name with its chips, at most one `narrow` column beside them, one muted line under the
name, then a decision's acts. A column the stacked row leaves out keeps its fact where
[a recurring job's pattern](copy.md#a-recurring-job-takes-its-fixed-pattern) says. The Tabelle, a
`stack` table and a `prose` table keep forms of their own (`fl_frontend/src/kit/Table.tsx`). A
card's act row, `Facts` and `LinkRows` switch at 32 rem
(`@lg`). The five match tiles stand in one row from 47.5 rem, the form column's width
(`fl_frontend/src/kit/StatTiles.tsx`). The K.-o.-Baum draws its cards of plaques alone below
42 rem and with each side's name and the date line from it, by the tree's box, since a card's own
width is the form's result (`fl_frontend/src/kit/BracketTree.tsx`). The organisers stand in four
columns from 44 rem, where the widest entry fits whole (`fl_frontend/src/kit/Organisers.tsx`). Two
kinds of part switch by the screen at `lg` instead:

- **A frame, and a classic page's own layout, which no block's box holds**: the frames' bands, rail
  and footer, a classic page's spacing, the landing's hero beside the season card, the gaps between
  the landing's sections, and a reading page's contents list beside its text
  (`fl_frontend/src/kit/ClassicPage.tsx`, `fl_frontend/src/kit/LandingPage.tsx`,
  `fl_frontend/src/kit/Prose.tsx`). Every block inside a landing section reads its own box, as on a
  rail page.
- **A part that answers a phone's touch rather than the room**: a form footer's acts stacking
  across the width, the filters folding into a sheet, a read page's acts, and a row's taller touch
  height. The screen tells the device, and a box does not.

A new block takes the box's rule unless it is one of these.

**Every string a visitor reads comes from the catalogue**, and the kit's text props refuse one typed
into a page: [`copy.md`](copy.md) says where each string, date and number comes from and how it is
written.

## Authentication and authorization

Better Auth, with a passkey sign-in and a six-digit code mailed as the fallback; the administration
admits only a session a passkey signed in. **This is the one place the frontend touches MongoDB
directly**: a separate `auth` database holding sessions and passkeys and no league data
(`fl_frontend/src/core/authIndexes.ts :: MONGO_DB_NAME`, reached through
`fl_frontend/src/core/db.ts :: signInStore`), because the library's adapter has no HTTP transport
and sits on every authorization check. Application data goes through FastAPI without exception.

**Administration is a stored grant, read on every request.** A row of `grants`
(`Berechtigung`) makes an address an administrator; the frontend reads it through
`fl_frontend/src/core/grant.ts :: grantOf`, and the backend checks it again on every
administration request. A backend that cannot answer admits nobody, and a revoked grant admits
nothing from the next request on. Every admin server action opens on
`fl_frontend/src/core/auth/guards.ts :: judgeAdminRequest`, through the builder's admin lane.

**Route protection is layered.** `src/proxy.ts` turns away a request to `/area`, `/admin` or `/account` carrying no
session cookie before any read, as Next's and Better Auth's guidance has a proxy check. It sends a page load of
`/signin` whose cookie names a stored session on to the sign-in's landing, which decides where that session goes. It
sends a page load of `/signin/passkey` on to the landing too where the request holds no passkey step, asking
`fl_frontend/src/core/auth/landing.ts :: getRequestPasskeyStep`, the page's own judgement, so the page never paints
its frame only to redirect. Both carry the return address through the allowlist and judge nothing further. The
session, its sign-in factor and the grant are judged where the data is read: no layout turns a session away, because
Next renders a page whatever its layout decides.

**A person's sign-in is managed on Konto, `/account` and its four pages**, whichever area they hold:
every frame's account menu links it, and an act on the passkey touch's fixed
list, a passkey's removal and the address change's start among them, runs only on a passkey sign-in
made seconds before, for a person holding a passkey (`fl_frontend/src/core/action.ts`, a lane's
`passkey`). The touch is always such an act's last step: the person presses the act, answers any
dialog, presses the final button, and that press asks the touch and then runs the act
(`fl_frontend/src/kit/usePasskeyTouch.ts`), so nothing typed runs against the minute a touch lasts.

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
