# Frontend — spec

**Verified against:** `ab20403`, 2026-08-05
**Scope:** `fl_frontend/src/`

---

## 1. Slice inventory

Twelve slices. The column shows which optional modules each actually has.

| Slice            | queries | mutations | actions | schemas | Notes                                          |
| ---------------- | :-----: | :-------: | :-----: | :-----: | ---------------------------------------------- |
| `spiele`         |   ✅    |    ✅     |   ✅    |   ✅    | Owns the Spiel write path; `utils.ts` + tests  |
| `spielorte`      |   ✅    |    ✅     |   ✅    |   ✅    | Full CRUD; `utils.ts` + tests                  |
| `schiedsrichter` |   ✅    |    ✅     |   ✅    |   ✅    | Full CRUD                                      |
| `teams`          |   ✅    |     —     |    —    |   ✅    | `resolvers.ts`, `utils.ts` + tests             |
| `saisons`        |   ✅    |     —     |    —    |   ✅    | `resolvers.ts`                                 |
| `spieler`        |   ✅    |     —     |    —    |   ✅    | Read-only                                      |
| `spieltage`      |   ✅    |     —     |    —    |   ✅    | Read-only                                      |
| `system`         |   ✅    |     —     |    —    |   ✅    | Read-only                                      |
| `admin`          |   ✅    |     —     |    —    |    —    | Aggregator; `constants.ts`, `utils.ts` + tests |
| `auth`           |    —    |     —     |   ✅    |    —    | `signOutAction` only                           |
| `dashboard`      |    —    |     —     |    —    |    —    | Components + constants only                    |
| `meta`           |    —    |     —     |    —    |    —    | Components + constants only                    |

`utils.ts` and `resolvers.ts` are sanctioned optional modules. They exist separately from `queries.ts`
because they hold non-caching code, and folding them in would put pure functions inside a `"use cache"`
module. (ADR-0004.)

## 2. Cached reads

Twelve `"use cache"` functions.

| Function                                       | Slice          | Lifetime  | Tags                                             |
| ---------------------------------------------- | -------------- | --------- | ------------------------------------------------ |
| `getSpiele`                                    | spiele         | `hours`   | `spiele` + `spiele:saison_id:{id}` when filtered |
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

**`getTeam` is `GET /teams/{team_id}` and is tagged exactly as `getTeams` is** — it reads the same
documents through the same derivation, so a result edit moves it too
([ADR-0034](../_decisions/0034-the-write-path-is-resource-first-in-a-second-router.md)). It throws
`APIBadStatusError` with `statusCode: 404` for an unknown id, which the two team detail pages catch to reach
`notFound()`; every other error is rethrown so it reaches `onRequestError`.

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

## 3. Server actions

Seven admin actions plus one auth action. Every admin action begins with `getAdminSession()` and
returns an access-denied `FormState` rather than throwing. **Every admin action body runs inside
`fl_frontend/src/shared/utils/serverAction.ts :: runAdminAction`**, which seeds the correlation-id
request scope and converts a thrown API error into the `FormState` the form toasts — without it a
409 (an ordinary create outcome, ADR-0032) crosses the server-action boundary redacted and replaces
the admin page with the error page ([`docs/logging.md`](../logging.md)).

| Action                       | Slice          | Invalidates                                                          |
| ---------------------------- | -------------- | -------------------------------------------------------------------- |
| `patchAdminSpielDataAction`  | spiele         | `spiele`, `teams`, + `spiele:saison_id:{id}`, `teams:saison_id:{id}` |
| `postSpielortAction`         | spielorte      | `spielorte`                                                          |
| `patchSpielortAction`        | spielorte      | `spielorte`, `spiele`                                                |
| `deleteSpielortAction`       | spielorte      | `spielorte`                                                          |
| `postSchiedsrichterAction`   | schiedsrichter | `schiedsrichter`                                                     |
| `patchSchiedsrichterAction`  | schiedsrichter | `schiedsrichter`, `spiele`                                           |
| `deleteSchiedsrichterAction` | schiedsrichter | `schiedsrichter`                                                     |
| `signOutAction`              | auth           | —                                                                    |

The two patch actions also invalidate `spiele` because the backend fans a venue or referee rename out
into every match document embedding it — so match data really has changed.

**Every mutation addresses its resource with the id in the PATH** — `PATCH /spielorte/{id}`,
`DELETE /schiedsrichter/{id}`, `PATCH /spiele/{spiel_id}`. There is no admin-prefixed route namespace,
and adding one would split a resource's writes from its reads
([ADR-0034](../_decisions/0034-the-write-path-is-resource-first-in-a-second-router.md)). The payload
schemas still carry `id`, because they back the admin forms, so each function in `mutations.ts` splits
it off before sending the body. **A backend payload model that saw an `id` would drop it silently**,
which is why the split is in one place per slice rather than at each call site.

**Six of the seven resources have write endpoints no action calls yet.** Teams, players, seasons,
matchdays and both season junctions are reachable from the API and have no admin page — that is FB-3
and FB-6.

## 4. The cache tag design

Only four resources have a frontend write surface: `spiele`, `teams`, `spielorte`, `schiedsrichter`.
A granular tag is worth having only if **(a)** its resource can be written from the app at all, and
**(b)** a mutation changes some rows and not others along that dimension.

Two granular tags satisfy both and exist:

| Tag                  | Why it earns its place                                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spiele:saison_id:*` | Editing one match in one season must not evict every other season's cached lists, and the patch action knows exactly which season it touched                |
| `teams:saison_id:*`  | The same edit changes that season's league table, which `/teams` derives from the matches — so team caches must go too, though no team document was written |

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
the action, ADR-0001), which is open items FB-3 and FB-6.

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

| #   | Invariant                                                                                                           | Enforced by                                                                                                                             | Breaks how                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | Every granular cache tag has a matching `updateTag` in a server action                                              | review                                                                                                                                  | The tag never invalidates; reads as coverage, is decoration                                                                                                          |
| I2  | Base tags `spiele`/`teams` invalidate unconditionally on a match write                                              | `fl_frontend/src/features/spiele/actions.ts :: updateTag("spiele")`                                                                     | The default read path's entries carry only base tags and go stale until expiry                                                                                       |
| I3  | `saison_id` reaches the action as an argument, never on the patch body                                              | `spiele/actions.ts` signature                                                                                                           | The backend model does not declare it; Pydantic drops it silently, leaving a dead field that looks load-bearing                                                      |
| I4  | A failed season-id parse never fails the edit                                                                       | `fl_frontend/src/features/spiele/actions.ts :: FLSpielSchema.shape.saison_id.safeParse`                                                 | An admin's work rejected over a cache optimisation                                                                                                                   |
| I5  | Write payloads compose from the read model's field schemas                                                          | `fl_frontend/src/features/spiele/schemas.ts :: FLPatchSpielDataPayloadSchema`                                                           | Read and write shapes drift apart                                                                                                                                    |
| I6  | `await connection()` precedes every page data fetch                                                                 | each page or its async child                                                                                                            | `docker compose build` fails — the builder stage has no reachable backend                                                                                            |
| I7  | Every admin server action starts with `getAdminSession()`                                                           | all seven actions                                                                                                                       | Unauthenticated mutation                                                                                                                                             |
| I8  | `getAdminSession()`'s return value must be checked                                                                  | naming only                                                                                                                             | It neither throws nor redirects; calling it bare guards nothing                                                                                                      |
| I9  | `core` imports neither `shared` nor `features`; `shared` does not import `features`                                 | ESLint `no-restricted-imports`                                                                                                          | Infrastructure gains a dependency on the app                                                                                                                         |
| I10 | No barrel files                                                                                                     | review                                                                                                                                  | Tree-shaking across the RSC boundary is defeated                                                                                                                     |
| I11 | Named exports under `src/`, defaults only where Next.js requires                                                    | review                                                                                                                                  | A filename/export mismatch becomes a silent rename instead of a compile error                                                                                        |
| I12 | `AdminEditSpielDataForm` takes lookup lists as props, never `useAdmin()`                                            | props signature                                                                                                                         | `spiele` would depend on `admin`, undoing the write-path move                                                                                                        |
| I13 | Before deleting a `"use client"` directive, check for render props                                                  | review                                                                                                                                  | A Server Component may not pass a function to a Client Component. Neither `tsc` nor `next build` catches it on a dynamic route — it throws at request time           |
| I14 | `revalidateTag` in route handlers, `updateTag` in server actions                                                    | route/action split                                                                                                                      | `updateTag` throws in a route handler                                                                                                                                |
| I15 | The three `SpielCard` variants stay separate                                                                        | review                                                                                                                                  | See §6                                                                                                                                                               |
| I16 | No invalidation endpoint for the reference caches (ADR-0035)                                                        | absence under `src/app/api/`                                                                                                            | A second out-of-band mechanism would re-carry the security posture and tag mapping the removal retired; staleness under 24 h is the documented cost                  |
| I17 | Every Zod schema agrees with the component that publishes it on presence, required, nullable, type and enum members | `fl_frontend/src/core/apiContract.test.ts` ([ADR-0040](../_decisions/0040-the-zod-mirror-is-checked-against-the-published-document.md)) | Zod's strip mode discards a field the backend sends with no error at all, and a nullable the mirror does not declare throws `APIMalformedDataError` on a public page |

## 11. Violation → remedy

The symptom-first index, for the reader who has the bug and does not yet know the cause. Several rows
are behaviour that is deliberate — those are the ones that save the most time.

| Symptom                                                     | Cause                                                                     | Remedy                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| An admin edit saves, but the list still shows the old data  | The entry carries only base tags, and only a granular tag was invalidated | I2 — the base `updateTag`s must stay unconditional                          |
| A page never refreshes after a season is edited             | A `saisons` write has to clear four tag families, not one                 | I17 — check `AFFECTED_TAGS` still lists `spiele`, `spieltage` and `teams`   |
| A field the admin form sends never reaches the database     | The backend model does not declare it, and Pydantic drops it silently     | I3 — pass it as an action argument, never on the patch body                 |
| The image build fails on a page that builds locally         | A page fetches without `await connection()`; the builder has no backend   | I6 — add the guard before the fetch; it need not sit in the default export  |
| A dynamic route throws at request time but the build passed | A Server Component passes a render prop to a Client Component             | I13 — restore the `"use client"` directive. No gate catches this one        |
| `updateTag` throws inside a route handler                   | Wrong function for the context                                            | I14 — `revalidateTag` in route handlers, `updateTag` in server actions      |
| The three match cards look like duplication                 | Working as intended — they differ in chips, names and container (§6)      | Nothing. Extract shared derivation into `utils.ts` rather than merging them |
| A cache tag exists but nothing ever clears it               | A granular tag on a resource with no write surface                        | I1 — add the matching `updateTag` in the same change, or delete the tag     |

## 12. Known-open

| #   | Item                                                                    | State                                                                                                                                                                                                                                                                                                                                    |
| --- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | `ausstehend` means `>= today` on the server and `> today` on the client | Open question of intent, not a filed bug. Tracked in [`docs/roadmap/open-items.md`](../roadmap/open-items.md)                                                                                                                                                                                                                            |
| —   | Pydantic and Zod models are hand-mirrored, no generation step           | Checked rather than generated ([ADR-0040](../_decisions/0040-the-zod-mirror-is-checked-against-the-published-document.md)): `fl_frontend/src/core/apiContract.test.ts` compares presence, required, nullable, type and enum members against the committed `fl_backend/openapi.json`. Patterns, lengths and messages stay each side's own |
| —   | No in-app sign-out                                                      | Session lifetime (8h) is the only revocation mechanism                                                                                                                                                                                                                                                                                   |
