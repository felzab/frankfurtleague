# Frontend — spec

**Verified against:** `df21894`, 2026-08-04
**Scope:** `fl_frontend/src/`

---

## 1. Slice inventory

Twelve slices. The column shows which optional modules each actually has.

| Slice            | queries | mutations | actions | schemas | Notes                                          |
| ---------------- | :-----: | :-------: | :-----: | :-----: | ---------------------------------------------- |
| `spiele`         |   ✅    |    ✅     |   ✅    |   ✅    | Owns the Spiel write path; `utils.ts` + tests  |
| `spielorte`      |   ✅    |    ✅     |   ✅    |   ✅    | Full CRUD; `utils.ts` + tests                  |
| `schiedsrichter` |   ✅    |    ✅     |   ✅    |   ✅    | Full CRUD                                      |
| `teams`          |   ✅    |     —     |    —    |   ✅    | `resolvers.ts`                                 |
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
belong in a shared cache.

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

## 3. Server actions

Seven admin actions plus one auth action. Every admin action begins with `getAdminSession()` and
returns an access-denied `FormState` rather than throwing.

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
directly in MongoDB is served stale for up to 24 hours.

`POST /api/revalidate` exists for that case. It accepts a **resource name from a fixed set of three**,
never a raw tag, authenticates with a bearer token compared in constant time, and clears every tag
whose content depends on that resource.

**A resource is not the same thing as a tag, and for `saisons` the difference matters.** A season edit
clears `saisons`, `spiele`, `spieltage` **and** `teams`, because a season decides which season an
omitted `saison_id` means (ADR-0002) and its `rules` score the league table `/teams` derives from the
matches (ADR-0026). Clearing only `saisons` would leave a rollover, or a change to the points scheme,
invisible on the public pages for a day. `spieler` and `spieltage` clear only themselves — neither is
season-resolved on the read path. The mapping is `AFFECTED_TAGS` in the route.

Three things about it are load-bearing:

- **It is unreachable from a browser**, because nginx routes `/api` to FastAPI and only `/api/auth` to
  Next. The only caller is inside the compose network. **Adding an nginx location for this path would
  publish it.**
- It must use `revalidateTag`, not `updateTag` — the latter throws in a Route Handler, because it
  exists for read-your-own-writes inside a Server Action.
- **`AFFECTED_TAGS` is the thing to update when a read starts depending on a new resource.** It is the
  only place that knows a `/teams` response is a function of the `saisons` document, and nothing fails
  loudly when it is wrong — the page just serves yesterday's answer.

## 6. Invariants

| #   | Invariant                                                                           | Enforced by                                                                             | Breaks how                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | Every granular cache tag has a matching `updateTag` in a server action              | review                                                                                  | The tag never invalidates; reads as coverage, is decoration                                                                                                |
| I2  | Base tags `spiele`/`teams` invalidate unconditionally on a match write              | `fl_frontend/src/features/spiele/actions.ts :: updateTag("spiele")`                     | The default read path's entries carry only base tags and go stale until expiry                                                                             |
| I3  | `saison_id` reaches the action as an argument, never on the patch body              | `spiele/actions.ts` signature                                                           | The backend model does not declare it; Pydantic drops it silently, leaving a dead field that looks load-bearing                                            |
| I4  | A failed season-id parse never fails the edit                                       | `fl_frontend/src/features/spiele/actions.ts :: FLSpielSchema.shape.saison_id.safeParse` | An admin's work rejected over a cache optimisation                                                                                                         |
| I5  | Write payloads compose from the read model's field schemas                          | `fl_frontend/src/features/spiele/schemas.ts :: FLPatchSpielDataPayloadSchema`           | Read and write shapes drift apart                                                                                                                          |
| I6  | `await connection()` precedes every page data fetch                                 | each page or its async child                                                            | `docker compose build` fails — the builder stage has no reachable backend                                                                                  |
| I7  | Every admin server action starts with `getAdminSession()`                           | all seven actions                                                                       | Unauthenticated mutation                                                                                                                                   |
| I8  | `getAdminSession()`'s return value must be checked                                  | naming only                                                                             | It neither throws nor redirects; calling it bare guards nothing                                                                                            |
| I9  | `core` imports neither `shared` nor `features`; `shared` does not import `features` | ESLint `no-restricted-imports`                                                          | Infrastructure gains a dependency on the app                                                                                                               |
| I10 | No barrel files                                                                     | review                                                                                  | Tree-shaking across the RSC boundary is defeated                                                                                                           |
| I11 | Named exports under `src/`, defaults only where Next.js requires                    | review                                                                                  | A filename/export mismatch becomes a silent rename instead of a compile error                                                                              |
| I12 | `AdminEditSpielDataForm` takes lookup lists as props, never `useAdmin()`            | props signature                                                                         | `spiele` would depend on `admin`, undoing the write-path move                                                                                              |
| I13 | Before deleting a `"use client"` directive, check for render props                  | review                                                                                  | A Server Component may not pass a function to a Client Component. Neither `tsc` nor `next build` catches it on a dynamic route — it throws at request time |
| I14 | `revalidateTag` in route handlers, `updateTag` in server actions                    | route/action split                                                                      | `updateTag` throws in a route handler                                                                                                                      |
| I15 | No nginx location for `/api/revalidate`                                             | `nginx/*.conf`                                                                          | An internal-only endpoint becomes internet-reachable                                                                                                       |
| I16 | The three `SpielCard` variants stay separate                                        | review                                                                                  | See §7                                                                                                                                                     |
| I17 | A `saisons` revalidation clears `spiele`, `spieltage` and `teams` too               | `AFFECTED_TAGS` in the route                                                            | A rollover or a change to the season's points scheme stays invisible on the public pages for a day, with nothing failing                                   |

## 7. Deliberate duplication: the three match cards

`SpielCard`, `SpielCardCompact` and `SpielCardUltraCompact` read as copy-paste and are not. They differ
in chip count (two, one, none), in full team names versus two-letter shorthands, and in the container
driving them — a grid, a vertical timeline, and a horizontal playoff bracket. No configuration flag
collapses them without producing a three-mode component, which is harder to read and change than three
single-mode ones. **Do not merge them.** (ADR-0007.)

Their genuinely shared code is already extracted: `formatSpielDisplay` in `spiele/utils.ts` returns the
three presentation values all of them need. That extraction was itself a bug fix — an unplayed match
rendered `"- : -"` in one card and `"-:-"` in the other two, on the same screen.

## 8. Environment

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
| `LOG_FORMAT`                                   | string                                               |

`SKIP_ENV_VALIDATION=true` bypasses the gate — used by the Docker builder stage, which has no real
environment.

The `AUTH_URL` https rule exists because `@auth/core` derives the session cookie's `Secure` flag from
that URL's protocol, so a stray `http://` value would ship an admin session cookie in plaintext. It is
gated on hostname rather than `NODE_ENV`, because the local stack runs the production image against
`http://localhost:3000`.

`AUTH_TRUST_HOST` is deliberately **not** declared: `@auth/core` reads `AUTH_URL` first in the same
chain, and `AUTH_URL` is mandatory, so the variable can never be reached.

## 9. Lint rules that encode a decision

| Rule                                                | Why it exists                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react/no-danger: error`                            | The enforced CSP keeps `'unsafe-inline'` on `script-src`, so it does not mitigate script injection. This does, at the only place injection could realistically enter                                                                                                                                                                                                                      |
| `better-tailwindcss/no-unknown-classes: error`      | The only check in the toolchain that can see a class name resolving to nothing. TypeScript, the Prettier plugin and the browser all accept an unresolvable utility in silence, and two such classes shipped                                                                                                                                                                               |
| `better-tailwindcss/no-concatenated-classes: error` | Partial cover for a real defect: a class string relying on a space _inside_ the string, which `prettier --write` trims, fusing classes together. **Know its limit** — it catches a literal abutting an interpolation but not two adjacent interpolations, which is the shape that actually shipped. The convention (put the separating space in the template literal) is what prevents it |
| `no-restricted-imports` on `core`/`shared`          | Layer boundaries, scoped deliberately narrowly — see the overview                                                                                                                                                                                                                                                                                                                         |
| `@typescript-eslint/consistent-type-imports`        | Type-only imports are erased; mixing them risks pulling runtime modules across the RSC boundary                                                                                                                                                                                                                                                                                           |

## 10. Testing

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

The seven test files cover pure functions only — schema validators, formatters, derivations. There are
no component tests and no end-to-end suite.

## 11. Known-open

| #    | Item                                                                    | State                                                               |
| ---- | ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| F1   | `ausstehend` means `>= today` on the server and `> today` on the client | Open question of intent, not a filed bug. See the ledger            |
| F2   | Pydantic and Zod models are hand-mirrored, no generation step           | Accepted. The main drift risk                                       |
| —    | No in-app sign-out                                                      | Session lifetime (8h) is the only revocation mechanism              |
| BE-9 | The `is_placeholder` "TBD" team affects bracket rendering               | Tracked in [`docs/roadmap/open-items.md`](../roadmap/open-items.md) |
