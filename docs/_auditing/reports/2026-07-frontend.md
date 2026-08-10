# Frontend audit & remediation — final report

**Programme:** 2026-07-28 → 2026-08-01 · **Method:** [`docs/_auditing/`](../README.md)\
**Scope:** `fl_frontend` in full (~169 `.ts`/`.tsx` files at audit time, Next.js 16 / React 19 /
HeroUI 3 / Tailwind 4 / zod 4 / next-auth 5-beta), plus every backend and ops change the findings
forced (`fl_backend` schema convergence and tests, nginx, Docker, scripts).\
**Outcome in one line:** five audit passes produced 188 findings (0 critical, 36 high); nine
remediation waves closed all of them plus ~70 more discovered en route, ratified 16 architectural
decisions into ADRs, and left the repo with an enforced verification gate, two test suites and a
0-warning lint baseline where none of the three existed before.

This report is the programme's permanent record. The working documents it summarises — five pass
reports, the remediation ledger, the wave reports — live in `docs/audit/`, which is due for
deletion; nothing below depends on them surviving. Claims cite code, ADRs and git history, which
outlive everything.

---

## 1. Numbers

| Measure                                                                              | Before                                                          | After                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audit findings                                                                       | —                                                               | 188 (R1: 4 · R2: 53 · R3a: 35 · R3b: 24 · R4: 72); 0 CRITICAL, 36 HIGH                                                                                                                      |
| Findings discovered during remediation                                               | —                                                               | ~70 (`NEW-*`, `W4R-*`, `V2-*`, `BE-*` series) — none in any report                                                                                                                          |
| Findings closed won't-fix / superseded, with recorded evidence and reversal triggers | —                                                               | ~18 (incl. 4 outright false positives)                                                                                                                                                      |
| Remediation waves / PRs                                                              | —                                                               | 9 (0–8; wave 5 ran as two branches a/b, wave 8 shipped as three PRs a/b/c)                                                                                                                  |
| Frontend unit tests                                                                  | 0 (no runner)                                                   | 83 (`node --test`, native TS)                                                                                                                                                               |
| Backend tests                                                                        | 0                                                               | 238 pytest (model validation + filter builders)                                                                                                                                             |
| ESLint baseline                                                                      | 2 rules; 22 warnings once Wave 1's new plugins landed at `warn` | 0 errors, 0 warnings, with `jsx-a11y`, `better-tailwindcss` (`no-unknown-classes`, `no-concatenated-classes`), `react/no-danger` and two `no-restricted-imports` layer rules all at `error` |
| `pnpm audit --prod`                                                                  | 4 advisories (3 high)                                           | 0, gate-enforced                                                                                                                                                                            |
| Admin session lifetime / sign-out                                                    | 30 idle days, no sign-out existed                               | 8 h idle, in-app sign-out                                                                                                                                                                   |
| Magic-link validity                                                                  | 24 h (Auth.js default)                                          | 15 min                                                                                                                                                                                      |
| Granular cache tags                                                                  | 22 declared, 0 ever invalidated                                 | 2, both wired (ADR-0001)                                                                                                                                                                    |
| Dashboard / admin static shells                                                      | 6.5 KB / 5.4 KB stubs                                           | 21.8 KB / ~19.2 KB working shells                                                                                                                                                           |
| Client bundle                                                                        | baseline 734,544 B gzip                                         | 734,538 B (React Compiler trialled at +40 KB and removed)                                                                                                                                   |
| Duplicated code collapsed                                                            | ~1,830 near-identical lines (largest single pair 499 lines)     | shared components (`ModalShell`, `EntityForm`, `AdminCrudView`, `InlineCreateAutocomplete`, …)                                                                                              |
| `dark:` escape hatches / raw `text-white` / raw-palette utilities in `src`           | 17 / many / many                                                | 2 / 0 / 0                                                                                                                                                                                   |
| Architectural decisions ratified                                                     | 0 recorded                                                      | 16 ADRs (`docs/_decisions/`), summarised in CLAUDE.md's ratified-decisions index                                                                                                            |
| TypeScript strictness                                                                | baseline                                                        | + `noUncheckedIndexedAccess`, `noUnusedLocals`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, at 0 errors                                                                             |
| CI                                                                                   | none                                                            | `.github/workflows/verify.yml` — `verify.sh --quick` on PRs, full gate on `main`                                                                                                            |

## 2. How it was run

Five audit passes, each a fresh session with `/clear` between them, each writing one evidence
report: **deprecated/legacy patterns**, **architecture/dead code/tooling**, **RSC & caching
semantics + validation integrity**, **security & authorization**, and **UI quality**
(a11y/styling/UX states/performance). Each pass wrote a coverage ledger first (per-check search
patterns and counts), worked check-by-check, and reported negative results as first-class output.

A remediation ledger then assigned every finding to a wave, mapped cross-report overlap (the same
defect surfacing under two or three lenses became a single fix), and — before any code changed —
answered five blocking questions and five decisions of mine (**Wave 0**), two of which inverted HIGH
findings outright. Wave order followed dependencies, not severity: guardrails (1) → broken output
(2) → security (3) → layer boundaries and types (4, required before extraction) → design tokens
(5a, required before extraction) → extraction/dedup (5b) → accessibility (6, after extraction so
the sweep runs once) → performance (7) → cleanup (8). One wave = one branch = one PR = one fresh
session; every wave ended with the verification gate, an independent review of its own diff, a
narrative wave report, and a consistency sweep. The full method, with everything it learned, is
[`docs/_auditing/`](../README.md).

## 3. Major changes — fully described

### 3.1 Security

**A stored-XSS sink on public pages — the audit's one genuine vulnerability.** Team pages rendered a
"Schul-Website öffnen" link straight from backend data, validated only with zod's `z.url()`, which
checks parseability, not scheme — `javascript:alert(1)` passed and React rendered it. Anyone able to
write a team's `website_url` could run script against any visitor, including a signed-in admin. The
fix is a shared `ExternalUrlSchema` (https/http scheme allowlist) in `fl_frontend/src/shared/schemas.ts`,
used for every backend URL that reaches an `href`; all 16 team pages were re-verified against real
data afterwards, since a schema tightened too far breaks pages instead of protecting them.

**A second lock on the admin door.** The `/admin/:path*` proxy matcher was the _only_ guard — no
admin page or layout checked the session itself, so any change that stopped the proxy matching would
have silently made four admin pages public, one of which fetches with the admin API key. The admin
layout now verifies the session itself via a single `getAdminSession()` helper in
`src/core/auth.ts` (deliberately _not_ named `requireAdmin` — it returns `Session | null` and
neither throws nor redirects, so a bare call cannot masquerade as enforcement). Tested by rebuilding
the site with `/admin` removed from the proxy matcher: no admin content served.

**Sessions, sign-in and enumeration.** Admin sessions went from 30 idle days (with no sign-out
mechanism at all — the function existed and nothing called it) to 8 hours, with an in-app sign-out
added later in the programme. The sign-in page — previously an unauthenticated, unthrottled outbound
email trigger whose input was cast rather than parsed — gained nginx rate limiting on the POST,
zod-parsed input, and an identical neutral response for admin and non-admin addresses behind a
minimum response time. A later review round found the response equalisation was decorative: the
underlying `signIn` call _navigated_ differently per branch, so the address bar still revealed admin
membership. Both paths now end on `/signin` with the same confirmation panel (`redirect: false`),
and the accepted cost is recorded: a mistyped admin address gets no hint anything went wrong.
Magic-link emails are now project-owned (`src/core/authEmail.ts`, German, 15-minute validity stated
in the mail and the UI from one constant).

**The CSP decision** (ADR-0011). The nonce + `'strict-dynamic'` policy the audit prescribed was
built, shipped Report-Only, measured — and removed: 24 routes serve build-time HTML whose script
tags can never carry a per-request token, and Next's `_global-error` must be a client component that
can never be tokened or hashed, so the "strict" policy needed three mechanisms plus a permanent
hole. The ratified posture is one enforced policy retaining `'unsafe-inline'` on `script-src`, with
`'unsafe-eval'` dropped, `connect-src 'self'`, the non-inheriting directives added, and
`react/no-danger` at `error` as the compensating control matched to the app's actual injection
surface (zero `dangerouslySetInnerHTML`, no user-generated markup). Reversal trigger: the moment the
app renders user-supplied markup.

**The startup environment gate — which had never run.** The gate validating env at boot, and with
it _all production server error logging_, was silently dead: `instrumentation.ts` at the repo root
compiles and passes every local check, but is not traced into `output: "standalone"`, so the image
contained no instrumentation at all. Moved to `src/instrumentation.ts` (it must stay there); a
malformed secret now 500s every route within a second, the healthcheck fails, and nginx — which
depends on frontend health — never serves. Verified against built images, including that no secret
value appears in failure logs. This is also why the verification gate builds real images: local
checks were green through the entire failure.

**Hardening set:** `Secure` cookie flag now derived from `AUTH_URL`'s own host (https required
unless loopback — the audit's `NODE_ENV` gate would have refused to boot the local stack);
`import "server-only"` on the four secret-holding core modules; the Auth.js default sign-in page
redirected to the real one; validation-error logging that dumped zod trees to production stdout
removed; `frame-ancestors 'none'`, `base-uri`, `object-src`, `form-action` added; a catch-all
`default_server` block; the `sharp`/`postcss` advisories cleared via workspace overrides (the
`sharp` override floats past `next`'s declared range — re-check on every `next` bump); the dead
`callbackUrl` in the proxy deleted rather than honoured (honouring it unvalidated is an open
redirect); and `POST /api/revalidate` added for out-of-band reference-data edits — bearer-authed
with `timingSafeEqual`, resource-enum-validated, and deliberately reachable only inside the compose
network (retired decision 0015; ADR-0028 later removed the route).

### 3.2 Broken and silently wrong output

**Every visitor was accused of a failed sign-in.** The sign-in form tested `!state?.success`
against an initial state that is `undefined`, so a red "SignIn Failed" toast fired on arrival,
before any input — and a correct submission produced no confirmation at all. One inverted boolean
plus a success path.

**Dates rendered a day early west of UTC.** All five display formatters parsed date-only strings
(read as UTC midnight) and formatted them in the viewer's zone; server and client disagreed because
match cards are client components. One shared `formatSpielDatum` pins Europe/Berlin. Demonstrated
live: a fixture on 2026-03-15 rendered 14.3.2026 for a New York viewer under the old construction.

**Every dated match painted as "past" on first paint.** A `useToday()` hook returned `null` while
typed as `string`; comparing dates against `null` fails every branch and fell through to
"vergangen", flipping after mount — and rendering the admin's to-do list empty. The date is a
German calendar date, so it never needed the browser clock: it is computed server-side (behind
`await connection()`) and passed as a prop; the hook is deleted.

**Docker shipped the wrong `node_modules`.** Both `.dockerignore`s had been round-tripped through
something that backslash-escapes Markdown characters, turning ~75 patterns inert — including
`**/node_modules/` and `**/__pycache__/` — so Windows-native binaries landed in Alpine images.
Also: PWA manifest icons 404'd on every install (paths missing a directory segment), and the icon
library used by 33 runtime files was a devDependency, so any `--prod` install failed.

**Classes and tokens that resolved to nothing.** `bg-surface-muted`, `lg:text-fluid-md` and the
eight-site `animate-appearance-in` (a HeroUI **v2** leftover, not — as first believed — a current
utility) all compiled, passed every check, and styled nothing. The project's warning colour sat
dead under a name nothing used while HeroUI's amber rendered instead. The `better-tailwindcss`
lint rule now makes an unresolvable class a build failure.

**The brand colour was illegible in dark mode** — the only accent that did not flip per theme,
rendering the app's most-used colour at 1.88:1 on dark surfaces. Split into `brand` (text, borders,
rings, tints) and `brand-solid` + `brand-solid-foreground` (opaque fills behind text); measured
after: 5.2–5.7:1 for text, 10:1 for fills. The convention — fills use the solid pair, never a
literal `text-white` — held for the rest of the programme.

**Missing states and metadata.** All three layouts had `<Suspense>` with no fallback (blank content
area on every navigation); the admin segment had no `loading.tsx` (navigation unmounted the whole
shell); a mistyped team id destroyed the dashboard with a root 404; a backend outage rendered as
"Team nicht gefunden" _and was never logged_ (a `.catch(() => null)` conflating not-found with
broken, narrowed to 404); both `[team_id]` pages emitted the dashboard's title and canonical
(telling crawlers every team page is a duplicate — `generateMetadata` added, starting with
`await connection()` per ADR-0006); the sitemap stamped `new Date()` per request (now a build-time
constant, flipping the route static); robots.txt disallowed `/admin` while the sitemap advertised
it. A dead five-weight font (~100–150 KB on every first paint, zero glyphs rendered) was removed.

### 3.3 Caching and data flow

**Two granular cache tags instead of twenty-two** (ADR-0001). Twenty-two granular tags were
declared across eight query modules and not one was ever invalidated — targeted invalidation read
as implemented and was decoration. The test that decided each tag's fate: a tag earns its keep only
if its resource has a write surface _and_ a mutation changes some rows but not others along that
dimension. Two qualify (`spiele:saison_id:*`, `teams:saison_id:*`); both are now wired into the
Spiel patch action, which takes the season read off the loaded match (never on the patch body —
Pydantic silently drops undeclared fields). Base tags are invalidated unconditionally, which is
load-bearing: since the season default moved server-side, the common cache entries carry only base
tags.

**The season lookup is gone** (ADR-0002). Every page previously serialised a "which season is it"
round-trip in front of its real query, on eight routes. FastAPI now resolves an omitted `saison_id`
to the current season in the handler (one shared helper also used by `/saisons/current`, so the two
definitions cannot drift). Shipped as one PR with the frontend change — `publish.sh` builds both
images before pushing either, so no deploy window mixes versions.

**The dashboard and admin shells came back.** `Sidemenu` called `useSearchParams()` with no
`Suspense` above it; under `cacheComponents` that hangs the prerender unconditionally, so every
dashboard and admin route shipped a ~5–6.5 KB stub instead of a working static shell. The hook
moved below a boundary whose fallback is the same nav without the query string (dashboard shells
6.5 → 21.8 KB); the admin layout's auth guard moved inside its existing boundary
(5.4 → ~19.2 KB). The related PPR resume failure — a 500 logged on _every public request_ — was
bisected to a single build-time `new Date()` in a client component in the static shell; it is now a
Server Component reading the clock behind `connection()` in its own boundary. An earlier "fix"
(`await connection()` in the public layout) had merely suppressed the error by collapsing the
shells to stubs, and was reverted after measurement.

**Reference-data staleness.** `saisons`, `spieler` and `spieltage` are cached for a day and have no
write surface, and out-of-band Mongo edits are a real workflow — so edits were served stale for up
to 24 h with no recourse. `POST /api/revalidate` (§3.1) plus an operator-run revalidation call
close the gap; the durable fix (a real backend write path that revalidates itself, retiring the
manual step) is recorded as open item BE-4 in `docs/_roadmap/open-items.md`.

### 3.4 Layer boundaries and type integrity

**The dependency graph flows one way.** `shared` imported feature components and schemas; `teams`
imported from `admin` for a two-character constant; `spiele` and `spieltage` imported each other in
a loop. All broken — by slot props (`Footer` takes `serverStatusSlot`), by moving code to the slice
that owns it, and by moving two views into the slice whose data they iterate. Enforced ever since
by two `no-restricted-imports` blocks scoped to `core` and `shared` (a blanket cross-feature ban
would flag 47 sites of which 44 are correct — `admin` is a sanctioned aggregator, ADR-0008).

**Stringly-typed structures became checked**, which unblocked `noUncheckedIndexedAccess` at zero
errors with no `?.` or `!` added: the sidemenu's icon indirection (a typo compiled and rendered no
icon), the admin action-required categorisation (a mistyped category crashed at runtime), the team
member grouping. The codebase's only double cast (`as unknown as`) became a real zod parse; the
`[team_id]` params are parsed, not cast (four sites — the reports counted two); seven identical
filter casts vanished by converting `interface` declarations to `type` (TypeScript infers index
signatures for aliases, not interfaces).

**The frontend and backend now agree on what the data is.** My ruling: the backend is the
source of truth, the frontend mirrors it — converging _upward_, because each side was stricter
somewhere (the frontend's calendar-date check rejects `2026-02-31`, which the backend's regex
accepted; the frontend email check was the only one that existed). ~40 constraints moved into
`fl_backend` (each preceded by a read-only data audit, because Pydantic validates on the way out of
Mongo and a constraint stored data violates 500s the serving endpoint), six response schemas
regained the API envelope, and the convergence flushed out four defects no report had seen:
`getSystemInfo` called a route that does not exist with a wrong-typed schema; the admin form
accepted a time the API 422s; a season with an empty group would have crashed the league table
(and a blank group silently vanished a team); a duplicate backend `FLSpieltag` model made edits to
the wrong one silently ineffective. The constraints got a regression net — 238 pytest cases wired
into `scripts/verify.sh` — deliberately scoped to model validation, leaving route/service testing
to the backend audit (`fl_backend/tests/README.md`).

**Hardening the hardening.** A final review pass over the wave's own fixes, run as if reviewing a
stranger's code, found among others: the new backend URL validator's entire scheme restriction hung
on a `^` anchor that _no test exercised_ (Pydantic's `pattern` is `re.search`), and its replacement
then rejected internationalised domains the old code accepted — an umlaut school domain would have
500'd `GET /teams` — until it punycoded like zod does; a `mietpreis` default that let a PATCH
silently overwrite stored rent with 0; a two-way branch scoring an unknown team as a loss. Each is
pinned by a test that fails if the fix is undone.

### 3.5 Deduplication and shared components

The referee and venue admin surfaces were ~1,300 near-identical lines each; the inline-create
pickers a 499-line 75%-identical pair; one 20-class dialog string was pasted at five sites. Once
duplicated, the copies had drifted in ways nobody chose: Enter created a referee but not a venue,
`- : -` vs `-:-` on adjacent cards, one search view returning nothing on an empty query while two
returned everything. The wave collapsed them — `ModalShell`/`FormModal`/`ConfirmDeleteModal`,
`AdminCrudView`/`EntityForm`/`RowActions`, `InlineCreateAutocomplete`, `useDebouncedUrlQuery` +
`useFuzzySearch` + shared `SearchBar`, `EmptyState` (eight previously blank views), shared
formatters with one placeholder per category — resolving every behavioural divergence explicitly
and every visual one to "both sides identical" unless I agreed otherwise. The standing
limit: the three `SpielCard` variants are ratified as three components (ADR-0005); only their
derivation and chrome are shared.

**NEW-T1 — the admin tables that emptied.** In no report: navigating admin pages left tables with
headers and no rows until a hard refresh. Root cause: Next parks the previous page in a hidden
Activity tree; `useSearchParams()` re-renders those tables while hidden, and a react-aria
collection that re-renders hidden drops its rows. The fix that survived measurement is
`Table.Body`'s `items` render-function form plus `React.memo` with referentially stable props — an
inline lambda or fresh array passed to those tables silently restores the bug (the constraint is
documented at the tables). The ledger's own first prescription was tested and disproved — the
programme's clearest case for measuring fixes rather than trusting them.

### 3.6 Accessibility

The app was usable with a mouse and much less usable without. Icon-only admin controls announced
"Button. Button. Button." — one of them permanently deletes a venue; they now carry names
templated with the record ("Schiedsrichter Bibiana Steinhaus löschen"), with tooltip (description)
and name kept as separate required props. The closed mobile drawer was only translated off-screen —
fourteen invisible tab stops; `invisible`/`lg:visible` removes it from tab order and the
accessibility tree in CSS alone, with Escape handling on the document. Five of six forms rejected
submits with a vanishing toast naming no field; a `fieldErrors` channel now runs zod →
`FormState` → `Form validationErrors` with `FieldError` on all 18 fields, names matching payload
paths, and `reportValidity()` to move focus (react-aria only auto-focuses on the native `invalid`
event, which server errors never fire — the audit's "focus moves for free" was wrong). Twelve of
seventeen routes had no `h1`; headings, landmarks, list semantics, skip links and `aria-current`
landed without a pixel changing. Clearing a currency field no longer silently submits €0.

**One focus indicator app-wide** — reached over three of my review rounds after the app was found running
three focus languages at once. A single `--focus` token drives HeroUI's 89 rings plus one base-layer
outline; field-like controls are the ratified exception (border turns brand, keyed off `data-slot`
attributes in one unlayered block); collection options deliberately have no indicator, because
react-aria's `isFocusVisible` is a _global_ modality flag and any rule keyed off it fires at random
— a recorded WCAG 2.4.7 deviation. Filled badges gained `-solid` tokens (white text 4.6–6:1 both
themes, from as low as 1.32:1 — the dark-mode draw badge had been effectively invisible); two amber
chip states remain sub-AA by recorded decision, at or above their pre-audit values.

### 3.7 Performance

**The React Compiler was enabled, measured, and removed.** +40 KB gzipped on every page load and
+1.3 s build for memoization this app needed in exactly two places — inconsistent with the same
wave rejecting a real 3.5 KB payload saving as not worth collecting. Both memos are hand-written
with comments; the reversal trigger (Next enabling it by default) is on the config key, and turning
it on again means _deleting_ those memos. The spielplan's whole-season payload (25 matches shipped
for 8 rendered) was measured at 5,033 B gzipped total and closed won't-fix with a linear-scaling
trigger (~10× today's match count changes the answer).

Also: `AdminContextWrapper` stopped shipping every referee's contact data and every venue address
to two admin routes that never open the match editor; `SpielDetailsModal` mounts only after a card
is clicked (all four call sites — an independent audit caught the first pass guarding one of four
while its row sat ticked); the match editor's chunk (all of `@internationalized/date`, Calendar,
DatePicker, three Autocompletes) prefetches after paint because `dynamic({ssr:false})` with no
`loading` renders `null` — the click had looked dead; the season selector no longer paints a
finished-looking control before hydration makes it work, and its popover joined
`useNavigationClosedOverlay` (the one overlay not wired to it — open state survived navigation in
the Activity tree, which made the trigger read as dead); list keys were fixed
(`spiel_nr` is only unique per season and the action-required view renders one match in several
sibling lists); `next/image` usage ended entirely in favour of masked monochrome SVGs.

### 3.8 Guardrails and verification infrastructure

The programme's most durable output besides the ADRs. In order of arrival: layer-boundary lint
rules; `jsx-a11y` and `better-tailwindcss` landed at `warn` and flipped to `error` in the waves
that cleared them; a test runner (`node --test`, zero dependencies, with a ~40-line
`registerHooks` alias shim so tests import `@/` like everything else); `pnpm verify` as one script
(a hand-typed chain had already dropped its prettier link once); `pnpm audit:prod` in the chain;
then `scripts/verify.sh` wrapping the frontend gate plus backend ruff/pytest/pyright plus **both
Docker image builds** plus an image sanity check — added after `pnpm verify` was green twice while
the image was broken. `verify.sh --quick` exists but is insufficient for changes touching
`src/core/config.ts`, `src/core/auth.ts` or `src/instrumentation.ts`. CI runs the same script.
Prettier's scope became an explicit allowlist (a blocklist walked into `.venv` and enumerated
`.git` 3,312 files at a time), and `proseWrap: preserve` stopped one-word edits reflowing whole
documents.

### 3.9 Cleanup

Named exports everywhere under `src` (59 conversions + 82 import rewrites by codemod; defaults only
where Next requires them — ADR-0003), one component-category folder convention with a single
allowed nesting level (ADR-0003, twelve files moved), dead code deleted (an unwired provider, three
unreferenced schemas, dead config keys and globs), English identifiers with German domain nouns
enforced across both packages (`getCurrentSaison`, phase-token spellings, collection-name
constants; the wire contract deliberately untouched), and the config/tsconfig/prettier tidy —
including the discovery that `next build` re-adds any `compilerOptions` key it misses, so `allowJs`
is declared `false` rather than deleted.

## 4. Decisions ratified

The sixteen ADRs in [`docs/_decisions/`](../../_decisions/) are the programme's permanent decision
record; CLAUDE.md's ratified-decisions index is their summary table. Highlights and why they exist: `connection()` precedes
every page fetch or `docker compose build` fails (0009) · Auth.js's direct MongoClient is the one
sanctioned DB exception (0010) · zero barrel files (0003) · the three SpielCards stay three (0007)
· no `generateStaticParams` (0011) · `admin` is an aggregator slice (0012) · the Spiel write path
lives in `spiele` (0005) · two granular cache tags, base tags unconditional (0001) · omitted season
= current season, resolved in the handler (0002) · named exports (0008) · category folders (0006) ·
the kept-but-unused system endpoints (0014) · the topology-protected revalidation route (0015) ·
the single enforced CSP with `react/no-danger` as compensating control (0016) · uncached admin
action-required data (0013) · `utils.ts`/`resolvers.ts` as sanctioned slice modules (0004). Every
one had been flagged as a violation by at least one audit pass — writing them down is what ended
the false-positive treadmill.

## 5. Where the audit was wrong

Of 188 findings: two HIGHs inverted outright on backend evidence (the delete actions need no cache
invalidation — the endpoints structurally cannot touch `spiele`); one HIGH was a no-op (react-aria
already mounts only the selected tab panel); several fixes were unshippable or dangerous as written
(a CSP that blocks every prerendered script; a cookie gate that refuses to boot the local stack; a
container validation step whose modules don't exist in the image; two replacement snippets
containing the exact bug class they fixed; three token names that don't compile; advice targeting
an env var that is never read); one finding would have regressed a correct editor setting; counts
were systematically understated (cast sites, file moves, blast radii). Separately, the passes
missed an entire defect class — runtime interactions (NEW-T1's emptying tables, NEW-T2's per-request
500, the shell collapse) and cross-boundary convergence gaps — which the remediation's measurement
discipline and independent reviews caught instead.

The consequence is procedural and now permanent: **findings are verified before they are acted on,
report snippets are treated as untested code, and every wave ends with an independent review of its
own diff** — that review found shipped defects every single time it ran. The full catalogue, kept
for the next programme: [`docs/_auditing/lessons.md`](../lessons.md).

## 6. Minor changes — the complete record

Everything that merged, wave by wave, that §3 does not already describe. IDs are the programme's
finding identifiers, kept for greppability against commit messages and PR titles.

### Wave 0 (decisions only — no `src` changes)

- **Q1–Q5** answered from backend code or by me: soft deletes don't fan out (inverted A1.1/A1.2);
  `ergebnis` is `null`-or-`d+:d+` (settled B1.2 + spawned BE-2); the response envelope is universal
  (fix direction for six schemas); backend will default `saison_id` (BE-1); out-of-band edits are
  real (spawned the revalidation route). **D1–D5** decided: keep the system endpoints; keep 2 of 22
  tags; delete the Krub font; named exports; component folder convention. **A1–A8** ratified into
  CLAUDE.md (later ADRs).

### Wave 1 — guardrails

- **R2-2.4** two `no-restricted-imports` blocks (scoped per A7), erroring on exactly the 2 real
  violations, tracked suppressions deleted by Wave 4 · **R2-6.5** ESLint coverage extended ·
  **R4-P0.1/P0.2** `better-tailwindcss` + `jsx-a11y` at `warn` (later `error`) · **R2-6.2** three
  free strictness flags · **R2-6.6** `node --test` + 39 tests over the pure utilities ·
  **R3b-S10.1a** `pnpm audit:prod` script, deliberately red until Wave 3.

### Wave 2 — broken and silently wrong

- **R2-4.7** manifest icon paths · **R2-4.11(+b)** both `.dockerignore` sweeps · **R3b-S10.4**
  dead duplicate pattern · **R2-6.3** icon lib to dependencies · **R4-13.1** sign-in toast ·
  **R4-6.3/6.3b** two dead classes · **R4-6.4** `--color-warning` rename · **R4-5.2/7.1 + 5.2b**
  brand split + 21 fill-contrast sites · **R4-14.2 + R2-3.11** timezone-pinned date formatter ·
  **R3a-B4.1/A6.1/R4-18.6** `useToday` deleted · **R1-2b** bracket card keyboard access (overlay
  button; `as="button"` would nest buttons) · **R1-8e** Suspense fallbacks in three layouts ·
  **R3a-A3.2/R4-12.4** admin `loading.tsx` · **R3a-A3.3/B4.4** dashboard-scoped not-found +
  404-vs-outage distinction · **R3a-A5.1** team-page metadata · **R3a-A6.3/A5.3** static sitemap +
  robots fix · **R3a-A1.x** false delete-warning copy removed from two modals · **R3a-B1.2 + BE-2**
  `ergebnis` regex + `ge=0` on `tore` · **R4-17.1** Krub font deleted · **R3a-A1.1/A1.2** closed
  won't-fix (false positives).

### Wave 3 — security hardening

- **R3b-S8.1** `ExternalUrlSchema` · **S9.1/S9.1b/S9.2** CSP hardening + posture decision +
  `frame-ancestors` set · **S3.1** `getAdminSession()` in the admin layout · **S5.2** 8 h sessions
  · **S5.1** https-or-loopback `AUTH_URL` · **S10.1/S5.3/S10.2** dependency overrides + dead
  `@auth/core` override dropped · **R3a-B2.1/S1.1** parsed sign-in input + rate limit + neutral
  response · **S3.4** default sign-in page redirected · **S7.1/S7.2/S5.5** log hygiene ·
  **S9.3 + NEW-S3** `default_server` + inert `AUTH_TRUST_HOST` removed · **S2.1** `server-only`
  imports · **R3a-A1.4-fix + BE-3** revalidation route + runbook script · **S10.3 + NEW-S2** env
  gate fail-closed + instrumentation relocation · **S3.2/S3.3** redirect ordering/status comments
  corrected · **S6.1** dead `callbackUrl` deleted · **S7.3** browser-console error logging removed.

### Wave 4 — boundaries and types

- **R2-1.3/2.3** `TBD_TEAM_SHORTHAND` → `teams` · **R2-2.1** `Footer` slot prop · **R2-2.2/3.6**
  `formatMapsLink` → `spielorte` · **R2-1.1** `TeamSpielerView` → `spieler` · **R2-2.5/1.2** the
  slice cycle broken · **R2-5.9/1.7/1.6** three stringly structures typed · **R2-6.2b**
  `noUncheckedIndexedAccess` on at 0 · **R2-1.8** `computeErgebnisFor` extracted (report snippet
  unsafe) · **R2-1.4/1.5** draft types to slice `types.ts`, derived from payloads · **R3a-B4.2**
  double cast → zod parse · **R3a-B4.3/R3b-S8.2** params parsed (4 sites) · **R3a-B4.5/B4.6** casts
  removed by better types · **R3a-B1.1** envelope on 6 schemas, `BaseAPIResponseSchema` moved to
  `core/schemas.ts` (no `server-only`, no re-export) · **R3a-B1.3** `full_name` strict both sides ·
  **R3a-A2.1-pre** `saison_id` added to `FLSpielSchema` · **SC-BE** the ~40-constraint convergence ·
  **NEW-SC1–SC5** system route/schema fixed; time regex tightened; `FLGruppen` seeded and raising;
  backend dead code deleted; three cross-boundary name drifts aligned · **NEW-SC6/SC7** filter
  params and `trace_id` documented won't-fix · **W4R-1…9** the final-review series (URL validator,
  `mietpreis`, three-way ergebnis, `joinCollections` soundness + aliasing, `FLGruppen` error type,
  model hygiene incl. Unicode `\d` both ends, test diagnostics, alias-hook/`SidemenuStructure`/
  unreachable-throw fixes, pnpm 11.18.0) · **R2-6.1** `.prettierrc` importOrder rewritten (37-file
  reformat isolated) · **BE-5** the 226-case backend suite.

### Wave 5a — tokens and stylesheet

- **R4-5.1** one unlayered reduced-motion block (later softened by NEW-F4) · **R4-6.2/14.4/18.1**
  both status chips tokenised, module-constant maps, German labels, `-strong` label companions
  (literal report mapping measured below AA) · **R4-6.5/10.1/10.4/10.5** 58 hard-coded values → 8
  tokens; both shadowing breakpoints deleted; header `box-content` fix · **R4-11.2–11.5** dead
  tokens/utility hygiene; `--accent-action` deleted with reversal trigger · **R4-6.1** verified
  already fixed · **R4-7.2/7.3** meta pages on four `--field-*` tokens; `dotted-bg` `currentColor`
  premise corrected · **R4-7.4** masked theme-flipping logos (two white assets deleted; the 0×0
  `inline-block` regression caught by the visual pass) · **R4-10.2** shell breakpoint `xl:`→`lg:`
  (9 sites, 6 files) · **W5A-VIS** the CDP screenshot gate · plus the out-of-scope NEW-T2 root
  cause fix (build-time `new Date()`), two no-op Suspense boundaries removed, `async` dropped from
  9 components.

### Wave 5b — extraction and deduplication

- Rows 1–12: **R4-8.2/R2-3.1a** modal + CRUD shells · **R2-3.8** `InlineCreateAutocomplete` ·
  **R2-3.2/3.3/R4-9.1/16.3** search stack · **R4-8.4/9.2/3.4** `formButton` recipe · **R4-12.2/
  12.3/12.5** `EmptyState` · **R4-8.3/9.3** `IconTooltip` · **R4-14.3/R2-3.4/R4-18.5** formatters +
  placeholders · **R2-3.7** shared error boundary · **R2-3.9** Enter guard (with button/combobox
  exemptions) · **R4-8.5** `FIELD_INPUT` · **R4-10.3** drawer header extraction · **R2-3.5**
  `formatSpielDisplay` · **NEW-T1** (§3.5) · **NEW-T2** (§3.3) · **NEW-T3** `ContentLoader` ·
  **NEW-V1** one `card()` recipe · **NEW-V2 + V2-1…8** consistency sweep series (recipe adoption,
  press states, disabled treatment, motion standard, kept `rounded-3xl` tier, theme verification,
  panel recipes, sign-in buttons on the recipe) · **NEW-F1–F13** the series from my review rounds: score
  centering, `TeamPopoverMenu` everywhere, focus treatment v1, reduced-motion softening, design-
  language pass, scrollbar-gutter on `<html>`, playoff centering (`w-max`), sidemenu options menu +
  containment, edit form flattening + `useTransition` + two real submit bugs (`tore: NaN`, cleared
  team), the Spiel write path moved to `spiele` (ADR-0004), truncation/overlay-on-navigation fixes
  (`useNavigationClosedOverlay`), NumberField null/NaN analysis · plus `RouterProvider` (menu links
  had been full page reloads), `useRetainedValue` (modals unmounting mid-transition),
  keystroke-dropping debounce fix.

### Wave 6 — accessibility

- **R4-4.1** row-action names · **R4-2.1** dropdown trigger labelling · **R4-2.2/2.3/5.3** the
  focus system · **R4-1.2** drawer visibility · **R4-3.1/3.3** field-error channel +
  `AddressFields` naming · **R4-4.2–4.7** headings, `aria-current`, lists, alt text, `role=status`,
  skip links · **R4-14.1** German accessible names (incl. HeroUI's hardcoded English clear-button
  label) · **R4-3.2** overriding aria-labels deleted (plus two switches) · **R4-1.1/1.3/1.4**
  dialog naming, `alertdialog`, close trigger · **R4-3.4/13.3** pending-disabled cancel ·
  **R4-13.2** clipboard hardening · **R4-13.4** inline-create auto-select (first cut resolved
  against a list that couldn't contain the new record — found by re-reading the diff) · **NEW-C1**
  badge `-solid` ramp + recorded chip deviation · **NEW-S1** sign-out (with the `NEXT_REDIRECT`
  rejection trap) · **NEW-F14** popover-in-fixed-overlay removed · **W6-MAN** my keyboard +
  screen-reader walkthroughs · plus eleven review rounds' worth of fixes recorded in the series:
  union error messages germanised, tab-strip constants (`TAB_ITEM/TRACK/INDICATOR`), switch layout,
  `ctaButton`/`StatusPanel`/`FIELD_LABEL` recipes, the sign-in navigation oracle (§3.1), 15-minute
  magic links, controlled-field `value` placement, `isInvalid={false}` outranking native validation.

### Wave 7 — performance

- **NEW-P1** compiler on→measured→off · **R4-16.1 / NEW-P2** mount-guard no-op + payload won't-fix,
  both measured · **R4-16.4** modal mount guard (all four sites, second attempt) · **R4-16.2**
  `AdminContextWrapper` scoped + season-aware picker · **R4-18.2/18.3** two hand-written memos ·
  **R3a-A6.4/A6.5 + R4-18.4** key fixes · **R4-17.2** last masks, `next/image` retired · **BE-1 +
  R4-15.1** season default (§3.3) · **BE-8** the silent filter builder, found and fixed en route ·
  **R3a-A2.4** traceId-in-cache verified by-design · **NEW-SC10/SC11** the shells (§3.3) ·
  **NEW-R1–R8** the review series: two-press sign-out, `BrandLink` + `useId` logo filter, the
  three-round spielplan cascade (`cards-cascade`, 25 ms stagger, `[role="listitem"]` selector),
  editor chunk prefetch, CRUD fallback → entrance animation, the season selector's two root causes,
  the naming pass (closing five Wave 8 rows early), the dimensionally-exact `SpielCardSkeleton`
  (3/4/6 by breakpoint, under-reserving on purpose) · **A1 wording amended** with my
  authorisation (`connection()` precedes the fetch, not necessarily in the default export) ·
  `no-concatenated-classes` added with its coverage limit recorded.

### Wave 8 — cleanup (three PRs: 8a/8b/8c)

- **8a:** **R2-4.1** `TeamsProvider` + directory deleted · **R2-4.3/4.4/4.5** dead schemas (one
  removing a cross-feature edge; the Zod-twin row followed its sources, not its own instruction) ·
  **R2-4.6** `QaQuestion` applied · **R2-4.8** `core/api.ts` internals unexported · **R2-4.9/4.10**
  dead glob; `allowJs: false` (deletion impossible — Next rewrites absent keys) · **R2-4.2/R3a-B5.1/
  R3b-S4.1** kept per D1/ADR-0010.
- **8b:** **R2-5.1 + 5.7/5.8** named exports + folder moves (one PR, 96 files) · **R2-5.6** handler
  naming · (R2-5.2/5.3/5.4/5.5/5.10 had closed early in Wave 7's naming pass).
- **8c:** **R3a-A2.1** D2 executed — 20 tags deleted, 2 wired · **R3a-A2.2/A2.3** superseded ·
  **R3a-B1.4** verified closed by NEW-SC2 · **R3a-A4.3** 2 of 3 `"use client"` removals (the third
  needs its render prop — the rule is now CLAUDE.md §6) · **R3a-A4.2** server-rendered dropdown
  items (the report's caveat did not hold, verified at runtime) · **R3a-A4.4/A6.2** closed by 5a's
  NEW-T2 fix · **R3a-B2.2** progressive-enhancement row confirmed by-design · **R1-13c/13d**
  targets extinct · **R2-6.4** postcss placement · **R2-6.7** false positive · **R2-6.8**
  `.prettierignore` pruned with each survivor justified · **NEW-SC8/SC9** `Headers` assembly +
  timeout bounding the body read · **R1-9** dead `optimizePackageImports` entry · **R4-8.1**
  `tailwindFunctions` pruned to `["tv"]` · plus `useMounted`/`db.ts` export conversion (my
  extension of D4) and the stale Part 1.4 backend rows corrected.

## 7. Left open

Tracked in [`docs/_roadmap/open-items.md`](../../_roadmap/open-items.md) unless
noted:

- **BE-4** — no write path for `saisons`/`spieler`/`spieltage`; edits are direct-in-Mongo with
  manual revalidation. Building it retires the runbook script and the manual half (since removed by
  ADR-0028).
- **BE-9** — the "TBD" placeholder team vs nullable opponents. Analysis recorded; trigger: BE-4's
  scoping, or the first season where the missing junction row breaks a bracket.
- **BE-6** — `CustomObjectId` validates nothing in JSON mode · **BE-7** — `typing` →
  `collections.abc` via ruff `UP` in one pass. Both seeded into the backend audit prompts.
- **F4** — team statistics written to `teams`, served from `saison_teams` ⚠️ — the backend audit's
  motivating finding (its pass B1 re-verifies it first).
- **F1** — two definitions of `ausstehend` (server includes today, client excludes) — verify intent
  before changing either side.
- **Accepted deviations, recorded at their sites:** two amber chip states below AA in light mode;
  no focus indicator inside open listboxes (WCAG 2.4.7 — react-aria's global modality flag);
  no focus trap/restore on the mobile drawer (reversal trigger: convert to `Modal` if it grows);
  react-aria's built-in strings follow the browser locale (an `I18nProvider` would change number
  parsing — my call); an in-flight submit can still be dismissed via the modal's X/Escape.
- **Never runtime-verified:** the two kept granular cache tags' invalidation (needs an admin
  session; the wiring type-checks and builds); BE-1's narrowing on multi-season data (one season
  exists); the masked social icons' final look awaits my eye.

## 8. Verification state at close

The final gate (`./scripts/verify.sh`, 2026-08-01): exit 0 — script self-check · prettier ·
`tsc --noEmit` clean · `eslint .` 0 errors 0 warnings (all a11y/tailwind/layer rules at `error`) ·
`next build` 27 routes · `node --test` 83/83 · `pnpm audit --prod` clean · backend ruff clean +
238 pytest + pyright 0 errors · both Docker images build · `instrumentation.js` present in the
frontend image. CI enforces the same script. Human verification performed during the programme:
my keyboard-only and screen-reader walkthroughs (Wave 6), the NEW-T1 admin round-trip, both
themes on three route classes, and production header/sign-in checks after the Wave 3 deploy.
