# Frontend — spec

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
| [1.15 The document root](#115-the-document-root)                                                      | What the document root may never carry                 |
| [2. Invariants](#2-invariants)                                                                        | The rules that must hold                               |
| [3. Violation → remedy](#3-violation--remedy)                                                         | A symptom, its cause, and what to do about it          |
| [4. Known-open](#4-known-open)                                                                        | The accepted gaps                                      |

---

## 1. Contract

### 1.1 Slice inventory

| Slice            | queries | mutations | actions | schemas | Owns, beyond the four modules and `components/`                                                                                                |
| ---------------- | :-----: | :-------: | :-----: | :-----: | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `spiele`         |   ✅    |    ✅     |   ✅    |   ✅    | The Spiel write path                                                                                                                           |
| `spielorte`      |   ✅    |    ✅     |   ✅    |   ✅    | Full CRUD                                                                                                                                      |
| `schiedsrichter` |   ✅    |    ✅     |   ✅    |   ✅    | Full CRUD                                                                                                                                      |
| `teams`          |   ✅    |    ✅     |   ✅    |   ✅    | Full CRUD + season junction                                                                                                                    |
| `saisons`        |   ✅    |    ✅     |   ✅    |   ✅    | Create, edit, rollover, group swap, the Spielplan draw and its undraw — no delete, and the draw's `replace` where the season already holds one |
| `spieler`        |   ✅    |    ✅     |   ✅    |   ✅    | Full CRUD + squad junction                                                                                                                     |
| `spieltage`      |   ✅    |    ✅     |   ✅    |   ✅    | Re-dating alone — the `saisons` draw creates them, and a replace or an undraw of that draw removes them                                        |
| `bewerbungen`    |   ✅    |    ✅     |   ✅    |   ✅    | Triage, the public application form and the contact confirmation — two irreversible decisions, two unauthenticated writes                      |
| `aktionen`       |   ✅    |     —     |    —    |   ✅    | Read-only: the backend writes the log on every recorded write, never this slice, and facets it by the actor's origin                           |
| `system`         |   ✅    |     —     |    —    |   ✅    | Read-only                                                                                                                                      |
| `admin`          |   ✅    |     —     |    —    |    —    | Aggregator                                                                                                                                     |
| `kontakte`       |    —    |    ✅     |   ✅    |   ✅    | Three contact seats on a season's junction row; an erasure keyed on an address rather than on a row                                            |
| `auth`           |    —    |     —     |   ✅    |    —    | `handleSignIn` + `signOutAction`, neither an admin mutation (§1.3); one sign-in payload the form and the action both parse (I18)               |
| `dashboard`      |    —    |     —     |    —    |    —    | —                                                                                                                                              |
| `meta`           |    —    |     —     |    —    |    —    | —                                                                                                                                              |

`utils.ts`, `resolvers.ts` and `facets.ts` are sanctioned optional modules. `utils.ts` and
`resolvers.ts` exist separately from `queries.ts` because they hold non-caching code, and folding
them in would put pure functions inside a `"use cache"` module. `facets.ts` is separate from
`constants.ts` because a facet carries a `read` function over the slice's row type, and because
module scope is load-bearing: `AdminCrudView`'s memo and the react-aria collection behind it both
key on the array's identity (`fl_frontend/src/features/teams/facets.ts :: TEAM_FACETS`). A slice
declares every dimension its pages offer and no subset beside it, so which of them a page would
rather show is a question no surface has to answer.

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

**Uncached, deliberately: every admin-tier read.** **The tier settles it on its own: `"use cache"`
keys on the arguments rather than on caller identity, so one shared entry would be a slot of
admin-authorized data any caller could reach.** **An admin-tier read several components on one page
make is wrapped in React's `cache`, never in `"use cache"`** — that wrapper dedupes within one
render pass, so it costs the confinement nothing. None carries a cache tag either: a tag only means
something inside a cache scope. Each seeds the request's correlation scope, which a `"use cache"`
read cannot ([`docs/logging/spec.md`](../logging/spec.md#11-the-correlation-id)).

**The application form's reads are base-tier and uncached, and the tier is not what settles it.**
Each answers a question judged against the present moment rather than a property of the season —
whether a window is running today, whether a Kürzel, a club or a kit colour is still free — so a
cached answer outlives its own truth: the form would go on inviting applications after the window
shut, or offer a Kürzel the write then refuses (`REQ-BEWERBUNG-008`). None carries a cache tag
either, for the reason above.

**The club list and the assigned-colour read each degrade toward the WIDER offer** — the
new-school arm, the empty set — because an unreadable answer means nothing is known to be taken.
**What the failed read degrades is the exclusion's input, never its rule**:
`fl_frontend/src/features/teams/utils.ts :: offeredTrikotFarben` offers what a season has left and
nothing at all once every colour is assigned, the wish field staying required there.

**A page reading one of them from more than one boundary shares a single round trip, and that
sharing is NOT the data cache.** `fl_frontend/src/core/api.ts :: apiClient` bounds every call with an
`AbortController` timeout signal, and Next's own `fetch` memoization opts out the moment a signal is
present, so React's `cache` supplies the dedupe instead: it holds the in-flight promise for the
length of ONE request and shares it across that request's boundaries alone, so no later request can
reach it and the confinement above stands intact. **A memo over a FILTERED read keys on the filters
serialized**, in a `cache()`-scoped `Map` —
`fl_frontend/src/features/spiele/queries.ts :: getAdminSpiele`, `getAdminTeams` and
`getAdminSpieltage` each hold one — because React's `cache` compares an argument by identity, so an
object literal written at a call site would miss every time and memoize nothing.

**What the admin tier adds is withheld by a response model per endpoint, never by a projection per
caller** ([`docs/backend/spec.md`](../backend/spec.md#11-endpoint-inventory)): a shape declared that
way is one a Zod mirror can be held to (I17), where an endpoint narrowing its response by the
credential would answer a shape its own published component never states.

**A cached read that answers `null` for an unknown id converts the 404 INSIDE the cached function.** A
production build redacts an error thrown out of a `"use cache"` scope to a digest-only `Error`, which a
catch at the call site can never recognise, so `getTeam` catches its own 404 where the directive can
still see it. The uncached reads that resolve `null` the same way are under no such constraint, and
each catches where its own answer is decided.

**`getTeam` is tagged exactly as `getTeams` is** — it reads the same documents through the same
derivation, so a result edit moves it too. Its `null` covers a club with no junction row for the
requested season as well as an unknown id, the join being strict
([`docs/backend/spec.md`](../backend/spec.md) I11).

**`getTeams` caches two tables per season, not one**: `statistik_scope` is part of the cache key.
No granular tag for it — the coarse `teams` tag clears both, which is right in both directions,
since a Gruppenphase result moves both tables and a playoff result moves only one.

**The grouped shape arrives already ranked, and nothing here re-sorts it.** The order is the
competition's tiebreak chain, which includes a head-to-head table the client never receives, and
the same ordering seeds the playoff bracket — so a second sort would let the table and the bracket
disagree about who finished second.

### 1.3 Admin mutations

Every admin mutation is a server action opening on `getAdminSession()` (I7) and returning an
access-denied `FormState` rather than throwing, and every one runs inside
`fl_frontend/src/shared/utils/adminMutation.ts :: runAdminMutation` — without which a 409 crosses
the server-action boundary redacted and replaces the admin page with the error page
([`docs/logging/error-codes.md`](../logging/error-codes.md)).

**The `auth` slice's two actions are in the table and are not admin mutations, which is the one
exception to every sentence above and below about a row.** `handleSignIn` is the only server action
in this application reachable without a session, so it can no more open on `getAdminSession()` than
the public route handlers below can, and it answers a neutral sentence rather than a `FormState`
carrying a verdict — a distinguishable refusal there is a membership oracle. `signOutAction` ends
the session it would otherwise check.

**That `getAdminSession()` call is also what makes the write attributable**: it records the
session's address in the request scope `runAdminMutation` has just seeded, and `apiClient` sends it
as `X-FL-Actor` on admin-tier calls alone — the ordering is load-bearing. A write reaching the
backend without it comes back 401 ([`docs/backend/spec.md`](../backend/spec.md) I41).

**Among the ADMIN mutations the route handlers are the eight page-owned editors' undos, one
`undo/route.ts` per slice under `fl_frontend/src/app/api/admin/`, and the boundary is the PATTERN
rather than a count**. A server action is the right primitive for an admin mutation and stays
so for every other one; an undo is
dispatched from a route other than the one that raised it, which makes Next re-render the editor
segment and raise the E592 invariant mid-response. A ninth page-owned editor may have one; a
dialog, a row control or a bulk action may not. **Revert all eight to server actions once Next
fixes E592.** Every configuration lever around E592 is closed:
`dynamic = "force-dynamic"` build-errors under `cacheComponents`, 16.3 offers no
per-route PPR opt-out, `generateStaticParams` leaves fallback params on unlisted ids regardless,
disabling `cacheComponents` would take every cached read in §1.2 with it, and uncaching the read
shipped and was disproven by retest — 16.3.0 and 16.3.1-canary.4 both still reproduce it.

**The app's other route handlers sit outside that boundary, each for its own reason.** The Auth.js
catch-all and the client-error ingest (`FE-CLIENT-001`) mutate no application data at all. The
public application form's submit, its Kürzel check and the confirmation page's write
(`fl_frontend/src/app/api/bestaetigung/route.ts`) authorize nobody, so none can open on
`getAdminSession()` (I7) or borrow `runAdminMutation`, whose name asserts a session was checked;
`fl_frontend/src/shared/utils/publicRoute.ts :: handlePublicRequest` is their spine, and it
authorizes nothing — the guard on the backend endpoint stays the only thing deciding whether the
write may happen ([`docs/backend/spec.md`](../backend/spec.md) §1.1). The confirmation's own
credential is the emailed token, sent in the body: the link's GET writes nothing, because a mail
scanner's GET and a reader's are one request to the same-origin guard.

**The eight share two modules and spell neither per slice**, so a rule about an undo is written
once and every editor gets it. `fl_frontend/src/shared/utils/undoDispatch.ts` `fetch`es the route
rather than dispatching an action, the editor being unmounted by the time the press lands, and
`fl_frontend/src/shared/utils/undoRoute.ts :: handleUndoRequest` is where `getAdminSession()` and
`runAdminMutation` are reached — each of the eight `route.ts` files supplies a name, a schema and
the replay, and nothing else. **Both answer 200 with the outcome in the body for every reportable
case**, a non-2xx landing in the dispatch's rejection arm, which blames the transport and sends the
admin to check a connection that is fine.

**Five of the eight undo replays can be refused on the way back**, and each answers in German out of
its own route's `REPLAY_REFUSALS`: the replay meets the rules the save met, so a span another tab has
since narrowed comes back from the matchday's as a refusal, and the toast reports the change as still
standing — which is correct. The contacts undo reaches `revalidateTag` not at all — the one place the
eight differ (I14).

**Where a page-owned editor's write has no undo, the absence is never an omission.** The rollover
confirms in place: there is nothing for an undo to call (`REQ-ACTIVATE-002`, and no endpoint
demotes a season), and `activateSaisonAction` answers each refusal in its own words for the stale
page that reaches the write anyway.

**The draw and the undraw are destructive rather than reversible** (`REQ-SPIELPLAN-001`,
`REQ-SPIELPLAN-005`, `REQ-SPIELPLAN-006`): `/spiele` has no create for an undo to replay removed
rows into, and the action log's images (backend I48) are a record for a person to read, never a
restore. **This side judges the replace window itself, from a hand-written mirror**:
`fl_frontend/src/features/saisons/utils.ts :: holdsARecordedFact` answers it per fixture against
`fl_backend/app/api/saisons/services.py :: holds_a_recorded_fact`, RECORDED being defined once, in
[`docs/backend/spec.md`](../backend/spec.md) I46, so no surface spells the window twice. Both
writes confirm in place behind the two-press escalation, **which sends the `replace` where the
season already holds a draw**, the flag decided from the same input as the
sentence beside it; they are **one panel and one armed state**, and what counts as drawn is one
expression
(`fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/blockedReasons.ts :: spielplanHoldsADraw`,
with `:: spielplanBlockedReason` closing the panel outside the window rather than on any drawn
season). The undraw is judged on the operation rather than on what there is to remove, so a season
already undrawn is answered with zeros, graded `info`. **The three shape rules move with the draw
rather than in the rules panel** (`REQ-RULES-011`), `qualifiers_per_group` riding the draw's own
payload and the group shape repaired by the undraw; **the tie-break beside them is the panel's own
freeze** (`REQ-RULES-012`), `FormRegelnSection` being HANDED the count `FormGruppenSwapSection`
closes on for `REQ-SWAP-002` rather than reading the fixtures again —
`fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/regelnFreeze.test.ts` pins
all three halves.

**The group swap also confirms in place, for a different reason: it is its own inverse** — running
it again on the same pair restores the season. Its two entry points, the season editor's panel and
the club editor's single picker, share one write and grade a pair through
`fl_frontend/src/features/saisons/utils.ts :: findSwapPartnerRefusal`, so neither can offer a pair
the other refuses.

| Action                           | Slice          | Invalidates                                                                                    |
| -------------------------------- | -------------- | ---------------------------------------------------------------------------------------------- |
| `patchAdminSpielDataAction`      | spiele         | `spiele`, `teams`, + `spiele:saison_id:{id}`, `teams:saison_id:{id}`                           |
| `previewAdminSpielDataAction`    | spiele         | **nothing** — it writes nothing (`dry_run=true`)                                               |
| `readAdminSpielBookingsAction`   | spiele         | **nothing** — it reads the bookings a save moved, so the undo can restore each one whole       |
| `postSpielortAction`             | spielorte      | **nothing** — no cached read holds a venue                                                     |
| `patchSpielortAction`            | spielorte      | `spiele`                                                                                       |
| `deleteSpielortAction`           | spielorte      | **nothing**                                                                                    |
| `reactivateSpielortAction`       | spielorte      | **nothing**                                                                                    |
| `postSchiedsrichterAction`       | schiedsrichter | **nothing** — no cached read holds a referee                                                   |
| `patchSchiedsrichterAction`      | schiedsrichter | `spiele`                                                                                       |
| `deleteSchiedsrichterAction`     | schiedsrichter | **nothing**                                                                                    |
| `reactivateSchiedsrichterAction` | schiedsrichter | **nothing**                                                                                    |
| `anonymiseSchiedsrichterAction`  | schiedsrichter | `spiele` — the label lands on every fixture the referee officiated, as a rename does           |
| `postTeamAction`                 | teams          | `teams`, + `teams:saison_id:{id}`                                                              |
| `patchTeamAction`                | teams          | `teams`, `spiele`                                                                              |
| `deleteTeamAction`               | teams          | `teams`                                                                                        |
| `reactivateTeamAction`           | teams          | `teams`                                                                                        |
| `postSaisonTeamAction`           | teams          | `teams`, + `teams:saison_id:{id}`                                                              |
| `patchSaisonTeamAction`          | teams          | `spiele`, `teams`, + `spiele:saison_id:{id}`, `teams:saison_id:{id}`                           |
| `replaceSaisonTeamAction`        | teams          | `spiele`, `teams`, `spieler`, + `spiele:saison_id:{id}`, `teams:saison_id:{id}`                |
| `postSpielerAction`              | spieler        | `spieler`                                                                                      |
| `patchSpielerAction`             | spieler        | `spieler`                                                                                      |
| `deleteSpielerAction`            | spieler        | `spieler`                                                                                      |
| `eraseSpielerAction`             | spieler        | `spieler`                                                                                      |
| `reactivateSpielerAction`        | spieler        | `spieler`                                                                                      |
| `postSaisonSpielerAction`        | spieler        | `spieler`                                                                                      |
| `patchSaisonSpielerAction`       | spieler        | `spieler`                                                                                      |
| `deleteSaisonSpielerAction`      | spieler        | `spieler`                                                                                      |
| `reactivateSaisonSpielerAction`  | spieler        | `spieler`                                                                                      |
| `postSaisonAction`               | saisons        | `saisons`                                                                                      |
| `patchSaisonAction`              | saisons        | `saisons`, `teams`                                                                             |
| `activateSaisonAction`           | saisons        | `saisons`, `spiele`, `spieltage`, `teams`                                                      |
| `swapGruppenAction`              | saisons        | `teams`, `spiele`, + both `:saison_id:{id}`                                                    |
| `generateSpielplanAction`        | saisons        | `saisons`, `spieltage`, `spiele`, `teams`, + both `:saison_id:{id}`                            |
| `undrawSpielplanAction`          | saisons        | `saisons`, `spieltage`, `spiele`, `teams`, + both `:saison_id:{id}`                            |
| `patchSpieltagAction`            | spieltage      | `spieltage`                                                                                    |
| `annehmenBewerbungAction`        | bewerbungen    | `teams`, + `teams:saison_id:{id}`                                                              |
| `ablehnenBewerbungAction`        | bewerbungen    | **nothing** — a decline moves this application's own row, which no cached read holds           |
| `einwilligungErneutSendenAction` | bewerbungen    | **nothing** — no cached read holds an application                                              |
| `patchSaisonTeamKontakteAction`  | kontakte       | **nothing** — the only read carrying the block is `getTeamMemberships`, which is React `cache` |
| `eraseKontaktpersonAction`       | kontakte       | **nothing** — no cached read holds a contact person                                            |
| `handleSignIn`                   | auth           | —                                                                                              |
| `signOutAction`                  | auth           | —                                                                                              |

What the table cannot carry:

- **The public application form's create is absent by rule**: every row but the `auth` pair is an
  admin mutation, which a write that authorizes nobody can never be, and it invalidates nothing —
  no cached read holds an application (§1.2). What puts the `auth` pair in the table instead is the
  exception stated above it, which is about a session rather than about application data.
- **The venue, referee and team patch actions invalidate `spiele` because the backend fans a rename
  out into the match documents embedding it.** The team patch stays on base tags alone: a rename
  reaches every season that is not `past` ([`docs/backend/spec.md`](../backend/spec.md) I13), and
  the action holds no list of which seasons those are. `patchSaisonTeamAction` invalidates the
  `spiele` pair for a different reason — each side's `austritt` is JOINED from the junction row at
  read time (backend I32), so the junction write changes what `GET /spiele` returns.
- **Every spieler action invalidates the base tag alone**, a squad row joining into no second
  resource; why no granular tag exists to add is §1.4.
- **The season actions invalidate different sets, and what each write can reach decides the set**
  (I25). **A matchday write clears `spieltage` alone**: `GET /spiele` never joins `spieltage`.
- The team create is **one action over two requests** — `POST /teams`, then
  `POST /teams/{team_id}/saisons` — because every team read is season-scoped with a strict
  junction join ([`docs/backend/spec.md`](../backend/spec.md) I11): a club created without a
  junction row would be invisible to the very list the create form sits on. **The player create is
  the same shape for the same reason**, offering `active` and `future` seasons both; the chosen
  season's status decides `is_nachgetragen`, which the form derives rather than asks (decided
  2026-08-07).
- **Season entry is offered only where the backend would take it**: only `future` seasons, with
  `fl_frontend/src/features/teams/utils.ts :: buildGruppeOffer` deriving each offered group's fill
  state, full ones disabled. **A club that has left the LEAGUE is refused by every season and every
  group alike** (`REQ-ENTER-005`), so the editor withholds the affordance entirely and says so in a
  banner. The junction write's refusals stay authoritative;
  `fl_frontend/src/features/teams/actions.ts :: mapEntryRefusal` turns each into its German answer,
  on the group field where the group is what was refused.

**A mutation addressing a ROW puts that row's id in the PATH** — an admin-prefixed namespace would
split a resource's writes from its reads. The one write addressing no row is the contact erasure,
keyed on an address that travels in the body: a path would file the value the request exists to
destroy in the access log and in `aktionen.request.path`. The payload schemas still carry `id`
wherever one is in the path, because they back the admin forms, so each such function in
`mutations.ts` splits it off before sending — **a backend payload model that saw an `id` refuses
the whole body** (`fl_backend/tests/api/test_payload_strictness.py`), which is why the split is in
one place per slice.

**Every resource with write endpoints has an action calling them**, each dispatched from a
page-owned editor — `kontakte`'s erasure from inside the seat holding the person it erases, keyed on
an ADDRESS rather than on the seat it stands in, so it reaches every season's junction row, every
application and the log
(`fl_backend/app/api/kontakte/admin_router.py :: erase_kontaktperson`). **These of its writes are
irreversible** — a pupil's erasure, a referee's anonymisation, a contact person's erasure, the
replacement of a club on a season's junction row, the draw's `replace`, the undraw beside it, the
rollover's close of the outgoing season and the triage's decisions
([`docs/backend/spec.md`](../backend/spec.md#11-endpoint-inventory)). Each destroys or hands on
what nothing here can put back, so each confirms in place behind I37's shared escalation and none
offers an undo. **The triage's decisions hand on rather than destroy**: each mails the school as it
commits, and no endpoint recalls a message or decides an application a second time
(`REQ-BEWERBUNG-001`).

**The messages are not all addressed alike.** A decision reaches every mailbox the application
names (I39). Every message addressed to the submitter reaches the Ansprechperson's mailbox alone
(`fl_frontend/src/features/bewerbungen/notifications.ts :: collectBewerbungEingangEmpfaenger`), no
seat recording who submitted. A confirmation link reaches one mailbox per distinct address, each
carrying one link for every seat that mailbox holds and the submitter's receipt does not already
answer for (`:: seatsByMailbox`, `fl_frontend/src/features/bewerbungen/utils.ts :: empfangsSitze`),
so two people on a school inbox get one message and a person holding two seats gets one control per
link rather than per seat. The footer line saying who a message reached is split with them. Every one tells a reader
who never applied to ignore it, an address on an application being one a stranger can type, and
each says what ignoring it costs.

**The queue MARKS a colliding application ACROSS THE ROWS IT LOADED; the write refuses none.** Both
of a colliding pair are flagged for the administrator to decide between
(`fl_frontend/src/features/bewerbungen/duplicates.ts :: findBewerbungDubletten`, which is where the
argument against enforcing that uniqueness at an unauthenticated write is recorded). A pair split
across the endpoint's cap goes unmarked, and nothing identifies which pair:
`FLBewerbungenListResponse.vollstaendig` is false there, and the notice `AdminBewerbungenView`
raises on it says so before it says anything else.

The other absences are deliberate rather than unbuilt: there is no `DELETE /saisons/{saison_id}`,
because a season that is over is `past`; no action writes `saisons.status` except
`activateSaisonAction`; and a matchday is re-dated but never retired, `spieltage` carrying no
`inactive_since` to stamp.

**Irreversible splits in two, and the copy says which** (my rule, 2026-08-26): where the action log
keeps the pre-image, `Es gibt in der Verwaltung keinen Weg zurück.`; where the same transaction
empties those log rows as it empties the values
(`fl_backend/app/core/recording.py :: build_redaction_update`),
`Zurückholen lässt sich das nicht.` — a pupil's erasure, a referee's anonymisation and a contact
person's erasure alone. **Each is a whole sentence of its own**, because folding the qualifier into
the object beside it is what let one promise grow into a family of wordings nobody could sort.

### 1.4 The cache tag design

A granular tag is worth having only if **(a)** its resource can be written from the app at all, and
**(b)** a mutation changes some rows and not others along that dimension. Test (b) is the one
almost every candidate fails.

These satisfy both and exist:

| Tag                  | Why it earns its place                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `spiele:saison_id:*` | Editing one match in one season must not evict every other season's cached lists, and the patch action knows exactly which season it touched     |
| `teams:saison_id:*`  | An edit changes that season's league table, which `/teams` derives from the matches — so team caches go too, though no team document was written |

**These shapes fail one of the two tests, and none of them may be added:**

- **No tag keys on a resource the app cannot write** — the system endpoints and the action log:
  nothing here could invalidate such a tag, so it would stand until expiry whatever it was named.
- **No tag names a read that is not cached**, the mirror of that, reaching the admin-tier reads
  (§1.2): an `updateTag` on one clears nothing and reads as invalidation of data no entry ever
  held.
- **No `saisons:`, `spieler:` or `spieltage:` season tag**, though all three have write surfaces.
  These fail (b) rather than (a): a season IS the season rather than season-scoped data,
  `getSaisons` reads every one in a single call, one spieler read spans every season, and one
  matchday write moves both the season-scoped admin list and the public Spielplan's default-season
  entry.
- **No tag keys on a dimension the mutation itself changes** — `spiele:status:*` and
  `spiele:phase:*` are the shapes to refuse: correct invalidation needs the old value and the new
  one, and the action holds only the new one. A tag that is right half the time is worse than no
  tag, because the wrong half is invisible.
- **No tag keys on a team dimension a junction write moves** — group, the `austritt` record — the
  bullet above on a second resource; the `teams:saison_id:*` entry that action already invalidates
  clears both sides of the move, a move never crossing a season.
- **No tag keys on an argument its declaring query is never called with.**

**Base tags are not made redundant by the granular ones.** Because the default read path sends no
`saison_id` at all, the most frequently hit cache entries carry only `spiele` and `teams`. Invalidating
by season alone would leave exactly those entries stale, which is why both base tags are invalidated
unconditionally on every match write.

### 1.5 Out-of-band invalidation

`saisons`, `spieler` and `spieltage` are cached for a day, so an edit made **directly in MongoDB**
is served stale until the cache expires — **at most 24 hours, and that bound is the whole
mechanism** (I16: no invalidation endpoint exists and none may be added).

Each of the three has an admin page that invalidates as it saves (`updateTag` inside the action), so
an edit made through the app is visible at once and only a hand edit goes around it — the symptom a
hand edit produces, and its remedy, are [`docs/ops/spec.md`](../ops/spec.md) §3. **A write sent
straight to the API leaves exactly the same staleness**, invalidation living in the action and not
in the endpoint: a pupil erased by a hand call is gone from the database while the cached read still
serves them.

**A season edited by hand is the case where the daily bound costs the most**: a season decides which
season an omitted `saison_id` means and its `rules` score the league table, so `saisons`, `spiele`,
`spieltage` and `teams` all stay stale until their entries expire or the container is recreated. I25
names what an action clears instead.

### 1.6 Deliberate duplication: the three match cards

`SpielCard`, `SpielCardCompact` and `SpielCardUltraCompact` read as copy-paste and are not. They
differ in chip count, in full team names versus shorthands, and in the container driving them; no
configuration flag collapses them without producing a three-mode component, which is harder to read
and change than three single-mode ones. **Do not merge them.**

Their genuinely shared code is extracted rather than copied —
`fl_frontend/src/features/spiele/utils.ts :: formatSpielDisplay` and the two atoms rendering its
values — and beyond that each card passes only its own wrapper classes. The first extraction was
itself a bug fix: an unplayed match rendered `"- : -"` in one card and `"-:-"` in the other two, on
the same screen.

The fourth value is a knockout's shoot-out, which **every surface renders on its own line under the
score and never inside it** — `SpielScore` is the single component that decides that, the match
editor's draft preview included: the fixture finished level, the Saisontabelle counts it as a draw,
and a card showing `4:3` where `2:2` belongs would contradict the table about the same match.

### 1.7 Environment

Validated at startup by `@t3-oss/env-nextjs` (`fl_frontend/src/core/config.ts`). Failure prints **names only**, never
values.

| Variable                                       | Constraint                                                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `API_URL`                                      | URL; must not share `AUTH_URL`'s origin                                                                                              |
| `API_VERSION`                                  | integer                                                                                                                              |
| `MONGODB_URI`                                  | must start `mongodb://` or `mongodb+srv://`                                                                                          |
| `AUTH_URL`                                     | URL; **must be https** unless it points at localhost                                                                                 |
| `AUTH_SECRET`, `AUTH_RESEND_KEY`               | string                                                                                                                               |
| `INTERNAL_API_KEY_BASE` / `_SYSTEM` / `_ADMIN` | exactly 64 characters                                                                                                                |
| `ALLOWED_ADMIN_EMAILS`                         | comma-separated, each a valid email                                                                                                  |
| `LOG_FORMAT`                                   | `json` \| `console`, case-normalised                                                                                                 |
| `BEWERBUNG_SWEEP`                              | `on` \| `off`, case-normalised, `on` where the server sets nothing; the sweep arms only where it reads `on` under a production build |

`SKIP_ENV_VALIDATION=true` bypasses the gate — used by the Docker builder stage, which has no real
environment.

The `AUTH_URL` https rule exists because `@auth/core` derives the session cookie's `Secure` flag
from that URL's protocol, so a stray `http://` value would ship an admin session cookie in
plaintext; it is gated on hostname rather than `NODE_ENV`, because the local stack runs the
production image against `http://localhost:3000`. The `API_URL` origin rule exists because the
public origin reaches FastAPI on the liveness path alone
([`docs/ops/spec.md`](../ops/spec.md) §1.3), so an `API_URL` standing on it would leave
`checkIsLive` answering 200 while Next's HTML 404 met every other read and write — the boot refusal
stops that half-alive shape reaching a page. `AUTH_TRUST_HOST` is deliberately **not** declared:
`@auth/core` reads `AUTH_URL` first in the same chain, and `AUTH_URL` is mandatory, so the variable
can never be reached.

### 1.8 Lint rules that encode a decision

| Rule                                                | Why it exists                                                                                                                                                        |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react/no-danger: error`                            | The enforced CSP keeps `'unsafe-inline'` on `script-src`, so it does not mitigate script injection. This does, at the only place injection could realistically enter |
| `better-tailwindcss/no-unknown-classes: error`      | The only check that sees a class name resolving to nothing: TypeScript, the Prettier plugin and the browser all accept an unresolvable utility in silence            |
| `better-tailwindcss/no-concatenated-classes: error` | Partial cover — `prettier --write` trims a space at a class string's own edge, fusing two classes into one; §3 carries its limit                                     |
| `no-restricted-imports` on `core`/`shared`          | Layer boundaries, scoped deliberately narrowly — see the overview                                                                                                    |
| `@typescript-eslint/consistent-type-imports`        | Type-only imports are erased; mixing them risks pulling runtime modules across the RSC boundary                                                                      |

### 1.9 The test suite

**Runner:** Node's built-in test runner — `node --test`, driven through `pnpm test`. There is no
Vitest or Jest, and no test config file.

**Tests sit next to the code they test**, unlike the backend's separate `fl_backend/tests/` tree —
each side takes its own ecosystem's default, and colocation ships nothing, bundlers excluding
`.test.` files by pattern ([`docs/backend/spec.md`](../backend/spec.md) §1.6). Most test files
cover pure functions, and there is no end-to-end suite.

**A claim about what a component renders is asserted against the markup it renders**, through
`fl_frontend/src/shared/testing/renderTest.ts :: renderMarkup`. The component under test is reached
with `await import`, never by a static import beside that helper: the helper registers the compile
step as it evaluates, and every static import in the graph has resolved before then.

**A source-text assertion is for what no rendering can show** — a convention spanning files, a
directive, a wiring between two of them. Held against a component's own output, a regex over the
source passes on markup that says the opposite and on a component nothing renders at all.

**The `test` script stands `fl_frontend/src/core/config.ts`'s gate down and supplies the database
URI a module reads past it** (`fl_frontend/package.json`), so a component whose graph reaches that
gate renders — a form through its slice's actions module, and every field panel that form composes.
That environment is the script's own, so every runner of the suite inherits it by invoking
`pnpm test` rather than spelling it — the gate's `scripts/gate/verify.sh :: do_unit_tests` and CI
alike.

**The shapes no render reaches:**

- an async Server Component, whose content sits behind its own awaits — a render reaches the
  fallback it declares, so an assertion over that markup passes without seeing the component's own
- a state a press or a submit arrives at: the component mounts in its resting form, and every other
  form it has sits behind an interaction
  (`fl_frontend/src/shared/components/ui/ConfirmReveal.tsx`)
- an overlay's body — a modal, a `ComboBox`'s suggestion list, a `DatePicker`'s calendar — which the
  component holds outside the markup it renders, a modal handed `isOpen` included
- a call site taking a class-name recipe rather than the classes it returns
  (`fl_frontend/src/shared/components/ui/overlayPanel.ts`), a literal spelling those classes
  rendering identical markup

**A `Select` is the exception that makes a picker assertable**: react-aria mirrors the whole
collection into a hidden native `<select>` carrying every member's value and text, the selection,
and the control's `required`
(`fl_frontend/src/features/teams/components/forms/GruppeSelect.tsx`). A row's own `isDisabled` is
not in that mirror, and neither is a `name` the control was never handed
(`fl_frontend/src/shared/components/ui/RefusableSelect.tsx`).

**A component reading a Next client context renders under `renderTree` with that context's provider,
which `next/navigation` does not export** — `useSearchParams` answers `null` without one and throws
where a parameter is read, and `useRouter` throws for a router nothing has mounted.
`fl_frontend/src/features/kontakte/editor.test.ts` reaches both at the paths Next keeps them on,
which a seat holding an address requires; neither hook puts a component out of reach.

**A replacement reason names what the assertion is about, never what the runner cannot do** — a
ratified decision (`.claude/rules/frontend.md`), not this sheet's to widen. Calling a server action
for the sentence it returns is the standing exception — it raises Next's request-scope error, and a
refusal mapper is module-private besides
(`fl_frontend/src/features/saisons/actions.ts :: mapRulesRefusal`).

**A citation to this section never stands as that reason.** The shapes above decide whether a
source-text assertion is available at all; what a test writes is the subject its own assertion has —
the armed form of a two-press control, the wiring between two modules — and a pointer to this
section in place of one is the excuse that decision refuses.

**Several tests sweep the source tree rather than exercise a function** — that is how a rule no
linter can express is held, `fl_frontend/src/core/refusalPaths.test.ts` (I34) and
`fl_frontend/src/shared/components/ui/formSubmit.test.ts` (I32) among them.
`fl_frontend/src/core/refusalRegister.ts` parses `fl_backend/app/core/domain.py` at test time, so
each slice asserts its mapper covers the endpoint's own declared set rather than a list somebody
typed. **A caller that ITERATES that answer asserts it first**, because a loop
over an operation the register no longer names runs zero times and proves nothing; the assertion is
the whole list where the codes are stable, and a floor on the count where one gets renumbered
(`fl_frontend/src/features/spieltage/actions.test.ts`). **Each caller of `:: sliceBetween` pins its
cut before reading it**, an assertion over a cut that has silently emptied proving nothing either.
`fl_frontend/src/core/apiContract.test.ts` compares every Zod schema against the component
`fl_backend/openapi.json` publishes (I17), discovering the schema modules by walking the
tree — so a new slice is DISCOVERED without an edit and `core` gains no static import of `features`
(I9). The number of pairs compared is pinned in that file, so a component quietly dropping out of
the comparison is a failure rather than a smaller run, and the named exemptions are held to the
same standard — a stale entry fails.

**A sweep's own reader is held against a synthetic sample, not only against the tree.** Where every
case in the tree is uniform, no floor over the tree separates a correct reader from one that stops at
the first thing it finds. `fl_frontend/src/core/refusalPaths.test.ts` and
`fl_frontend/src/core/schemaGerman.test.ts` each run their reader over such a sample, and each keeps
its floor over the tree as well: the two answer different questions.

**A sweep that would report the same clean answer over an empty list floors itself first, and a
sweep whose population could be filtered on the property it asserts derives that population twice**
(`docs/_standard/standard.md` PRE-4). **A floor sits under its population with room for ordinary
product change**: one set at the count fires when a file is legitimately retired, and whoever meets
it then lowers it, after which it protects nothing.
`fl_frontend/src/shared/hooks/useDraftFieldErrors.test.ts` derives the form population twice, the
second route eliminating a named prose-only allowlist from every file mentioning `<Form` at all, so
narrowing either route breaks the equality rather than shrinking the sweep (I71).
`fl_frontend/src/core/refusalPaths.test.ts` finds its mappers twice over, by return type and by
assignment, and **fails on what it cannot read rather than skipping it** — an unbound helper, an
assignment whose value is none of the shapes it handles (I34, I63).
`fl_frontend/src/core/toastTitles.test.ts` resolves a title expression to literals **or fails**, a
value arriving from a prop resolving only while every call site passes a literal (I42).
`fl_frontend/src/core/bewerbungEmail.test.ts` asserts that no line of either mail OPENS with a
forged fact shaped like a real row but written by no message, so a hit is the forgery rather than a
genuine line, and `fl_frontend/src/features/bewerbungen/schemas.test.ts` beside it spells every
refused character by code point rather than as a literal, one pasted in being invisible in a diff
and in a review (I87, I88).

**The two German guards prove what is exactly checkable and stop there.**
`fl_frontend/src/core/schemaMessages.test.ts` holds a form-bound closed set to a SENTENCE — a
capital, a full stop — which is what separates copy from a note like „enum member expected“, and
`fl_frontend/src/core/schemaGerman.test.ts` holds a bound field to not falling back to Zod's own
English. Neither reads language, so „Please choose a position.“ passes both (§4).

**`fl_frontend/src/core/apiRequests.test.ts` compares that same document against the REQUESTS,
where `apiContract.test.ts` compares it against the shapes** — what it holds each call to is I36's
row. It is there because a wrong request is the failure nothing else reports: a path the backend
does not publish type-checks, lints, builds and answers 404 only once someone opens the page, and an
undeclared query parameter is not refused but dropped, so a filter renamed on one side alone narrows
nothing and the page still renders. It widens I17 by nothing, deliberately, the Zod mirror being
hand-written (§4).

**`fl_frontend/src/core/apiRequests.test.ts` is blind to:**

- a request made with bare `fetch`
- the runtime value inside a `${…}` hole
- a parameter written into the endpoint literal, which carries no type to compare
- a filter type that neither ends in `FilterParams` nor is passed anywhere

**Not on that list:** a path assembled outside the call expression, and a published schema the reader
cannot resolve — each is reported and fails the run, a call the reader cannot read being a call
nothing compares.

### 1.10 The match editor's structural properties

#### The draft has exactly one derivation

`fl_frontend/src/features/spiele/draftStatus.ts :: deriveSpielDraftStatus` answers everything the
page says about a field, and **nothing reads a draft field directly** (I20) — a surface that does
gets the answer right today and keeps giving the old answer when the table changes. A field with no
`FIELD_DESCRIPTORS` row is invisible to every surface at once — a failure loud enough to catch.

#### The editor's subtree is keyed by the fixture's stored state

`fl_frontend/src/app/admin/spiele/[spiel_id]/page.tsx` keys `AdminSpielEditView` with
`fl_frontend/src/features/spiele/utils.ts :: spielStateKey`, which is the fixture id **plus every
value the editor seeds an atom from** — not the id alone. Every field is `useState` initialised
from `spielData`, and an initialiser runs once per mounted instance, so fresh props never re-seed a
field; the id alone misses the _same_ fixture whose stored values changed, which is the undo's case
— a restored fixture reopened in a still-mounted editor reads as un-restored until a reload.

The key is built from `fl_frontend/src/features/spiele/utils.ts :: toEditorSeed`, a **superset** of
the wire payload: the payload plus the display copies the panels render, without which a rename
reaching this fixture would move nothing the key can see.
`fl_frontend/src/features/spiele/utils.test.ts` pins the exclusion of a field no draft atom holds.
**Narrowing this key to `spiel.id` alone opens a bug the type checker cannot see.**

**The key is one of two gates, and neither is sufficient alone.** The other is that **both exits
reset the draft** — `resetDraftToStored`, run by the discard AND by the save. The reset is what
makes a _reused_ tree honest: a save followed by an undo lands on the key the tree was first
mounted with, so React reuses that tree, and whatever is left in its atoms is what the admin sees —
the values they typed, on a fixture that does not hold them. Measured, because each fix reads as
sufficient on its own.

#### The navigation guard has an accepted gap

Next 16 exposes **no navigation blocker** — verified against the `next/navigation` export list.
What the page can intercept, it does:

| Leaving by                      | Guarded | How                                                                                                                    |
| ------------------------------- | :-----: | ---------------------------------------------------------------------------------------------------------------------- |
| Reload, tab close, browser quit |   ✅    | `beforeunload`, in `useUnsavedChangesWarning`                                                                          |
| A link this page renders        |   ✅    | `<Link onNavigate>`                                                                                                    |
| Abbrechen, and the Zurück pill  |   ✅    | `requestLeave` from `fl_frontend/src/shared/hooks/useEditorExit.ts`, handed to `EditFormLayout` and to `FormActionBar` |
| The admin sidemenu's links      |   ❌    | Rendered by the layout, above this tree                                                                                |
| The browser's Back button       |   ❌    | `popstate` fires after the router has committed                                                                        |

**The gaps are accepted** rather than paid for, and the shape of the payment is recorded so the
trade can be re-taken rather than re-derived: a `NavigationGuardContext` in the admin layout, which
every intercept-able control consults and this form registers its guard with. The browser's Back
button stays outside even then, which is why the header's Zurück pill earns its place beside it: the
pill routes through the discard guard and the button cannot.

#### The submit is a handler, never a form action

Every form whose fields are React state submits through
`fl_frontend/src/shared/components/ui/formSubmit.ts :: runOnSubmit` — `onSubmit` with
`preventDefault` (I32, whose row carries the one exception and the sweep that holds the rule).
**Passing a function to a form's `action` instead discards the draft on every
submit**, in silence: React treats a function `action` as a form action and resets the form's DOM
element when the transition commits, and react-aria's `useFormReset` answers that event by pushing
each field's mount-time value back through the editor's own setter, so the draft is replaced by
what the page opened on. **Both halves of the save-confirmation defect are that one chain**: the
reset lands in the same commit that opens `ConfirmSaveModal`, so the dialog renders against a draft
that no longer differs from what is stored — "0 Hinweise gelten für diesen Entwurf", over fields
showing their old values. **Nothing in the toolchain sees it**: `action` is a valid prop, the types
are satisfied and the build is clean, and a save that succeeds navigates away before the emptied
fields are on screen, which is why the class stayed invisible until a dialog held the page open.

#### The draft may hold what the wire refuses

`fl_frontend/src/features/spiele/draftStatus.ts :: FLSpielDraftFields` lets a Mietpreis, a Honorar
and a shoot-out count stand empty while the admin is typing, because `0` is a real value for each;
`FLPatchSpielDataPayload` allows none of them. **Two rules keep that gap off the wire.**

**What the draft holds is narrowed by parsing, never by a cast.** `buildPayload` returns
`fl_frontend/src/features/spiele/schemas.ts :: FLPatchSpielDataPayloadDraft`, so the difference is
a type error at every point the wire payload is wanted, and `handleFormSubmit` parses
`FLPatchSpielDataPayloadSchema` before it sends — a field still empty becomes a message on its own
path, where a cast satisfies the type checker while the value travels. **The rail's preview
declares the same gap rather than casting it away**: `fl_frontend/src/features/spiele/draftStatus.ts :: applyDraftToSpiel` returns
`fl_frontend/src/features/spiele/schemas.ts :: FLSpielWithDraftFields`, whose every reader asks
whether the venue and the referee are SET, never what either costs — a cast onto `FLSpiel`'s shape
launders a cleared Mietpreis into a type declaring a number, and the first surface to format one
renders it.

**A field whose inputs are conditional is retracted by that same condition.** A shoot-out describes
a knockout that finished level and nothing else, so
`fl_frontend/src/features/spiele/draftStatus.ts :: admitsShootOut` drops the record — rather than
each handler that can leave the shape, which is retracting by memory, and the miss is silent both
ways. The atom keeps its counts, so re-levelling the score brings them back. **The one route the
condition cannot see is the result toggle**, which unmounts the fields while leaving the score
level: that is the handler restoring the stored result, and the record goes back with the goals —
which is what the panel's own Hinweis already promises.

**The draft's other surplus is the display copies, and the same parse drops those too**: the draft
holds each picker's `name`, which the payload halves never declare, so zod's `strip` leaves every
copy behind on the way to the wire — the server composes them from the row each id names
([`docs/backend/spec.md`](../backend/spec.md) I3), so a copy travelling back could only disagree
with it. `mietpreis` and `payment` stay on the payload beside them, being what this fixture agreed
to pay rather than a copy of anything.

### 1.11 Adding a HeroUI component

Importing the component in TSX is half the change. The other half, and **there are two stylesheets to
check, not one**: `fl_frontend/src/app/globals.css` loads everywhere,
`fl_frontend/src/app/admin/admin.css` loads only under `/admin`.

1. **Decide which file it belongs in.** It goes in `admin.css` only if no public route can reach it —
   established from the import graph, following dynamic imports, not from folder names. `Select`,
   `ListBox`, `Autocomplete`, `DatePicker` and `CloseButton` all look admin-shaped and are not. **When in doubt, `globals.css`**: the
   cost of guessing wrong that way is a few KB, the other way it is an unstyled admin form.
2. Add `@import "@heroui/styles/components/<name>.css" layer(components);` **at the position it occupies
   in `node_modules/@heroui/styles/dist/components/index.css`** — not at the end. HeroUI's file states
   the order is load-bearing: shared primitives first, then the components that compose them.
3. Check what the component renders _underneath_ it. A picker is a popover plus a listbox plus a button,
   and each has its own stylesheet. The quickest check is to render it and read `[data-slot]` in the DOM:
   any slot whose CSS is missing shows up as an unstyled box. **Sub-components can be public even when
   the parent is not** — that is why `close-button` and `list-box` sit in `globals.css`. **A parent
   needs every sheet its parts render beside its own**, as `date-picker` does there: any one of them
   in the other file renders an unstyled box inside a styled one.
4. **Grep both files before you finish.** A component in neither renders unstyled; a component in both
   ships to visitors who never see it.
5. **Its entrance and exit scale do not come with it.** Whatever `zoom-in-*` or
   `zoom-out-*` the vendored stylesheet declares is pinned to `1` document-wide, so the component
   arrives and leaves as a pure fade and nothing reports that it was overridden.
6. Verify in the browser, not by reading the diff. Computed styles are the evidence — a border-radius, a
   padding and a background that are not the browser defaults. For an `admin.css` entry that means
   signing in and opening the admin page, because no public route will show the mistake.

**A stylesheet keeps its `@reference` even when nothing of ours is left in it.** HeroUI's own vendored
sheets carry `@apply` — `textarea.css` opens with one — so `@reference "../globals.css"` is what resolves
them against the theme without emitting it a second time, and a file holding nothing but imports still
needs it. What makes this worth a step is how it fails: removing it breaks `next build` alone, and the
comment at `fl_frontend/src/app/admin/admin.css :: @reference` records that nothing else does.

**Restyling one you already have: reach for the component's own composition API before a stylesheet.**
Several HeroUI components take a render function or per-slot `className`, and anything expressed that
way is type-checked, linted and covered by `better-tailwindcss/no-unknown-classes`. A
`.<component>__<slot>` rule in `globals.css` is none of those: those class names are vendored
implementation detail, and a release that renames one takes the styling with it and reports nothing
(I57). Where a stylesheet is genuinely the only route, **name the HeroUI version the rule was written
against at the rule**, so the next upgrade knows what to re-read.

### 1.12 The copy rules

**Every rule here was generalised from a worked example, and the example outranks the rule** (my
rule, 2026-08-27). Where a rule below and a sentence I dictated disagree, the rule is what is wrong,
and it is amended here rather than the sentence rewritten. A dictated line says so at the line it
constrains, so the next reader finds the reason before the rule.

**Scope: what a user reads** — rendered strings, form and toast copy, and every message the app
emails a reader. German inside `/docs` and in code comments addresses developers and is out, except
where a comment quotes a rendered string, which tracks it. The wording rules:

- **The reader is `Du` — informal, and capitalised everywhere** (my rule, 2026-08-04): `Du`,
  `Dein`, `Dir`, `Dich`, and never `Sie` or `Ihr`. When auditing, a sentence-initial `Du` is
  capitalised whatever the convention holds, so it is evidence of nothing.
- **One German word per concept, and a club is a `Team`** (my rule, 2026-08-21): never
  `Mannschaft`. `Team` is neuter, and the word that has to agree often sits in the NEXT sentence,
  which no grep for the noun will find; `sideLabel` also numbers a fixture's two seats `Team`, so a
  sentence naming both says the club by name.
- **_Already_ is `schon`** (my rule, 2026-08-31): never `bereits`, which takes a capital at the
  head of a sentence, so a case-sensitive sweep leaves those occurrences standing; `bereit` and
  `bereiten` are other words and stay.
- **Refusal copy carries a second register on top of this**, declared at
  `fl_frontend/src/shared/utils/adminMutation.ts :: VALIDATION_FAILED`: a FIELD message stays one
  sentence about the value, a FORM message is two with the action second, and field messages are
  the one place "Bitte" stays — a field nudges toward input, a banner refuses it.
- **The FORM shape is built rather than written**:
  `fl_frontend/src/shared/utils/refusal.ts :: buildRefusal` composes the two sentences from a
  reason and a repair, and every `actions.ts` with a write path reaches it. The panel a repair
  names is framed inside the helper, never at the call site; where a separable verb has to close
  the clause the caller hands over a `{ before, after }` pair. `:: UNKNOWN_REFUSAL` stands under a
  failure nothing can name a cause for.
- **No dash is punctuation** (my rule, 2026-08-13): not the em dash `—`, not the en dash `–`, not a
  hyphen standing between spaces. A dash that carried a real break is **rewritten**, never merely
  deleted, and a dash doing a word's job is spelled out — a pairing reads `gegen`.
- **A hyphen that connects stays** — `KO-Runde`, `E-Mail`, every club and venue name — which is the
  half a find-and-replace destroys, so the sweep runs string by string.
- **A range between two dates takes an en dash, and it is the only exception** (my rule,
  2026-08-14): `01.09.2025 – 30.06.2026`, never `bis`. It reaches two dates and nothing else — not
  a number range (`von 2 bis 16`), not a scoreline, not `format.ts :: PLACEHOLDER`'s digit masks —
  and licenses no parenthetical and no substitute for a colon or a comma. A range not named here is
  a question to ask, never an analogy to extend.
- **An interpolated noun must read correctly for every value it can take** (my rule, 2026-08-13):
  its article, its plural, and any pronoun agreeing with it. **Recast rather than adding a gender
  map beside the label map** — a tag lead, a readout, or a sentence per count — because two
  parallel maps for one noun set drift the moment a value is added.
- **Copy says what the reader should do or expect, never how the value is computed** (my rule,
  2026-08-13). The tells: a sentence naming a field not on screen, one explaining how a value is
  stored or regenerated, one about when something is recalculated.
- **An enumeration is of what the reader can do, or there is no enumeration** (my rule,
  2026-08-27); a list of a thing's parts comes out whole. **Such a list is complete, or it does not
  exist** — short by one it reads as the whole offer — and **it is counted against what the reader
  can reach, never against the array**. Where a list would have to track a growing surface, name
  the class and enumerate nothing; the sidemenu tables name the fixture search's keys a second
  time, so one change to the search goes stale in two places.
- **No copy line calls an operation impossible that the product performs.** The tell is a scope
  word (`nie`, `kein`, `nicht mehr`) about the whole product from inside one surface. **The repair
  is to drop the scope word, never to add a second sentence naming the other route**, and **where a
  state can be left, the sentence says so.**

**A hint says what the thing in front of the reader is, and then at most one thing it does that the
surface cannot show them** (my rule, 2026-08-27), said in the league's own words.

**The cap is a ceiling and never a target** (my rule, 2026-08-27): a lead and at most four
single-sentence bullets, together about 350 characters, refused past that by
`fl_frontend/src/shared/components/ui/hintCap.test.ts`. **A closing note counts against those four**
(my rule, 2026-08-26). **What a hint renders from a label table is not counted**, the sweep reading
literals only, so a legend is written out by hand rather than mapped over its set. **The ordinary
hint is a lead alone, or a lead and one sentence.** **Meeting the cap means cutting, never
compressing** (my rule, 2026-08-26): where a sentence cannot be shortened without becoming untrue,
that is the sentence to delete, not the one to squeeze.

**One question decides a sentence**: delete it, and what does the reader then do wrong? Only "they
would have expected the opposite" keeps a sentence. Eight diagnostics decide _whether_ a sentence
belongs:

1. **No justification.** A sentence opening `Damit`, `So`, `Dadurch` or `weil`, or an `aber` walking
   back the sentence before it, explains the design rather than the thing.
2. **No experience but this reader's.** What a visitor meets is nothing an admin can act on.
3. **No hypothetical the reader is not about to cause.**
4. **Nothing the interface already carries** — an optional field is said by the absent required
   marker, a destructive act by the danger panel, what a control does by the verb written on it.
   **A control that names itself gets no sentence at all.**
5. **Nothing that follows from what the reader knows.** The test is whether deleting the sentence
   would leave any reader with a wrong expectation.
6. **No two sentences where a clause carries it** — one fact stated twice from opposite sides.
7. **No inventory, and no mechanism.** The enumeration rule above says which single kind of list
   survives, and the consequence rule what replaces a described mechanism.
8. **Nowhere but here.** Naming another page or control as the place to do something is wayfinding,
   which the navigation does better. Two things are exempt: **an absence this surface cannot
   explain**, standing where a reader would otherwise hunt for a control that does not exist; and
   **the continuation of a repair a refusal has already started, wherever that continuation is
   written** (my rule, 2026-08-27) — a loop broken at its second step leaves the admin exactly
   where the refusal sent them.

The ninth decides _how_ it is said, and it outranks the cap: **the reader runs a school football
league, not this system.** No field name, code or endpoint, and no `Eintrag` or `Datensatz` where
`Spiel`, `Spieltag`, `Spieler`, `Team`, `Kader` or `Gruppe` exists — **`where … exists` is the
whole of the test**, so a `Kadereintrag` stands. No derivation (`wird berechnet aus`, `ergibt sich
aus`). No conditional chain: a hint states the common case while the refusal handles the rest.
Prefer the shorter everyday word, and **where being short and being plain pull apart, plain wins.**
What this bars is describing how the machine works, never saying that it has stopped acting — the
league has no word for the product ceasing to maintain something.

**The hint rules end at the hint** (my rule, 2026-08-27). A refusal, a banner, a toast and an empty
state each answer a question the reader has already been made to ask. What binds each instead:

- **A refusal names the repair wherever one exists.** The FORM shape above is its floor, not its
  ceiling, and diagnostic 8 does not reach it: naming the panel that holds the repair IS the
  repair. **Where the closure is a boundary with no route back**, the refusal says so and stops.
- **A banner names the one thing the reader would otherwise get wrong about the act in front of
  them**, and the register rule binds its body — a conditional chain is a specification wherever it
  is written.
- **A toast's title says what happened, and its body what it cost.** Where the server sent a
  message, that message is the body and nothing is written over it.
- **An empty state says which narrowing emptied the list**, so a reader who searched, one who
  filtered and one who has entered nothing yet each meet a different sentence.

The banner rules:

- **Four questions raise a banner, and a banner answers the one that raised it** (my rule,
  2026-08-27): a save raises _what will this do to what is already there_; a control this panel
  cannot offer, _why not_; a control living on another page, _where_; a gap in the record, _what
  should I add_. **The answer is a title and at most one sentence under it.**
- **That cap reaches an entry built in a `banners.ts` and stops there** (my rule, 2026-08-27): a
  rail entry renders twice, so a second sentence is paid for twice over. A `Callout` written into a
  panel section stands alone and earns a second sentence — a closure states the rule and then the
  way out, an operation committing on its own control what it does and what moves with it. **Two is
  the ceiling there as well**, a readout not counted.
- **Write the rule, never the situation that met it** — the rule is the half a reader can carry
  away and predict from. **The tell is a figure or a clause about rows other than the one being
  edited**; what the reader is standing on is not that tell and stays. **A readout is not prose and
  none of this reaches it**: a stored value shown back is data a reader compares.
- **A banner's title is written from where the reader stands, never from where the write lands**
  (my rule, 2026-08-27): its subject the thing in the league the reader would point at, never the
  row holding it; its verb what becomes different for the reader, never the step the machine takes;
  its mood the one the code can keep — a certainty the save cannot deliver is spent the first time
  an admin looks and finds nothing moved.
- **One line survives only where the two would say one thing.** A body restating the title from the
  other side goes (diagnostic 6); a mechanism title over a consequence body is inverted, the body
  being the line to keep; **a body reaching a fact the title cannot stays**. **A title naming the
  act and when it lands, over a body naming what the reader will see change, keeps both** (my rule,
  2026-08-27) — reading that shape as mechanism-over-consequence is what deleted
  `spieler.team-changed`'s title once already.
- **Say what is now true rather than what stopped being true** — a negation makes the reader invert
  it. **A prohibition is exempt**: where the rule itself is that something may no longer be done,
  `nicht mehr möglich` IS what is now true.
- **These come out wherever they appear**: the causal tail (`deshalb`, `damit`, `so`); the scope
  tail (`überall`); a trailing `auch …` naming the edge case already covered; `sobald Du
speicherst`; emphasis on a verb that carries itself; and reassurance (`trotzdem`).
- **The trailing `auch` has two exceptions**, each naming a subject the sentence before it cannot
  reach. **The first is the clause naming that a change reaches fixtures that are already played**
  (my rule, 2026-08-27): a reader who has just typed reads a save as forward-looking, so the test
  is whether deleting the clause would leave them expecting the old value to stand on a played
  fixture — checked against the write path, never assumed. **The second is the clause naming the
  rows a title's enumeration stops short of** (my rule, 2026-08-27) — a list complete against what
  the reader can reach is still read as complete against the consequence — and **the repair is one
  clause naming the rest as a class, never more numbers**: past the slot an admin fills by hand, no
  further number is one they act on. A third case answering the same description is the signal to
  restate the rule around that test, never a third carve-out.
- **A banner nothing raised is deleted rather than shortened**, and a value the page renders as
  plain text raises nothing either: a reader who never meets a control does not ask why it is
  closed.
- **A banner's colour says how serious the situation is, and only a consequence the pending save
  causes raises the confirmation** (my rule, 2026-08-27): a state the reader has already been
  living with has no question in it however grave, so `danger` buys no confirmation step on
  unrelated edits. **A required `raisedBy` is where that is recorded**
  (`fl_frontend/src/shared/components/ui/railBanner.ts :: resolveBlockingBanners` opens the dialog
  on `"change"` alone — severity does not imply it). **The test is what the page would have shown
  on load**: a banner already on screen then is `state` however grave.
- **A hint and a banner on one panel never carry the same fact**: the hint carries the rule that
  stands whatever is typed, the banner what this save will do. Review enforces it, a check having
  to recognise a paraphrase across two files; **the one-sentence body is the half a check could
  reach**, as a second sentence-final stop in a `banners.ts` body, the rail-borne refusal remedies
  (marked by `isSpielRefusalBannerId`) exempted, their floor being two sentences under the refusal
  rule above.

**The rules held mechanically are the ones `scripts/checks/docs_gate/copy_rules.py` reaches** — the
dash rule with its date-range exception, the `Mannschaft` and `bereits` bans, and the register
rules — over every string literal and JSX element of
`fl_frontend/src`, comments and tests excluded; it recognises a date by the name of the function
that formats it, a coupling `copy-corpus` fails when the name stops matching, rather than letting
the exception widen unseen. **Every other rule here holds by review**: a lint over agreement,
register or a list's completeness would first have to know which string reaches a reader, in what
company, and what the surface it describes offers.

### 1.13 Metadata and indexing

Every public route sets its own `title`, `description` and canonical, the homepage excepted: the root
layout's own three ARE the homepage's, its canonical being `/`. `metadataBase` there is what lets the
canonicals be paths. **No route under `/admin` sets any**, so the whole admin tree inherits.
The consequences worth knowing before editing metadata:

- **A route that sets no metadata inherits the root layout's, canonical included**, so an unset
  canonical claims to be the homepage rather than claiming nothing.
- **`openGraph` is inherited or replaced whole, never merged field-by-field**, so the root layout
  declares only the site-wide parts and og:title and og:description resolve from each page's own
  title and description.
- **No route ships a `keywords` array, and none is added for a new route** — the engines ignore it
  or read it as a spam signal; ranking terms belong in the title and description.

### 1.14 The shared editor surface

Every entity editor is one shell over one status object. Six modules under
`fl_frontend/src/shared/components/ui/` hold that shape, and a slice contributes only what is its own.

| Module                   | Provides                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `EditFormLayout.tsx`     | The scroll container, page-width wrapper, two-column grid and sticky rail slot       |
| `EditPageHeader.tsx`     | The Zurück pill, the `h2`, its one chip, the reactivate control and the save notice  |
| `DraftStatusContext.tsx` | `DraftStatusProvider`, and `useDraftStatus` / `useFieldStatus` for anything below it |
| `DraftRail.tsx`          | The Hinweise and Änderungen cards, separately and as a `DraftRail` pair              |
| `FormActionBar.tsx`      | The save/cancel bar and its unsaved-changes count                                    |
| `FieldLabel.tsx`         | A field's label, its `feld-` anchor id, and the Geändert marker                      |

**The header's slot set is I38's** (my rule, 2026-08-26), and the row does not wrap at any width —
the title truncates and the chip holds its place. Where a retirement badge and an identity chip
both apply, the badge takes the slot: the Kürzel and the squad number are fields of the form below,
and the day a row was retired is stated nowhere else.

**A slice owns its descriptors and nothing structural**, folding its own `FLFieldDescriptor` rows
through `fl_frontend/src/shared/utils/draftStatus.ts :: deriveDraftStatus` and mounting
`DraftStatusProvider` around the form. The shared controls read that context rather than taking
props, and one rendered outside the provider throws rather than rendering a wrong state. **A form
whose panel has more than one arrangement declares a table per arrangement and picks between
them**: `fl_frontend/src/features/spieltage/spieltagDraftStatus.ts :: deriveSpieltagDraftStatus`
hands `deriveDraftStatus` the table matching what is on screen, so a control the reader cannot see
owns no row and every rendered label still finds one (I35).

**The rail's hint names its entity through a `nomen` prop, as a topic prefix** — the prefix removes
German grammar from the call site, where a phrase carrying an article would let a caller pair the
wrong one with a noun and nothing would report it.

**Three conventions bind every form on the site, an entity editor and the public application form
alike.** A callback judging a picked value is handed the value the event carried rather than reading
it back off state, which has not committed at the moment the callback runs. A shared control's
`name` is the field's dotted path in the payload, which is also its `FieldErrors` key and its anchor
id (I34). A control disabled for a reason the page already shows carries an inline `Hint` beside it,
pointed at by `aria-describedby`, so the reason reaches a screen reader that cannot see the page.

**The match editor is the one composer.** `AdminEditSpielDataForm` mounts the shared provider _and_
`fl_frontend/src/features/spiele/components/forms/AdminEditSpielDataForm/SpielExpectedContext.tsx ::
SpielExpectedProvider`, whose rows are the fields a triage category is waiting on — a concept no
other entity has. The two contexts carry disjoint data: the shared one never learns about
`expected`, and the narrow one holds no draft status.

### 1.15 The document root

**`<html>` and `<body>` carry `position: static` and nothing else forming a containing block** (I29).
Every property below forms one while naming nothing about position, which is why the set is written
out rather than left to be recognised at the line somebody adds one:

- `transform`, `translate`, `rotate`, `scale` or `perspective`
- `filter` or `backdrop-filter`
- `contain` of `layout`, `paint`, `strict` or `content`
- `content-visibility` of `auto` or `hidden`
- `will-change` naming any of those
- `container-type`

**The set is CSS's own and grows without us**, so a property missing from it is unchecked rather than
permitted: a declaration on either root is read against the current specification first.

## 2. Invariants

| #    | Invariant                                                                                                                                                                                                                                  | Enforced by                                                                                                                                                                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1   | Every granular cache tag has a matching `updateTag` in a server action                                                                                                                                                                     | review                                                                                                                                                                                                                                                                                          |
| I2   | Base tags `spiele`/`teams` invalidate unconditionally on a match write                                                                                                                                                                     | `fl_frontend/src/features/spiele/actions.ts :: updateTag("spiele")`                                                                                                                                                                                                                             |
| I3   | `saison_id` reaches the action as an argument, never on the patch body                                                                                                                                                                     | `fl_frontend/src/features/spiele/actions.ts` signature                                                                                                                                                                                                                                          |
| I4   | A failed season-id parse never fails the edit                                                                                                                                                                                              | `fl_frontend/src/features/spiele/actions.ts :: FLSpielSchema.shape.saison_id.safeParse`                                                                                                                                                                                                         |
| I5   | A write payload and the read model share one declaration per field, never a second copy: the stored shape extends the payload half                                                                                                         | `fl_frontend/src/features/spiele/schemas.ts :: FLPatchSpielDataPayloadSchema` composes `:: FLSpielTeamFieldPayloadSchema` and its siblings                                                                                                                                                      |
| I6   | `await connection()` precedes every page data fetch                                                                                                                                                                                        | each page or its async child                                                                                                                                                                                                                                                                    |
| I7   | Every admin server action starts with `getAdminSession()`                                                                                                                                                                                  | every action in §1.3's table but the two `auth` rows, the read-only preview included; §1.3 says why neither `auth` action can open on it                                                                                                                                                        |
| I8   | `getAdminSession()`'s return value must be checked                                                                                                                                                                                         | naming only                                                                                                                                                                                                                                                                                     |
| I9   | `core` imports neither `shared` nor `features`; `shared` does not import `features`                                                                                                                                                        | ESLint `no-restricted-imports`                                                                                                                                                                                                                                                                  |
| I10  | No barrel files                                                                                                                                                                                                                            | review                                                                                                                                                                                                                                                                                          |
| I11  | Named exports under `src/`, defaults only where Next.js requires                                                                                                                                                                           | review                                                                                                                                                                                                                                                                                          |
| I12  | `AdminEditSpielDataForm` takes lookup lists as props, never `useAdmin()`; `AdminSpielEditView` is what supplies them                                                                                                                       | props signature                                                                                                                                                                                                                                                                                 |
| I13  | Before deleting a `"use client"` directive, check for render props                                                                                                                                                                         | review                                                                                                                                                                                                                                                                                          |
| I14  | `revalidateTag(tag, profile)` in route handlers, `updateTag(tag)` in server actions; the eight undo handlers are the only route-handler callers                                                                                            | route/action split                                                                                                                                                                                                                                                                              |
| I15  | The three `SpielCard` variants stay separate                                                                                                                                                                                               | review                                                                                                                                                                                                                                                                                          |
| I16  | No invalidation endpoint for the reference caches                                                                                                                                                                                          | Unenforced — no check would notice one arriving; the undo handlers under `fl_frontend/src/app/api/admin/` call `revalidateTag`, so that directory reading empty would prove nothing                                                                                                             |
| I17  | Every Zod schema agrees with the component that publishes it on presence, required, nullable, type and enum members                                                                                                                        | `fl_frontend/src/core/apiContract.test.ts`                                                                                                                                                                                                                                                      |
| I18  | Client-side field validation runs the schema the server action parses, never a second copy of the rules                                                                                                                                    | `fl_frontend/src/shared/hooks/useDraftFieldErrors.ts :: useDraftFieldErrors`                                                                                                                                                                                                                    |
| I19  | **A client verdict never writes into the submit's map**                                                                                                                                                                                    | `fl_frontend/src/shared/hooks/useDraftFieldErrors.ts :: mergeFieldVerdicts`                                                                                                                                                                                                                     |
| I20  | `deriveSpielDraftStatus` is the match editor's single contract: every marker, badge, list, count and guard reads it, and **no surface reads a draft field directly**                                                                       | `fl_frontend/src/features/spiele/draftStatus.ts :: FIELD_DESCRIPTORS`, whose test requires a row per field of the draft shape                                                                                                                                                                   |
| I21  | The navigation guard covers reload, tab close, and links this page renders — and nothing else                                                                                                                                              | `useUnsavedChangesWarning` (`beforeunload`) and `<Link onNavigate>`; the gap is accepted, see §1.10                                                                                                                                                                                             |
| I22  | **A dynamic segment's page awaits `params`, and every runtime API, INSIDE a `<Suspense>` boundary, never at its own top level**                                                                                                            | The page component is synchronous; `next build` prints an App Shell sub-entry under each dynamic route, which is the visible signal it worked                                                                                                                                                   |
| I23  | **A toast is raised through `appToast`, never `toast` from `@heroui/react` at a call site**                                                                                                                                                | `fl_frontend/src/shared/utils/appToast.ts`                                                                                                                                                                                                                                                      |
| I24  | **The action-required page holds no client state: which section is on screen is `?section=`, read with `useSearchParams` and written with `window.history.replaceState`**                                                                  | `fl_frontend/src/features/admin/components/views/AdminSpieleActionRequiredView.tsx :: SECTION_PARAM`                                                                                                                                                                                            |
| I25  | **A season write invalidates every read its answer reaches; what it reaches decides the set, never which endpoint was called.** §1.3 holds each set                                                                                        | `fl_frontend/src/features/saisons/actions.ts :: invalidateSaisonAndTable`, `:: invalidateRollover` and `:: invalidateSpielplan`                                                                                                                                                                 |
| I26  | **`saisons.status` reaches no payload, no draft atom and no descriptor row**                                                                                                                                                               | absence from every payload schema in `fl_frontend/src/features/saisons/schemas.ts` — the read model declares it — and from `fl_frontend/src/features/saisons/saisonDraftStatus.ts`                                                                                                              |
| I27  | **A matchday's order is the API's and no frontend surface re-sorts it**: a filtered or reordered list labels each matchday the same way                                                                                                    | `fl_frontend/src/features/spieltage/utils.ts :: orderRoundsByWiring`, which consumes the arrival order rather than re-deriving it                                                                                                                                                               |
| I28  | **No `generateStaticParams` on a dynamic segment**                                                                                                                                                                                         | Unenforced — no check would notice one arriving, and nothing in `fl_frontend/src` declares one today; I22 names the shape a reader has to look for                                                                                                                                              |
| I29  | **The document root is never a containing block**: `<html>` and `<body>` carry `position: static` and nothing CSS makes one for an absolutely positioned descendant (§1.15)                                                                | review — `fl_frontend/src/app/layout.tsx` holds both class lists; an `html` or `body` selector in `fl_frontend/src/app/globals.css` or `fl_frontend/src/app/admin/admin.css` reaches them too                                                                                                   |
| I30  | **A picker trigger's readout never replays a list row carrying a badge**: it comes from the prop, or a `Value` render prop returning a string                                                                                              | `fl_frontend/src/features/spiele/components/forms/AdminEditSpielDataForm/FormTeamPicker.tsx :: FormTeamPicker`, the one trigger rendering a `LABEL_BADGE` today                                                                                                                                 |
| I31  | **A clear or dismiss control is spread from `dismissControl`**, whose label names in German what goes; a bare HeroUI dismiss control is the violation                                                                                      | `fl_frontend/src/core/dismissControl.ts :: dismissControl`, and every site rendering a HeroUI `ClearButton`, `CloseTrigger` or `CloseButton`                                                                                                                                                    |
| I32  | **A form whose fields are React state submits through `runOnSubmit`, never through a function `action`.** `fl_frontend/src/features/auth/components/forms/SignInForm.tsx` is the one exception, and its field is uncontrolled              | `fl_frontend/src/shared/components/ui/formSubmit.test.ts` sweeps every `.tsx` holding either field-error hook                                                                                                                                                                                   |
| I33  | **The match editor's draft reaches the wire payload by a parse, never by a cast**                                                                                                                                                          | `fl_frontend/src/features/spiele/schemas.ts :: FLPatchSpielDataPayloadDraft` makes the gap a type error                                                                                                                                                                                         |
| I34  | **Every field path a refusal can name is a path its form renders a `name` for — or a declared, reasoned exemption**                                                                                                                        | `fl_frontend/src/core/refusalPaths.test.ts`, which sweeps every payload schema an action or a route handler parses against the `name` props of the components dispatching it                                                                                                                    |
| I35  | **Every `path` a field label is given is a path its editor's descriptor table carries**                                                                                                                                                    | `fl_frontend/src/shared/components/ui/fieldLabelPaths.test.ts` sweeps every literal, template and composed path a label is handed                                                                                                                                                               |
| I36  | **Every request `apiClient` composes reaches an operation `fl_backend/openapi.json` publishes, matched on method and path shape, and sends only query parameters that operation declares**                                                 | `fl_frontend/src/core/apiRequests.test.ts`                                                                                                                                                                                                                                                      |
| I37  | **A press confirmed in place escalates through the shared two-press control, and a panel spelling its own armed state is the violation**                                                                                                   | `fl_frontend/src/shared/hooks/useTwoPressConfirm.ts`; `fl_frontend/src/shared/components/ui/confirmPanel.test.ts`, which fails a panel keeping armed state of its own                                                                                                                           |
| I38  | **An entity editor's page chrome is `EditPageHeader`**, whose title, chip, Reaktivieren control and save notice are data slots rather than nodes                                                                                           | `fl_frontend/src/shared/components/ui/EditPageHeader.tsx` and `EditFormLayout.tsx :: EditFormLayout`, whose `header` prop admits no node                                                                                                                                                        |
| I39  | **A decision's message reaches every person the application names; no failure to deliver retracts the decision, and a refused mailbox is reported rather than raised**                                                                     | `fl_frontend/src/features/bewerbungen/notifications.ts :: sendBewerbungMail`; `fl_frontend/src/features/bewerbungen/notifications.test.ts`                                                                                                                                                      |
| I40  | **A missing value is never reported before a submit; a present, wrong value is reported on blur; a corrected field clears as it is typed**                                                                                                 | `fl_frontend/src/shared/hooks/useDraftFieldErrors.ts :: verdictMessage`, gated on the submit having been attempted, and `:: missingVerdicts`, which publishes missing paths only                                                                                                                |
| I41  | **The locale is pinned once, at the root, to the language `<html lang>` declares**: an unpinned `DatePicker` reorders its segments at hydration, changing a birthdate                                                                      | `fl_frontend/src/core/providers/RootProviders.tsx`, which the root layout renders around every route; `fl_frontend/src/core/providers/documentLocale.test.ts` compares the pinned language subtag against every `<html lang>`                                                                   |
| I42  | **Every toast title is registered, raised at one variant, and where several sites share a title the description is what tells them apart**                                                                                                 | `fl_frontend/src/core/toastTitles.test.ts`, whose register is compared both ways: an unregistered title fails, and a row nothing raises fails                                                                                                                                                   |
| I43  | **A link inside text takes its underline and colour from one recipe, whose base carries the underline**: colour alone is not a link (WCAG 1.4.1)                                                                                           | `fl_frontend/src/shared/components/ui/textLink.ts :: textLink`, whose `base` carries the underline; `fl_frontend/src/shared/components/ui/textLink.test.ts` sweeps every `.tsx` under `src` for a hand-spelled `hover:underline`                                                                |
| I44  | **A panel's heading names itself and nothing else**: its hint is rendered beside the `<h2>` rather than inside it                                                                                                                          | `fl_frontend/src/shared/components/ui/PanelHeading.tsx :: PanelHeading`; `fl_frontend/src/shared/components/ui/PanelHeading.test.ts`, which resolves a hint reaching a heading through a lookup                                                                                                 |
| I45  | **No module consumes an environment value at load that the builder stage leaves undefined**: `SKIP_ENV_VALIDATION=true` makes every name `undefined` for the whole build                                                                   | `fl_frontend/src/core/buildTimeEnv.test.ts`, which parses every module with the TypeScript AST rather than grepping, so a function body is told from a module's own statements                                                                                                                  |
| I46  | **Every application mail's text branch sets one fact to the line, so every value it prints is normalised where it is printed**                                                                                                             | `fl_frontend/src/core/bewerbungEmail.ts :: einzeilig` and `:: eingerueckt`, the normalisers `:: renderText` applies to every fact it prints                                                                                                                                                     |
| I47  | **A field sharing a row fixes no width of its own, and nothing in that row keeps its input's intrinsic width as a floor**                                                                                                                  | `fl_frontend/src/shared/components/ui/AddressFields.tsx :: AddressFields`, whose two paired rows are the shape a fixed width overflows                                                                                                                                                          |
| I55  | **An undo clearing a cached read passes `{ expire: 0 }`**: an undo tolerates no staleness. The contacts undo has none and calls neither                                                                                                    | `fl_frontend/src/shared/utils/undoRoute.ts :: handleUndoRequest` and the eight `route.ts` files supplying it a replay                                                                                                                                                                           |
| I56  | **A client verdict is laid over a message on the same path only where the value beneath it has moved since the submit was answered**                                                                                                       | `fl_frontend/src/shared/hooks/useDraftFieldErrors.ts :: differsFromSubmitted`, whose tests cover both directions                                                                                                                                                                                |
| I57  | **A toast's appearance is built in `AppToaster`**, never a new `.toast*` rule in a stylesheet                                                                                                                                              | `fl_frontend/src/core/providers/AppToaster.tsx`                                                                                                                                                                                                                                                 |
| I58  | **The draw clears the granular `spiele` and `teams` entries too**: a base tag alone leaves one serving a season that had no fixtures when filled                                                                                           | `fl_frontend/src/features/saisons/actions.ts :: invalidateSpielplan`                                                                                                                                                                                                                            |
| I59  | **The undraw shares the draw's helper rather than declaring a set of its own**, so it takes away exactly what that write created                                                                                                           | `fl_frontend/src/features/saisons/actions.ts :: undrawSpielplanAction`, which calls `:: invalidateSpielplan`                                                                                                                                                                                    |
| I60  | **A matchday's ordinal is the SERVED `position`, never its arrival order**: `position` rides on no payload and no surface offers to move one                                                                                               | `fl_frontend/src/features/spieltage/utils.ts :: spieltagLabels` takes the ordinal from `position`; `fl_frontend/src/features/spieltage/schemas.ts :: FLPatchSpieltagPayloadSchema` sends the span alone                                                                                         |
| I61  | **A badge on a picker trigger sits beside the truncating span**, and each child spaces itself with `ms-2` rather than a gap on `FIELD_TRIGGER`                                                                                             | `fl_frontend/src/shared/components/ui/formFieldStyles.ts :: FIELD_TRIGGER`, which is where the no-gap half is kept                                                                                                                                                                              |
| I62  | **A field whose inputs are conditional is retracted by that same condition**, never handler by handler                                                                                                                                     | `fl_frontend/src/features/spiele/draftStatus.ts :: admitsShootOut` is the shoot-out's one condition, read by the panel, the draft and the preview alike                                                                                                                                         |
| I63  | **Every path a hand-written `fieldErrors` map names is a path its form renders**; `BANNER_ONLY` excuses only a mapper that fills the shape nowhere                                                                                         | the second sweep in `fl_frontend/src/core/refusalPaths.test.ts`, which fails a listed file assigning `fieldErrors` at all                                                                                                                                                                       |
| I64  | **`useFieldStatus` answers `undefined` for an unknown path rather than throwing**, so a stray path renders a label with no Geändert marker and no error                                                                                    | `fl_frontend/src/shared/components/ui/DraftStatusContext.tsx :: useFieldStatus`                                                                                                                                                                                                                 |
| I65  | **A TYPED `params` object is compared on required-ness, type and enum members, both ways**; one spelled into the endpoint literal is matched by name alone                                                                                 | `fl_frontend/src/core/apiRequests.test.ts`                                                                                                                                                                                                                                                      |
| I66  | **One reveal and one action row per panel, whatever it offers**: a second reveal would arm one operation while the row below confirmed the other                                                                                           | `fl_frontend/src/shared/components/ui/confirmPanel.test.ts`, which holds every panel on its roster to exactly one reveal and one action row                                                                                                                                                     |
| I67  | **The shell announces itself as an alert and takes no variant; the copy, the blocked reason, the readouts and the grading stay each panel's own**                                                                                          | `fl_frontend/src/shared/components/ui/ConfirmReveal.tsx`, `ConfirmActionRow.tsx` and `ConfirmReadoutRow.tsx`; `fl_frontend/src/shared/components/ui/formButtons.ts :: confirmButton` for the armed fill                                                                                         |
| I68  | **A control that leaves a page is disabled while it goes**: the flag is what ends react-aria's hover on a tree the App Router keeps                                                                                                        | review judgment                                                                                                                                                                                                                                                                                 |
| I69  | **Addresses are collected DISTINCT and each is sent its own message, all of them settled**: one person can hold two of the application's slots                                                                                             | `fl_frontend/src/features/bewerbungen/notifications.ts :: collectBewerbungEmpfaenger`; `:: settleFanOut`, which both public senders reach, keeps one refusal to its own recipient                                                                                                               |
| I70  | **Composing runs inside that settling, in an `async` callback**: a message that cannot be built is one rejected promise rather than a throw escaping `.map()`                                                                              | `fl_frontend/src/features/bewerbungen/notifications.ts :: settleFanOut`, reached through `:: sendBewerbungMail` and `:: sendBewerbungLinkMail`                                                                                                                                                  |
| I71  | **Every form runs `validationBehavior="aria"` and gates its submit through the shared `guardSubmit`, which are one mechanism rather than two**                                                                                             | `fl_frontend/src/shared/hooks/useDraftFieldErrors.ts :: guardSubmit`, which runs the write rather than answering a verdict a call site could drop; `fl_frontend/src/shared/hooks/useDraftFieldErrors.test.ts`                                                                                   |
| I72  | **A required field says the schema's own German, at the submit and for every control alike**: WCAG 3.3.1 wants the error named in text                                                                                                     | `fl_frontend/src/shared/components/ui/requiredMarking.test.ts`, which pins the asterisk rules and that no native `required` survives                                                                                                                                                            |
| I73  | **Absence counts `false`**, an unchecked required box being missing rather than wrong; **an empty ARRAY is a choice somebody made and is judged**                                                                                          | `fl_frontend/src/shared/hooks/useDraftFieldErrors.ts :: missingVerdicts`                                                                                                                                                                                                                        |
| I74  | **Refusal focus walks `form.elements` in document order**, `aria` leaving `reportValidity()` nothing to report                                                                                                                             | `fl_frontend/src/shared/hooks/useServerFieldErrors.ts :: focusFirstRefusal`                                                                                                                                                                                                                     |
| I75  | **A second `I18nProvider` anywhere below is the same defect narrowed to a subtree**, react-aria reading the nearest one                                                                                                                    | `fl_frontend/src/core/providers/documentLocale.test.ts`, which finds the mount by sweeping the tree rather than by name and fails on a second one                                                                                                                                               |
| I76  | **The one exception is structural: a confirmation or a spinner may be identified by the press that raised it**, `appToast.pending` taking no options                                                                                       | `fl_frontend/src/core/toastTitles.test.ts`, where a shared failure declaring itself identified by the press cannot be written at all                                                                                                                                                            |
| I77  | **The toast register is a table of claims, never a copy of the German**: a row states the variant and what identifies the raising                                                                                                          | `fl_frontend/src/core/toastTitles.test.ts`                                                                                                                                                                                                                                                      |
| I78  | **The link recipe sets no size, weight or layout**: folding them in erases the difference between a URL in running prose and a standalone action                                                                                           | `fl_frontend/src/shared/components/ui/textLink.ts :: textLink`                                                                                                                                                                                                                                  |
| I79  | **The two link tones are a ranking rather than a palette, so they may not resolve to one colour**                                                                                                                                          | `fl_frontend/src/shared/components/ui/textLink.test.ts`, which keeps the tones distinct                                                                                                                                                                                                         |
| I80  | **One shared component renders every panel heading**, which is what makes the heading level a single decision                                                                                                                              | `fl_frontend/src/shared/components/ui/PanelHeading.test.ts`, which fails any panel heading spelled outside the component                                                                                                                                                                        |
| I81  | **The hint shares the title's line box**: a text run's mass sits above that box's centre, so a flex row centring the two looks wrong                                                                                                       | `fl_frontend/src/shared/components/ui/hintTrigger.ts`                                                                                                                                                                                                                                           |
| I82  | **Composing such a value is harmless and the app does it; parsing it, calling into it or reaching through it at load ends the build**                                                                                                      | `fl_frontend/src/core/buildTimeEnv.test.ts`                                                                                                                                                                                                                                                     |
| I83  | **Two escapes, and neither is an exemption list**: defer the read into a function, or give it a fallback at the site                                                                                                                       | `fl_frontend/src/core/buildTimeEnv.test.ts`, whose reader is held against a synthetic sample carrying both (§1.9)                                                                                                                                                                               |
| I84  | **The only exempt names are the ones the builder itself sets**: a name added there is a claim about `fl_frontend/Dockerfile`, not a way past this                                                                                          | `fl_frontend/src/core/buildTimeEnv.test.ts`                                                                                                                                                                                                                                                     |
| I85  | **The normalisation is the renderer's, never trusted from the payload**: a length bound is no protection, and `trim` clears the ends alone                                                                                                 | `fl_frontend/src/core/bewerbungEmail.ts :: renderText`                                                                                                                                                                                                                                          |
| I86  | **A value in the column of facts is folded onto one line; one stated as a block keeps its breaks and gives up column 0**                                                                                                                   | `fl_frontend/src/core/bewerbungEmail.ts :: einzeilig` and `:: eingerueckt`                                                                                                                                                                                                                      |
| I87  | **Both payload ends refuse a wider class than the one forging a line**: a whole control class is cheaper to refuse than to reason about                                                                                                    | `fl_backend/app/shared/schemas/custom.py :: SINGLE_LINE_PATTERN` and `fl_frontend/src/features/bewerbungen/schemas.ts :: einzeiligerName`                                                                                                                                                       |
| I88  | **The two ends part company on a PADDED U+0085**, which Python's `str.strip` clears and JavaScript's `trim` does not: fail-closed, the form being the stricter side                                                                        | `fl_frontend/src/features/bewerbungen/schemas.test.ts`; I17 compares no pattern, so nothing else would report it                                                                                                                                                                                |
| I89  | **A value the prose states is normalised by its builder as well**, `renderText` never reaching one the column of facts does not also state                                                                                                 | `fl_frontend/src/core/bewerbungEmail.test.ts`                                                                                                                                                                                                                                                   |
| I90  | **Neither end makes the other redundant**: the refusal governs what is stored, the fold governs what is printed                                                                                                                            | review                                                                                                                                                                                                                                                                                          |
| I91  | **Each half of I47 carries its own failure**: `min-w-0` removes the floor, and a `flex-<n>` share splits FREE space two fixed widths have already spent                                                                                    | `fl_frontend/src/shared/components/ui/formFieldWidths.test.ts`, which reads the class lists off the TypeScript AST and floors each sweep before judging it                                                                                                                                      |
| I92  | **The website field needs the rule at both levels**: a floor left on the `InputGroup` renders the typed text outside its own border                                                                                                        | `fl_frontend/src/features/teams/components/forms/WebsiteUrlField.tsx :: WebsiteUrlField`, whose group and box each carry the floor's removal                                                                                                                                                    |
| I93  | **A read schema bounds no field.** A stored value outside a bound must still parse, or one row fails a whole list                                                                                                                          | `fl_frontend/src/shared/schemas.test.ts`, which parses a stored value the payload schema refuses                                                                                                                                                                                                |
| I94  | **A kit-colour swatch is filled from `fl_frontend/src/features/teams/constants.ts :: TRIKOT_FARBE_OPTIONS`' `hex`, never a Tailwind token**: the league's print colours answer to no theme scale                                           | `fl_frontend/src/features/teams/constants.ts :: trikotFarbeHex`, the one reader of that field                                                                                                                                                                                                   |
| I120 | **The frontend opens exactly one `MongoClient`, in `fl_frontend/src/core/db.ts`, and Auth.js is its only reader**: application data goes through FastAPI                                                                                   | Unenforced — no check sweeps for a second client; `fl_frontend/src/core/db.ts` is the only module importing `mongodb`, and `fl_frontend/src/core/auth.ts` its only importer                                                                                                                     |
| I121 | **Admin is `ALLOWED_ADMIN_EMAILS` rather than a stored role, and `fl_frontend/src/core/auth.ts :: isUserAdmin` decides it at sign-in and again on every session read** (§4)                                                                | Unenforced — no check counts the call sites; `fl_frontend/src/core/auth.ts` is the allowlist's only reader, `fl_frontend/src/core/config.ts` validating its shape (§1.7)                                                                                                                        |
| I122 | **`/admin` is guarded twice and rendering fails closed even if the matcher stops matching**: `fl_frontend/src/proxy.ts`, and `fl_frontend/src/features/admin/components/providers/AdminAuthGuard.tsx` inside the admin layout's `Suspense` | Unenforced — no check compares the two; `fl_frontend/src/app/admin/layout.tsx` places the second, above the page segment                                                                                                                                                                        |
| I135 | **Both auth lifetimes are set explicitly and below `@auth/core`'s defaults**: dropping either as redundant restores the library's, a far longer window                                                                                     | Unenforced — no check compares either against a default; `fl_frontend/src/core/auth.ts` holds both, each with the argument for its own value                                                                                                                                                    |
| I136 | **Every retirable editor's retirement banner names the exclusion in its title and what survives in its body, and points at no control**                                                                                                    | `fl_frontend/src/features/spielorte/components/forms/AdminSpielortEditForm/banners.test.ts :: the exclusion plus what survives, and points at no control`, and the same case in each other retirable editor's `banners.test.ts`                                                                 |
| I139 | **An unreadable kit-colour read degrades to the EMPTY set**: narrowing would withhold a colour nobody holds                                                                                                                                | `fl_frontend/src/app/(public)/bewerbung/[saison_id]/page.tsx :: Degraded to the EMPTY set`; `fl_frontend/src/features/bewerbungen/publicRoutes.test.ts :: degrades to the empty set rather than to a narrowed palette`                                                                          |
| I140 | **The privacy notice and the imprint are linked from every public page's footer and from the public application form**                                                                                                                     | `fl_frontend/src/shared/components/layout/footer/Footer.tsx`, `fl_frontend/src/features/bewerbungen/components/forms/BewerbungForm/FormKontaktpersonenSection.tsx`; unenforced, no test asserts either link, review holds it                                                                    |
| I147 | **The confirmation page renders every standing paragraph from the version it stamps**; the greeting, lead and age warning are the page's own                                                                                               | `fl_frontend/src/core/einwilligung.ts :: BESTAETIGUNG_ABSAETZE`, rendered by `fl_frontend/src/features/bewerbungen/components/views/BestaetigungHinweise.tsx`; `fl_frontend/src/features/bewerbungen/publicRoutes.test.ts :: renders every paragraph the version holds` and the cases beside it |
| I148 | **The confirmation page's stored wording label is the registry's, stamped by the route handler**: a label the browser sends is read and dropped                                                                                            | `fl_frontend/src/features/bewerbungen/utils.ts :: stampEinwilligungFassung`, called by `fl_frontend/src/app/api/bestaetigung/route.ts`; `fl_frontend/src/features/bewerbungen/utils.test.ts :: replaces whatever label the request carried with the registry's own`                             |

## 3. Violation → remedy

| Symptom                                                                                                                            | Cause                                                                                                                                                                                   | Remedy                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| An admin edit saves, but the list still shows the old data                                                                         | The entry carries only base tags, and only a granular tag was invalidated                                                                                                               | I2 — the base `updateTag`s must stay unconditional                                                                                                                       |
| A page never refreshes after a rollover                                                                                            | A rollover changes what an omitted `saison_id` resolves to, so it has to clear four tag families rather than one                                                                        | I25 — `fl_frontend/src/features/saisons/actions.ts :: invalidateRollover` must clear `saisons`, `spiele`, `spieltage` and `teams`                                        |
| A season's points change but the table still shows the old standings                                                               | The edit cleared `saisons` and not `teams`, and the table is scored from `rules` on every read                                                                                          | I25 — `invalidateSaisonAndTable` clears both, unconditionally rather than by comparing what moved                                                                        |
| A matchday list looks right and the playoff bracket's columns are in the wrong order                                               | Something re-sorted the matchdays on this side, so `orderRoundsByWiring` anchored on the wrong round                                                                                    | I27 — remove the sort; the order arrives correct from `order_spieltage`                                                                                                  |
| A matchday sits in the wrong place in the list                                                                                     | Its stored `position` is wrong, or it sits in the wrong `saison_phase`                                                                                                                  | I60 — no surface repairs either: both are the season's draw's, on no payload and written once                                                                            |
| A season is edited in Compass and the change never appears                                                                         | A hand edit invalidates nothing; only an action does                                                                                                                                    | I16 — accept the daily bound or recreate BOTH containers; the backend keeps a shorter season cache of its own ([`docs/backend/spec.md`](../backend/spec.md) I131)        |
| A field the admin form sends never reaches the database                                                                            | The Zod mirror does not declare it, so `strip` removes it before the body is sent; one that did reach the backend would be refused                                                      | I3 — pass it as an action argument, never on the patch body                                                                                                              |
| Pressing Speichern resets every edited field to its stored value, and the save confirmation opens listing 0 Hinweise               | The form passes a function to `action`, so React resets it on submit and react-aria pushes each field's mount-time value back through `onChange`                                        | I32 — submit through `runOnSubmit`; §1.10 carries the chain and why nothing in the toolchain reports it                                                                  |
| Saving fails with "Nichts wurde gespeichert, aber Deine Eingaben stehen unverändert im Formular", and no field is marked           | Refused on a path this form renders no input for: a draft field whose inputs have unmounted, or a payload key that never had one                                                        | I62 — retract a conditional field by its own condition. I34 — give a payload key an input, or enter it in `fl_frontend/src/core/refusalPaths.test.ts`'s exemption table  |
| The image build fails on a page that builds locally                                                                                | A page fetches without `await connection()`; the builder has no backend                                                                                                                 | I6 — add the guard before the fetch; it need not sit in the default export                                                                                               |
| A dynamic route throws at request time but the build passed                                                                        | A Server Component passes a render prop to a Client Component                                                                                                                           | I13 — restore the `"use client"` directive. No gate catches this one                                                                                                     |
| `updateTag` throws inside a route handler                                                                                          | Wrong function for the context                                                                                                                                                          | I14 — `revalidateTag` in route handlers, `updateTag` in server actions                                                                                                   |
| The three match cards look like duplication                                                                                        | Working as intended — they differ in chips, names and container (§1.6)                                                                                                                  | Nothing. Shared code leaves the cards as §1.6 says — a derivation into `utils.ts`, an atom into `components/ui/` — and never by a merge                                  |
| A cache tag exists but nothing ever clears it                                                                                      | A granular tag on a resource with no write surface                                                                                                                                      | I1 — add the matching `updateTag` in the same change, or delete the tag                                                                                                  |
| A server action fails with "An unexpected response was received from the server"                                                   | Something answered its POST with a redirect, so the client read HTML where an RSC payload belongs                                                                                       | `fl_frontend/src/proxy.ts` exempts any request carrying `next-action`; the action's own `getAdminSession()` refuses it instead                                           |
| A server action fails with "An unexpected response was received from the server", and the route keeps serving its old data         | A dynamic page awaited `params` at its own top level, so an `updateTag` from another route truncates the response                                                                       | I22 — await inside the page's `<Suspense>` boundary                                                                                                                      |
| A server action writes, but the screen does not change                                                                             | It was dispatched from a closure whose component has unmounted, so the router never applies its revalidation                                                                            | `updateTag` is required and NOT sufficient there — call `router.refresh()` when the result arrives (the undo toast)                                                      |
| A white outline appears on a control that already rings                                                                            | The base-layer focus rule painting over a HeroUI control                                                                                                                                | The unlayered opt-out in `globals.css` — HeroUI's own is `:not(:focus)`-gated and cannot fire on a focused element                                                       |
| A focus indicator appears after a plain mouse press                                                                                | Working as intended — react-aria's focus-visible modality is global and survives an earlier key press                                                                                   | Nothing. Opt the control out where its container already indicates focus — unless that container holds other tab stops its one indicator cannot tell apart               |
| A toast disappears before it can be read, or a spinner retires mid-request                                                         | The call site used HeroUI's `toast` directly, so it took the library's 4000 ms default                                                                                                  | I23 — raise it through `appToast`, which derives the duration and gives `pending` `timeout: 0`                                                                           |
| A toast renders unstyled or misaligned after a HeroUI upgrade                                                                      | HeroUI's upgraded stylesheet spells a vendored class differently from the toast rules in `globals.css`, so those rules match nothing                                                    | Re-read `@heroui/styles/dist/components/toast.css`; the rules say which version they were written against                                                                |
| A separating space vanishes and two classes fuse into one                                                                          | `prettier --write` trimmed a space at a class string's own edge                                                                                                                         | Put the separating space inside the template literal; the lint rule catches a literal abutting an interpolation, never two adjacent ones                                 |
| A hover or press animation snaps instead of easing                                                                                 | A hand-written `transition-[…]` names `transform`, but Tailwind v4 emits `scale-*`, `translate-*` and `rotate-*` as standalone properties; the `transition-transform` shorthand is safe | Name the property that actually changes; it runs both ways, `transform` being right where the movement is a library's own CSS (`fl_frontend/src/core/dismissControl.ts`) |
| A tooltip, menu or popover opens a screen-height below the control it names, on a public route only — one placed `bottom` included | `<html>` or `<body>` became a containing block, so react-aria measured a top-placed overlay's `bottom` against the viewport and CSS resolved it against the page                        | I29 — take whatever made the root a containing block off it; the overlay's own geometry is correct and needs no offset                                                   |
| A picker trigger's clear button sits in a different place depending on whether the team has left the season                        | The free space is parked on the badge with `ml-auto` instead of on the name span                                                                                                        | I61 — `flex-1 min-w-0 truncate` on the span; the badge and the clear button each carry their own `ms-2`                                                                  |
| A date field asks mm/dd/yyyy, or its segments reorder once the page finishes loading                                               | Nothing pinned the locale above it, so react-aria answered `en-US` under SSR and the browser's language after hydration                                                                 | I41 — the pin belongs at the root beside the other document-wide providers, never on the route that owns the field                                                       |
| A failure toast says only `Speichern fehlgeschlagen`, and nothing says which save                                                  | The call site raised a shared title with no description, so the only distinguishing half is missing                                                                                     | I42 — give it a description, or a title no other site raises                                                                                                             |
| A link in running text is invisible to a reader who cannot tell the colour from the text around it                                 | Its call site spelled the treatment inline and left the underline to a hover                                                                                                            | I43 — take `textLink`, whose base underlines; pick the tone, never the decoration                                                                                        |
| A section heading is read out with its hint's label appended, „Schule Hinweis zur Schule“                                          | The hint rendered inside the `<h2>`, and a heading names itself from its contents                                                                                                       | I44 — take `PanelHeading`; the hint is its child, beside the heading rather than in it                                                                                   |
| A decision mail's plain-text half states a fact the league never wrote, under the league's own name                                | An applicant-controlled value carried an interior break, and the text branch sets one fact to the line                                                                                  | I86 — `einzeilig` in the column of facts, `eingerueckt` for a block; I90 — the payload refusal is the second end, never the only one                                     |
| A form row runs off the side of the screen on a phone, or its gap sits outside the container the two fields share                  | A field in the row fixes a width for itself, or lost the `min-w-0` that removes its input's intrinsic-width floor                                                                       | I47 — `min-w-0`, a `flex-<n>` share and no width of its own; I92 — the website field needs that at both levels                                                           |

## 4. Known-open

| Item                                                                                                                                                 | State                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No guard proves a refusal message is German                                                                                                          | Accepted — detecting German needs a dictionary, and a list short enough to maintain fails an ordinary German sentence; §1.12 and review carry it instead                                    |
| Pydantic and Zod models are hand-mirrored                                                                                                            | Accepted — checked rather than generated (I17): patterns, lengths and messages stay each side's own, `fl_frontend/src/core/apiContract.test.ts` comparing neither                           |
| Revocation is out of band, never the session lifetime; `fl_frontend/src/features/auth/actions.ts :: signOutAction` is the admin's own sign-out       | Accepted — an operator revokes by removing the address from `ALLOWED_ADMIN_EMAILS`, which the `session` callback re-reads on every request                                                  |
| Next injects a polyfill bundle `browserslist` cannot cut                                                                                             | Accepted — `next/dist/build/polyfills/polyfill-module.js` ships unconditionally and no supported way to drop it exists; PageSpeed reports it under "Legacy JavaScript" in an unscored audit |
| The rules §1.8 records are enforced by a linter past end of life, whose current documentation describes a major version this repository does not run | Open — `fl_frontend/package.json` holds eslint at a 9.x line taking no further fix, so §1.8's decisions and I9's boundary rest on an unrepairable tool                                      |
