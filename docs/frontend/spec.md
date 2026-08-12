# Frontend — spec

**Verified against:** `d6dd386`, 2026-08-12\
**Scope:** `fl_frontend/src/`

| Section                                                                                               | Answers                                                |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [1.1 Slice inventory](#11-slice-inventory)                                                            | Which slices exist and which modules each holds        |
| [1.2 Cached reads](#12-cached-reads)                                                                  | What is cached, for how long, under which tags         |
| [1.3 Admin mutations](#13-admin-mutations)                                                            | Which writes exist and what each invalidates           |
| [1.4 The cache tag design](#14-the-cache-tag-design)                                                  | Why exactly two granular tags, and what may not be one |
| [1.5 Out-of-band invalidation](#15-out-of-band-invalidation)                                          | What a hand edit in MongoDB costs                      |
| [1.6 Deliberate duplication: the three match cards](#16-deliberate-duplication-the-three-match-cards) | Why three near-identical cards stay separate           |
| [1.7 Environment](#17-environment)                                                                    | Which variables are validated, and against what        |
| [1.8 Lint rules that encode a decision](#18-lint-rules-that-encode-a-decision)                        | Which lint rules are load-bearing                      |
| [1.9 The test suite](#19-the-test-suite)                                                              | What the runner is and what is covered                 |
| [1.10 The match editor's structural properties](#110-the-match-editors-structural-properties)         | Why the editor is built the way it is                  |
| [1.11 Adding a HeroUI component](#111-adding-a-heroui-component)                                      | What a new component needs beyond its TSX import       |
| [1.12 The copy rules](#112-the-copy-rules)                                                            | How the site addresses its reader, and where           |
| [1.13 Metadata and indexing](#113-metadata-and-indexing)                                              | What each route sets, and what an unset value claims   |
| [2. Invariants](#2-invariants)                                                                        | The rules that must hold, and how each one breaks      |
| [3. Violation → remedy](#3-violation--remedy)                                                         | A symptom, its cause, and what to do about it          |
| [4. Known-open](#4-known-open)                                                                        | The accepted gaps                                      |

---

## 1. Contract

### 1.1 Slice inventory

The Notes column lists everything a slice holds beyond the four columns and its `components/` folder.

| Slice            | queries | mutations | actions | schemas | Notes                                                                                                                                  |
| ---------------- | :-----: | :-------: | :-----: | :-----: | -------------------------------------------------------------------------------------------------------------------------------------- |
| `spiele`         |   ✅    |    ✅     |   ✅    |   ✅    | Owns the Spiel write path; `draftStatus.ts`, `facets.ts`, `resolvers.ts`, `types.ts`, `utils.ts`, tests                                |
| `spielorte`      |   ✅    |    ✅     |   ✅    |   ✅    | Full CRUD; `constants.ts`, `facets.ts`, `types.ts`, `utils.ts`, tests                                                                  |
| `schiedsrichter` |   ✅    |    ✅     |   ✅    |   ✅    | Full CRUD; `constants.ts`, `facets.ts`, `types.ts`                                                                                     |
| `teams`          |   ✅    |    ✅     |   ✅    |   ✅    | Full CRUD + season junction; `constants.ts`, `facets.ts`, `resolvers.ts`, `teamDraftStatus.ts`, `types.ts`, `utils.ts`, tests          |
| `saisons`        |   ✅    |    ✅     |   ✅    |   ✅    | Create, edit, rollover — no delete; `constants.ts`, `facets.ts`, `resolvers.ts`, `saisonDraftStatus.ts`, `types.ts`, `utils.ts`, tests |
| `spieler`        |   ✅    |    ✅     |   ✅    |   ✅    | Full CRUD + squad junction; `constants.ts`, `facets.ts`, `resolvers.ts`, `spielerDraftStatus.ts`, `types.ts`, `utils.ts`, tests        |
| `spieltage`      |   ✅    |    ✅     |   ✅    |   ✅    | Full CRUD; `constants.ts`, `facets.ts`, `types.ts`, `utils.ts`, tests                                                                  |
| `system`         |   ✅    |     —     |    —    |   ✅    | Read-only; nothing else                                                                                                                |
| `admin`          |   ✅    |     —     |    —    |    —    | Aggregator; `constants.ts`, `types.ts`, `utils.ts`, tests                                                                              |
| `auth`           |    —    |     —     |   ✅    |    —    | `handleSignIn` + `signOutAction`; nothing else                                                                                         |
| `dashboard`      |    —    |     —     |    —    |    —    | Components + `constants.ts`                                                                                                            |
| `meta`           |    —    |     —     |    —    |    —    | Components + `constants.ts`, `types.ts`                                                                                                |

`utils.ts`, `resolvers.ts` and `facets.ts` are sanctioned optional modules. `utils.ts` and
`resolvers.ts` exist separately from `queries.ts` because they hold non-caching code, and folding them
in would put pure functions inside a `"use cache"` module (ADR-0003). `facets.ts` is separate from
`constants.ts` because a facet carries a `read` function over the slice's row type — behaviour rather
than copy — and because module scope is load-bearing: `AdminCrudView`'s memo and the react-aria
collection behind it both key on the array's identity
(`fl_frontend/src/features/teams/facets.ts :: TEAM_FACETS`).

### 1.2 Cached reads

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

**Uncached, deliberately:** the admin-authed reads — `getAdminSpieleActionRequired`,
`getTeamMemberships` and `getSpielerMemberships`
([ADR-0009](../_decisions/0009-admin-scoped-reads-are-never-cached.md)). Admin-authorized data does not
belong in a shared cache, and `getAdminSpieleActionRequired`'s `bracket_faults` are derived per request
over the stored bracket ([ADR-0039](../_decisions/0039-a-bracket-fault-is-derived-on-demand.md)), so a
cached copy would be wrong the moment a document moved under it. None carries a cache tag either: a tag
only means something inside a cache scope. Each seeds the request's correlation scope, which a
`"use cache"` read cannot ([`docs/logging/spec.md`](../logging/spec.md#11-the-correlation-id)).

**The cost is one backend request per call site, not per page load.** `apiClient` bounds every call
with an `AbortController` timeout signal, and Next's `fetch` memoization opts out the moment a signal
is present, so a page reading the same data from more than one boundary pays for each. A create modal
beside its own list is the shape that does it, in `/admin/teams` as in `/admin/spieler`: a single page
view produces a backend line for each boundary that reads.

**`getSpiel` is `GET /spiele/{spiel_id}` and carries the base tag ALONE.** The match editor is addressed
by match id with no season in the URL
([ADR-0040](../_decisions/0040-a-form-that-outgrows-a-dialog-becomes-a-page.md)), so the season a
granular tag would name is what this read exists to supply — and a season tag would be wrong even where
one is available, because a match write resolves the whole bracket and rewrites fixtures the request
never named ([ADR-0034](../_decisions/0034-a-result-entry-resolves-the-whole-bracket.md)). The patch
action invalidates `spiele` unconditionally, so this entry cannot outlive an edit. It resolves `null`
for an unknown id, which the editor page turns into `notFound()`, and rethrows every other error. **The
404 → null conversion lives INSIDE the cached function**: a production build redacts an error thrown out
of a `"use cache"` scope to a digest-only `Error`, which a catch at the call site can never recognise.

**`getTeam` is `GET /teams/{team_id}` and is tagged exactly as `getTeams` is** — it reads the same
documents through the same derivation, so a result edit moves it too
([ADR-0027](../_decisions/0027-the-write-path-is-resource-first-in-a-second-router.md)). It resolves
`null` for an unknown id — or a club with no junction row for the requested season, since the join is
strict — for the same redaction reason as `getSpiel`, and the detail pages and the admin team editor
turn that null into `notFound()` or an absent membership.

**`getTeams` caches two tables per season, not one.** `statistik_scope` is part of the cache key
([ADR-0022](../_decisions/0022-the-league-table-counts-the-gruppenphase.md)): the Saisontabelle asks
for `gruppenphase` and a team's own page asks for `gesamt`, and those are separate entries. No
granular tag for it — the coarse `teams` tag clears both, which is right in both directions, since a
Gruppenphase result moves both tables and a playoff result moves only one.

**The grouped shape arrives already ranked, and nothing here re-sorts it.** The order is the
competition's tiebreak chain, whose last criterion is a head-to-head table the client never receives,
and the same ordering seeds the playoff bracket — so a second sort would let the table and the bracket
disagree about who finished second
([ADR-0035](../_decisions/0035-a-group-placing-is-ranked-by-one-chain-and-seeded-only-when-final.md)).
That response also carries `qualifiers_per_group`, which
`fl_frontend/src/features/teams/utils.ts :: computeQualifyingTeamIds` turns into the Saisontabelle's
marked rows.

### 1.3 Admin mutations

Every admin mutation is a server action that begins with `getAdminSession()` and returns an
access-denied `FormState` rather than throwing, and every one runs inside
`fl_frontend/src/shared/utils/adminMutation.ts :: runAdminMutation`, which seeds the correlation-id
request scope and converts a thrown API error into the `FormState` the caller toasts — without it a
409 (an ordinary create outcome, ADR-0025) crosses the server-action boundary redacted and replaces
the admin page with the error page ([`docs/logging/error-codes.md`](../logging/error-codes.md)).

**The route handlers are the four page-owned editors' undos — `POST /api/admin/spiele/undo`,
`POST /api/admin/teams/undo`, `POST /api/admin/spieler/undo` and `POST /api/admin/saisons/undo` — and
the boundary is the PATTERN rather than a count**
([ADR-0049](../_decisions/0049-every-page-owned-editors-undo-is-a-route-handler.md)). A server action
is the right primitive for an admin mutation and stays so for every other one; an undo is dispatched
from a route other than the one that raised it, which makes Next re-render the editor segment and
raise the E592 invariant mid-response. A fifth page-owned editor may have one; a dialog, a row
control or a bulk action may not. **Revert all four to server actions once Next fixes E592** — they
are enumerated here and in the ADR precisely so none is missed.

**The rollover is the one write on a page-owned editor with no undo**, and it is not an omission: it
changes what every public page shows to a visitor who named no season, for two seasons at once and
immediately, so there is no window in which it goes unnoticed. It confirms in place instead
([ADR-0050](../_decisions/0050-a-matchday-list-is-the-seasons-skeleton.md)).

| Action                          | Slice          | Invalidates                                                          |
| ------------------------------- | -------------- | -------------------------------------------------------------------- |
| `patchAdminSpielDataAction`     | spiele         | `spiele`, `teams`, + `spiele:saison_id:{id}`, `teams:saison_id:{id}` |
| `previewAdminSpielDataAction`   | spiele         | **nothing** — it writes nothing (`dry_run=true`)                     |
| `postSpielortAction`            | spielorte      | `spielorte`                                                          |
| `patchSpielortAction`           | spielorte      | `spielorte`, `spiele`                                                |
| `deleteSpielortAction`          | spielorte      | `spielorte`                                                          |
| `postSchiedsrichterAction`      | schiedsrichter | `schiedsrichter`                                                     |
| `patchSchiedsrichterAction`     | schiedsrichter | `schiedsrichter`, `spiele`                                           |
| `deleteSchiedsrichterAction`    | schiedsrichter | `schiedsrichter`                                                     |
| `postTeamAction`                | teams          | `teams`, + `teams:saison_id:{id}`                                    |
| `patchTeamAction`               | teams          | `teams`, `spiele`                                                    |
| `deleteTeamAction`              | teams          | `teams`                                                              |
| `reactivateTeamAction`          | teams          | `teams`                                                              |
| `postSaisonTeamAction`          | teams          | `teams`, + `teams:saison_id:{id}`                                    |
| `patchSaisonTeamAction`         | teams          | `spiele`, `teams`, + `spiele:saison_id:{id}`, `teams:saison_id:{id}` |
| `postSpielerAction`             | spieler        | `spieler`                                                            |
| `patchSpielerAction`            | spieler        | `spieler`                                                            |
| `deleteSpielerAction`           | spieler        | `spieler`                                                            |
| `reactivateSpielerAction`       | spieler        | `spieler`                                                            |
| `postSaisonSpielerAction`       | spieler        | `spieler`                                                            |
| `patchSaisonSpielerAction`      | spieler        | `spieler`                                                            |
| `deleteSaisonSpielerAction`     | spieler        | `spieler`                                                            |
| `reactivateSaisonSpielerAction` | spieler        | `spieler`                                                            |
| `postSaisonAction`              | saisons        | `saisons`                                                            |
| `patchSaisonAction`             | saisons        | `saisons`, `teams`                                                   |
| `activateSaisonAction`          | saisons        | `saisons`, `spiele`, `spieltage`, `teams`                            |
| `postSpieltagAction`            | spieltage      | `spieltage`                                                          |
| `patchSpieltagAction`           | spieltage      | `spieltage`                                                          |
| `deleteSpieltagAction`          | spieltage      | `spieltage`                                                          |
| `reactivateSpieltagAction`      | spieltage      | `spieltage`                                                          |
| `handleSignIn`                  | auth           | —                                                                    |
| `signOutAction`                 | auth           | —                                                                    |

The venue, referee and team patch actions also invalidate `spiele` because the backend fans a rename
out into every match document embedding it — so match data really has changed. The team patch stays on
base tags alone: a club is season-independent, so its rename touches every season's entries and no
granular tag names them all. `patchSaisonTeamAction` invalidates the `spiele` pair for a different
reason — no match document is written, but each side's `disqualifikation` is JOINED from the junction
row at read time ([`docs/backend/spec.md`](../backend/spec.md) I32), so the junction write changes
what `GET /spiele` returns for that season.

**Every spieler action invalidates the base tag alone**, and `spieler` is the whole set: a squad row
joins into no second resource, unlike the team junction whose `disqualifikation` reaches every match
([`docs/backend/spec.md`](../backend/spec.md) I32). Why no granular tag exists to add is §1.4.

**The two season actions invalidate different sets, and the difference is what each write can reach**
(I25). **Every spieltage action clears `spieltage` alone**: `GET /spiele` never joins `spieltage`, which
is the same fact that makes retiring a matchday safe for its matches.

The team create is **one action over two requests** — `POST /teams`, then
`POST /teams/{team_id}/saisons` — because every team read is season-scoped with a strict junction
join (I11 there): a club created without a junction row would be invisible to the very list the
create form sits on, with no surface left that could give it one. **The player create is the same
shape for the same reason**, `POST /spieler` then `POST /spieler/{spieler_id}/saisons`, and differs
in which seasons it offers: `active` and `future` both, because a squad is filled in during its
season. The chosen season's status decides `is_nachgetragen`, which the form derives rather than asks
(decided 2026-08-07).

**Season entry is offered only where the backend would take it.** The create form and the club
editor's Aufnehmen affordance offer only `future` seasons, and their group picker
(`fl_frontend/src/features/teams/components/forms/GruppeSelect.tsx :: offer`) shows each offered
group's fill state with full ones disabled — derived by
`fl_frontend/src/features/teams/utils.ts :: buildGruppeOffer` from the season's `rules` and the
memberships read. The junction write's four refusals (`REQ-ENTER-001..004`,
[`docs/logging/error-codes.md`](../logging/error-codes.md)) stay authoritative;
`fl_frontend/src/features/teams/actions.ts :: mapEntryRefusal` turns each into its German answer, on
the group field where the group is what was refused.

**Every mutation addresses its resource with the id in the PATH** — `PATCH /spielorte/{id}`,
`DELETE /schiedsrichter/{id}`, `PATCH /spiele/{spiel_id}`. There is no admin-prefixed route namespace,
and adding one would split a resource's writes from its reads
([ADR-0027](../_decisions/0027-the-write-path-is-resource-first-in-a-second-router.md)). The payload
schemas still carry `id`, because they back the admin forms, so each function in `mutations.ts` splits
it off before sending the body. **A backend payload model that saw an `id` would drop it silently**,
which is why the split is in one place per slice rather than at each call site.

**Every resource with write endpoints has an action calling them** — `spiele`, `teams`, `spieler`,
`spielorte`, `schiedsrichter`, `saisons` and `spieltage`, the last two through the pages
[ADR-0050](../_decisions/0050-a-matchday-list-is-the-seasons-skeleton.md) gives them. Two writes are
deliberately absent rather than unbuilt: there is no `DELETE /saisons/{id}`, because a season that is
over is `past` ([ADR-0026](../_decisions/0026-one-active-season-and-one-path-to-it.md)), and no action
writes `saisons.status` except `activateSaisonAction`, which reaches it only through the one endpoint
that may.

### 1.4 The cache tag design

Every resource has a frontend write surface. A granular tag is worth having only if **(a)** its
resource can be written from the app at all, and **(b)** a mutation changes some rows and not others
along that dimension. Test (b) is the one almost every candidate fails.

These satisfy both and exist:

| Tag                  | Why it earns its place                                                                                                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spiele:saison_id:*` | Editing one match in one season must not evict every other season's cached lists, and the patch action knows exactly which season it touched                                                                                                   |
| `teams:saison_id:*`  | The same edit changes that season's league table, which `/teams` derives from the matches — so team caches must go too, though no team document was written. The season-junction actions write exactly one season's membership and name it too |

**These shapes fail one of the two tests, and none of them may be added:**

- **No tag keys on a resource the app cannot write.** The system endpoints are the whole of that
  category: nothing writes them, so nothing could invalidate such a tag and it would stand until
  expiry whatever it was named.
- **No `saisons:`, `spieler:` or `spieltage:` season tag**, though all three have write surfaces.
  These fail (b) rather than (a): a season is not season-scoped data but IS the season, `getSaisons`
  reads every one of them in a single call, one spieler read spans every season while the public
  squad read is narrowed by team, and one matchday write moves both the season-scoped admin list and
  the public Spielplan's default-season entry.
- **No tag keys on a dimension the mutation itself changes** — `spiele:status:*` and `spiele:phase:*`
  are the shapes to refuse. Editing a result can move a match from pending to played, so correct
  invalidation needs both the old value and the new one, and the action holds only the new one. A tag
  that is right half the time is worse than no tag, because the wrong half is invisible.
- **No tag keys on a team dimension no mutation touches** — group, disqualification and similar. The
  only thing an app mutation changes about a team is its league table, and that is a result edit.
- **No tag keys on an argument its declaring query is never called with.** A tag on a parameter every
  call site leaves at its default names nothing that is ever cached under it.

**Base tags are not made redundant by the granular ones.** Because the default read path sends no
`saison_id` at all, the most frequently hit cache entries carry only `spiele` and `teams`. Invalidating
by season alone would leave exactly those entries stale, which is why both base tags are invalidated
unconditionally on every match write.

**Standing rule:** every granular tag added must ship with its matching `updateTag` call in the same
change (I1). That rule is what keeps the refused shapes above from being proposed back in.

### 1.5 Out-of-band invalidation

`saisons`, `spieler` and `spieltage` are cached for a day, so an edit made **directly in MongoDB** is
served stale until the cache expires — **at most 24 hours, and that bound is the whole mechanism**
([ADR-0028](../_decisions/0028-reference-data-staleness-is-bounded-by-cache-lifetime.md)). There is no
invalidation endpoint for these caches and none may be added.

Each of the three has an admin page that invalidates as it saves (`updateTag` inside the action,
[ADR-0001](../_decisions/0001-two-granular-cache-tags.md)), so an edit made through the app is visible at
once and only a hand edit goes around it — the symptom a hand edit produces, and its remedy, are
[`docs/ops/spec.md`](../ops/spec.md) §3.

To make an edit visible sooner, recreate the frontend container — the cache lives in its
filesystem, so recreation starts empty at the cost of every cached page, not three tags.

**A season edited by hand is the case where the daily bound costs the most**: a season decides which
season an omitted `saison_id` means (ADR-0002) and its `rules` score the league table `/teams` derives
from the matches (ADR-0019), so `saisons`, `spiele`, `spieltage` and `teams` all stay stale until their
entries expire or the container is recreated. I25 names what an action clears instead.

### 1.6 Deliberate duplication: the three match cards

`SpielCard`, `SpielCardCompact` and `SpielCardUltraCompact` read as copy-paste and are not. They differ
in chip count (two, one, none), in full team names versus two-letter shorthands, and in the container
driving them — a grid, a vertical timeline, and a horizontal playoff bracket. No configuration flag
collapses them without producing a three-mode component, which is harder to read and change than three
single-mode ones. **Do not merge them.** (ADR-0005.)

Their genuinely shared code is already extracted:
`fl_frontend/src/features/spiele/utils.ts :: formatSpielDisplay` returns the
four presentation values all of them need. That extraction was itself a bug fix — an unplayed match
rendered `"- : -"` in one card and `"-:-"` in the other two, on the same screen.

The fourth is a knockout's shoot-out, which **every card renders on its own line under the score and
never inside it** ([ADR-0036](../_decisions/0036-a-shoot-out-is-its-own-scoreline.md)): the fixture
finished level, the Saisontabelle counts it as a draw, and a card showing `4:3` where `2:2` belongs
would contradict the table about the same match.

### 1.7 Environment

Validated at startup by `@t3-oss/env-nextjs` (`fl_frontend/src/core/config.ts`). Failure prints **names only**, never
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
| `LOG_FORMAT`                                   | `json` \| `console`, case-normalised (ADR-0032)      |

`SKIP_ENV_VALIDATION=true` bypasses the gate — used by the Docker builder stage, which has no real
environment.

The `AUTH_URL` https rule exists because `@auth/core` derives the session cookie's `Secure` flag from
that URL's protocol, so a stray `http://` value would ship an admin session cookie in plaintext. It is
gated on hostname rather than `NODE_ENV`, because the local stack runs the production image against
`http://localhost:3000`.

`AUTH_TRUST_HOST` is deliberately **not** declared: `@auth/core` reads `AUTH_URL` first in the same
chain, and `AUTH_URL` is mandatory, so the variable can never be reached.

### 1.8 Lint rules that encode a decision

| Rule                                                | Why it exists                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react/no-danger: error`                            | The enforced CSP keeps `'unsafe-inline'` on `script-src`, so it does not mitigate script injection. This does, at the only place injection could realistically enter                                                                                                                                                                                                                      |
| `better-tailwindcss/no-unknown-classes: error`      | The only check in the toolchain that can see a class name resolving to nothing. TypeScript, the Prettier plugin and the browser all accept an unresolvable utility in silence, and two such classes shipped                                                                                                                                                                               |
| `better-tailwindcss/no-concatenated-classes: error` | Partial cover for a real defect: a class string relying on a space _inside_ the string, which `prettier --write` trims, fusing classes together. **Know its limit** — it catches a literal abutting an interpolation but not two adjacent interpolations, which is the shape that actually shipped. The convention (put the separating space in the template literal) is what prevents it |
| `no-restricted-imports` on `core`/`shared`          | Layer boundaries, scoped deliberately narrowly — see the overview                                                                                                                                                                                                                                                                                                                         |
| `@typescript-eslint/consistent-type-imports`        | Type-only imports are erased; mixing them risks pulling runtime modules across the RSC boundary                                                                                                                                                                                                                                                                                           |

### 1.9 The test suite

**Runner:** Node's built-in test runner — `node --test`, driven through `pnpm test`. There is no Vitest
or Jest, and no test config file. TypeScript path aliases are resolved by `tsconfig-alias-hook.mjs`,
loaded with `--import`.

**Tests sit next to the code they test** (`utils.ts` beside `utils.test.ts`), unlike the backend, whose
tests live in a separate `fl_backend/tests/` tree. Each side takes its own ecosystem's default: Node's
runner discovers `*.test.ts` anywhere in the tree and bundlers exclude `.test.` files by pattern, so
colocation needs no configuration and nothing ships; pytest keeps tests _outside_ the importable
package, where they cannot ship at all ([`docs/backend/spec.md`](../backend/spec.md) §1.6).

The test files cover pure functions only — schema validators, formatters, derivations, the log-line
format and the action error mapping ([`docs/logging/spec.md`](../logging/spec.md), invariants L1–L3 and L6).
There are no component tests and no end-to-end suite.

**One test is not a unit test.** `fl_frontend/src/core/apiContract.test.ts` reads the committed
`fl_backend/openapi.json` and compares every Zod schema against the component that publishes it
([ADR-0033](../_decisions/0033-the-zod-mirror-is-checked-against-the-published-document.md)). It
discovers the schema modules by walking the tree and imports them dynamically, so a new feature slice
is covered without an edit, and `core` gains no static import of `features` (I9).

### 1.10 The match editor's structural properties

Each is load-bearing and none is visible from any single component, which is why they are here rather
than left to be rediscovered.

#### The draft has exactly one derivation

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

#### The editor's subtree is keyed by the fixture's stored state

`fl_frontend/src/app/admin/spiele/[spiel_id]/page.tsx` keys `AdminSpielEditView` with
`fl_frontend/src/features/spiele/utils.ts :: spielStateKey`, which is the fixture id **plus the
payload the draft mirrors** — not the id alone.

Every field on the page is `useState` initialised from `spielData`, and an initialiser runs once per
mounted instance, so fresh props never re-seed a field. React's own answer is to reset with a `key`,
and the id covers only half the cases: two different fixtures differ by id, but the _same_ fixture
whose stored values changed does not. That second case is the undo's — a restored fixture reopened in
a still-mounted editor reads as un-restored until a reload, with the server sending correct data the
whole time.

The key is built from `toPatchPayload` — exactly the fields the draft mirrors — so it moves when
something the form displays has changed underneath it, and not when a field no draft atom holds
(`ergebnis`, `spiel_nr`) does; `fl_frontend/src/features/spiele/utils.test.ts` pins that case.
**Narrowing this key to `spiel.id` alone opens a bug the type checker cannot see.**

**The key is one of two gates, and neither is sufficient alone.** The other is that **both exits reset
the draft** — `resetDraftToStored` in `AdminEditSpielDataForm`, run by the discard AND by the save. The
key is what makes a reopened editor re-seed from data that changed while it was away. The reset is what
makes a _reused_ tree honest: a save followed by an undo lands on the key the tree was first mounted
with, because the undo restores the values the page opened on, so React reuses that tree and whatever is
left in its atoms is what the admin sees — the values they typed, on a fixture that does not hold them.
Neither the payload nor the key is wrong in that case; the state is. Measured, because each fix reads as
sufficient on its own.

#### The navigation guard has an accepted gap

Next 16 exposes **no navigation blocker** — verified against the `next/navigation` export list and
`AppRouterInstance`. What the page can intercept, it does:

| Leaving by                      | Guarded | How                                                    |
| ------------------------------- | :-----: | ------------------------------------------------------ |
| Reload, tab close, browser quit |   ✅    | `beforeunload`, in `useUnsavedChangesWarning`          |
| A link this page renders        |   ✅    | `<Link onNavigate>`                                    |
| Abbrechen, and the Zurück pill  |   ✅    | The form's own `requestLeave`, via a register-callback |
| The admin sidemenu's links      |   ❌    | Rendered by the layout, above this tree                |
| The browser's Back button       |   ❌    | `popstate` fires after the router has committed        |

**The gaps are accepted** rather than paid for, and the shape of the payment is recorded so the trade
can be re-taken rather than re-derived: a `NavigationGuardContext` in the admin layout, which every
intercept-able control consults before navigating and which this form registers its guard with. It is
not built, and the browser's Back button stays outside even then — nothing in the platform makes that
one interceptable. This is also why the header's Zurück pill earns its place beside the browser's own
back button: the pill routes through the discard guard and the button cannot.

### 1.11 Adding a HeroUI component

Importing the component in TSX is half the change. The other half, and **there are two stylesheets to
check, not one**: `fl_frontend/src/app/globals.css` loads everywhere,
`fl_frontend/src/app/admin/admin.css` loads only under `/admin`
([ADR-0016](../_decisions/0016-admin-only-css-split.md)).

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
   the parent is not** — that is why `close-button` and `list-box` sit in `globals.css`.
4. **Grep both files before you finish.** A component in neither renders unstyled; a component in both
   ships to visitors who never see it.
5. Verify in the browser, not by reading the diff. Computed styles are the evidence — a border-radius, a
   padding and a background that are not the browser defaults. For an `admin.css` entry that means
   signing in and opening the admin page, because no public route will show the mistake.

**Restyling one you already have: reach for the component's own composition API before a stylesheet.**
Several HeroUI components take a render function or per-slot `className`, and anything expressed that
way is type-checked, linted and covered by `better-tailwindcss/no-unknown-classes`. A
`.<component>__<slot>` rule in `globals.css` is none of those: those class names are vendored
implementation detail, and a release that renames one takes the styling with it and reports nothing
(I23). Where a stylesheet is genuinely the only route, **name the HeroUI version the rule was written
against at the rule**, so the next upgrade knows what to re-read.

### 1.12 The copy rules

**The reader is `Du` — informal, and capitalised everywhere** (my rule, 2026-08-04): `Du`, `Dein`,
`Dir`, `Dich`, and never `Sie` or `Ihr`. When auditing, a sentence-initial `Du` is capitalised whatever
the convention holds, so it is evidence of nothing.

**Scope: what a user reads.** Rendered strings, form and toast copy, and the sign-in emails in
`fl_frontend/src/core/authEmail.ts` are all in. German inside `/docs` and in code comments addresses
developers, not users, and is out — except where a comment quotes a rendered string, which tracks it.

**Refusal copy carries a second register on top of this**, declared at
`fl_frontend/src/shared/utils/adminMutation.ts :: VALIDATION_FAILED`: a FIELD message stays one sentence
about the value, and a FORM message is two with the action second. Field messages are the one place
"Bitte" stays ("Bitte gib einen Namen ein."): a field nudges toward input, a banner refuses it, and
softening a refusal blurs which of the two the reader is looking at.

**Nothing mechanical holds either rule.** A lint over the pronouns would have to know which string
literals are user-facing, and nothing in the tree marks that, so both rules hold by review.

### 1.13 Metadata and indexing

Every route sets its own `title`, `description` and canonical; `metadataBase` in the root layout is what
lets the canonicals be paths. The consequences worth knowing before editing metadata:

- **A route that sets no metadata inherits the root layout's, canonical included**, so an unset canonical
  claims to be the homepage rather than claiming nothing.
- **`openGraph` is inherited or replaced whole, never merged field-by-field**, so the root layout
  declares only the site-wide parts (`siteName`, `images`, `locale`, `type`) and og:title and
  og:description resolve from each page's own title and description.
- **No route ships a `keywords` array, and none is added for a new route.** Google has ignored the tag
  since 2009 and Bing reads an overstuffed one as a spam signal, so it is maintenance with no reader;
  ranking terms belong in the title and description.

## 2. Invariants

| #   | Invariant                                                                                                                                                                                                                                                                                                                           | Enforced by                                                                                                                                                                                                                                                        | Breaks how                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | Every granular cache tag has a matching `updateTag` in a server action                                                                                                                                                                                                                                                              | review                                                                                                                                                                                                                                                             | The tag never invalidates; reads as coverage, is decoration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| I2  | Base tags `spiele`/`teams` invalidate unconditionally on a match write                                                                                                                                                                                                                                                              | `fl_frontend/src/features/spiele/actions.ts :: updateTag("spiele")`                                                                                                                                                                                                | The default read path's entries carry only base tags and go stale until expiry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| I3  | `saison_id` reaches the action as an argument, never on the patch body                                                                                                                                                                                                                                                              | `fl_frontend/src/features/spiele/actions.ts` signature                                                                                                                                                                                                             | The backend model does not declare it; Pydantic drops it silently, leaving a dead field that looks load-bearing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| I4  | A failed season-id parse never fails the edit                                                                                                                                                                                                                                                                                       | `fl_frontend/src/features/spiele/actions.ts :: FLSpielSchema.shape.saison_id.safeParse`                                                                                                                                                                            | An admin's work rejected over a cache optimisation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| I5  | Write payloads compose from the read model's field schemas                                                                                                                                                                                                                                                                          | `fl_frontend/src/features/spiele/schemas.ts :: FLPatchSpielDataPayloadSchema`                                                                                                                                                                                      | Read and write shapes drift apart                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| I6  | `await connection()` precedes every page data fetch                                                                                                                                                                                                                                                                                 | each page or its async child                                                                                                                                                                                                                                       | `docker compose build` fails — the builder stage has no reachable backend                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| I7  | Every admin server action starts with `getAdminSession()`                                                                                                                                                                                                                                                                           | every action in §1.3's table, the read-only preview included                                                                                                                                                                                                       | Unauthenticated mutation — and, for the preview, an unauthenticated read of a season's bracket                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| I8  | `getAdminSession()`'s return value must be checked                                                                                                                                                                                                                                                                                  | naming only                                                                                                                                                                                                                                                        | It neither throws nor redirects; calling it bare guards nothing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| I9  | `core` imports neither `shared` nor `features`; `shared` does not import `features`                                                                                                                                                                                                                                                 | ESLint `no-restricted-imports`                                                                                                                                                                                                                                     | Infrastructure gains a dependency on the app                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| I10 | No barrel files                                                                                                                                                                                                                                                                                                                     | review                                                                                                                                                                                                                                                             | Tree-shaking across the RSC boundary is defeated                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| I11 | Named exports under `src/`, defaults only where Next.js requires                                                                                                                                                                                                                                                                    | review                                                                                                                                                                                                                                                             | A filename/export mismatch becomes a silent rename instead of a compile error                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| I12 | `AdminEditSpielDataForm` takes lookup lists as props, never `useAdmin()`; `AdminSpielEditView` is what supplies them                                                                                                                                                                                                                | props signature                                                                                                                                                                                                                                                    | `spiele` would depend on `admin`, undoing the write-path move                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| I13 | Before deleting a `"use client"` directive, check for render props                                                                                                                                                                                                                                                                  | review                                                                                                                                                                                                                                                             | A Server Component may not pass a function to a Client Component. Neither `tsc` nor `next build` catches it on a dynamic route — it throws at request time                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| I14 | `revalidateTag(tag, profile)` in route handlers, `updateTag(tag)` in server actions — the four undo handlers are the only route-handler callers, and each passes `{ expire: 0 }` because an undo tolerates no staleness                                                                                                             | route/action split                                                                                                                                                                                                                                                 | `updateTag` throws in a route handler                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| I15 | The three `SpielCard` variants stay separate ([ADR-0005](../_decisions/0005-three-spiel-cards-stay-separate.md))                                                                                                                                                                                                                    | review                                                                                                                                                                                                                                                             | A merged component carries three internal modes, so every change to it has to be reasoned about three times inside one file and a change made for one card reaches the other two (§1.6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| I16 | No invalidation endpoint for the reference caches (ADR-0028)                                                                                                                                                                                                                                                                        | absence under `fl_frontend/src/app/api/`                                                                                                                                                                                                                           | A second out-of-band mechanism carries a security posture and a tag mapping of its own, for a staleness bound the daily cache lifetime already holds at 24 hours                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| I17 | Every Zod schema agrees with the component that publishes it on presence, required, nullable, type and enum members                                                                                                                                                                                                                 | `fl_frontend/src/core/apiContract.test.ts` ([ADR-0033](../_decisions/0033-the-zod-mirror-is-checked-against-the-published-document.md))                                                                                                                            | Zod's strip mode discards a field the backend sends with no error at all, and a nullable the mirror does not declare throws `APIMalformedDataError` on a public page                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| I18 | Client-side field validation runs the schema the server action parses, never a second copy of the rules                                                                                                                                                                                                                             | `fl_frontend/src/shared/hooks/useDraftValidation.ts` ([ADR-0040](../_decisions/0040-a-form-that-outgrows-a-dialog-becomes-a-page.md))                                                                                                                              | The browser accepts a value the server rejects, or rejects one it accepts, and no test can see the two disagree                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| I19 | Client verdicts never write into `useServerFieldErrors`'s map                                                                                                                                                                                                                                                                       | `fl_frontend/src/shared/hooks/useDraftValidation.ts :: mergedWith`                                                                                                                                                                                                 | That hook calls `reportValidity()` on every change of its map, so clearing a corrected field on blur throws focus onto the next unfixed one mid-form                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| I20 | `deriveSpielDraftStatus` is the match editor's single contract: every marker, badge, list, count and guard reads it, and **no surface reads a draft field directly**                                                                                                                                                                | `fl_frontend/src/features/spiele/draftStatus.ts :: FIELD_DESCRIPTORS`, whose test requires a row per field of the draft shape ([ADR-0041](../_decisions/0041-a-voided-result-is-named-before-it-is-lost.md))                                                       | Adding a field stops being one descriptor row and becomes an edit to every surface that mentions it — and a surface that reads the draft directly is invisible to the derivation, so it silently keeps the old behaviour when the table changes. See §1.10                                                                                                                                                                                                                                                                                                                                                                                                                            |
| I21 | The navigation guard covers reload, tab close, and links this page renders — and nothing else                                                                                                                                                                                                                                       | `useUnsavedChangesWarning` (`beforeunload`) and `<Link onNavigate>`; the gap is accepted, see §1.10                                                                                                                                                                | Treating it as complete coverage. The admin sidemenu's links and the browser Back button cannot be intercepted at all, so a draft is lost through either with no prompt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| I22 | **A dynamic segment's page awaits `params` (and every runtime API) INSIDE a `<Suspense>` boundary, never at its own top level.** Every one does: `/admin/spiele/[spiel_id]`, `/admin/teams/[team_id]`, `/admin/spieler/[spieler_id]`, `/admin/saisons/[saison_id]`, `/dashboard/teams/[team_id]` and `/dashboard/spieler/[team_id]` | The page component is synchronous and renders `<Suspense><…Content {...props} /></Suspense>`; `next build` prints an App Shell sub-entry under each dynamic route, which is the visible signal it worked                                                           | `cacheComponents` builds an App Shell with FALLBACK params for a segment with no `generateStaticParams` (I28). A top-level await ties that shell to one URL, and Next then raises `Invariant: postponed state should not be provided when fallback params are provided` whenever a server action's `updateTag` revalidates the route from a DIFFERENT route. The action's response is truncated, the client reports "An unexpected response was received from the server", and the route keeps serving its stale payload — so a saved fixture reopens with its old values. Nothing in the toolchain catches it: it type-checks, lints, builds and renders correctly on a direct visit |
| I23 | **A toast is raised through `appToast`, and its appearance is built in `AppToaster`** — never `toast` from `@heroui/react` at a call site, and never a new `.toast*` rule in a stylesheet                                                                                                                                           | `fl_frontend/src/shared/utils/appToast.ts` and `fl_frontend/src/core/providers/AppToaster.tsx` ([ADR-0043](../_decisions/0043-a-toast-is-built-in-tsx-not-patched-in-css.md))                                                                                      | HeroUI applies a 4000 ms default to any toast that states no `timeout`, so a call site that bypasses `appToast` silently gets a clock sized for a one-word message — and a pending toast omitting it retires while its request is still running. Styling a toast from CSS instead reaches it through vendored selectors that an upgrade can rename with no error anywhere                                                                                                                                                                                                                                                                                                             |
| I24 | **The action-required page holds no client state: which section is on screen is `?section=`, read with `useSearchParams` and written with `window.history.replaceState`**                                                                                                                                                           | `fl_frontend/src/features/admin/components/views/AdminSpieleActionRequiredView.tsx :: SECTION_PARAM` ([ADR-0044](../_decisions/0044-a-triage-list-is-ordered-by-what-blocks-play.md))                                                                              | The App Router hides an admin route's tree with `<Activity>` rather than unmounting it, so a selection in `useState` — or inside an uncontrolled `Tabs` — survives a round trip to the editor and comes back describing the page as it was. It is §1.10's hazard on a second surface, and here there is no content key and no reset to be fixed by. `router.replace` is the other trap: this route's read is uncached (ADR-0009), so a router navigation re-reads the whole archive to change which already-loaded section is displayed                                                                                                                                               |
| I25 | **A season write invalidates every read its answer reaches, and the two writes reach different sets.** An edit clears `saisons` + `teams`; the rollover clears `saisons` + `spiele` + `spieltage` + `teams`                                                                                                                         | `fl_frontend/src/features/saisons/actions.ts :: invalidateSaisonAndTable` and `:: invalidateRollover` ([ADR-0050](../_decisions/0050-a-matchday-list-is-the-seasons-skeleton.md))                                                                                  | An omitted `saison_id` means the current season (ADR-0002), so a rollover changes what `/spiele`, `/spieltage` and `/teams` return to most public traffic — and none of those entries carries the promoted season's id, so no granular tag reaches them. Clearing `saisons` alone leaves the whole public site showing the previous season for a day                                                                                                                                                                                                                                                                                                                                  |
| I26 | **`saisons.status` reaches no payload, no draft atom and no descriptor row**                                                                                                                                                                                                                                                        | absence from every payload schema in `fl_frontend/src/features/saisons/schemas.ts` — the read model declares it — and from `fl_frontend/src/features/saisons/saisonDraftStatus.ts` ([ADR-0026](../_decisions/0026-one-active-season-and-one-path-to-it.md))        | Two seasons holding `active` is a state no validator and no index can express, so "exactly one" holds only because `POST /saisons/{id}/activate` is the sole writer. A `status` on the patch payload would put the invariant back where it was: maintained by whoever remembers the second call                                                                                                                                                                                                                                                                                                                                                                                       |
| I27 | **A matchday's order is the API's and no frontend surface re-sorts it.** The admin list sections by phase and renders a per-section ordinal counted from the received order; nothing stores or writes a position                                                                                                                    | `fl_frontend/src/app/admin/spieltage/page.tsx :: SpieltageList` counts the ordinal; `fl_frontend/src/features/spieltage/utils.ts :: orderRoundsByWiring` consumes the arrival order ([ADR-0051](../_decisions/0051-a-matchdays-position-is-derived-not-stored.md)) | The order is derived on the backend from `saison_phase` in bracket order, then `beginn`, then `_id` (ADR-0051: the label is composed FROM this order, so ordering by it would be circular). `orderRoundsByWiring` anchors its walk on the LAST round of the arrival order and `PlayoffsView` draws its columns from the result, so a second ordering on this side would mis-place every playoff column while looking correct on the admin list. The ordinal is presentation and must stay so: it is counted per render, so it cannot disagree with the arrangement it labels                                                                                                          |
| I28 | **No `generateStaticParams` on a dynamic segment**                                                                                                                                                                                                                                                                                  | absence in every dynamic segment (I22 lists them)                                                                                                                                                                                                                  | Independent failures, any one sufficient: it calls the API at build time, and the Docker builder stage has no reachable backend, so `APINetworkError` fails the image build (I6's constraint); the prerender set is `teams × seasons` and grows every season, forever; and the pages are `saison_id`-parameterised through `searchParams`, which `generateStaticParams` cannot enumerate — it produces route segments, not query strings, so even a successful prerender would cover one season of a page meant for any. `cacheLife("days")` on the reads already delivers most of the benefit                                                                                        |

## 3. Violation → remedy

| Symptom                                                                              | Cause                                                                                                                                                                          | Remedy                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| An admin edit saves, but the list still shows the old data                           | The entry carries only base tags, and only a granular tag was invalidated                                                                                                      | I2 — the base `updateTag`s must stay unconditional                                                                                                                                                                                                           |
| A page never refreshes after a rollover                                              | A rollover changes what an omitted `saison_id` resolves to, so it has to clear four tag families rather than one                                                               | I25 — `fl_frontend/src/features/saisons/actions.ts :: invalidateRollover` must clear `saisons`, `spiele`, `spieltage` and `teams`                                                                                                                            |
| A season's points change but the table still shows the old standings                 | The edit cleared `saisons` and not `teams`, and the table is scored from `rules` on every read (ADR-0019)                                                                      | I25 — `invalidateSaisonAndTable` clears both, unconditionally rather than by comparing what moved                                                                                                                                                            |
| A matchday list looks right and the playoff bracket's columns are in the wrong order | Something re-sorted the matchdays on this side, so `orderRoundsByWiring` anchored on the wrong round                                                                           | I27 — remove the sort; the order arrives correct from `order_spieltage` (ADR-0051)                                                                                                                                                                           |
| A matchday sits in the wrong place in the list                                       | Its `saison_phase` or its `beginn` is wrong — there is no position to correct                                                                                                  | Edit the phase or the date in the matchday dialog; the row moves on the next read                                                                                                                                                                            |
| A season is edited in Compass and the change never appears                           | A hand edit invalidates nothing; only an action does                                                                                                                           | I16 — accept the daily bound or recreate the containers; the backend caches seasons for ten minutes of its own ([ADR-0056](../_decisions/0056-the-season-document-is-cached-in-process.md)), so the frontend one alone is not enough (`docs/ops/spec.md` §3) |
| A field the admin form sends never reaches the database                              | The backend model does not declare it, and Pydantic drops it silently                                                                                                          | I3 — pass it as an action argument, never on the patch body                                                                                                                                                                                                  |
| The image build fails on a page that builds locally                                  | A page fetches without `await connection()`; the builder has no backend                                                                                                        | I6 — add the guard before the fetch; it need not sit in the default export                                                                                                                                                                                   |
| A dynamic route throws at request time but the build passed                          | A Server Component passes a render prop to a Client Component                                                                                                                  | I13 — restore the `"use client"` directive. No gate catches this one                                                                                                                                                                                         |
| `updateTag` throws inside a route handler                                            | Wrong function for the context                                                                                                                                                 | I14 — `revalidateTag` in route handlers, `updateTag` in server actions                                                                                                                                                                                       |
| The three match cards look like duplication                                          | Working as intended — they differ in chips, names and container (§1.6)                                                                                                         | Nothing. Extract shared derivation into `utils.ts` rather than merging them                                                                                                                                                                                  |
| A cache tag exists but nothing ever clears it                                        | A granular tag on a resource with no write surface                                                                                                                             | I1 — add the matching `updateTag` in the same change, or delete the tag                                                                                                                                                                                      |
| A server action fails with "An unexpected response was received from the server"     | Something answered its POST with a redirect, so the client read HTML where an RSC payload belongs                                                                              | `fl_frontend/src/proxy.ts` exempts any request carrying `next-action`; the action's own `getAdminSession()` refuses it instead                                                                                                                               |
| A server action writes, but the screen does not change                               | It was dispatched from a closure whose component has unmounted, so the router never applies its revalidation                                                                   | `updateTag` is required and NOT sufficient there — call `router.refresh()` when the result arrives (the undo toast)                                                                                                                                          |
| A white outline appears on a control that already rings                              | The base-layer focus rule painting over a HeroUI control                                                                                                                       | The unlayered opt-out in `globals.css` — HeroUI's own is `:not(:focus)`-gated and cannot fire on a focused element                                                                                                                                           |
| A focus indicator appears after a plain mouse press                                  | Working as intended — react-aria's focus-visible modality is global and survives an earlier key press                                                                          | Nothing. Opt the control out where its container already indicates focus, as the switch and the field groups do                                                                                                                                              |
| A toast disappears before it can be read, or a spinner retires mid-request           | The call site used HeroUI's `toast` directly, so it took the library's 4000 ms default                                                                                         | I23 — raise it through `appToast`, which derives the duration and gives `pending` `timeout: 0`                                                                                                                                                               |
| A toast renders unstyled or misaligned after a HeroUI upgrade                        | One of the two vendored selectors `globals.css` still owns was renamed — `.toast` or `.toast__close-button`                                                                    | Re-read `@heroui/styles/dist/components/toast.css`; the rules say which version they were written against (ADR-0043)                                                                                                                                         |
| A hover or press animation snaps instead of easing                                   | A hand-written `transition-[…]` names `transform`, but Tailwind v4 emits `scale-*`, `translate-*` and `rotate-*` as the standalone `scale` / `translate` / `rotate` properties | Name the property that actually changes. The `transition-transform` shorthand is safe — v4 expands it to all four — so only an arbitrary list is exposed                                                                                                     |

## 4. Known-open

| #   | Item                                                     | State                                                                                                                                                                                                                                                                                                                                                           |
| --- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —   | Pydantic and Zod models are hand-mirrored                | Accepted — checked rather than generated ([ADR-0033](../_decisions/0033-the-zod-mirror-is-checked-against-the-published-document.md)): `fl_frontend/src/core/apiContract.test.ts` compares presence, required, nullable, type and enum members against the committed `fl_backend/openapi.json`. Patterns, lengths and messages stay each side's own             |
| —   | Revocation is out of band, never the session lifetime    | Accepted — the admin's own sign-out is `fl_frontend/src/features/auth/actions.ts :: signOutAction`; an operator revokes by removing the address from `ALLOWED_ADMIN_EMAILS`, which the `session` callback re-reads on every request                                                                                                                             |
| —   | One admin stylesheet import styles nothing               | Open — `fl_frontend/src/app/admin/admin.css` imports `@heroui/styles/components/combo-box.css`, and nothing under `fl_frontend/src/` renders HeroUI's `ComboBox`: `Autocomplete` composes react-aria's own primitives instead, and that stylesheet declares only `.combo-box*` selectors. The cost is bytes on an admin route and never a public one (ADR-0016) |
| —   | Next injects a polyfill bundle `browserslist` cannot cut | Accepted — `next/dist/build/polyfills/polyfill-module.js` ships unconditionally, which is what PageSpeed reports under "Legacy JavaScript": 1,380 bytes measured 2026-08-09, against Lighthouse's estimated "14 KiB" in an audit that is unscored. No supported way to drop it exists, so the diagnostic is not worth chasing                                   |
