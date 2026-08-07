# Frontend — spec

**Verified against:** `cf88b87`, 2026-08-07
**Scope:** `fl_frontend/src/`

---

## 1. Slice inventory

Twelve slices. The column shows which optional modules each actually has.

| Slice            | queries | mutations | actions | schemas | Notes                                                           |
| ---------------- | :-----: | :-------: | :-----: | :-----: | --------------------------------------------------------------- |
| `spiele`         |   ✅    |    ✅     |   ✅    |   ✅    | Owns the Spiel write path; `resolvers.ts`, `utils.ts` + tests   |
| `spielorte`      |   ✅    |    ✅     |   ✅    |   ✅    | Full CRUD; `utils.ts` + tests                                   |
| `schiedsrichter` |   ✅    |    ✅     |   ✅    |   ✅    | Full CRUD                                                       |
| `teams`          |   ✅    |    ✅     |   ✅    |   ✅    | Full CRUD + season junction; `resolvers.ts`, `utils.ts` + tests |
| `saisons`        |   ✅    |     —     |    —    |   ✅    | `resolvers.ts`                                                  |
| `spieler`        |   ✅    |     —     |    —    |   ✅    | Read-only                                                       |
| `spieltage`      |   ✅    |     —     |    —    |   ✅    | Read-only                                                       |
| `system`         |   ✅    |     —     |    —    |   ✅    | Read-only                                                       |
| `admin`          |   ✅    |     —     |    —    |    —    | Aggregator; `constants.ts`, `utils.ts` + tests                  |
| `auth`           |    —    |     —     |   ✅    |    —    | `signOutAction` only                                            |
| `dashboard`      |    —    |     —     |    —    |    —    | Components + constants only                                     |
| `meta`           |    —    |     —     |    —    |    —    | Components + constants only                                     |

`utils.ts` and `resolvers.ts` are sanctioned optional modules. They exist separately from `queries.ts`
because they hold non-caching code, and folding them in would put pure functions inside a `"use cache"`
module. (ADR-0004.)

## 2. Cached reads

Thirteen `"use cache"` functions.

| Function                                       | Slice          | Lifetime  | Tags                                             |
| ---------------------------------------------- | -------------- | --------- | ------------------------------------------------ |
| `getSpiele`                                    | spiele         | `hours`   | `spiele` + `spiele:saison_id:{id}` when filtered |
| `getSpiel`                                     | spiele         | `hours`   | `spiele`                                         |
| `getTeams`                                     | teams          | `days`    | `teams` + `teams:saison_id:{id}` when filtered   |
| `getTeam`                                      | teams          | `days`    | `teams` + `teams:saison_id:{id}` when filtered   |
| `getSaisons`                                   | saisons        | `days`    | `saisons`                                        |
| `getCurrentSaison`                             | saisons        | `days`    | `saisons`                                        |
| `getSpieler`                                   | spieler        | `days`    | `spieler`                                        |
| `getSpieltage`                                 | spieltage      | `days`    | `spieltage`                                      |
| `getSpielorte`                                 | spielorte      | `days`    | `spielorte`                                      |
| `getSchiedsrichter`                            | schiedsrichter | `days`    | `schiedsrichter`                                 |
| `checkIsLive`, `checkIsReady`, `getSystemInfo` | system         | `minutes` | `system`                                         |

**Uncached, deliberately:** `getAdminSpieleActionRequired` (admin). Admin-authorized data does not
belong in a shared cache, and its `bracket_faults` are derived per request over the stored bracket
([ADR-0047](../_decisions/0047-a-bracket-fault-is-derived-on-demand.md)), so a cached copy would be
wrong the moment a document moved under it.

**`getSpiel` is `GET /spiele/{spiel_id}` and carries the base tag ALONE.** The match editor is addressed
by match id with no season in the URL ([ADR-0050](../_decisions/0050-a-form-that-outgrows-a-dialog-becomes-a-page.md)),
so the season a granular tag would name is what this read exists to supply — and a season tag would be
wrong even where one is available, because a match write resolves the whole bracket and rewrites fixtures
the request never named ([ADR-0042](../_decisions/0042-a-result-entry-resolves-the-whole-bracket.md)). The
patch action invalidates `spiele` unconditionally, so this entry cannot outlive an edit. It resolves
`null` for an unknown id, which the editor page turns into `notFound()`; every other error is
rethrown. The 404 → null conversion lives INSIDE the cached function, because a production build
redacts an error thrown out of a `"use cache"` scope to a digest-only `Error` — a catch at the call
site can never recognise it.

**`getTeam` is `GET /teams/{team_id}` and is tagged exactly as `getTeams` is** — it reads the same
documents through the same derivation, so a result edit moves it too
([ADR-0034](../_decisions/0034-the-write-path-is-resource-first-in-a-second-router.md)). It resolves
`null` for an unknown id — or a club with no junction row for the requested season, since the join is
strict — for the same redaction reason as `getSpiel`; the detail pages and the admin team editor turn
the null into `notFound()` or an absent membership. Every other error is rethrown so it reaches
`onRequestError`.

**`getTeams` caches two tables per season, not one.** `statistik_scope` is part of the cache key
([ADR-0029](../_decisions/0029-the-league-table-counts-the-gruppenphase.md)): the Saisontabelle asks
for `gruppenphase` and a team's own page asks for `gesamt`, and those are separate entries. No
granular tag for it — the coarse `teams` tag clears both, which is right in both directions, since a
Gruppenphase result moves both tables and a playoff result moves only one.

**The grouped shape arrives already ranked, and nothing here re-sorts it.** The order is the
competition's tiebreak chain, whose last criterion is a head-to-head table the client never receives
([ADR-0043](../_decisions/0043-a-group-placing-is-ranked-by-one-chain-and-seeded-only-when-final.md)) —
and the same ordering seeds the playoff bracket, so a second sort would let the table and the bracket
disagree about who finished second. That response also carries `qualifiers_per_group`, which is what
`fl_frontend/src/features/teams/utils.ts :: computeQualifyingTeamIds` turns into the marked rows of the Saisontabelle.

## 3. Admin mutations

Fourteen admin server actions plus one auth action, and **two route handlers**. Every admin mutation
begins with `getAdminSession()` and returns an access-denied `FormState` rather than throwing, and
every one runs inside
`fl_frontend/src/shared/utils/adminMutation.ts :: runAdminMutation`, which seeds the correlation-id
request scope and converts a thrown API error into the `FormState` the caller toasts — without it a
409 (an ordinary create outcome, ADR-0032) crosses the server-action boundary redacted and replaces
the admin page with the error page ([`docs/logging.md`](../logging.md)).

**The route handlers are the two editors' undos — `POST /api/admin/spiele/undo` and
`POST /api/admin/teams/undo` — and the boundary stops there**
([ADR-0060](../_decisions/0060-an-editors-undo-is-a-route-handler-until-e592-is-fixed.md)). A server
action is the right primitive for an admin mutation and stays so for every other one; an undo is
dispatched from a route other than the one that raised it, which makes Next re-render the editor
segment and raise the E592 invariant mid-response. **Revert both to server actions once Next fixes
E592.**

| Action                        | Slice          | Invalidates                                                          |
| ----------------------------- | -------------- | -------------------------------------------------------------------- |
| `patchAdminSpielDataAction`   | spiele         | `spiele`, `teams`, + `spiele:saison_id:{id}`, `teams:saison_id:{id}` |
| `previewAdminSpielDataAction` | spiele         | **nothing** — it writes nothing (`dry_run=true`)                     |
| `postSpielortAction`          | spielorte      | `spielorte`                                                          |
| `patchSpielortAction`         | spielorte      | `spielorte`, `spiele`                                                |
| `deleteSpielortAction`        | spielorte      | `spielorte`                                                          |
| `postSchiedsrichterAction`    | schiedsrichter | `schiedsrichter`                                                     |
| `patchSchiedsrichterAction`   | schiedsrichter | `schiedsrichter`, `spiele`                                           |
| `deleteSchiedsrichterAction`  | schiedsrichter | `schiedsrichter`                                                     |
| `postTeamAction`              | teams          | `teams`, + `teams:saison_id:{id}`                                    |
| `patchTeamAction`             | teams          | `teams`, `spiele`                                                    |
| `deleteTeamAction`            | teams          | `teams`                                                              |
| `reactivateTeamAction`        | teams          | `teams`                                                              |
| `postSaisonTeamAction`        | teams          | `teams`, + `teams:saison_id:{id}`                                    |
| `patchSaisonTeamAction`       | teams          | `spiele`, `teams`, + `spiele:saison_id:{id}`, `teams:saison_id:{id}` |
| `signOutAction`               | auth           | —                                                                    |

The venue, referee and team patch actions also invalidate `spiele` because the backend fans a rename
out into every match document embedding it — so match data really has changed. The team patch stays on
base tags alone: a club is season-independent, so its rename touches every season's entries and no
granular tag names them all. `patchSaisonTeamAction` invalidates the `spiele` pair for a different
reason — no match document is written, but each side's `disqualifikation` is JOINED from the junction
row at read time ([`docs/backend/spec.md`](../backend/spec.md) I32), so the junction write changes
what `GET /spiele` returns for that season.

The team create is **one action over two requests** — `POST /teams`, then
`POST /teams/{team_id}/saisons` — because every team read is season-scoped with a strict junction
join (I11 there): a club created without a junction row would be invisible to the very list the
create form sits on, with no surface left that could give it one.

**Every mutation addresses its resource with the id in the PATH** — `PATCH /spielorte/{id}`,
`DELETE /schiedsrichter/{id}`, `PATCH /spiele/{spiel_id}`. There is no admin-prefixed route namespace,
and adding one would split a resource's writes from its reads
([ADR-0034](../_decisions/0034-the-write-path-is-resource-first-in-a-second-router.md)). The payload
schemas still carry `id`, because they back the admin forms, so each function in `mutations.ts` splits
it off before sending the body. **A backend payload model that saw an `id` would drop it silently**,
which is why the split is in one place per slice rather than at each call site.

**Three of the seven resources have write endpoints no action calls yet.** Players, seasons and
matchdays — plus the player season junction — are reachable from the API and have no admin page. That
is FB-3's spieler half and FB-6.

## 4. The cache tag design

Only four resources have a frontend write surface: `spiele`, `teams`, `spielorte`, `schiedsrichter`.
A granular tag is worth having only if **(a)** its resource can be written from the app at all, and
**(b)** a mutation changes some rows and not others along that dimension.

Two granular tags satisfy both and exist:

| Tag                  | Why it earns its place                                                                                                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spiele:saison_id:*` | Editing one match in one season must not evict every other season's cached lists, and the patch action knows exactly which season it touched                                                                                                   |
| `teams:saison_id:*`  | The same edit changes that season's league table, which `/teams` derives from the matches — so team caches must go too, though no team document was written. The season-junction actions write exactly one season's membership and name it too |

Twenty others were removed. The reasoning, by group:

- **Eleven had no write surface at all** — tags on seasons, players, matchdays and the system
  endpoints. Nothing in the app can invalidate them, so they would have persisted until expiry no
  matter what they were named.
- **Two keyed on a dimension the mutation changes** — `spiele:status:*` and `spiele:phase:*`. Editing a
  result can move a match from pending to played, so correct invalidation would need both the old value
  and the new one; the action holds only the new one. A tag that is right half the time is worse than
  no tag, because the wrong half is invisible.
- **Five keyed on team dimensions no mutation touches** — group, disqualification, and similar. The
  only thing an app mutation changes about a team is its league table, and that is a result edit.
- **Two sat on an unreachable branch** — the declaring query is only ever called with no arguments.

**Base tags are not made redundant by the granular ones.** Because the default read path sends no
`saison_id` at all, the most frequently hit cache entries carry only `spiele` and `teams`. Invalidating
by season alone would leave exactly those entries stale, which is why both base tags are invalidated
unconditionally on every match write.

**Standing rule:** every granular tag added must ship with its matching `updateTag` call in the same
change. That rule is what prevents recreating the twenty.

## 5. Out-of-band invalidation

`saisons`, `spieler` and `spieltage` have no write surface and are cached for a day, so an edit made
directly in MongoDB is served stale until the cache expires — **at most 24 hours, and that bound is
the whole mechanism**
([ADR-0035](../_decisions/0035-reference-data-staleness-is-bounded-by-cache-lifetime.md)). There is
no invalidation endpoint for these caches, and none may be added while the resources have no admin
write surface; the durable fix is an admin page that invalidates as it saves (`updateTag` inside
the action, ADR-0001), which is FB-3's remaining spieler half and FB-6.

To make an edit visible sooner, recreate the frontend container — the cache lives in its
filesystem, so recreation starts empty at the cost of every cached page, not three tags. The
command is in [`docs/workflows/README.md`](../workflows/README.md).

**A season edit is the case where the daily bound matters most**: a season decides which season an
omitted `saison_id` means (ADR-0002), and its `rules` score the league table `/teams` derives from
the matches (ADR-0026) — so a rollover or a points-scheme change touches `spiele`, `spieltage` and
`teams` answers too, and stays partially invisible until their entries expire or the container is
recreated.

## 6. Deliberate duplication: the three match cards

`SpielCard`, `SpielCardCompact` and `SpielCardUltraCompact` read as copy-paste and are not. They differ
in chip count (two, one, none), in full team names versus two-letter shorthands, and in the container
driving them — a grid, a vertical timeline, and a horizontal playoff bracket. No configuration flag
collapses them without producing a three-mode component, which is harder to read and change than three
single-mode ones. **Do not merge them.** (ADR-0007.)

Their genuinely shared code is already extracted: `formatSpielDisplay` in `spiele/utils.ts` returns the
four presentation values all of them need. That extraction was itself a bug fix — an unplayed match
rendered `"- : -"` in one card and `"-:-"` in the other two, on the same screen.

The fourth is a knockout's shoot-out, which **every card renders on its own line under the score and
never inside it** ([ADR-0044](../_decisions/0044-a-shoot-out-is-its-own-scoreline.md)): the fixture
finished level, the Saisontabelle counts it as a draw, and a card showing `4:3` where `2:2` belongs
would contradict the table about the same match.

## 7. Environment

Validated at startup by `@t3-oss/env-nextjs` (`core/config.ts`). Failure prints **names only**, never
values.

| Variable                                       | Constraint                                           |
| ---------------------------------------------- | ---------------------------------------------------- |
| `API_URL`                                      | URL                                                  |
| `API_VERSION`                                  | integer                                              |
| `MONGODB_URI`                                  | must start `mongodb://` or `mongodb+srv://`          |
| `AUTH_URL`                                     | URL; **must be https** unless it points at localhost |
| `AUTH_SECRET`, `AUTH_RESEND_KEY`               | string                                               |
| `INTERNAL_API_KEY_BASE` / `_SYSTEM` / `_ADMIN` | exactly 64 characters                                |
| `ALLOWED_ADMIN_EMAILS`                         | comma-separated, each a valid email                  |
| `LOG_FORMAT`                                   | `json` \| `console`, case-normalised (ADR-0039)      |

`SKIP_ENV_VALIDATION=true` bypasses the gate — used by the Docker builder stage, which has no real
environment.

The `AUTH_URL` https rule exists because `@auth/core` derives the session cookie's `Secure` flag from
that URL's protocol, so a stray `http://` value would ship an admin session cookie in plaintext. It is
gated on hostname rather than `NODE_ENV`, because the local stack runs the production image against
`http://localhost:3000`.

`AUTH_TRUST_HOST` is deliberately **not** declared: `@auth/core` reads `AUTH_URL` first in the same
chain, and `AUTH_URL` is mandatory, so the variable can never be reached.

## 8. Lint rules that encode a decision

| Rule                                                | Why it exists                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react/no-danger: error`                            | The enforced CSP keeps `'unsafe-inline'` on `script-src`, so it does not mitigate script injection. This does, at the only place injection could realistically enter                                                                                                                                                                                                                      |
| `better-tailwindcss/no-unknown-classes: error`      | The only check in the toolchain that can see a class name resolving to nothing. TypeScript, the Prettier plugin and the browser all accept an unresolvable utility in silence, and two such classes shipped                                                                                                                                                                               |
| `better-tailwindcss/no-concatenated-classes: error` | Partial cover for a real defect: a class string relying on a space _inside_ the string, which `prettier --write` trims, fusing classes together. **Know its limit** — it catches a literal abutting an interpolation but not two adjacent interpolations, which is the shape that actually shipped. The convention (put the separating space in the template literal) is what prevents it |
| `no-restricted-imports` on `core`/`shared`          | Layer boundaries, scoped deliberately narrowly — see the overview                                                                                                                                                                                                                                                                                                                         |
| `@typescript-eslint/consistent-type-imports`        | Type-only imports are erased; mixing them risks pulling runtime modules across the RSC boundary                                                                                                                                                                                                                                                                                           |

## 9. Testing

**Runner:** Node's built-in test runner — `node --test`, driven through `pnpm test`. There is no Vitest
or Jest, and no test config file. TypeScript path aliases are resolved by `tsconfig-alias-hook.mjs`,
loaded with `--import`.

**Tests sit next to the code they test** (`utils.ts` beside `utils.test.ts`), unlike the backend, whose
tests live in a separate `fl_backend/tests/` tree. That asymmetry is not an inconsistency anyone chose —
it is each ecosystem's default, and both defaults exist for a reason:

- **Node's runner discovers `*.test.ts` anywhere in the tree**, so colocation needs zero configuration.
  Bundlers exclude `.test.` files by pattern, so nothing ships. The JavaScript convention followed from
  that.
- **pytest is configured with `testpaths = ["tests"]`** and `--import-mode=importlib`. Python's
  convention keeps tests _outside_ the importable package: a `tests` package inside `app/` would be
  importable as `app.tests` and would ship with the application. The importlib mode is also what lets
  `tests/` work without `__init__.py` files and lets two test modules share a basename.

The test files cover pure functions only — schema validators, formatters, derivations, the log-line
format and the action error mapping ([`docs/logging.md`](../logging.md), invariants L1–L3 and L6).
There are no component tests and no end-to-end suite.

**One test is not a unit test.** `src/core/apiContract.test.ts` reads the committed
`fl_backend/openapi.json` and compares every Zod schema against the component that publishes it
([ADR-0040](../_decisions/0040-the-zod-mirror-is-checked-against-the-published-document.md)). It
discovers the schema modules by walking the tree and imports them dynamically, so a new feature slice
is covered without an edit, and `core` gains no static import of `features` (I9).

## 10. Invariants

| #   | Invariant                                                                                                                                                                                                                               | Enforced by                                                                                                                                                                                                  | Breaks how                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I1  | Every granular cache tag has a matching `updateTag` in a server action                                                                                                                                                                  | review                                                                                                                                                                                                       | The tag never invalidates; reads as coverage, is decoration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| I2  | Base tags `spiele`/`teams` invalidate unconditionally on a match write                                                                                                                                                                  | `fl_frontend/src/features/spiele/actions.ts :: updateTag("spiele")`                                                                                                                                          | The default read path's entries carry only base tags and go stale until expiry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| I3  | `saison_id` reaches the action as an argument, never on the patch body                                                                                                                                                                  | `spiele/actions.ts` signature                                                                                                                                                                                | The backend model does not declare it; Pydantic drops it silently, leaving a dead field that looks load-bearing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| I4  | A failed season-id parse never fails the edit                                                                                                                                                                                           | `fl_frontend/src/features/spiele/actions.ts :: FLSpielSchema.shape.saison_id.safeParse`                                                                                                                      | An admin's work rejected over a cache optimisation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| I5  | Write payloads compose from the read model's field schemas                                                                                                                                                                              | `fl_frontend/src/features/spiele/schemas.ts :: FLPatchSpielDataPayloadSchema`                                                                                                                                | Read and write shapes drift apart                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| I6  | `await connection()` precedes every page data fetch                                                                                                                                                                                     | each page or its async child                                                                                                                                                                                 | `docker compose build` fails — the builder stage has no reachable backend                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| I7  | Every admin server action starts with `getAdminSession()`                                                                                                                                                                               | all nine actions, the read-only preview included                                                                                                                                                             | Unauthenticated mutation — and, for the preview, an unauthenticated read of a season's bracket                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| I8  | `getAdminSession()`'s return value must be checked                                                                                                                                                                                      | naming only                                                                                                                                                                                                  | It neither throws nor redirects; calling it bare guards nothing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| I9  | `core` imports neither `shared` nor `features`; `shared` does not import `features`                                                                                                                                                     | ESLint `no-restricted-imports`                                                                                                                                                                               | Infrastructure gains a dependency on the app                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| I10 | No barrel files                                                                                                                                                                                                                         | review                                                                                                                                                                                                       | Tree-shaking across the RSC boundary is defeated                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| I11 | Named exports under `src/`, defaults only where Next.js requires                                                                                                                                                                        | review                                                                                                                                                                                                       | A filename/export mismatch becomes a silent rename instead of a compile error                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| I12 | `AdminEditSpielDataForm` takes lookup lists as props, never `useAdmin()`; `AdminSpielEditView` is what supplies them                                                                                                                    | props signature                                                                                                                                                                                              | `spiele` would depend on `admin`, undoing the write-path move                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| I13 | Before deleting a `"use client"` directive, check for render props                                                                                                                                                                      | review                                                                                                                                                                                                       | A Server Component may not pass a function to a Client Component. Neither `tsc` nor `next build` catches it on a dynamic route — it throws at request time                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| I14 | `revalidateTag(tag, profile)` in route handlers, `updateTag(tag)` in server actions — the undo handler is the one route-handler caller, and passes `{ expire: 0 }` because an undo tolerates no staleness                               | route/action split                                                                                                                                                                                           | `updateTag` throws in a route handler                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| I15 | The three `SpielCard` variants stay separate                                                                                                                                                                                            | review                                                                                                                                                                                                       | See §6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| I16 | No invalidation endpoint for the reference caches (ADR-0035)                                                                                                                                                                            | absence under `src/app/api/`                                                                                                                                                                                 | A second out-of-band mechanism would re-carry the security posture and tag mapping the removal retired; staleness under 24 h is the documented cost                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| I17 | Every Zod schema agrees with the component that publishes it on presence, required, nullable, type and enum members                                                                                                                     | `fl_frontend/src/core/apiContract.test.ts` ([ADR-0040](../_decisions/0040-the-zod-mirror-is-checked-against-the-published-document.md))                                                                      | Zod's strip mode discards a field the backend sends with no error at all, and a nullable the mirror does not declare throws `APIMalformedDataError` on a public page                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| I18 | Client-side field validation runs the schema the server action parses, never a second copy of the rules                                                                                                                                 | `fl_frontend/src/shared/hooks/useDraftValidation.ts` ([ADR-0050](../_decisions/0050-a-form-that-outgrows-a-dialog-becomes-a-page.md))                                                                        | The browser accepts a value the server rejects, or rejects one it accepts, and no test can see the two disagree                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| I19 | Client verdicts never write into `useServerFieldErrors`'s map                                                                                                                                                                           | `fl_frontend/src/shared/hooks/useDraftValidation.ts :: mergedWith`                                                                                                                                           | That hook calls `reportValidity()` on every change of its map, so clearing a corrected field on blur throws focus onto the next unfixed one mid-form                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| I20 | `deriveSpielDraftStatus` is the match editor's single contract: every marker, badge, list, count and guard reads it, and **no surface reads a draft field directly**                                                                    | `fl_frontend/src/features/spiele/draftStatus.ts :: FIELD_DESCRIPTORS`, whose test requires a row per field of the draft shape ([ADR-0051](../_decisions/0051-a-voided-result-is-named-before-it-is-lost.md)) | Adding a field stops being one descriptor row and becomes an edit to every surface that mentions it — and a surface that reads the draft directly is invisible to the derivation, so it silently keeps the old behaviour when the table changes. See §12                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| I21 | The navigation guard covers reload, tab close, and links this page renders — and nothing else                                                                                                                                           | `useUnsavedChangesWarning` (`beforeunload`) and `<Link onNavigate>`; the gap is accepted, see §12                                                                                                            | Treating it as complete coverage. The admin sidemenu's links and the browser Back button cannot be intercepted at all, so a draft is lost through either with no prompt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| I22 | **A dynamic segment's page awaits `params` (and every runtime API) INSIDE a `<Suspense>` boundary, never at its own top level.** All three do: `/admin/spiele/[spiel_id]`, `/dashboard/teams/[team_id]`, `/dashboard/spieler/[team_id]` | The page component is synchronous and renders `<Suspense><…Content {...props} /></Suspense>`; `next build` prints an App Shell sub-entry under each of the three, which is the visible signal it worked      | `cacheComponents` builds an App Shell with FALLBACK params for a segment with no `generateStaticParams` (ADR-0011). A top-level await ties that shell to one URL, and Next then raises `Invariant: postponed state should not be provided when fallback params are provided` whenever a server action's `updateTag` revalidates the route from a DIFFERENT route. The action's response is truncated, the client reports "An unexpected response was received from the server", and the route keeps serving its stale payload — so a saved fixture reopens with its old values. Nothing in the toolchain catches it: it type-checks, lints, builds and renders correctly on a direct visit |
| I23 | **A toast is raised through `appToast`, and its appearance is built in `AppToaster`** — never `toast` from `@heroui/react` at a call site, and never a new `.toast*` rule in a stylesheet                                               | `fl_frontend/src/shared/utils/appToast.ts` (20 call sites across 7 files) and `fl_frontend/src/core/providers/AppToaster.tsx` ([ADR-0053](../_decisions/0053-a-toast-is-built-in-tsx-not-patched-in-css.md)) | HeroUI applies a 4000 ms default to any toast that states no `timeout`, so a call site that bypasses `appToast` silently gets a clock sized for a one-word message — and a pending toast omitting it retires while its request is still running. Styling a toast from CSS instead reaches it through vendored selectors that an upgrade can rename with no error anywhere                                                                                                                                                                                                                                                                                                                  |
| I24 | **The action-required page holds no client state: which section is on screen is `?section=`, read with `useSearchParams` and written with `window.history.replaceState`**                                                               | `fl_frontend/src/features/admin/components/views/AdminSpieleActionRequiredView.tsx :: SECTION_PARAM` ([ADR-0056](../_decisions/0056-a-triage-list-is-ordered-by-what-blocks-play.md))                        | The App Router hides an admin route's tree with `<Activity>` rather than unmounting it, so a selection in `useState` — or inside an uncontrolled `Tabs` — survives a round trip to the editor and comes back describing the page as it was. It is §12's hazard on a second surface, and here there is no content key and no reset to be fixed by. `router.replace` is the other trap: this route's read is uncached (ADR-0013), so a router navigation re-reads the whole archive to change which already-loaded section is displayed                                                                                                                                                      |

## 11. Violation → remedy

The symptom-first index, for the reader who has the bug and does not yet know the cause. Several rows
are behaviour that is deliberate — those are the ones that save the most time.

| Symptom                                                                          | Cause                                                                                                                                                                          | Remedy                                                                                                                                                   |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An admin edit saves, but the list still shows the old data                       | The entry carries only base tags, and only a granular tag was invalidated                                                                                                      | I2 — the base `updateTag`s must stay unconditional                                                                                                       |
| A page never refreshes after a season is edited                                  | A `saisons` write has to clear four tag families, not one                                                                                                                      | I17 — check `AFFECTED_TAGS` still lists `spiele`, `spieltage` and `teams`                                                                                |
| A field the admin form sends never reaches the database                          | The backend model does not declare it, and Pydantic drops it silently                                                                                                          | I3 — pass it as an action argument, never on the patch body                                                                                              |
| The image build fails on a page that builds locally                              | A page fetches without `await connection()`; the builder has no backend                                                                                                        | I6 — add the guard before the fetch; it need not sit in the default export                                                                               |
| A dynamic route throws at request time but the build passed                      | A Server Component passes a render prop to a Client Component                                                                                                                  | I13 — restore the `"use client"` directive. No gate catches this one                                                                                     |
| `updateTag` throws inside a route handler                                        | Wrong function for the context                                                                                                                                                 | I14 — `revalidateTag` in route handlers, `updateTag` in server actions                                                                                   |
| The three match cards look like duplication                                      | Working as intended — they differ in chips, names and container (§6)                                                                                                           | Nothing. Extract shared derivation into `utils.ts` rather than merging them                                                                              |
| A cache tag exists but nothing ever clears it                                    | A granular tag on a resource with no write surface                                                                                                                             | I1 — add the matching `updateTag` in the same change, or delete the tag                                                                                  |
| A server action fails with "An unexpected response was received from the server" | Something answered its POST with a redirect, so the client read HTML where an RSC payload belongs                                                                              | `src/proxy.ts` exempts any request carrying `next-action`; the action's own `getAdminSession()` refuses it instead                                       |
| A server action writes, but the screen does not change                           | It was dispatched from a closure whose component has unmounted, so the router never applies its revalidation                                                                   | `updateTag` is required and NOT sufficient there — call `router.refresh()` when the result arrives (the undo toast)                                      |
| A white outline appears on a control that already rings                          | The base-layer focus rule painting over a HeroUI control                                                                                                                       | The unlayered opt-out in `globals.css` — HeroUI's own is `:not(:focus)`-gated and cannot fire on a focused element                                       |
| A focus indicator appears after a plain mouse press                              | react-aria's focus-visible modality is global and survives an earlier key press                                                                                                | Expected. Opt the control out where its container already indicates focus, as the switch and the field groups do                                         |
| A toast disappears before it can be read, or a spinner retires mid-request       | The call site used HeroUI's `toast` directly, so it took the library's 4000 ms default                                                                                         | I23 — raise it through `appToast`, which derives the duration and gives `pending` `timeout: 0`                                                           |
| A toast renders unstyled or misaligned after a HeroUI upgrade                    | One of the two vendored selectors `globals.css` still owns was renamed — `.toast` or `.toast__close-button`                                                                    | Re-read `@heroui/styles/dist/components/toast.css`; the rules say which version they were written against (ADR-0053)                                     |
| A hover or press animation snaps instead of easing                               | A hand-written `transition-[…]` names `transform`, but Tailwind v4 emits `scale-*`, `translate-*` and `rotate-*` as the standalone `scale` / `translate` / `rotate` properties | Name the property that actually changes. The `transition-transform` shorthand is safe — v4 expands it to all four — so only an arbitrary list is exposed |

## 12. The match editor's three structural properties

All three are implemented, all three are load-bearing, and none is visible from any single
component — which is why they are here rather than left to be rediscovered.

### The draft has exactly one derivation

`fl_frontend/src/features/spiele/draftStatus.ts :: deriveSpielDraftStatus` answers everything the page
says about a field. The label's markers, the change list, the open-items list with its two severity
badges, the unsaved count on the action bar, the discard dialog's count and the navigation guard all
read it, and **nothing reads a draft field directly** (I20).

The mechanism is `FIELD_DESCRIPTORS`: one row per editable field, carrying how it is read, compared,
formatted, which panel it belongs to and which action-required category waits on it. Adding a field is
adding a row. A field with no row is invisible to every surface at once, which is a failure loud enough
to catch — unlike a field that half the surfaces know about.

**The rule that keeps it true is the negative one.** Any surface that reads `draft.team1.tore` instead
of asking the derivation gets the answer right today and keeps giving the old answer when the table
changes. There is always a shorter route for one component; taking it is what turns a one-row change
into a sweep.

### The editor's subtree is keyed by the fixture's stored state

`fl_frontend/src/app/admin/spiele/[spiel_id]/page.tsx` keys `AdminSpielEditView` with
`fl_frontend/src/features/spiele/utils.ts :: spielStateKey`, which is the fixture id **plus the
payload the draft mirrors** — not the id alone.

Every field on the page is `useState` initialised from `spielData`, and an initialiser runs once per
mounted instance, so fresh props never re-seed a field. React's own answer is to reset with a `key`,
and the id covers only half the cases: two different fixtures differ by id, but the _same_ fixture
whose stored values changed does not. That second case is the undo's — a restored fixture reopened in
a still-mounted editor reads as un-restored until a reload, with the server sending correct data the
whole time.

Built from `toPatchPayload` deliberately: those are exactly the fields the draft mirrors, so the key
moves when something the form displays has changed underneath it, and not when a field no draft atom
holds (`ergebnis`, `spiel_nr`) does. Four cases in `utils.test.ts` pin it, including that one.
**Narrowing this key back to `spiel.id` reintroduces a bug the type checker cannot see.**

**The key is one of two gates, and neither is sufficient alone.** The other is that **both exits reset
the draft** — `resetDraftToStored` in `AdminEditSpielDataForm`, run by the discard AND by the save.

They cover different halves, and each half is invisible without the other. The key is what makes a
reopened editor re-seed from data that changed while it was away. The reset is what makes a _reused_
tree honest: a preserved tree is matched by its key, and a save followed by an undo lands on the key
the tree was first mounted with, because the undo restores the values the page opened on. React then
reuses that tree, and whatever is left in its atoms is what the admin sees — the values they typed, on
a fixture that no longer holds them. Neither the payload nor the key is wrong in that case; the state
is.

Measured, because both fixes read as sufficient on their own: with the typed value left in state, a
reopened editor shows it while the server-rendered value and the passed prop are both correct. It is
the same failure the discard path was given `resetDraftToStored` for, and the save path went without
it.

### The navigation guard has an accepted gap

Next 16 exposes **no navigation blocker** — verified against the `next/navigation` export list and
`AppRouterInstance`. What the page can intercept, it does:

| Leaving by                      | Guarded | How                                                    |
| ------------------------------- | :-----: | ------------------------------------------------------ |
| Reload, tab close, browser quit |   ✅    | `beforeunload`, in `useUnsavedChangesWarning`          |
| A link this page renders        |   ✅    | `<Link onNavigate>`                                    |
| Abbrechen, and the Zurück pill  |   ✅    | The form's own `requestLeave`, via a register-callback |
| The admin sidemenu's links      |   ❌    | Rendered by the layout, above this tree                |
| The browser's Back button       |   ❌    | `popstate` fires after the router has committed        |

**The owner accepted the two gaps** rather than pay for full coverage, and the shape of that payment is
worth recording so the trade can be re-taken rather than re-derived: a `NavigationGuardContext` in the
admin layout, which every intercept-able control consults before navigating and which this form
registers its guard with. That is the upgrade path if full coverage is ever wanted. It is not built,
and the browser's Back button stays outside even then — nothing in the platform makes that one
interceptable.

This is also why the header's Zurück pill earns its place beside the browser's own back button: the
pill routes through the discard guard and the button cannot.

## 13. Known-open

| #   | Item                                                                    | State                                                                                                                                                                                                                                                                                                                                    |
| --- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | `ausstehend` means `>= today` on the server and `> today` on the client | Open question of intent, not a filed bug. Tracked in [`docs/roadmap/open-items.md`](../roadmap/open-items.md)                                                                                                                                                                                                                            |
| —   | Pydantic and Zod models are hand-mirrored, no generation step           | Checked rather than generated ([ADR-0040](../_decisions/0040-the-zod-mirror-is-checked-against-the-published-document.md)): `fl_frontend/src/core/apiContract.test.ts` compares presence, required, nullable, type and enum members against the committed `fl_backend/openapi.json`. Patterns, lengths and messages stay each side's own |
| —   | Two revocation paths, neither of them the 8h lifetime                   | The admin's own sign-out is `fl_frontend/src/features/auth/actions.ts :: signOutAction`; an operator revokes by removing the address from `ALLOWED_ADMIN_EMAILS`, which the `session` callback re-reads on every request                                                                                                                 |
