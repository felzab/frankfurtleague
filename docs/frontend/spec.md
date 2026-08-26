# Frontend — spec

**Verified against:** `1bee7a81`, 2026-08-26\
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
| [1.14 The shared editor surface](#114-the-shared-editor-surface)                                      | What every entity editor shares, and what a slice owns |
| [2. Invariants](#2-invariants)                                                                        | The rules that must hold                               |
| [3. Violation → remedy](#3-violation--remedy)                                                         | A symptom, its cause, and what to do about it          |
| [4. Known-open](#4-known-open)                                                                        | The accepted gaps                                      |

---

## 1. Contract

### 1.1 Slice inventory

The Notes column lists everything a slice holds beyond the four columns and its `components/` folder.

| Slice            | queries | mutations | actions | schemas | Notes                                                                                                                                                                                                                                                      |
| ---------------- | :-----: | :-------: | :-----: | :-----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spiele`         |   ✅    |    ✅     |   ✅    |   ✅    | Owns the Spiel write path; `constants.ts`, `draftStatus.ts`, `facets.ts`, `resolvers.ts`, `types.ts`, `utils.ts`, tests                                                                                                                                    |
| `spielorte`      |   ✅    |    ✅     |   ✅    |   ✅    | Full CRUD; `constants.ts`, `facets.ts`, `resolvers.ts`, `spielortDraftStatus.ts`, `types.ts`, `utils.ts`, tests                                                                                                                                            |
| `schiedsrichter` |   ✅    |    ✅     |   ✅    |   ✅    | Full CRUD; `constants.ts`, `facets.ts`, `resolvers.ts`, `schiedsrichterDraftStatus.ts`, `types.ts`, tests                                                                                                                                                  |
| `teams`          |   ✅    |    ✅     |   ✅    |   ✅    | Full CRUD + season junction; `constants.ts`, `facets.ts`, `resolvers.ts`, `teamDraftStatus.ts`, `types.ts`, `utils.ts`, tests                                                                                                                              |
| `saisons`        |   ✅    |    ✅     |   ✅    |   ✅    | Create, edit, rollover, group swap, the Spielplan draw and its undraw — no delete, and the draw's `replace` is sent where the season already holds one; `constants.ts`, `facets.ts`, `resolvers.ts`, `saisonDraftStatus.ts`, `types.ts`, `utils.ts`, tests |
| `spieler`        |   ✅    |    ✅     |   ✅    |   ✅    | Full CRUD + squad junction; `constants.ts`, `facets.ts`, `resolvers.ts`, `shorthandChip.ts`, `spielerDraftStatus.ts`, `types.ts`, `utils.ts`, tests                                                                                                        |
| `spieltage`      |   ✅    |    ✅     |   ✅    |   ✅    | Re-dating alone — the `saisons` draw creates them, and a replace or an undraw of that draw removes them; `constants.ts`, `facets.ts`, `resolvers.ts`, `spieltagDraftStatus.ts`, `types.ts`, `utils.ts`, tests                                              |
| `aktionen`       |   ✅    |     —     |    —    |   ✅    | Read-only; the action log is written by the backend on every admin write, never from here; `constants.ts`, `facets.ts`, `types.ts`, `utils.ts`, tests                                                                                                      |
| `system`         |   ✅    |     —     |    —    |   ✅    | Read-only; nothing else                                                                                                                                                                                                                                    |
| `admin`          |   ✅    |     —     |    —    |    —    | Aggregator; `constants.ts`, `types.ts`, `utils.ts`, tests                                                                                                                                                                                                  |
| `auth`           |    —    |     —     |   ✅    |    —    | `handleSignIn` + `signOutAction`; nothing else                                                                                                                                                                                                             |
| `dashboard`      |    —    |     —     |    —    |    —    | Components + `constants.ts`                                                                                                                                                                                                                                |
| `meta`           |    —    |     —     |    —    |    —    | Components + `constants.ts`, `types.ts`                                                                                                                                                                                                                    |

`utils.ts`, `resolvers.ts` and `facets.ts` are sanctioned optional modules. `utils.ts` and
`resolvers.ts` exist separately from `queries.ts` because they hold non-caching code, and folding them
in would put pure functions inside a `"use cache"` module. `facets.ts` is separate from
`constants.ts` because a facet carries a `read` function over the slice's row type — behaviour rather
than copy — and because module scope is load-bearing: `AdminCrudView`'s memo and the react-aria
collection behind it both key on the array's identity
(`fl_frontend/src/features/teams/facets.ts :: TEAM_FACETS`). A slice declares every dimension its pages
offer and no subset beside it: a filter control draws a pill for a dimension somebody chose to filter by
and nothing for the rest, so which of them a page would rather show is a question no surface has to
answer.

### 1.2 Cached reads

| Function                                       | Slice     | Lifetime  | Tags                                             |
| ---------------------------------------------- | --------- | --------- | ------------------------------------------------ |
| `getSpiele`                                    | spiele    | `hours`   | `spiele` + `spiele:saison_id:{id}` when filtered |
| `getTeams`                                     | teams     | `days`    | `teams` + `teams:saison_id:{id}` when filtered   |
| `getTeam`                                      | teams     | `days`    | `teams` + `teams:saison_id:{id}` when filtered   |
| `getSaisons`                                   | saisons   | `days`    | `saisons`                                        |
| `getCurrentSaison`                             | saisons   | `days`    | `saisons`                                        |
| `getSpieler`                                   | spieler   | `days`    | `spieler`                                        |
| `getSpieltage`                                 | spieltage | `days`    | `spieltage`                                      |
| `checkIsLive`, `checkIsReady`, `getSystemInfo` | system    | `minutes` | `system`                                         |

**Uncached, deliberately: every admin-tier read** — `getAdminSaisons`, `getAdminTeams`,
`getTeamMemberships`, `getAdminSpiele`, `getAdminSpiel`, `getAdminSpieleActionRequired`,
`getAdminSpieltage`, `getAdminSpieltagById`, `getSpielerMemberships`, `getSpielorte`,
`getSchiedsrichter` and `getAktionen`. **The tier settles it on its own: `"use cache"` keys on the
arguments rather than on caller identity, so one shared entry would be a slot of admin-authorized data
any caller could reach.** A reason of their own stands behind `getAdminSpieleActionRequired`, whose
`bracket_faults` are derived per request over the stored bracket, so a cached copy would be wrong the
moment a document moved under it, and behind `getAktionen`, whose rows carry the documents a write
replaced or removed — one entry holding data from every collection at once. None carries a cache tag either: a tag
only means something inside a cache scope. Each seeds the request's correlation scope, which a
`"use cache"` read cannot ([`docs/logging/spec.md`](../logging/spec.md#11-the-correlation-id)).

**A page reading one of them from more than one boundary shares a single round trip, and that
sharing is NOT the data cache.** `fl_frontend/src/core/api.ts :: apiClient` bounds every call with an
`AbortController` timeout signal, and Next's own `fetch` memoization opts out the moment a signal is
present, so nothing dedupes such a read by default: a create modal beside its own list would pay a
backend request for each, which is the shape `/admin/teams` and `/admin/spieler` have. React's `cache`
supplies the dedupe instead. It holds the in-flight promise for the length of ONE request and shares it
across that request's boundaries alone, so no later request can reach it and the confinement above
stands intact, where `"use cache"` would hand every caller the same stored entry. **A memo
over a FILTERED read keys on the filters serialized**, in a `cache()`-scoped `Map` —
`fl_frontend/src/features/spiele/queries.ts :: getAdminSpiele`, `getAdminTeams` and `getAdminSpieltage`
each hold one — because React's `cache` compares an argument by identity, so an object literal written
at a call site would miss every time and memoize nothing.

**`getAdminSpiel` is `GET /spiele/{spiel_id}/admin`, and it is one of the uncached reads above.** It
serves the rent and the referee's Entschädigung, and it is the only fixture read that carries either —
the base-tier reads answer a fixture shape without them
([`docs/backend/spec.md`](../backend/spec.md#11-endpoint-inventory)). It is admin-tier, so it is
uncached for the reason the class above gives. Nothing is given up by that: the match editor is
addressed by match id with no season in the URL, so a granular season tag has nothing to key on, and a
season tag would be wrong even where one is available, because a match write resolves the whole bracket
and rewrites fixtures the request never named. What staying uncached adds on top of that confinement is
freshness: the editor seeds from the fixture as it stands, so a save cannot write back a copy that went
stale in a cache. **The withholding is a response model per endpoint, never a projection per caller:**
each endpoint names the model it answers, and a shape declared that way is one a Zod mirror can be held
to (I17) — where an endpoint narrowing its response by the credential would answer a shape its own
published component never states. It resolves `null` for an unknown id,
which the editor page turns into `notFound()`, and rethrows every other error.

**A cached read that answers `null` for an unknown id converts the 404 INSIDE the cached function.** A
production build redacts an error thrown out of a `"use cache"` scope to a digest-only `Error`, which a
catch at the call site can never recognise, so `getTeam` catches its own 404 where the directive can
still see it. The uncached reads that resolve `null` the same way — `getAdminSpiel` and
`getAdminSpieltagById` — are under no such constraint, and catch where they do only because that is
where the id is known.

**`getTeam` is `GET /teams/{team_id}` and is tagged exactly as `getTeams` is** — it reads the same
documents through the same derivation, so a result edit moves it too. It resolves
`null` for an unknown id — or a club with no junction row for the requested season, since the join is
strict and the club's name for that season lives on the row that is missing
([`docs/backend/spec.md`](../backend/spec.md) I11) — and the detail pages and the admin team editor
turn that null into `notFound()` or an absent membership.

**`getTeams` caches two tables per season, not one.** `statistik_scope` is part of the cache key:
the Saisontabelle asks for `gruppenphase` and a team's own page asks for `gesamt`, and those are
separate entries. No granular tag for it — the coarse `teams` tag clears both, which is right in
both directions, since a Gruppenphase result moves both tables and a playoff result moves only one.

**The grouped shape arrives already ranked, and nothing here re-sorts it.** The order is the
competition's tiebreak chain, which includes a head-to-head table the client never receives,
and the same ordering seeds the playoff bracket — so a second sort would let the table and the bracket
disagree about who finished second.
That response also carries `qualifiers_per_group`, which
`fl_frontend/src/features/teams/utils.ts :: computeQualifyingTeamIds` turns into the Saisontabelle's
marked rows.

### 1.3 Admin mutations

Every admin mutation is a server action that begins with `getAdminSession()` and returns an
access-denied `FormState` rather than throwing, and every one runs inside
`fl_frontend/src/shared/utils/adminMutation.ts :: runAdminMutation`, which seeds the correlation-id
request scope and converts a thrown API error into the `FormState` the caller toasts — without it a
409 (an ordinary create outcome) crosses the server-action boundary redacted and replaces
the admin page with the error page ([`docs/logging/error-codes.md`](../logging/error-codes.md)).

**That `getAdminSession()` call is also what makes the write attributable.** It records the session's address
in the same request scope `runAdminMutation` has just seeded, and `apiClient` reads it from there and sends it
as `X-FL-Actor` on admin-tier calls alone — so the ordering is load-bearing rather than stylistic. A write
reaching the backend without it comes back 401 rather than landing unattributed
([`docs/backend/spec.md`](../backend/spec.md) I41).

**The route handlers are the seven page-owned editors' undos — `POST /api/admin/spiele/undo`,
`POST /api/admin/teams/undo`, `POST /api/admin/spieler/undo`, `POST /api/admin/saisons/undo`,
`POST /api/admin/schiedsrichter/undo`, `POST /api/admin/spielorte/undo` and
`POST /api/admin/spieltage/undo` — and the boundary is the PATTERN rather than a count**. A server
action is the right primitive for an admin mutation and stays so for every other one; an undo is
dispatched from a route other than the one that raised it, which makes Next re-render the editor
segment and raise the E592 invariant mid-response. An eighth page-owned editor may have one; a
dialog, a row control or a bulk action may not. **Revert all seven to server actions once Next fixes
E592** — they are enumerated here precisely so none is missed. Every configuration lever around E592
is closed: `dynamic = "force-dynamic"` build-errors under `cacheComponents`, 16.3 offers no
per-route PPR opt-out, `generateStaticParams` leaves fallback params on unlisted ids regardless,
disabling `cacheComponents` would take every cached read in §1.2 with it, and uncaching the read
shipped and was disproven by retest — 16.3.0 and 16.3.1-canary.4 both still reproduce it.

**The matchday undo is the one that can be refused on the way back**, and it answers in German rather
than as a bare failure. It is an ordinary `PATCH` and meets the rules the save met, so a span another
tab has since narrowed comes back as a refusal instead of a restore — which is correct, and the toast
reports the change as still standing.

**Where a page-owned editor's write has no undo, the absence is never an omission.** The rollover
changes what every public page shows to a visitor who named no season, for two seasons at once and
immediately, so there is no window in which it goes unnoticed. It confirms in place instead. There is
also nothing for an undo to call — re-activating the season the rollover demoted is refused
(`REQ-ACTIVATE-002`) and no endpoint demotes one — so its panel closes the control for that target as
it does for an unfinished incumbent, and `activateSaisonAction` answers each refusal in its own words
for the stale page that reaches the write anyway.

**The draw is destructive rather than reversible**:
`POST /saisons/{saison_id}/spielplan` refuses a season that already carries fixtures
(`REQ-SPIELPLAN-001`) unless the request confirms a REPLACE, and `/spiele` has neither a create nor
a delete, so nothing exists for an undo to call — a replaced draw's rows are gone and there is no
endpoint to write them back. A replace is held to a `future` season with nothing recorded against any fixture
(`REQ-SPIELPLAN-005`), and RECORDED is defined once, in
[`docs/backend/spec.md`](../backend/spec.md) I46 — a date and a kickoff time alone excepted, being
what a replace exists to redo. **This side judges that window itself, from a hand-written mirror**:
`fl_frontend/src/features/saisons/utils.ts :: holdsARecordedFact` answers it per fixture against
`fl_backend/app/api/saisons/services.py :: holds_a_recorded_fact`, and
`fl_frontend/src/features/saisons/constants.ts :: RECORDED_FACTS_NONE` and `:: RECORDED_FACTS_ANY`
are the German for its two polarities, so no panel, hint or refusal message spells the window twice.
So what a replace destroys is a schedule
nobody has played and nobody has touched since the draw wrote it, and the action log keeps
an image of every removed document ([`docs/backend/spec.md`](../backend/spec.md) I48) — which is a record for a person to
read, never a restore this app can offer. `FormSpielplanSection` confirms in place behind a
two-press escalation that shows the rules and the shape they produce, which is the same answer the
rollover gives to the same problem. **That escalation sends the `replace` where the season already holds a draw**, and the flag is
decided from the same input as the sentence beside it, so what an admin agrees to and what the
request asks for cannot come apart.
`fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/blockedReasons.ts :: spielplanBlockedReason`
closes the panel outside `REQ-SPIELPLAN-005`'s window rather than on any drawn season, and the armed
state names the matchdays and fixtures the press removes. No undo stands behind it: the rows are
gone and `/spiele` has no create to replay them into. **The three shape rules move with the draw
rather than in the rules panel**: `REQ-RULES-011` freezes them once fixtures exist, and
`FormRegelnSection` locks all three on a drawn season. `qualifiers_per_group` rides on the draw's own
payload, so a redraw carries it in one step. `number_of_groups` and `teams_per_group` are functions of
which clubs stand in the season, and `REQ-SPIELPLAN-004` asks every offered group for exactly
`teams_per_group`, so after a legal draw no club can be entered and a redraw asking for a different
group shape is refused for the groups then off their size. Their repair is the undraw below.

**The undraw reopens the two the replace cannot move**:
`DELETE /saisons/{saison_id}/spielplan` returns the season to undrawn, where the patch and the entry
endpoints both open again, so undraw, fix the rules, enter the clubs, draw again is the loop a wrong
group shape is repaired by. It runs in the replace's own window (`REQ-SPIELPLAN-006`) and is judged on
the operation rather than on what there is to remove, so a season already undrawn is answered with
zeros rather than refused, and `FormSpielplanRuecknahmeSection` grades that answer as `info`. No undo
stands behind it either, for the same reason the replace has none.

**The group swap also confirms in place, for a different reason: it is its own inverse**. Running it
again on the same pair restores the season, so a fifteen-second window and a route handler of its
own would be machinery for a reversal the control states in a sentence.

**That swap has two entry points and one write**: the season editor's panel,
which asks for both clubs and is the operation's home, and the club editor's single picker beneath the
locked Gruppe row, which fixes that page's club as one side. Both call `swapGruppenAction`, and both
grade a pair through `fl_frontend/src/features/saisons/utils.ts :: findSwapPartnerRefusal`, so neither
can offer a pair the other refuses.

| Action                           | Slice          | Invalidates                                                                                         |
| -------------------------------- | -------------- | --------------------------------------------------------------------------------------------------- |
| `patchAdminSpielDataAction`      | spiele         | `spiele`, `teams`, + `spiele:saison_id:{id}`, `teams:saison_id:{id}`                                |
| `previewAdminSpielDataAction`    | spiele         | **nothing** — it writes nothing (`dry_run=true`)                                                    |
| `readAdminSpielBookingsAction`   | spiele         | **nothing** — it reads the bookings a save moved, so the undo can restore each one whole            |
| `postSpielortAction`             | spielorte      | **nothing** — no cached read holds a venue                                                          |
| `patchSpielortAction`            | spielorte      | `spiele`                                                                                            |
| `deleteSpielortAction`           | spielorte      | **nothing**                                                                                         |
| `reactivateSpielortAction`       | spielorte      | **nothing**                                                                                         |
| `postSchiedsrichterAction`       | schiedsrichter | **nothing** — no cached read holds a referee                                                        |
| `patchSchiedsrichterAction`      | schiedsrichter | `spiele`                                                                                            |
| `deleteSchiedsrichterAction`     | schiedsrichter | **nothing**                                                                                         |
| `reactivateSchiedsrichterAction` | schiedsrichter | **nothing**                                                                                         |
| `anonymiseSchiedsrichterAction`  | schiedsrichter | **nothing** — the referee list is uncached, a fixture embeds only the name, and the log is uncached |
| `postTeamAction`                 | teams          | `teams`, + `teams:saison_id:{id}`                                                                   |
| `patchTeamAction`                | teams          | `teams`, `spiele`                                                                                   |
| `deleteTeamAction`               | teams          | `teams`                                                                                             |
| `reactivateTeamAction`           | teams          | `teams`                                                                                             |
| `postSaisonTeamAction`           | teams          | `teams`, + `teams:saison_id:{id}`                                                                   |
| `patchSaisonTeamAction`          | teams          | `spiele`, `teams`, + `spiele:saison_id:{id}`, `teams:saison_id:{id}`                                |
| `replaceSaisonTeamAction`        | teams          | `spiele`, `teams`, `spieler`, + `spiele:saison_id:{id}`, `teams:saison_id:{id}`                     |
| `postSpielerAction`              | spieler        | `spieler`                                                                                           |
| `patchSpielerAction`             | spieler        | `spieler`                                                                                           |
| `deleteSpielerAction`            | spieler        | `spieler`                                                                                           |
| `eraseSpielerAction`             | spieler        | `spieler`                                                                                           |
| `reactivateSpielerAction`        | spieler        | `spieler`                                                                                           |
| `postSaisonSpielerAction`        | spieler        | `spieler`                                                                                           |
| `patchSaisonSpielerAction`       | spieler        | `spieler`                                                                                           |
| `deleteSaisonSpielerAction`      | spieler        | `spieler`                                                                                           |
| `reactivateSaisonSpielerAction`  | spieler        | `spieler`                                                                                           |
| `postSaisonAction`               | saisons        | `saisons`                                                                                           |
| `patchSaisonAction`              | saisons        | `saisons`, `teams`                                                                                  |
| `activateSaisonAction`           | saisons        | `saisons`, `spiele`, `spieltage`, `teams`                                                           |
| `swapGruppenAction`              | saisons        | `teams`, `spiele`, + both `:saison_id:{id}`                                                         |
| `generateSpielplanAction`        | saisons        | `saisons`, `spieltage`, `spiele`, `teams`, + both `:saison_id:{id}`                                 |
| `undrawSpielplanAction`          | saisons        | `saisons`, `spieltage`, `spiele`, `teams`, + both `:saison_id:{id}`                                 |
| `patchSpieltagAction`            | spieltage      | `spieltage`                                                                                         |
| `handleSignIn`                   | auth           | —                                                                                                   |
| `signOutAction`                  | auth           | —                                                                                                   |

**The venue, referee and team patch actions invalidate `spiele` because the backend fans a rename out
into the match documents embedding it** — so match data really has changed. For the venue and the
referee that is the whole of what a write can reach: their own reads are admin-tier and uncached
(§1.2), so no entry exists for a create, a retirement or a reactivation to clear, and a retirement
moves `inactive_since` alone, which no match document carries. The team patch stays on
base tags alone: a club rename reaches its `saison_teams` rows and its matches in every season that is
not `past` ([`docs/backend/spec.md`](../backend/spec.md) I13), and the action holds no list of which
seasons those are, so no granular tag names them. `patchSaisonTeamAction` invalidates the `spiele` pair for a different
reason — no match document is written, but each side's `austritt` is JOINED from the junction
row at read time ([`docs/backend/spec.md`](../backend/spec.md) I32), so the junction write changes
what `GET /spiele` returns for that season.

**Every spieler action invalidates the base tag alone**, and `spieler` is the whole set: a squad row
joins into no second resource, unlike the team junction whose `austritt` reaches every match
([`docs/backend/spec.md`](../backend/spec.md) I32). Why no granular tag exists to add is §1.4.

**The season actions invalidate different sets, and the difference is what each write can reach**
(I25). **A matchday write clears `spieltage` alone**: `GET /spiele` never joins `spieltage`, so
re-dating a matchday changes no fixture a match read serves. The draw looks like the exception and is
not one — it is a season action, and it writes the fixtures and the season's own watermark beside the
matchdays, so it clears what those reach too.

The team create is **one action over two requests** — `POST /teams`, then
`POST /teams/{team_id}/saisons` — because every team read is season-scoped with a strict junction
join ([`docs/backend/spec.md`](../backend/spec.md) I11): a club created without a junction row would
be invisible to the very list the create form sits on, with no surface left that could give it one.
**The player create is the same
shape for the same reason**, `POST /spieler` then `POST /spieler/{spieler_id}/saisons`, and differs
in which seasons it offers: `active` and `future` both, because a squad is filled in during its
season. The chosen season's status decides `is_nachgetragen`, which the form derives rather than asks
(decided 2026-08-07).

**Season entry is offered only where the backend would take it.** The create form and the club
editor's Aufnehmen affordance offer only `future` seasons, and their group picker
(`fl_frontend/src/features/teams/components/forms/GruppeSelect.tsx :: offer`) shows each offered
group's fill state with full ones disabled — derived by
`fl_frontend/src/features/teams/utils.ts :: buildGruppeOffer` from the season's `rules` and the
memberships read. **A club that has left the LEAGUE is refused by every season and every group alike**
(`REQ-ENTER-005`), so the editor withholds the affordance entirely and says so in a banner rather than
greying each group in turn —
`fl_frontend/src/features/teams/components/forms/AdminTeamEditForm/banners.ts :: buildTeamBanners` grades that
closure ahead of the season's own. The junction write's refusals (`REQ-ENTER-001..005`,
[`docs/logging/error-codes.md`](../logging/error-codes.md)) stay authoritative;
`fl_frontend/src/features/teams/actions.ts :: mapEntryRefusal` turns each into its German answer, on
the group field where the group is what was refused.

**Every mutation addresses its resource with the id in the PATH** — `PATCH /spielorte/{id}`,
`DELETE /schiedsrichter/{id}`, `PATCH /spiele/{spiel_id}`. There is no admin-prefixed route namespace,
and adding one would split a resource's writes from its reads. The payload
schemas still carry `id`, because they back the admin forms, so each function in `mutations.ts` splits
it off before sending the body. **A backend payload model that saw an `id` refuses the whole body** (`fl_backend/tests/api/test_payload_strictness.py`),
which is why the split is in one place per slice rather than at each call site.

**Every resource with write endpoints has an action calling them** — `spiele`, `teams`, `spieler`,
`spielorte`, `schiedsrichter`, `saisons` and `spieltage`, every one of them now through a page-owned
editor. **The claim is per resource, and these of its writes are irreversible** — a pupil's erasure, a
referee's anonymisation, the replacement of a club on a season's junction row, the draw's `replace`
and the undraw beside it ([`docs/backend/spec.md`](../backend/spec.md#11-endpoint-inventory)). Each
destroys or hands on what nothing here can put back, so each confirms in place behind I37's shared
escalation and none offers an undo beside it. The other absences are
deliberate rather than unbuilt: there is no `DELETE /saisons/{id}`, because a season that is over is
`past`; no action writes `saisons.status` except `activateSaisonAction`, which reaches it only through
the one endpoint that may; and a matchday is drawn with its season and re-dated afterwards but never
retired, `spieltage` carrying no `inactive_since` to stamp.

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
- **No tag names a read that is not cached**, which is the mirror of that and reaches the admin-tier
  reads (§1.2). An `updateTag` on one clears nothing, and it reads at the call site as invalidation
  of data no entry ever held.
- **No `saisons:`, `spieler:` or `spieltage:` season tag**, though all three have write surfaces.
  These fail (b) rather than (a): a season is not season-scoped data but IS the season, `getSaisons`
  reads every one of them in a single call, one spieler read spans every season while the public
  squad read is narrowed by team, and one matchday write moves both the season-scoped admin list and
  the public Spielplan's default-season entry.
- **No tag keys on a dimension the mutation itself changes** — `spiele:status:*` and `spiele:phase:*`
  are the shapes to refuse. Editing a result can move a match from pending to played, so correct
  invalidation needs both the old value and the new one, and the action holds only the new one. A tag
  that is right half the time is worse than no tag, because the wrong half is invisible.
- **No tag keys on a team dimension a junction write moves** — group, the `austritt` record and similar. A
  club changes which value it sits under and `patchSaisonTeamAction` holds only the value it arrives at, so
  this is the bullet above on a second resource; the `teams:saison_id:*` entry that action already invalidates
  clears both sides of the move at once, a move never crossing a season.
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
served stale until the cache expires — **at most 24 hours, and that bound is the whole mechanism**.
There is no invalidation endpoint for these caches and none may be added.

Each of the three has an admin page that invalidates as it saves (`updateTag` inside the action), so
an edit made through the app is visible at once and only a hand edit goes around it — the symptom a
hand edit produces, and its remedy, are [`docs/ops/spec.md`](../ops/spec.md) §3. **A write sent straight to the
API leaves exactly the same staleness**, invalidation living in the action and not in the endpoint.
The sharpest case is a pupil's erasure: through the app the action clears the `spieler` tag as it
saves, while the same call made by hand leaves the person gone from the database and the cached read
still serving them.

To make an edit visible sooner, recreate the frontend container — the cache lives in its
filesystem, so recreation starts empty at the cost of every cached page, not three tags.

**A season edited by hand is the case where the daily bound costs the most**: a season decides which
season an omitted `saison_id` means and its `rules` score the league table `/teams` derives
from the matches, so `saisons`, `spiele`, `spieltage` and `teams` all stay stale until their
entries expire or the container is recreated. I25 names what an action clears instead.

### 1.6 Deliberate duplication: the three match cards

`SpielCard`, `SpielCardCompact` and `SpielCardUltraCompact` read as copy-paste and are not. They differ
in chip count (two, one, none), in full team names versus two-letter shorthands, and in the container
driving them — a grid, a vertical timeline, and a horizontal playoff bracket. No configuration flag
collapses them without producing a three-mode component, which is harder to read and change than three
single-mode ones. **Do not merge them.**

Their genuinely shared code is extracted rather than copied.
`fl_frontend/src/features/spiele/utils.ts :: formatSpielDisplay` derives the four presentation values
all of them need, and two atoms render them:
`fl_frontend/src/features/spiele/components/ui/SpielScore.tsx :: SpielScore` takes the score and the
shoot-out, and `fl_frontend/src/features/spiele/components/ui/SpielTeamSlot.tsx :: SpielTeamSlot` takes
a side and the text to show for it — the full name on the two wide cards, the shorthand on the bracket.
Beyond that text each card passes only its own wrapper classes. The first extraction was itself a bug
fix — an unplayed match rendered `"- : -"` in one card and `"-:-"` in the other two, on the same screen.

The fourth value is a knockout's shoot-out, which **every surface renders on its own line under the
score and never inside it** — `SpielScore` is the single component that decides that, the match
editor's draft preview included: the fixture finished level, the Saisontabelle counts it as a draw, and
a card showing `4:3` where `2:2` belongs would contradict the table about the same match.

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
| `LOG_FORMAT`                                   | `json` \| `console`, case-normalised                 |

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

Most test files cover pure functions — schema validators, formatters, derivations, the log-line
format and the action error mapping ([`docs/logging/spec.md`](../logging/spec.md), invariants L1–L3 and L6).
There are no component tests and no end-to-end suite.

**Several tests sweep the source tree rather than exercise a function** — that is how a rule no linter
can express is held, `fl_frontend/src/core/refusalPaths.test.ts` (I34) and
`fl_frontend/src/shared/components/ui/formSubmit.test.ts` (I32) among them.
`fl_frontend/src/core/refusalRegister.ts` is the one the slices' own tests read rather than run as a
sweep of its own. It parses `fl_backend/app/core/domain.py` at test time and answers which refusal
codes an operation declares, so each slice asserts its mapper covers the endpoint's own set rather
than a list somebody typed — matched as whole operation tokens, several operations being a prefix of
the one beside them. **A caller that ITERATES that answer asserts it first**, because a loop over an
operation the register no longer names runs zero times and proves nothing. The assertion is the whole
list where the codes are stable, and a floor on the count where one of them gets renumbered, which is
the matchday PATCH's case (`fl_frontend/src/features/spieltage/actions.test.ts`) — a restated list
would fail there for a renumbering that broke nothing.
`fl_frontend/src/core/refusalRegister.ts :: sliceBetween` is the second half of the
same guard, cutting one declaration out of a slice's own `actions.ts` so an assertion reads the arm
it names; each caller pins its cut before reading it, an unmatched boundary otherwise leaving an
empty slice that fails every later assertion for something that is not the defect.
`fl_frontend/src/core/apiContract.test.ts` reads the committed `fl_backend/openapi.json` and compares
every Zod schema against the component that publishes it, discovering the schema modules by walking the
tree and importing them dynamically — so a new feature slice is covered without an edit, and `core`
gains no static import of `features` (I9). A shape with no counterpart is exempted by name in that
file with the reason none can exist, and the exemptions are held to the same standard as the pairs:
one assertion fails on an entry whose shape is gone, or has since gained the counterpart it records as
impossible, and another on an exempted enum alias reaching no published use site — an alias exempted as
inlined is compared only through the sites that inline it, so members reaching none of them are compared
nowhere while the exemption still reads as covered.

**`fl_frontend/src/core/apiRequests.test.ts` compares that same document against the REQUESTS, where
`apiContract.test.ts` compares it against the shapes.** It resolves every `apiClient` call under `src/`
through the TypeScript checker, matched on the client's export symbol so a call site that renames it on
import is still seen. Each call's method and path shape must reach an operation `fl_backend/openapi.json`
publishes, a `${…}` hole matching only a `{param}` placeholder; every query parameter name the call sends
— written into the endpoint literal, or carried by the type passed as `params` — must be one that operation
declares; and every exported `*FilterParams` type under `features/*/types.ts` must reach some call. Every
`features/*/queries.ts` and `features/*/mutations.ts` must yield a call of its own, so renaming the client
cannot quietly empty the run (I36).

**It is there because a wrong request is the failure nothing else reports.** A path the backend does not
publish type-checks, lints, builds and passes every other test, and answers 404 only once someone opens the
page; an undeclared query parameter is not refused but dropped, so a filter renamed on one side alone
narrows nothing and the page still renders.

**It compares a query parameter's name and then what it may carry — required, primitive type, and enum
members — and widens I17 by nothing.** What the Zod mirror is checked on is unchanged and stays as I17
states it, deliberately, because that mirror is hand-written (§4). The two do not overlap: I17 iterates the
document's `components.schemas`, and a query parameter publishes inline under `paths`, so I17's comparison
never reaches one. Value comparison here needs a type to read, so it applies to a parameter carried by the
type passed as `params`, never to one written into the endpoint literal. **The required check is walked from
the operation's side rather than the mirror's**, because a parameter the server requires and the mirror
declares nowhere is one no property could be visited for, and every call would answer 422.

**It is blind to a request made with bare `fetch` instead of `apiClient`, to the runtime value inside a
`${…}` hole, which collapses to a placeholder before anything is compared, to a parameter written into the
endpoint literal, which carries no type to compare, and to a filter type that neither ends in
`FilterParams` nor is passed anywhere.** A path assembled outside the call expression is not on that list,
and neither is a published schema the reader cannot resolve to a type or a value set: each is reported and
fails the run, because a call the reader cannot read is a call nothing compares.

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
`fl_frontend/src/features/spiele/utils.ts :: spielStateKey`, which is the fixture id **plus every
value the editor seeds an atom from** — not the id alone.

Every field on the page is `useState` initialised from `spielData`, and an initialiser runs once per
mounted instance, so fresh props never re-seed a field. React's own answer is to reset with a `key`,
and the id covers only half the cases: two different fixtures differ by id, but the _same_ fixture
whose stored values changed does not. That second case is the undo's — a restored fixture reopened in
a still-mounted editor reads as un-restored until a reload, with the server sending correct data the
whole time.

The key is built from `fl_frontend/src/features/spiele/utils.ts :: toEditorSeed`, a **superset** of the
wire payload: the payload plus the display copies the panels render, which the server composes and
`:: toPatchPayload` therefore leaves behind. Without them a rename reaching this fixture would move
nothing the key can see, and a mounted picker would go on showing the old club. So the key moves when
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

#### The submit is a handler, never a form action

Every form whose fields are React state submits through
`fl_frontend/src/shared/components/ui/formSubmit.ts :: runOnSubmit` — `onSubmit` with
`preventDefault`. **Passing a function to a form's `action` instead discards the draft on every
submit**, and it does so in silence.

The chain is two library behaviours meeting. React treats a function `action` as a form action, and
`startHostTransition` in `react-dom` calls `requestFormReset` on the form fiber before it runs that
function; when the transition commits, `recursivelyResetForms` calls the DOM element's own `reset()`.
react-aria listens for exactly that event: `useFormReset` is called by `useTextField`, `useSelect`,
`useDateField`, `useNumberField`, `useToggle`, `useRadio` and `useComboBox`, and its handler runs
`onChange(props.defaultValue ?? initialValue)`, where `initialValue` is a `useState(value)` captured
at the field's first render. So every controlled field pushes its mount-time value back through the
editor's own setter, and the draft is replaced by what the page opened on.

**Both halves of the save-confirmation defect are that one chain.** The reset lands in the same commit
that opens `ConfirmSaveModal`, so the dialog renders against a draft that no longer differs from what
is stored — and because most Hinweise are derived from the draft (each `banners.ts` takes
`isNameChanged`, `isGruppeChanged`, `isPhaseChanged` and their siblings), the list it renders is empty
while the length that opened it was not: "0 Hinweise gelten für diesen Entwurf", over fields showing
their old values.

**Nothing in the toolchain sees it.** `action` is a valid prop, the types are satisfied, ESLint has no
rule for it and the build is clean; a save that succeeds navigates away before the emptied fields are
on screen, which is why the class stayed invisible until a dialog held the page open.

`fl_frontend/src/features/auth/components/forms/SignInForm.tsx` is the one form that keeps `action`,
correctly: its field is uncontrolled and read from `FormData` by a server action, so the reset is the
wanted behaviour rather than data loss. `fl_frontend/src/shared/components/ui/formSubmit.test.ts`
sweeps the tree and separates the two cases by whether the file holds either field-error hook.

#### The draft may hold what the wire refuses

`fl_frontend/src/features/spiele/draftStatus.ts :: FLSpielDraftFields` lets a Mietpreis, an
Entschädigung and a shoot-out count stand empty while the admin is typing, because `0` is a real value
for each of them: an empty box reading as `0` is a 0 € venue and a side that took its kicks and missed
every one. `FLPatchSpielDataPayload` allows none of them. **Two rules keep that gap off the wire, and
they answer different questions.**

**What the draft holds is narrowed by parsing, never by a cast.** `buildPayload` returns
`fl_frontend/src/features/spiele/schemas.ts :: FLPatchSpielDataPayloadDraft`, so the difference is a
type error at every point the wire payload is wanted, and `handleFormSubmit` parses
`FLPatchSpielDataPayloadSchema` before it sends — which turns a field still empty into a message on its
own path. A cast there satisfies the type checker while the value travels, so the class leaves no trace
until a save is refused.

**The rail's preview declares the same gap rather than casting it away.**
`fl_frontend/src/features/spiele/draftStatus.ts :: applyDraftToSpiel` answers "the fixture as it will
stand once saved" for a draft that is still being typed, so it returns
`fl_frontend/src/features/spiele/schemas.ts :: FLSpielWithDraftFields` — the stored-sides shape with
the two money fields still allowed to stand empty. Every reader of it asks whether the venue and the
referee are SET, never what either costs, so nothing is given up by saying so. A cast onto `FLSpiel`'s
shape instead launders a cleared Mietpreis into a type declaring a number, and the first surface to
format one renders it.

**A field whose inputs are conditional is retracted by that same condition.** A shoot-out describes a
knockout that finished level and nothing else, so
`fl_frontend/src/features/spiele/draftStatus.ts :: admitsShootOut`
drops the record — rather than each handler that can leave the shape: a goal edit that unlevels the
score, a side cleared, a count still being typed. Retracting handler by handler is retracting by memory,
and the miss is silent both ways: the record outlives its own inputs, the payload carries two nulls, and
the schema refuses the save with a message no rendered input can display. The atom keeps its counts, so
re-levelling the score brings them back.

**The one route the condition cannot see is the result toggle**, which unmounts the fields while leaving
the score level. That is the handler restoring the stored result, and the record goes back with the
goals — which is what the panel's own Hinweis already promises.

**The draft's other surplus is the display copies, and the same parse drops those too.** The pickers
render a club, a venue and a referee by name, so the draft holds each one's `name`, where
`FLPatchSpielDataPayloadSchema` composes from the payload halves —
`fl_frontend/src/features/spiele/schemas.ts :: FLSpielTeamFieldPayloadSchema` and its two siblings — which
declare no name at all, so zod's `strip` leaves every copy behind on the way to the wire. The server
composes them from the row each id names ([`docs/backend/spec.md`](../backend/spec.md) I3), so a copy
travelling back could only disagree with it. `mietpreis` and `payment` stay on the payload beside them,
being what this fixture agreed to pay rather than a copy of anything.

### 1.11 Adding a HeroUI component

Importing the component in TSX is half the change. The other half, and **there are two stylesheets to
check, not one**: `fl_frontend/src/app/globals.css` loads everywhere,
`fl_frontend/src/app/admin/admin.css` loads only under `/admin`.

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
5. **Its entrance and exit scale do not come with it.** Whatever `zoom-in-*` or
   `zoom-out-*` the vendored stylesheet declares is pinned to `1` document-wide, so the component
   arrives and leaves as a pure fade and nothing reports that it was overridden.
6. Verify in the browser, not by reading the diff. Computed styles are the evidence — a border-radius, a
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

**One German word per concept, and a club is a `Team`** (my rule, 2026-08-21): never `Mannschaft`.
`Team` is neuter, so every article, demonstrative, possessive, relative pronoun and adjective ending
agreeing with it is neuter too — and the word that has to agree often sits in the NEXT sentence,
which no grep for the noun will find. `Team` is also what `sideLabel` numbers a fixture's two seats,
so a sentence naming both says the club by name rather than leaning on the noun to separate them.

**Refusal copy carries a second register on top of this**, declared at
`fl_frontend/src/shared/utils/adminMutation.ts :: VALIDATION_FAILED`: a FIELD message stays one sentence
about the value, and a FORM message is two with the action second. Field messages are the one place
"Bitte" stays ("Bitte gib einen Namen ein."): a field nudges toward input, a banner refuses it, and
softening a refusal blurs which of the two the reader is looking at.

**No dash is punctuation** (my rule, 2026-08-13): not the em dash `—`, not the en dash `–`, and not a
hyphen standing between spaces. A dash that carried a real break is **rewritten**, most often into two
sentences and sometimes into a comma or a colon. Deleting one is not rewriting it, because a sentence
that reads worse without its dash has been cut rather than recast. The same holds for a dash doing a
word's job: a pairing reads `gegen`, and an absent value is named in words rather than by a lone `—`.

**A hyphen that connects stays**, and this is the half a find-and-replace destroys, so the sweep runs
string by string. `Frankfurt-League`, `K.-o.-Runde`, `Carl-Schurz-Schule`, `E-Mail` and `Karten-Link`
keep theirs, as does every club and venue name. The test is whether the character joins words into one
term or separates one clause from another.

**A range between two dates takes an en dash, and it is the only exception** (my rule, 2026-08-14):
`01.09.2025 – 30.06.2026`, never `01.09.2025 bis 30.06.2026`. A span is scanned rather than read, and
this is the one position where the dash carries what a word carries worse — `bis` sets a conjunction in
the same weight as the dates it joins, so the span reads as one grey ribbon in which the connective
outweighs its endpoints. The season selector also styles its span `uppercase`, which turns the word
into `BIS` and leaves a dash untouched. Every span in the product uses it:
`fl_frontend/src/features/saisons/components/collections/AdminSaisonsTable.tsx :: renderZeitraum`,
`fl_frontend/src/features/saisons/components/ui/SaisonSelector.tsx :: timespan`,
`fl_frontend/src/features/spieltage/components/collections/AdminSpieltageList.tsx` and
`fl_frontend/src/features/spieltage/components/views/AdminSpieltagEditView.tsx`.

**The exception reaches two dates and nothing else.** Not a range of numbers, which stays `von 2 bis
16`; not a scoreline; not `format.ts :: PLACEHOLDER`'s `--:--` and `-:-`, which are digit masks and
were never dashes in the first place. **It licenses no parenthetical, no aside and no substitute for a
colon or a comma**, beside a span or anywhere else — a dash with prose on either side is the general
case and still comes out. A range of some kind not named here is a question to ask, never an analogy
to extend.

**An interpolated noun must read correctly for every value it can take** (my rule, 2026-08-13): its
article, its plural, and any pronoun agreeing with it. `PHASE_LABELS` is the set that makes it bite —
behind a hardcoded `Die` a neuter knockout round reads wrong, and behind a hardcoded plural a count of
one does. **Recast rather than adding a gender map beside the label map**: lead with the label as a tag,
put the count in a readout instead of a sentence that has to agree with it, or give each count its own
sentence.
`fl_frontend/src/features/spieltage/components/forms/AdminSpieltagEditForm/banners.ts :: buildSpieltagBanners`
takes the second, putting the attached and the expected count in a readout rather than in a sentence
that would have to agree with both at once; `fl_frontend/src/features/saisons/utils.ts :: describeSpielplanUmfang`
spells each of its two numbers for one as well as for many, defensively: both counts arrive from the
server, and no season the rules permit draws a single one of either. Two parallel maps for one noun set
drift the moment a value is added.

**Copy says what the reader should do or expect, never how the value is computed** (my rule,
2026-08-13). The instance is the venue editor, which explained that the map link is composed from the
name and the address and rebuilt on save. An admin does not need to know a link is derived. What they
need is that changing this name changes where every fixture at this venue points, including the ones
already played, and that is the whole of what the banner now says. **The tells are a sentence naming a
field that is not on screen, a sentence explaining how a value is stored or regenerated, and a sentence
about when something is recalculated.** Cut the mechanism and keep the consequence sharp, because
several of these strings exist precisely because something is irreversible.

**A hint that enumerates what a page offers is complete, or it does not enumerate.** A list short by one
reads as the whole offer rather than as a sample, so the reader concludes the item it misses is not there
and never tries it. `fl_frontend/src/features/admin/constants.ts :: ADMIN_SIDEMENU_STRUCTURE` carries such
lists: the season editor's panels, named by their own headings in the order the page renders them, and the
fixture search's keys, which
`fl_frontend/src/features/spiele/components/views/SpielsucheView.tsx :: SEARCH_KEYS` decides and
`fl_frontend/src/features/dashboard/constants.ts :: DASHBOARD_SIDEMENU_STRUCTURE` names again for the
public route — so the second goes stale in two places from one change. **The list is counted against what
the reader can reach, never against the array**: both `ort.*` keys are the venue, and `Ort` names them
once. Where a list would have to track a surface that keeps growing, name the class and enumerate nothing.

**And no copy line calls an operation impossible that the product performs.** The write path decides that,
not the panel the sentence sits in, and a door shut in prose that the code leaves open turns a reader away
from a repair they could have made. The tell is a scope word — `nie`, `kein`, `nicht mehr` — reached for
about the whole product from inside one surface: `ADMIN_SIDEMENU_STRUCTURE`'s Teams note is about the
season exit entered on the team page, while the replacement that also takes a club out of a season is a
control on the season page. **Where a state can be left, the sentence says so.**
`fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/blockedReasons.ts :: spielplanBlockedReason`
splits the draw's one window for exactly that reason: the recorded half a fixture edit reopens
([`docs/backend/spec.md`](../backend/spec.md) I46) is worded as a state, and the half `status` closes as a
boundary.

**Only the dash rule can be checked mechanically, and the date-range exception is checkable with it.**
The characters the rule forbids stand between spaces or alone in a JSX text node, and the hyphen it
permits has a word character on both sides, so a check separates those two without knowing whether the
string reaches a reader. The exception is visible on the same terms: a permitted en dash has a date on
each side, which in this codebase means a `formatSpielDatum` call or a literal `dd.mm.yyyy`, so a check
would allow a dash flanked by those and flag every other one. **Two things such a check has to get
right**: the flanking dates are siblings rather than neighbours in one string wherever a span is built
from separate elements, as `renderZeitraum` in the seasons table builds it; and recognising a date by
the name of the function that formats it couples the check to that name, so a second date formatter
would need adding to it rather than being caught by it.

**Every other rule here holds by review.** A lint over the pronouns, over grammatical agreement or over
register would first have to know which string literals are user-facing, and nothing in the tree marks
that; one over a list's completeness would additionally have to know what the surface it describes offers,
which sits in a different file from the sentence describing it every time.

### 1.13 Metadata and indexing

Every public route sets its own `title`, `description` and canonical; `metadataBase` in the root layout is
what lets the canonicals be paths. **No route under `/admin` sets any**, so the whole admin tree inherits.
The consequences worth knowing before editing metadata:

- **A route that sets no metadata inherits the root layout's, canonical included**, so an unset canonical
  claims to be the homepage rather than claiming nothing.
- **`openGraph` is inherited or replaced whole, never merged field-by-field**, so the root layout
  declares only the site-wide parts (`siteName`, `images`, `locale`, `type`) and og:title and
  og:description resolve from each page's own title and description.
- **No route ships a `keywords` array, and none is added for a new route.** Google has ignored the tag
  since 2009 and Bing reads an overstuffed one as a spam signal, so it is maintenance with no reader;
  ranking terms belong in the title and description.

### 1.14 The shared editor surface

Every entity editor is one shell over one status object. Five modules under
`fl_frontend/src/shared/components/ui/` hold that shape, and a slice contributes only what is its own.

| Module                   | Provides                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `EditFormLayout.tsx`     | The scroll container, page-width wrapper, two-column grid and sticky rail slot       |
| `DraftStatusContext.tsx` | `DraftStatusProvider`, and `useDraftStatus` / `useFieldStatus` for anything below it |
| `DraftRail.tsx`          | The Hinweise and Änderungen cards, separately and as a `DraftRail` pair              |
| `FormActionBar.tsx`      | The save/cancel bar and its unsaved-changes count                                    |
| `FieldLabel.tsx`         | A field's label, its `feld-` anchor id, and the Geändert marker                      |

**A slice owns its descriptors and nothing structural.** It declares a group union and a
`FLFieldDescriptor` table, folds them through
`fl_frontend/src/shared/utils/draftStatus.ts :: deriveDraftStatus`, builds its own banners, and mounts
`DraftStatusProvider` around the form. `FieldLabel`, `FormActionBar` and `RailChangesSection` all read
that context rather than taking props, so a label deep inside a form section needs no drilling — and a
slice that renders one of them outside the provider throws rather than rendering a wrong state.

**The rail's hint names its entity through a `nomen` prop, as a topic prefix**:
`Saison: alle Warnungen an einem Ort, auch die aus dem Formular.` The prefix is what removes German
grammar from the call site — a phrase carrying an article would let a caller pair the wrong one with a
noun, and nothing would report it.

**The match editor is the one composer.** `AdminEditSpielDataForm` mounts the shared provider _and_
`fl_frontend/src/features/spiele/components/forms/AdminEditSpielDataForm/SpielExpectedContext.tsx ::
SpielExpectedProvider`, whose rows are the fields a triage category is waiting on — a concept no other
entity has. Its rail places the two shared cards around its own Vorschau and Offene Angaben, and its
`ExpectedMarker` reaches `FieldLabel` through the `extraMarker` slot. The two contexts carry disjoint
data: the shared one never learns about `expected`, and the narrow one holds no draft status.

## 2. Invariants

| #   | Invariant                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Enforced by                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | Every granular cache tag has a matching `updateTag` in a server action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | review                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| I2  | Base tags `spiele`/`teams` invalidate unconditionally on a match write                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `fl_frontend/src/features/spiele/actions.ts :: updateTag("spiele")`                                                                                                                                                                                                                                                                                                                                                                                                         |
| I3  | `saison_id` reaches the action as an argument, never on the patch body                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `fl_frontend/src/features/spiele/actions.ts` signature                                                                                                                                                                                                                                                                                                                                                                                                                      |
| I4  | A failed season-id parse never fails the edit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `fl_frontend/src/features/spiele/actions.ts :: FLSpielSchema.shape.saison_id.safeParse`                                                                                                                                                                                                                                                                                                                                                                                     |
| I5  | A write payload and the read model share one declaration per field, never a second copy — an embedded record the write narrows is declared as its payload half, and the stored shape extends that                                                                                                                                                                                                                                                                                                                                                                  | `fl_frontend/src/features/spiele/schemas.ts :: FLPatchSpielDataPayloadSchema` composes `:: FLSpielTeamFieldPayloadSchema` and its siblings, which `:: FLSpielTeamFieldSchema` and its own siblings extend                                                                                                                                                                                                                                                                   |
| I6  | `await connection()` precedes every page data fetch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | each page or its async child                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| I7  | Every admin server action starts with `getAdminSession()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | every action in §1.3's table, the read-only preview included                                                                                                                                                                                                                                                                                                                                                                                                                |
| I8  | `getAdminSession()`'s return value must be checked                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | naming only                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| I9  | `core` imports neither `shared` nor `features`; `shared` does not import `features`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | ESLint `no-restricted-imports`                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| I10 | No barrel files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | review                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| I11 | Named exports under `src/`, defaults only where Next.js requires                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | review                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| I12 | `AdminEditSpielDataForm` takes lookup lists as props, never `useAdmin()`; `AdminSpielEditView` is what supplies them                                                                                                                                                                                                                                                                                                                                                                                                                                               | props signature                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| I13 | Before deleting a `"use client"` directive, check for render props                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | review                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| I14 | `revalidateTag(tag, profile)` in route handlers, `updateTag(tag)` in server actions — the seven undo handlers are the only route-handler callers, and each passes `{ expire: 0 }` because an undo tolerates no staleness                                                                                                                                                                                                                                                                                                                                           | route/action split                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| I15 | The three `SpielCard` variants stay separate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | review                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| I16 | No invalidation endpoint for the reference caches                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | absence under `fl_frontend/src/app/api/`                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| I17 | Every Zod schema agrees with the component that publishes it on presence, required, nullable, type and enum members                                                                                                                                                                                                                                                                                                                                                                                                                                                | `fl_frontend/src/core/apiContract.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| I18 | Client-side field validation runs the schema the server action parses, never a second copy of the rules                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `fl_frontend/src/shared/hooks/useDraftFieldErrors.ts :: useDraftFieldErrors`                                                                                                                                                                                                                                                                                                                                                                                                |
| I19 | **Two rules, and they answer different questions. A client verdict never writes into the submit's map; and it is laid over a message on the same path only where the value beneath that path has moved since the submit was answered.** The second is symmetric: a verdict on an unmoved value neither deletes a message nor overwrites one                                                                                                                                                                                                                        | `fl_frontend/src/shared/hooks/useDraftFieldErrors.ts :: mergeFieldVerdicts` and `:: differsFromSubmitted`, whose tests cover both directions                                                                                                                                                                                                                                                                                                                                |
| I20 | `deriveSpielDraftStatus` is the match editor's single contract: every marker, badge, list, count and guard reads it, and **no surface reads a draft field directly**                                                                                                                                                                                                                                                                                                                                                                                               | `fl_frontend/src/features/spiele/draftStatus.ts :: FIELD_DESCRIPTORS`, whose test requires a row per field of the draft shape                                                                                                                                                                                                                                                                                                                                               |
| I21 | The navigation guard covers reload, tab close, and links this page renders — and nothing else                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `useUnsavedChangesWarning` (`beforeunload`) and `<Link onNavigate>`; the gap is accepted, see §1.10                                                                                                                                                                                                                                                                                                                                                                         |
| I22 | **A dynamic segment's page awaits `params` (and every runtime API) INSIDE a `<Suspense>` boundary, never at its own top level.** Every one does: `/admin/spiele/[spiel_id]`, `/admin/teams/[team_id]`, `/admin/spieler/[spieler_id]`, `/admin/saisons/[saison_id]`, `/admin/spieltage/[spieltag_id]`, `/admin/schiedsrichter/[schiedsrichter_id]`, `/admin/spielorte/[spielort_id]`, `/dashboard/teams/[team_id]` and `/dashboard/spieler/[team_id]`                                                                                                               | The page component is synchronous and renders `<Suspense><…Content {...props} /></Suspense>`; `next build` prints an App Shell sub-entry under each dynamic route, which is the visible signal it worked                                                                                                                                                                                                                                                                    |
| I23 | **A toast is raised through `appToast`, and its appearance is built in `AppToaster`** — never `toast` from `@heroui/react` at a call site, and never a new `.toast*` rule in a stylesheet                                                                                                                                                                                                                                                                                                                                                                          | `fl_frontend/src/shared/utils/appToast.ts` and `fl_frontend/src/core/providers/AppToaster.tsx`                                                                                                                                                                                                                                                                                                                                                                              |
| I24 | **The action-required page holds no client state: which section is on screen is `?section=`, read with `useSearchParams` and written with `window.history.replaceState`**                                                                                                                                                                                                                                                                                                                                                                                          | `fl_frontend/src/features/admin/components/views/AdminSpieleActionRequiredView.tsx :: SECTION_PARAM`                                                                                                                                                                                                                                                                                                                                                                        |
| I25 | **A season write invalidates every read its answer reaches, and what it reaches is what decides the set — never which endpoint was called.** An edit clears `saisons` + `teams`; the rollover clears `saisons` + `spiele` + `spieltage` + `teams`; the draw clears those four and the granular `spiele` and `teams` entries for the season it drew, a base tag alone leaving one serving a season that had no fixtures when it was filled. The undraw shares the draw's helper rather than declaring a set of its own, taking away exactly what that write created | `fl_frontend/src/features/saisons/actions.ts :: invalidateSaisonAndTable`, `:: invalidateRollover` and `:: invalidateSpielplan`                                                                                                                                                                                                                                                                                                                                             |
| I26 | **`saisons.status` reaches no payload, no draft atom and no descriptor row**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | absence from every payload schema in `fl_frontend/src/features/saisons/schemas.ts` — the read model declares it — and from `fl_frontend/src/features/saisons/saisonDraftStatus.ts`                                                                                                                                                                                                                                                                                          |
| I27 | **A matchday's order is the API's and no frontend surface re-sorts it, and its ordinal is the SERVED `position` rather than a place in the arrival order.** So a filtered or reordered list labels each matchday the same way, and no surface offers to move one: `position` is the round the season's draw gave it and rides on no payload                                                                                                                                                                                                                        | `fl_frontend/src/features/spieltage/utils.ts :: spieltagLabels` takes the ordinal from `position` and `:: orderRoundsByWiring` consumes the arrival order; the body `fl_frontend/src/features/spieltage/schemas.ts :: FLPatchSpieltagPayloadSchema` sends is the span alone, its `id` riding in the path                                                                                                                                                                    |
| I28 | **No `generateStaticParams` on a dynamic segment**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | absence in every dynamic segment (I22 lists them)                                                                                                                                                                                                                                                                                                                                                                                                                           |
| I29 | **The document root is never a containing block** — `<html>` and `<body>` carry `position: static` and nothing else that forms a containing block for absolutely positioned descendants: no `transform`, `translate`, `rotate`, `scale` or `perspective`, no `filter` or `backdrop-filter`, no `contain` of `layout`, `paint`, `strict` or `content`, no `will-change` naming any of those, and no `container-type`                                                                                                                                                | review — `fl_frontend/src/app/layout.tsx` holds both class lists, and any `html` or `body` selector in `fl_frontend/src/app/globals.css` or `fl_frontend/src/app/admin/admin.css` reaches the same two elements                                                                                                                                                                                                                                                             |
| I30 | **A picker trigger's readout never replays a list row that carries a badge, and a badge on the trigger is a sibling of the truncating span.** Such a readout comes from the prop, or from a `Value` render prop returning a string; a trigger carrying a badge gives its span `flex-1 min-w-0 truncate`, so the trailing controls hold their place with or without the badge; and the separation between two children is each child's own `ms-2`, never a gap on `FIELD_TRIGGER`                                                                                   | `fl_frontend/src/shared/components/ui/formFieldStyles.ts :: FIELD_TRIGGER`, which is where the no-gap half is kept, and every `Autocomplete.Trigger` or `Select.Trigger` rendering a `LABEL_BADGE` — today only the team picker in `fl_frontend/src/features/spiele/components/forms/AdminEditSpielDataForm/FormTeamPicker.tsx :: FormTeamPicker`                                                                                                                           |
| I31 | **A clear or dismiss control is spread from `dismissControl`, and its label names in German what goes.** A bare `SearchField.ClearButton`, `Autocomplete.ClearButton`, `Modal.CloseTrigger`, `CloseButton` or `Toast.CloseButton` is the violation, and so is a treatment respelled at a call site                                                                                                                                                                                                                                                                 | `fl_frontend/src/core/dismissControl.ts :: dismissControl` and every site rendering one of those                                                                                                                                                                                                                                                                                                                                                                            |
| I32 | **A form whose fields are React state submits through `runOnSubmit`, never through a function `action`.** `fl_frontend/src/features/auth/components/forms/SignInForm.tsx` is the one exception, and its field is uncontrolled                                                                                                                                                                                                                                                                                                                                      | `fl_frontend/src/shared/components/ui/formSubmit.test.ts` sweeps every `.tsx` holding either field-error hook                                                                                                                                                                                                                                                                                                                                                               |
| I33 | **The match editor's draft reaches the wire payload by a parse, and a field whose inputs are conditional is retracted by that same condition** — never by a cast, and never handler by handler                                                                                                                                                                                                                                                                                                                                                                     | `fl_frontend/src/features/spiele/schemas.ts :: FLPatchSpielDataPayloadDraft` makes the gap a type error; `fl_frontend/src/features/spiele/draftStatus.ts :: admitsShootOut` is the shoot-out's one condition, read by the panel that offers it, the draft that carries it and the preview that shows it                                                                                                                                                                     |
| I34 | **Every field path a refusal can name is a path its form renders a `name` for — or a declared, reasoned exemption**                                                                                                                                                                                                                                                                                                                                                                                                                                                | `fl_frontend/src/core/refusalPaths.test.ts` sweeps every payload schema an action parses against the `name` props of the components that dispatch that action, and against the paths its `map*Refusal` writes by hand                                                                                                                                                                                                                                                       |
| I35 | **Every `path` a field label is given is a path its editor's descriptor table carries.** A path no descriptor carries renders a label with no Geändert marker and no error, because `useFieldStatus` answers `undefined` rather than throwing                                                                                                                                                                                                                                                                                                                      | `fl_frontend/src/shared/components/ui/fieldLabelPaths.test.ts` sweeps every literal, template and composed path a label is handed                                                                                                                                                                                                                                                                                                                                           |
| I36 | **Every request `apiClient` composes reaches an operation `fl_backend/openapi.json` publishes — matched on method and on path shape — sends only query parameters that operation declares, each agreeing with it on type and enum members, and declares every parameter the operation requires.** A query parameter publishes inline under `paths` rather than as a component, so I17's comparison never reaches one                                                                                                                                               | `fl_frontend/src/core/apiRequests.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| I37 | **A write with no undo escalates in place through the shared two-press control, and a panel spelling its own armed state is the violation.** The hook holds the arming, the guard that runs before BOTH presses and the pending state; the shell announces itself as an alert and takes one gap for every panel, no variant of any kind, because a knob there is a variant prop under another name. What stays each panel's own is the copy, the blocked reason, the readouts and how it grades the response                                                       | `fl_frontend/src/shared/hooks/useTwoPressConfirm.ts`; `fl_frontend/src/shared/components/ui/ConfirmReveal.tsx`, `ConfirmActionRow.tsx` and `ConfirmReadoutRow.tsx` beside it; `fl_frontend/src/shared/components/ui/formButtons.ts :: confirmButton` for the armed fill; and `fl_frontend/src/shared/components/ui/confirmPanel.test.ts`, which holds every panel on its roster to the shell, the action row and that fill, and fails one that keeps armed state of its own |

## 3. Violation → remedy

| Symptom                                                                                                                                                                          | Cause                                                                                                                                                                          | Remedy                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An admin edit saves, but the list still shows the old data                                                                                                                       | The entry carries only base tags, and only a granular tag was invalidated                                                                                                      | I2 — the base `updateTag`s must stay unconditional                                                                                                                                                                                                                                                                                                                         |
| A page never refreshes after a rollover                                                                                                                                          | A rollover changes what an omitted `saison_id` resolves to, so it has to clear four tag families rather than one                                                               | I25 — `fl_frontend/src/features/saisons/actions.ts :: invalidateRollover` must clear `saisons`, `spiele`, `spieltage` and `teams`                                                                                                                                                                                                                                          |
| A season's points change but the table still shows the old standings                                                                                                             | The edit cleared `saisons` and not `teams`, and the table is scored from `rules` on every read                                                                                 | I25 — `invalidateSaisonAndTable` clears both, unconditionally rather than by comparing what moved                                                                                                                                                                                                                                                                          |
| A matchday list looks right and the playoff bracket's columns are in the wrong order                                                                                             | Something re-sorted the matchdays on this side, so `orderRoundsByWiring` anchored on the wrong round                                                                           | I27 — remove the sort; the order arrives correct from `order_spieltage`                                                                                                                                                                                                                                                                                                    |
| A matchday sits in the wrong place in the list                                                                                                                                   | Its stored `position` is wrong, or it sits in the wrong `saison_phase`                                                                                                         | I27 — no surface repairs either: both are the season's draw's, on no payload and written once                                                                                                                                                                                                                                                                              |
| A season is edited in Compass and the change never appears                                                                                                                       | A hand edit invalidates nothing; only an action does                                                                                                                           | I16 — accept the daily bound or recreate the containers; the backend caches seasons for ten minutes of its own, so the frontend one alone is not enough (`docs/ops/spec.md` §3)                                                                                                                                                                                            |
| A field the admin form sends never reaches the database                                                                                                                          | The Zod mirror does not declare it, so `strip` removes it before the body is sent; a key that did reach the backend would be refused rather than dropped                       | I3 — pass it as an action argument, never on the patch body                                                                                                                                                                                                                                                                                                                |
| Pressing Speichern resets every edited field to its stored value, and the save confirmation opens listing 0 Hinweise                                                             | The form passes a function to `action`, so React resets it on submit and react-aria pushes each field's mount-time value back through `onChange`                               | I32 — submit through `runOnSubmit`; §1.10 carries the chain and why nothing in the toolchain reports it                                                                                                                                                                                                                                                                    |
| Saving is refused with "Der Server hat eine Angabe beanstandet, die dieses Formular nicht anzeigt", and no field is marked                                                       | The submit was refused on a path this form renders no input for: a draft field carrying a value whose inputs have unmounted, or a payload key that never had one               | I33 — a conditional field is retracted by its own condition. I34 — a payload key with no input is either given one or entered in `refusalPaths.test.ts`'s exemption table with the reason it is unreachable, so the toast stands only for a path somebody decided about                                                                                                    |
| The image build fails on a page that builds locally                                                                                                                              | A page fetches without `await connection()`; the builder has no backend                                                                                                        | I6 — add the guard before the fetch; it need not sit in the default export                                                                                                                                                                                                                                                                                                 |
| A dynamic route throws at request time but the build passed                                                                                                                      | A Server Component passes a render prop to a Client Component                                                                                                                  | I13 — restore the `"use client"` directive. No gate catches this one                                                                                                                                                                                                                                                                                                       |
| `updateTag` throws inside a route handler                                                                                                                                        | Wrong function for the context                                                                                                                                                 | I14 — `revalidateTag` in route handlers, `updateTag` in server actions                                                                                                                                                                                                                                                                                                     |
| The three match cards look like duplication                                                                                                                                      | Working as intended — they differ in chips, names and container (§1.6)                                                                                                         | Nothing. Shared code leaves the cards as §1.6 says — a derivation into `utils.ts`, an atom into `components/ui/` — and never by a merge                                                                                                                                                                                                                                    |
| A cache tag exists but nothing ever clears it                                                                                                                                    | A granular tag on a resource with no write surface                                                                                                                             | I1 — add the matching `updateTag` in the same change, or delete the tag                                                                                                                                                                                                                                                                                                    |
| A server action fails with "An unexpected response was received from the server"                                                                                                 | Something answered its POST with a redirect, so the client read HTML where an RSC payload belongs                                                                              | `fl_frontend/src/proxy.ts` exempts any request carrying `next-action`; the action's own `getAdminSession()` refuses it instead                                                                                                                                                                                                                                             |
| A server action fails with "An unexpected response was received from the server", and the route keeps serving its old data                                                       | A dynamic page awaited `params` at its own top level, so an `updateTag` from another route truncates the response                                                              | I22 — await inside the page's `<Suspense>` boundary                                                                                                                                                                                                                                                                                                                        |
| A server action writes, but the screen does not change                                                                                                                           | It was dispatched from a closure whose component has unmounted, so the router never applies its revalidation                                                                   | `updateTag` is required and NOT sufficient there — call `router.refresh()` when the result arrives (the undo toast)                                                                                                                                                                                                                                                        |
| A white outline appears on a control that already rings                                                                                                                          | The base-layer focus rule painting over a HeroUI control                                                                                                                       | The unlayered opt-out in `globals.css` — HeroUI's own is `:not(:focus)`-gated and cannot fire on a focused element                                                                                                                                                                                                                                                         |
| A focus indicator appears after a plain mouse press                                                                                                                              | Working as intended — react-aria's focus-visible modality is global and survives an earlier key press                                                                          | Nothing. Opt the control out where its container already indicates focus, as the switch and the field groups do — unless the container holds other tab stops, which its one indicator cannot tell apart                                                                                                                                                                    |
| A toast disappears before it can be read, or a spinner retires mid-request                                                                                                       | The call site used HeroUI's `toast` directly, so it took the library's 4000 ms default                                                                                         | I23 — raise it through `appToast`, which derives the duration and gives `pending` `timeout: 0`                                                                                                                                                                                                                                                                             |
| A toast renders unstyled or misaligned after a HeroUI upgrade                                                                                                                    | A vendored class the toast rules in `globals.css` still target was renamed, so those rules match nothing                                                                       | Re-read `@heroui/styles/dist/components/toast.css`; the rules say which version they were written against                                                                                                                                                                                                                                                                  |
| A hover or press animation snaps instead of easing                                                                                                                               | A hand-written `transition-[…]` names `transform`, but Tailwind v4 emits `scale-*`, `translate-*` and `rotate-*` as the standalone `scale` / `translate` / `rotate` properties | Name the property that actually changes, which runs both ways: where the movement is a library's own CSS rather than a utility, `transform` is the right name and `scale` is the one that interpolates nothing (`fl_frontend/src/core/dismissControl.ts`). The `transition-transform` shorthand is safe — v4 expands it to all four — so only an arbitrary list is exposed |
| A tooltip, menu or popover opens a screen-height below the control it names, on a public route only — including one placed `bottom` that flipped to `top` near the viewport edge | `<html>` or `<body>` became a containing block, so react-aria measured a top-placed overlay's `bottom` against the viewport and CSS resolved it against the page               | I29 — take whatever made the root a containing block off it; the overlay's own geometry is correct and needs no offset                                                                                                                                                                                                                                                     |
| A picker trigger's clear button sits in a different place depending on whether the team has left the season                                                                      | The free space is parked on the badge with `ml-auto` instead of on the name span                                                                                               | I30 — `flex-1 min-w-0 truncate` on the span; the badge and the clear button each carry their own `ms-2`                                                                                                                                                                                                                                                                    |

## 4. Known-open

| #      | Item                                                             | State                                                                                                                                                                                                                                                                                                                                                                                       |
| ------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —      | Pydantic and Zod models are hand-mirrored                        | Accepted — checked rather than generated: `fl_frontend/src/core/apiContract.test.ts` compares presence, required, nullable, type and enum members against the committed `fl_backend/openapi.json`. Patterns, lengths and messages stay each side's own                                                                                                                                      |
| —      | Revocation is out of band, never the session lifetime            | Accepted — the admin's own sign-out is `fl_frontend/src/features/auth/actions.ts :: signOutAction`; an operator revokes by removing the address from `ALLOWED_ADMIN_EMAILS`, which the `session` callback re-reads on every request                                                                                                                                                         |
| —      | Next injects a polyfill bundle `browserslist` cannot cut         | Accepted — `next/dist/build/polyfills/polyfill-module.js` ships unconditionally, which is what PageSpeed reports under "Legacy JavaScript": 1,380 bytes measured 2026-08-09, against Lighthouse's estimated "14 KiB" in an audit that is unscored. No supported way to drop it exists, so the diagnostic is not worth chasing                                                               |
| FE-18  | A vendored HeroUI stylesheet may render nothing                  | Open — `fl_frontend/src/app/globals.css` imports HeroUI's `disclosure-group.css`, whose lone selector is emitted by a component this app does not render; the compiled-stylesheet diff that would settle it is unrun. Tracked in [`docs/_roadmap/open-items.md`](../_roadmap/open-items.md)                                                                                                 |
| FE-21  | The editor shell's `2xl` step is unexercised                     | Open — `fl_frontend/src/shared/components/ui/EditFormLayout.tsx :: EditFormLayout` widens its rail past 96rem, and no verification has rendered that width. Tracked in [`docs/_roadmap/open-items.md`](../_roadmap/open-items.md)                                                                                                                                                           |
| OPS-84 | The rules §1.8 records are enforced by a linter past end of life | Open — `fl_frontend/package.json` holds eslint at a 9.x line that will take no further fix of any kind, so every decision §1.8 encodes and I9's layer boundary rest on a tool that will not be repaired, and the documentation eslint serves as current describes a major version this repository does not run. Tracked in [`docs/_roadmap/tooling-items.md`](../_roadmap/tooling-items.md) |
