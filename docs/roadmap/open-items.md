# Open items

**Verified against:** `bb7a23b`, 2026-08-05

Findings and undecided questions with real analysis, plus the owner's ranked backlog. Each entry
keeps its full reasoning so the eventual decision is taken with the analysis in hand. The backend
audit prompts (`docs/_auditing/prompts/backend/`) seed several of these as their starting checks.

**Everything that has left this file is logged in [`closed-items.md`](closed-items.md)** — one row per
item, naming the commit that closed it. Look there before concluding that an id never existed.

## How this file is ordered

**Reading top to bottom is the suggested working order.** Entries are grouped into tiers, ordered
within each tier, and each entry that participates in a dependency carries a **Path** line naming
what it blocks or waits on. The five tests that produce that order — and the four things that must
not — are in the [README](README.md#how-the-file-is-ranked). Rank by what it costs to leave an item
undone, and let effort break ties toward the cheaper item.

Some entries are issue-shaped feature work parked here at the owner's direction, so that the
ordering lives in one place; the "this folder or a GitHub issue?" boundary in the
[README](README.md) still applies to everything else.

Effort scale: **S** — an afternoon · **M** — a day or two · **L** — a work package across several
sessions · **XL** — a programme touching data, schemas and UI end to end.

**Status vocabulary**, a closed set of five:

| Status       | Means                                                                                                                                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Open**     | Nothing decided, nothing blocking. Pick it up whenever.                                                                                                                                                                                                                  |
| **Decided**  | The argument is settled and recorded as an ADR; the work is not done. The entry is now an instruction, not a question.                                                                                                                                                   |
| **Blocked**  | Waiting on another entry that is still in this file. The `Depends on` column names which — a dependency marked _soft_ there is an ordering preference, not a block.                                                                                                      |
| **Standing** | No scheduled action — a caution, or a finding with a recorded trigger rather than a plan.                                                                                                                                                                                |
| **Closed**   | Concluded, awaiting removal. **This status exists for exactly one commit.** See [Closing an entry](README.md#closing-an-entry-two-commits-not-one) — the next commit deletes the entry, cites this one, and adds the item's row to [`closed-items.md`](closed-items.md). |

**Every status is re-derived whenever any entry is closed**, not only the entry that moved — `Blocked`
is a claim about another row, so a closure changes statuses nobody edited. The derivation is in the
[README](README.md#re-derive-every-status-not-just-the-one-you-touched).

## The path at a glance

| #   | ID    | Item                                                    | Surfaces    | Effort | Status   | Depends on                |
| --- | ----- | ------------------------------------------------------- | ----------- | ------ | -------- | ------------------------- |
| 1   | F7    | Hardcoded season badge on the landing page              | FE          | S      | Open     | — (clock: the rollover)   |
| 2   | FE-9  | Polite address form applied inconsistently              | FE          | S      | Open     | —                         |
| 3   | F2    | The Zod mirror is unverified                            | FE, BE      | M      | Open     | —                         |
| 4   | LOG-1 | Logging and error handling, surveyed then standardised  | FE, BE, Ops | L      | Open     | — (parallel-safe)         |
| 5   | FB-2  | Disqualification becomes a record, not a boolean        | FE, BE, DB  | M      | Open     | — (model decided)         |
| 6   | BE-9  | Replace the "TBD" placeholder team                      | BE, FE      | L      | Open     | —                         |
| 7   | FB-3  | Admin pages for team and spieler data                   | FE, BE      | L      | Open     | — (API built, ADR-0034)   |
| 8   | FB-6  | Admin pages for saisons and spieltage, and the rollover | FE, BE      | L      | Decided  | — (ADR-0033 settles it)   |
| 9   | FE-8  | `SpielCardCompact` does not survive a narrow screen     | FE          | S      | Open     | — (overlaps FE-3)         |
| 10  | BE-10 | Nothing caches the season document, read every request  | BE          | S      | Open     | —                         |
| 11  | FE-7  | The delete confirmation loses its backdrop blur         | FE          | S      | Open     | —                         |
| 12  | BE-13 | A malformed id is a 404 in a path, a 422 in a query     | BE          | S      | Open     | —                         |
| 13  | F1    | Two definitions of `ausstehend`                         | FE, BE      | S      | Open     | — (latest with FE-1)      |
| 14  | FB-4  | Playoff bracket: verify seeding, then auto-advance      | FE, BE      | M      | Blocked  | BE-9 (part 2 only)        |
| 15  | FE-4  | Mark the teams currently in a playoff place             | FE (+BE)    | M      | Open     | FB-4, FB-2 (both soft)    |
| 16  | FB-5  | `is_disqualified` inside `FLSpiel`'s team fields        | FE, BE      | S      | Blocked  | FB-2 (field shape)        |
| 17  | FB-7  | Cancelled matches are invisible in the games count      | FE, BE      | M      | Open     | — (batch with 16, 18, 19) |
| 18  | FE-2  | Optional per-game notes                                 | FE (+BE)    | S      | Open     | — (batch with 16, 17, 19) |
| 19  | FE-1  | Date ranges instead of specific dates                   | FE (+BE)    | XL     | Open     | — (batch with 16, 17, 18) |
| 20  | FE-3  | TeamDetailsView rework                                  | FE          | M      | Blocked  | FB-2                      |
| 21  | FE-5  | Filters for the Spielsuche                              | FE          | M      | Open     | — (F1 informs it)         |
| 22  | FE-6  | A way to report an error from the error page            | FE          | S      | Open     | LOG-1 (soft)              |
| 23  | BE-12 | Nothing purges a row whose `inactive_since` is old      | BE, DB      | M      | Open     | — (ADR-0032's follow-on)  |
| 24  | BE-7  | `typing` imports instead of `collections.abc`           | BE          | —      | Standing | audit pass B4             |
| 25  | BE-6  | `CustomObjectId` validates nothing in JSON mode         | BE          | —      | Standing | audit pass B2             |
| 26  | OPS-2 | Nothing validates the contents of a restored `.env`     | Ops         | —      | Standing | trigger recorded          |
| 27  | OPS-3 | Crawler policy split between robots.txt and Cloudflare  | Ops         | —      | Standing | trigger recorded          |

---

## Tier 1 — leverage and clocks

The two cheapest come first on purpose: each is an afternoon, and each makes what is written after
it correct by default rather than needing a second pass. F7 leads on its clock — left alone it
puts the wrong year on the landing page at a rollover nobody will be watching. F2 follows them
because four entries in tier 3 are schema changes and it is what makes a schema change safe. Then
LOG-1, the two model decisions three later entries consume, and last the two admin surfaces, which
turn an API nothing calls into something an operator can use and end the reference caches' staleness
window as a side effect.

### 1 · F7 — The landing page's season badge is hardcoded

`fl_frontend/src/app/(public)/page.tsx` renders "Saison 2026" as a literal. It is not derived from
the current season, so at the rollover the badge will still name the old year while the fixtures
below it — which _are_ season-aware — already show the new one.

Low severity and cosmetic, but it fails silently and on a date nobody will be watching. Documented
at the line; wiring it to `getCurrentSaison()` would give this page a data fetch it does not
currently have — a real trade-off rather than an obvious fix.

**Path:** independent, but deadline-bound — decide before the next season rollover.

### 2 · FE-9 — The polite address form is not applied consistently

**Owner's item, 2026-08-04.** User-facing content addresses the reader informally but politely —
**`Du`, `Dein`, `Dir`, `Dich`, capitalised** — and never as `Sie` or `Ihr`.

**The site is already mixed**, measured across `fl_frontend/src` on 2026-08-04. Capitalised: the
Kontakt and Team page descriptions (`erfährst Du`), `KontaktView` (`für Dein Anliegen`, `bei Dir`).
Lowercase: the Spielsuche description (`die Spiele deines Teams`), `MetaTeamView`
(`lernst du die Personen`), `SignInForm` (`Prüfe dein Postfach`), `ConfirmDeleteModal`
(`Möchtest du`, `Bist du dir`), the sign-in emails in `fl_frontend/src/core/authEmail.ts`, and eight
copies of `Bitte überprüfe deine Eingaben!` across four files — three each in the `schiedsrichter` and
`spielorte` slices' `actions.ts`, one in `spiele`, and one in `InlineCreateAutocomplete`. The
capitalising pages are not internally consistent either — the Kontakt description reads `wie Du dich`,
both forms in one sentence.

**A sentence-initial `Du` is capitalised in German whatever the convention holds**, so occurrences
such as "Du hast Fragen zum Turnierablauf" are not evidence either way and are not counted above.

Two things this needs beyond the sweep itself:

- **A recorded rule, or it decays the same week.** A one-off pass fixes today's strings and the next
  component reintroduces the mixture. The rule belongs where a session about to write German copy
  will actually read it; `docs/frontend/overview.md` and CLAUDE.md are the candidates, and choosing
  between them is part of this item.
- **A scope line.** German inside `/docs` and in code comments addresses developers, not users, and
  is out. The sign-in emails are user-facing and are in.

Whether anything mechanical can hold the rule is open. A lint rule matching the standalone words is
plausible — word boundaries keep it off `du` inside longer words — but it would also have to be
scoped to user-facing strings, and nothing in the tree marks which literals those are.

**Path:** independent. Every later item that writes copy — FE-5, FE-6, FB-7 — is cheaper after it.

### 3 · F2 — The Zod mirror of the Pydantic models is unverified

`fl_backend/app/api/spiele/schemas.py` and `fl_frontend/src/features/spiele/schemas.ts` (and their
siblings) are maintained as mirrors with **no generation step and no check**. This is the main drift
risk across the boundary and the first thing to check when behaviour looks impossible.

**Owner's item, 2026-08-04: find a way to verify the frontend schemas against the backend's, and
possibly generate them.** That is what moves this entry out of the standing cautions — it now has a
plan rather than a trigger.

**The repository has already answered this question once, for a third copy of the same shapes.**
[ADR-0031](../_decisions/0031-the-third-copy-of-the-schema-is-checked-not-generated.md) keeps the
`$jsonSchema` validators hand-written and makes drift a test failure:
`fl_backend/tests/core/test_constraints.py :: test_every_mirrored_model_matches_its_validator`
compares field names in the default tier, in under half a second, with no database. Read that ADR before choosing —
its argument transfers in part, and the part that does not transfer is where this decision lives.

**What exists to build on.** FastAPI publishes an OpenAPI document describing every endpoint's
shapes, which is what either a checker or a generator would read. It carries no service-level `title`
or `description` and its Swagger UI is not publicly routed (`docs/backend/spec.md`, Known-open), but
the document itself is complete.

**Why generation is not obviously the answer.** The Zod schemas carry things an OpenAPI document
cannot express: per-field German error messages, the draft types that let a currency field be `null`
while it is mid-edit, and the patch payload composed from the read model's own field schemas rather
than redeclared. A generated file cannot hold those, so generation means a generated core plus a
hand-written layer over it — two files where there is one, and the drift moves into the layer.
Checking has the opposite trade: it costs a test, and it catches only what it compares, so a check on
field names alone leaves constraints unverified.

**What could not be verified:** whether any generator handles the Pydantic-to-Zod direction well
enough to be worth the dependency. Nothing was evaluated, and naming a tool here without trying it
would be the guess this file exists to avoid.

**Path:** this is why FB-5, FB-7, FE-2 and FE-1 are batched — until it lands, every schema change is
a doubled edit that nothing checks. Landing it first turns that batch from a risk into ordinary work.

### 4 · LOG-1 — Logging and error handling, surveyed then standardised

**Owner's item, 2026-08-02. A consultation programme in two stages, ending in a recorded
standard.**

**Stage 1 — survey and feedback.** Examine the current state of logging in **all three parts** of
the repo — frontend, backend, dev ops — covering **production logging and dev logging** alike. Go
over all three implementations and give the owner feedback on each.

**Stage 2 — standardise.** Help the owner fully customise the logging conventions: bulletproof,
**best-practice conform**, and consistent across the three surfaces. This explicitly includes
**error handling on both the backend and the frontend, and the connection between the two** — how a
failure crossing the boundary is represented and handled on each side. Examine the custom error
classes and the machinery around them (`APIMalformedDataError` and its siblings in `core/api.ts`,
the structured logger, `instrumentation.ts` / `onRequestError`, FastAPI's error responses).

**Standing reminder the owner asked to be given:** consider adding a `trace_id` to **every**
request, not just failing ones. Evidence this is worth deciding deliberately: the API client sets
`X-Correlation-ID` on every outgoing request (`core/api.ts`), yet a Server Component crash on
2026-08-02 logged `<NO_TRACE_ID>` — the id exists on one path and does not reach others.

**Output:** a recorded convention (ADR or `docs/_standard/` entry — decide with the owner), and the
code brought to it.

**Path:** independent — nothing blocks it and it blocks nothing, so it can run alongside anything
else in this file. FE-6 waits on the identifier it settles.

### 5 · FB-2 — Disqualification becomes a record, not a boolean

**Owner's item, 2026-08-02.** Find a way to handle disqualifications properly. Currently teams can
only **be** disqualified — a bare `is_disqualified` flag on the `saison_teams` junction row — but
there should be a way to record **the reason, the date of disqualification, etc.**

**The model is decided: an embedded object on the `saison_teams` junction row**, replacing the
boolean in place. The structure review took this on 2026-08-02: a disqualification is season-scoped
by definition and there is exactly one per team per season, so a separate collection buys a join and
nothing else at this size — 17 junction rows in total. What remains open is the **field set** beyond
reason and date, which is a product question rather than a structural one.

Known consumers once the record exists:

- the DQ badge in `TeamPopoverMenu` and on the Saisontabelle,
- FE-3's "note on disqualified teams" in `TeamDetailsView`,
- FB-5's embedded field shape — settled by
  [ADR-0028](../_decisions/0028-store-what-was-true-then-derive-what-is-true-now.md): the flag is
  **joined** into `FLSpiel`, not denormalised into it, so whatever this item stores on the junction
  is what FB-5 reads. There is no second copy to keep in step.
- FB-3's admin pages, which are the natural place to enter reason and date.
- FE-4, which has to decide whether a disqualified team can hold a playoff place.

**Path:** the structural half is settled; the field set is not. Feeds FB-5, FE-3, FE-4 and FB-3 —
decide the fields here before those consume them.

### 6 · BE-9 — the "TBD" placeholder team

**State: open. The more interesting of the two backend items, and the one with a clear right
answer.**

An unresolved playoff opponent is currently a **real team document** named "TBD", with
`is_placeholder: true` — plus a `saison_teams` junction row for every season it appears in.

It works. It is also a lie in the data model, and it costs in three places:

1. **A junction row nobody is prompted to create.** Because team data is season-scoped
   (`saison_teams`), the placeholder needs its own row per season. Nothing prompts for it, and its
   absence makes the placeholder vanish from team queries for that season — the strict join drops
   it.
2. **A two-character shorthand for a non-team**, `TBD_TEAM_SHORTHAND = "??"`, which exists only to
   satisfy `FLSpielTeamFieldSchema.shorthand`'s `length(2)`.
3. **Special-casing in the edit form.** `FormMatchupSection` must exempt the placeholder from the
   "a team cannot play itself" rule, and `FormTeamPicker` carries a whole free-text-name mechanism
   so each bracket slot can read "Sieger HF1" rather than every slot reading "TBD".

**One fact measured on 2026-08-02 that the fix has to preserve.** That free-text mechanism is already
in the data: matches 29, 30 and 31 embed `team1.name` / `team2.name` values reading `"Sieger 25."`,
`"Sieger 26."`, `"Sieger 29."` and so on, while the `teams` document they reference reads `"TBD"`. So
the embedded team field is **not** a copy of `teams.name` — it carries a bracket slot label that
exists nowhere else in the database. Nullable opponent references delete the reference; they do not
by themselves provide a home for the label, and every bracket slot would read the same thing without
one. Decide where the label lives as part of this item.
[ADR-0028](../_decisions/0028-store-what-was-true-then-derive-what-is-true-now.md) keeps the embedded
team fields for exactly this reason.

**The textbook fix:** nullable opponent references on `FLSpiel`, and delete the placeholder team.
"Opponent not yet known" is then modelled directly instead of impersonated.

**Why it has not been done:** it is a schema change across the backend model, the frontend Zod
mirror, and the bracket rendering — every consumer of `team1`/`team2` has to handle null. That is a
real scope, not an afternoon.

**Its natural moment has arrived and passed once already.** BE-4 built season setup as a real flow —
`POST /teams/{team_id}/saisons` is where a junction row now comes from — and the placeholder needs one
like any other team, which `docs/workflows/README.md` names as a step nothing prompts for. FB-6 is the
page that will make that omission visible, so decide this model before or alongside it; the alternative
is the first season created without the TBD row breaking a bracket.

**Path:** shapes FB-4's auto-advance — writing a winner into the next match's slot is exactly the
operation the placeholder currently fakes, so decide this model before building that workflow.

### 7 · FB-3 — Admin panel pages for team and spieler data

**Owner's item, 2026-08-02, with emphasis: make new admin panel pages for editing team and spieler
data.**

What exists to build on: the generic `AdminCrudView` / `AdminCrudShell` pair was built precisely so
"a third admin resource would otherwise be a third copy" — Schiedsrichter and Spielorte are
per-entity declarations over it, and teams/spieler would be the third and fourth.

**The backend is done.** BE-4 built full CRUD for both, resource-first with the id in the path
([ADR-0034](../_decisions/0034-the-write-path-is-resource-first-in-a-second-router.md)): `POST`,
`PATCH`, `DELETE` and `POST /{id}/reactivate` on `/teams` and `/spieler`, plus the season junctions at
`/teams/{team_id}/saisons/{saison_id}` and `/spieler/{spieler_id}/saisons/{saison_id}`. Nothing calls
any of them. This item is the UI over an API that already exists.

Three things that API decided, which the pages inherit rather than choose:

- **Soft deletion is a date** ([ADR-0032](../_decisions/0032-soft-deletion-is-a-date-not-a-flag.md)).
  A list needs `include_inactive=true` to show retired rows at all, "delete" is a stamp rather than a
  removal, and bringing something back is its own explicit action.
- **A create can come back 409**, because a retired row keeps its slot in the unique index. The form
  has to say so — "that shorthand belongs to a retired club, reactivate it instead" — rather than
  reporting a generic failure.
- **A team never leaves a season**; disqualification is the only way out (ADR-0033), so the junction
  editor has no delete control to build.

**Three things the 2026-08-02 database inspection hands this item:**

- **A team rename must fan out into `spiele`, and nothing does that today.** Venues and referees have
  a fan-out (`patch_spielort`, `patch_schiedsrichter`); teams do not, only because no endpoint can
  rename a team yet. This page is that endpoint. Without a `patch_many_in_db` over `spiele` matching
  `team1.team_id` / `team2.team_id`, every match card shows the old name indefinitely — measured
  today at zero drift across all 31 matches, and that is the state to preserve. See
  [ADR-0028](../_decisions/0028-store-what-was-true-then-derive-what-is-true-now.md), rule 3.
- **`position` and `stufe` are free text and have already split.** Across 362 player rows:
  `Mittelfeld` 121, `Abwehr` 118, `Angriff` 86, `Tor` 29 — plus `Sturm` ×2, `TW` ×1 and `?` ×5, where
  `Sturm` and `Angriff` are the same position and so are `TW` and `Tor`. `stufe` has `??` ×2. Small
  today because nothing groups by position; it stops being small the moment this page offers a field
  to type into. Make both a closed set here — a `Literal` in Pydantic and a select in the form — and
  normalise the eight stray rows in the same change.
- **`schiedsrichter.kontakt` is null on all seven referees**, both `email` and `telefon`, while the
  model, the Zod mirror and the frontend all carry the shape. Either it is a field waiting for a use
  or it is weight; this is the page that would give it one. It is personal data, so unused is the
  safe state — decide deliberately rather than by default.

**Path:** unblocked. The natural UI home for FB-2's reason/date entry — build
these with that form section in mind.

### 8 · FB-6 — Admin pages for saisons and spieltage, and the rollover control

**Opened 2026-08-03, when BE-4 closed.** BE-4 built every endpoint a season rollover needs and no page
calls one, so the rollover is still done by hand against an API that already exists — which is strictly
worse than before it existed, because the runbook now names an endpoint per step and nothing prompts for
a step that is skipped.

**What the pages are.** A `saisons` editor over the same `AdminCrudView` / `AdminCrudShell` pair FB-3
uses, plus a `spieltage` editor. The season form covers dates and `rules.win_points` / `draw_points`;
`status` is on no payload and must not appear on one
([ADR-0033](../_decisions/0033-one-active-season-and-one-path-to-it.md)). `spieltage` is mostly
`order_val`, which the bracket orders by and the date does not.

**The rollover control is the substantive part**, and it is one button calling
`POST /saisons/{saison_id}/activate` — which demotes the incumbent and promotes the target in one
transaction, and is the only code path that writes `status` at all.

**The all-games-finished precondition belongs here, not at the endpoint.** ADR-0033 rejected a guard in
the backend deliberately: an early rollover is a legitimate decision, and the one case where someone
genuinely needs to activate a season is when the data is _not_ in the state a rule would assume. So this
page shows what is incomplete — matches without an `ergebnis`, in the outgoing season — and lets the
operator proceed anyway.

**An email reminder for the rollover, which the owner asked explicitly be recorded.** The rollover
happens twice a year at most, by hand, on a date nobody is watching — the same failure mode F7's
hardcoded badge has. What triggers it, where it is sent from, and whether it belongs in the frontend at
all are open; a scheduled job reading `saisons.end_date` is the obvious shape.

**It also ends the reference caches' staleness window.** A page that saves through these endpoints
invalidates its own cache tags as it saves — the durable fix
[ADR-0035](../_decisions/0035-reference-data-staleness-is-bounded-by-cache-lifetime.md) defers to,
landing together with FB-3 and not before.

**Path:** independent; the API is built. Batch with FB-3, which is the same shell over the same
generic components. If `rules` gains FE-4's qualifier count, this is the form that edits it.

---

## Tier 2 — an afternoon each, and the value is already understood

None of these blocks anything, and under the rubric that is not a reason to rank them below a work
package. Two are visible defects, two are cheap questions with a live cost, and one is a query paid on
every public request. Ordered by what each returns for the afternoon it takes.

### 9 · FE-8 — `SpielCardCompact` does not survive a narrow screen

**Owner's item, 2026-08-04:** the card does not resize properly on mobile, and the button that opens
the details modal is the worst of it.

**Where it is.** The card's metadata row is one `flex-row` holding the date, a dash, the time, a
`SaisonPhaseChip` and — pushed right by `ml-auto` — a fixed 32×32 icon button. Nothing in that row may
wrap or shrink: the date and time spans carry `w-full` inside a `w-fit` parent, and the button's size
is fixed in both dimensions. The teams row directly below it is a three-track grid built for exactly
this problem, with `minmax(0,1fr)` tracks and `truncate` on both names. **The two rows of one card
follow different rules, and only one of them was written for narrow screens.**

**It renders in one place.** `TeamDetailsView` is the card's only consumer, which bounds the blast
radius of a fix and also means this and FE-3 touch the same screen.

**Not diagnosed further**, and the width at which it first breaks is not recorded. Verify against the
local stack at a real mobile viewport rather than a dev server, and record the breakpoint before
changing classes.

**Path:** independent. FE-3 reworks the view this card renders in, so doing them in either order is
fine, but doing them together avoids reading the same layout twice.

### 10 · BE-10 — Nothing caches the season document, and every request reads it

**Owner's item, 2026-08-02. Widened the same day, when the league table started being scored with the
season's `rules`.**

The backend defaults `saison_id` to the current season when none is passed
([ADR-0002](../_decisions/0002-omitted-season-means-current.md)) and **looks it up every time**.
`pull_current_saison` (`fl_backend/app/api/saisons/crud.py`) is the single resolution point, and
`/spiele`, `/spieltage`, `/teams` and `/saisons/current` all route through it, so most public traffic
pays a Mongo query for an answer that changes once a year.

**Two things make this expensive.**

- **The query is not only for the default season.**
  [ADR-0026](../_decisions/0026-team-statistics-are-derived-from-spiele.md) makes `GET /teams` score
  the derived table from the season's `rules.win_points` / `draw_points`, so it reads the season
  document on **every** call, including calls that name a season explicitly.
  `pull_saison_id_and_rules` folds both halves into one query, which is the cheap part of the fix and
  is in place; the round trip itself is what remains.
- **`rules` is about as static as data gets.** It has never changed, and a season that changed its
  points scheme mid-season would be a different competition. The same is true of which season is
  active — twice a year at most, and by hand.

The consideration that makes it non-trivial is still **invalidation**. Seasons are edited by hand
today — the endpoints exist and no UI calls one (FB-6) — so no code path observes the active season
flipping or the points changing in practice; a naive process-lifetime cache serves the old answer
until a restart. Two candidates
([ADR-0035](../_decisions/0035-reference-data-staleness-is-bounded-by-cache-lifetime.md) removed a
third — there is no frontend revalidation route to hook): **a TTL measured in minutes**, which
bounds the staleness without needing an event and mirrors how the frontend's own reference caches
are bounded; or **a drop on the write path BE-4 built** — `PATCH /saisons/{saison_id}` and
`POST /saisons/{saison_id}/activate` are the only writes that can change either answer, and they
are the exact points where a process-lifetime cache drops with no staleness at all. The write-path
hook is the cheapest and cleanest, but it covers only edits that go through the API, and today none
do — so it wants the TTL as its backstop until FB-6 exists.

**Path:** independent. Nothing blocks it.

### 11 · FE-7 — The two-step delete confirmation loses its backdrop blur

**Owner's item, 2026-08-04.** Reproduction: open a delete confirmation, press the first `Löschen`.
The dialog advances to its second step and the blurred backdrop behind it goes flat.

**The blur is not this modal's.** It is `ModalShell`'s `Modal.Backdrop variant="blur"`, which
`FormModal` renders too — so a fix has to be checked against the create and edit dialogs, not only
this one. `SpielDetailsModal` is the exception: it declares its own backdrop with the same
`variant="blur"` and is deliberately not on the shell (owner decision, recorded in its module header),
which makes it both a second place the same bug could appear and the one modal the public ever sees.

**What changes at that moment** is `ConfirmDeleteModal` swapping the step-1 paragraph for the step-2
alert panel, which enters with `animate-in fade-in slide-in-from-bottom-4`.

**A hypothesis, and it has not been tested.** A transform animation starting inside an element that
sits under a `backdrop-filter` ancestor is a known way to make a browser stop applying the filter,
because the compositing layers beneath it are rebuilt. **Test it by removing those animation classes
before changing anything else** — if the blur survives, the cause is confirmed and the fix is to
animate a property that does not promote the element, or to move the animation out of the backdrop's
subtree. Which browsers reproduce it is also not recorded; establish that first, because a
Chromium-only compositing artefact and a general CSS mistake have different fixes.

Verify against the local stack, never `next dev`.

**Path:** independent.

### 12 · BE-13 — A malformed id is a 404 in a path and a 422 in a query

**Owner's item, 2026-08-04**, asking for one predictable rule.

**What is true today**, and both halves are uniform within themselves:

- **A path segment: 404.** `by_id()` (`fl_backend/app/core/routing.py :: by_id`) spells every
  id-addressed route with the `objectid` convertor, whose regex is 24 hex characters, so
  `/spiele/not-an-id` matches no route and never reaches a handler. Every ObjectId-addressed resource
  uses it. `saisons` differs only because a season id is a four-character string and never an
  ObjectId at all.
- **A query parameter: 422.** `GET /spieler?team_id=not-an-id` reaches the filter model, where
  `team_id` is a `CustomObjectId`, and Pydantic rejects the value.

**The proposed rule cannot be implemented as stated.** "Twenty-four characters and not a valid
ObjectId" is an empty set: every 24-character hex string constructs an ObjectId, and a 24-character
string that is not hex fails the convertor's regex and so never reaches validation. There is no case
in between for a rule to catch.

That leaves two consistent rules, and the cheaper one may be the one already in force:

| Rule                                       | Means                                              | Costs                                                                                                                                                                                                                                                                                               |
| ------------------------------------------ | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A path identifies, a query validates**   | 404 from a path, 422 from a query — today's answer | Nothing but writing it down. It is a real distinction: a path names a resource and there is no such resource, while a query carries input and the input is wrong                                                                                                                                    |
| **One status for a malformed id anywhere** | Either drop the convertor, or 404 a bad query id   | Dropping the convertor re-opens what `app/core/routing.py` exists to prevent: `/spiele/action_required` is captured by `/{spiel_id}`, and the router include order in `app/main.py` becomes load-bearing and silent. The two routes cannot share a router — they differ in authorization (ADR-0034) |

**Either way `docs/backend/spec.md` §4 gains a row.** It lists five error codes and says nothing
about a malformed id, which is why the behaviour reads as accidental.

**Path:** independent. May well end as a documentation change and no code at all.

### 13 · F1 — Two definitions of `ausstehend`

`build_spiele_filter` (`fl_backend/app/api/spiele/services.py :: build_spiele_filter`) filters
`spiel_status="ausstehend"` as `datum >= today`, **including today**. `computeSpielStatus`
(`fl_frontend/src/features/spiele/utils.ts :: ausstehend`) derives `ausstehend` as `datum > today`,
**excluding today** — a match today is `heute`.

Consequence: a match today is returned by the "upcoming" query and then labelled `heute` by its own
card. On the landing page's _Nächste Begegnungen_ that is very likely the desired behaviour.

**Verify the intent before changing either side.** Tightening the server bound to `>` would
silently drop today's matches off the landing page. Not filed as a bug. Related: the client takes
cancellation first (`isCanceled` wins over any date), while the server treats `is_canceled` and
`datum` as independent filters. Seeded into backend audit pass B2's semantic-contracts check.

**Path:** independent, but settle it at the latest inside FE-1, whose date ranges change these
semantics anyway. FE-5 would expose these semantics as a user-facing filter, so it inherits the
answer.

---

## Tier 3 — the work those decisions carry

Dependency order. Ranks 17–20 all touch `FLSpiel` or `FLTeamStatistik`, their Pydantic/Zod mirrors and
`AdminEditSpielDataForm`. **Batch them**: until F2 lands, every separate schema change is a doubled
edit that nothing checks, so one coordinated pass beats four. BE-12 closes the tier because it becomes
real only once FB-3 or FB-6 makes retiring a row possible at all.

### 14 · FB-4 — Playoff bracket: verify the seeding, then auto-advance winners

**Owner's item, 2026-08-02, in two parts.**

**Part 1 — validate the matchups.** The playoff tree possibly does not have the right matchup. The
owner's example: if matches 25–28 are the quarter-finals with teams 1–8 remaining, then the first
matchup needs to be team 1 vs team 3 — _he thinks_, and explicitly asks: **check online what is
normal for a playoff tree and consult him** before changing anything. This needs validation and
possible fixing.

Context to check against when the item is worked (verify against an authoritative source, then
decide **with** the owner):

- Seeded single-elimination convention: quarter-finals pair 1v8, 2v7, 3v6, 4v5, arranged in halves
  so the top two seeds can only meet in the final (semis pair 1v4 and 2v3 if seeds hold).
- Group-based knockout convention (this league has four groups, A–D): winners meet runners-up
  across groups — A1–B2, B1–A2, C1–D2, D1–C2 — keeping same-group teams apart until late.

Which convention this league intends, and whether "1 vs 3" matches either, is exactly the
consultation requested. Note the bracket orders by `spieltage.order_val`, not by date.

**Part 2 — auto-advance winners.** When winners in a previous stage emerge, automatically update
the following game's matchup — the owner's example: team A wins and team B loses the first
quarter-final, so the correct semi-final gains team A. **A backend workflow**, triggered by result
entry. Open questions to settle when built: re-propagation when a result is edited or a match
cancelled after advancement, and what fills the slot before a winner exists — which is BE-9.

**Path:** part 2 depends on BE-9's model (nullable opponent refs are the thing auto-advance
fills). Part 1 is cheap — a check plus a consultation — and can be pulled forward at any time; it
answers half of FE-4, which asks the same question from the table's end.

### 15 · FE-4 — Mark the teams currently in a playoff place in the Saisontabelle

**Owner's item, 2026-08-04:** give the teams that would proceed to the playoffs a visual distinction
in the Saisontabelle — normally the top two of each group.

**The rendering is the easy half.** `SaisontabelleView` receives each group already ranked, so a
marker is a row style plus a line of legend copy. Everything that makes this an M rather than an
afternoon is deciding what "would proceed" means.

- **Nothing in the system knows how many teams advance.** `FLSaison.rules` carries `win_points` and
  `draw_points` and nothing else, so a `2` written into the component is a constant of exactly the
  kind [ADR-0026](../_decisions/0026-team-statistics-are-derived-from-spiele.md) refused for 3/1/0
  and F7 still has in the landing page. `rules` is the obvious home, and putting it there makes a
  season with a different bracket representable — which is also the form FB-6 would edit.
- **The ranking has two keys and qualification needs a third.**
  `FLGruppen.from_teams` sorts each group by points, then goal difference, descending. A further tie
  falls back to the alphabetical order the pipeline delivered, because `build_team_pipeline` sorts by
  `name` and Python's sort is stable. That is a fine display order and it is not a qualification rule:
  **marking row 2 asserts a distinction the sort cannot actually make.**
- **A team with no counting match ranks on zeros.** The pipeline substitutes `ZERO_STATISTIK` where
  nothing matched, so a team that has played nothing sits at 0 points and 0 difference — above every
  team with a negative difference. `SaisontabelleView` already prints `N/A` instead of a placement for
  those rows, and a marker keyed on row index would decorate one regardless.
- **A disqualified team stays in the table** (the junction lookup in `build_team_pipeline` filters
  nothing out), so one can hold a marked place. Whether it should is FB-2's record to answer.

**Path:** the same question as FB-4's part 1 from the other end — that item decides which qualifiers
meet whom, this one decides who qualifies, and the two must agree. Soft dependency on FB-2 for the
disqualified case.

### 16 · FB-5 — `is_disqualified` inside `FLSpiel`'s team fields

**Owner's item, 2026-08-02.** In order to display the DQ badge in **every** `TeamPopoverMenu`, the
`FLSpiel` object needs `is_disqualified` in its `team1` and `team2` dictionaries respectively, so
it does not need to be fetched separately. (Today the badge renders only where a caller happens to
have team data in hand — the grids and the Saisontabelle — and never on the Spiel cards.)

The wrinkle that makes this more than a field add: `team1`/`team2` are **embedded** in the spiel
document, while `is_disqualified` lives season-scoped on the `saison_teams` junction.

**That wrinkle is decided.**
[ADR-0028](../_decisions/0028-store-what-was-true-then-derive-what-is-true-now.md), 2026-08-02:
**join the flag from `saison_teams`; do not denormalise it into the embedded team fields.** A
disqualification changes _during_ a season, so a fan-out would run on the field most likely to be
forgotten, and a stale DQ badge is a visibly wrong answer on a public page. Denormalising it would
also put season-scoped state into a document that has deliberately never carried any.

**The cost, stated plainly, because it is the bulk of this item.** `GET /spiele` is a plain
`pull_many_from_db` with a filter — no aggregation pipeline at all, and it is the most-read endpoint
on the site (landing page, every grid, the bracket). Joining the flag means converting it to an
`aggregate` with a `$lookup` into `saison_teams`, keyed on both team ids and the season. That is real
work on a hot path, for a badge, and it was chosen over the cheaper fan-out deliberately — read the
ADR before reversing it.

Whatever shape FB-2 gives the record, this reads it rather than copying it, so the two cannot drift.

**Path:** field shape depends on FB-2; the storage question is settled. Batch with FB-7, FE-2 and
FE-1 (same schema surfaces, one mirror pass — see F2).

### 17 · FB-7 — Cancelled matches are invisible in the Saisontabelle's games count

**Owner's item, 2026-08-04:** a team showing fewer games than its group's fixtures should say why.
The sketch is `Spiele: 2 +1` in two colours, with a tooltip on hover for a pointer and on tap for
touch.

**What the number actually counts.** `anzahl_gespielte_spiele` counts matches carrying an `ergebnis`
with both `tore` present (`fl_backend/app/api/teams/services.py :: build_statistik_lookup_stage`). **A
cancelled match that has a result already counts** — it is a forfeit, and
[ADR-0026](../_decisions/0026-team-statistics-are-derived-from-spiele.md) settles that. So a missing
game is a match with no result at all, and that covers two different situations: cancelled without a
result, and not yet played.

**Verify which one is behind the numbers before designing the badge.** The owner's reading is that
they are cancellations; the pipeline cannot currently tell the two apart, and a badge that says
"cancelled" about a fixture that simply has not happened yet is worse than no badge.

**What it costs.** `FLTeamStatistik` carries seven fields and no eighth. A count of cancelled matches
is a new field in the aggregation, the Pydantic model and the Zod mirror — a schema change, which is
why it belongs in the batch rather than on its own.

**Where it approaches a ratified decision.** ADR-0026 keeps `is_canceled` out of the counting rule,
and this item would be the first thing to read that flag inside the same pipeline. A separate,
clearly-named count is not a reversal — **the scoring must not change** — but the boundary belongs in
a comment at the stage, because the next reader will see `is_canceled` in a pipeline an ADR says does
not consult it.

**The tooltip is an accessibility question rather than a device question.** A trigger that is
focusable and announced gives the tap behaviour on touch and the hover behaviour on a pointer without
branching on the device at all.

**Path:** batch with FB-5, FE-2 and FE-1 — one schema and mirror pass (see F2). Its display half
depends on nothing.

### 18 · FE-2 — Optional per-game notes

**Owner's item, 2026-08-02.** Add a place for **small notes on every game** — optional, containing
information about the game such as exciting moments. **Editable in the admin form**
(`AdminEditSpielDataForm`).

An optional field on `FLSpiel` in both mirrors, a form section, and a display decision (where the
note appears — `SpielDetailsModal` is the obvious candidate) that is deliberately left open here.

**Path:** batch with FB-5, FB-7 and FE-1 — same form, same schemas, one mirror pass.

### 19 · FE-1 — Date ranges instead of specific dates for games (heavy)

**Owner's item, 2026-08-02.** At some point, implement **date ranges** instead of specific dates
for games. A heavy change, in the owner's scoping: it would change `AdminEditSpielDataForm`, the
schemas, and possibly logic and UI elements **across the board**.

Known touchpoints to scope against when it is worked: `datum` in both schema mirrors and the DB
documents; `computeSpielStatus`'s date comparisons; `formatSpielDisplay` and the card layouts;
`sort_by=datum` on the backend; `searchable_datum` in the Spielsuche; and F1's `ausstehend`
semantics — a range makes the ausstehend/heute/vergangen ternary genuinely harder, so settle F1's
intent at the latest here.

**Path:** batch with FB-5, FB-7 and FE-2 (one schema/mirror/form pass). Resolves or restates F1.

### 20 · FE-3 — TeamDetailsView rework

**Owner's item, 2026-08-02.** Rework `TeamDetailsView` to look nicer — **especially the saison
progress line at the bottom**, which should also include important notes and milestones like "went
to playoffs".

Contents the rework must carry:

- the **full statistics** of the team, which this view already shows and is now the only surface
  that does. The Saisontabelle counts the Gruppenphase; this page asks `GET /teams` for
  `statistik_scope=gesamt` and counts every phase
  ([ADR-0029](../_decisions/0029-the-league-table-counts-the-gruppenphase.md), 2026-08-02). **The data
  question is settled and the fetch is already written** — what remains here is presentation, plus the
  line of copy that currently explains the difference and should survive the rework in some form;
- a **note on disqualified teams**, which is where FB-2's reason and date get displayed.

**Path:** waits only on FB-2 now. Doing the visual rework before the disqualification record exists
would mean reworking it twice. FE-8 fixes the compact card this view is the only consumer of.

### 21 · FE-5 — Filters for the Spielsuche, and Spielhistorie as one of them

**Owner's item, 2026-08-04:** add filters to the Spielsuche, after which Spielhistorie could simply
link into it with a "past" filter instead of existing as its own page.

**How close the two already are.** `SpielsucheView` fuzzy-searches client-side across seven keys over
the season already fetched, and shows nothing until the user types. `SpielhistoriePage` fetches a
different query — `spiel_status: "vergangen"`, sorted by date descending — and hands it to the same
card list. The pages differ by a server-side filter and a sort order, not by their interface.

Three things to settle when it is worked:

- **Where a filter runs.** The view filters in memory over one season, which is what makes it feel
  instant and why it cannot find a match outside the selected season. A status filter can work the
  same way, but F1 records that the two ends define `ausstehend` differently — a filter labelled for
  users inherits that disagreement and makes it visible.
- **What the URL carries.** `useDebouncedUrlQuery` already puts the search text in the URL; a filter
  set has to go there too or a shared link loses it, and `resolveSaisonId` is already reading
  `searchParams` on these routes.
- **Whether Spielhistorie stays.** It has its own metadata, canonical URL and Open Graph entry, and
  it is named in both `fl_frontend/src/features/dashboard/constants.ts` and
  `fl_frontend/src/app/sitemap.ts`. Folding it into the Spielsuche is a routing and search-visibility
  decision as much as a UI one: a redirect keeps the URL working, deleting the route does not.

**Path:** independent. Inherits whatever F1 decides.

### 22 · FE-6 — A way to report an error from the error page

**Owner's item, 2026-08-04, with the evaluation he asked for**: is a report affordance worth having
when everything is already logged?

**Worth having, narrowly, for one thing the logs cannot cover.** `onRequestError` records server
errors and `StatusPanel` shows the digest that makes one greppable — but the digest is written
server-side, and `fl_frontend/src/app/error.tsx` says so at the line: server errors are redacted to a
message plus a digest, "client errors are the user's own code". A client-side render crash therefore
reaches the same boundary with nothing to quote and nothing recorded. What the user was doing is in no
log either, and it is usually the difference between a report that reproduces and one that does not.
**Confirm the client-side case against the local stack before building anything** — it is the whole
justification, and it has not been reproduced.

**Keep it to a `mailto:`.** The Kontakt page already publishes the address, so a link carrying the
digest, the route and the time in its subject costs one component and adds no write path. A form
posting to an endpoint would be a public, unauthenticated write on a site whose backend is otherwise
reached only by server-side fetches — a new abuse surface for the same information.

**Do not build it before LOG-1.** That item decides whether every request carries a trace id; an
affordance built first would quote an identifier LOG-1 may replace.

**Path:** soft dependency on LOG-1's identifier decision. Nothing waits on it.

### 23 · BE-12 — Nothing purges a row whose `inactive_since` is old enough

**Opened 2026-08-03, when BE-4 closed. It is the reason that field is a date rather than a boolean**
([ADR-0032](../_decisions/0032-soft-deletion-is-a-date-not-a-flag.md)).

Six collections now carry `inactive_since`: `teams`, `spieler`, `saison_spieler`, `spieltage`,
`spielorte`, `schiedsrichter`. A retired row stays forever, keeps its slot in whatever unique index
covers it, and is filtered out of every default read. Nothing removes one, ever.

**Today that is fine and the numbers say so.** Nothing is retired anywhere: 0 rows across all six,
against 17 teams, 362 players, 362 squad rows, 6 matchdays, 6 venues and 7 referees. This is a
prospective item, opened so the field's purpose is recorded rather than rediscovered.

**What a purge has to answer, none of it decided:**

- **How old is old enough**, and is it one threshold or one per collection? A venue nobody has booked
  for three years and a squad row from a season that was played are different kinds of stale.
- **What still references the row.** This is the hard half and it is why the delete was soft in the
  first place: `spiele` embeds a copy of a venue, a referee and both teams, and references each by id.
  A purge that is not preceded by a reachability check reintroduces exactly the orphaned references
  ADR-0032 refused. `saison_spieler` is the one collection with no such embedding.
- **Whether `uniq_shorthand` releasing two letters is a feature or a hazard.** Purging a retired club
  frees its shorthand for reuse, which is the point — and it also means a future club can hold letters
  that historical matches still name, if any survived the check above.
- **What runs it.** A scheduled job, a script the owner runs like the backfill, or an admin control.
  The repository has no scheduler today, which makes the middle option the cheapest by a distance.

**The two collections without the field are not oversights.** `saisons` has no delete at all and
`saison_teams` has none either (ADR-0033), so neither can accumulate anything to purge.

**Path:** independent, and genuinely not urgent — it becomes real the first time something is retired,
which needs FB-3 or FB-6 to exist. Doing it before then is designing against zero rows.

---

## Tier 4 — standing cautions and watch items

No scheduled action. Each of these has a recorded trigger rather than a plan, and an owner elsewhere:
two are seeded into backend audit passes, two into ops.

### 24 · BE-7 — `typing` imports instead of `collections.abc`

Several backend modules import `Mapping`/`Sequence`/`Optional`/`Callable` from `typing` — aliases
deprecated since Python 3.9, on a project running far newer. **Deliberately not fixed piecemeal:**
modernising one module while the rest keep the old spelling is worse than uniformity. The recorded
decision is to enable ruff's `UP` rules and migrate in one pass — which backend audit pass B4's
typing check owns.

### 25 · BE-6 — `CustomObjectId` validates nothing in JSON mode

Its `json_or_python_schema` passes a bare `str_schema()` for the JSON branch, so
`model_validate_json` accepts **any string** as an ObjectId while `model_validate` rejects it.
Unreachable through FastAPI today, which validates already-parsed dicts — which is precisely why
the existing tests certify a guarantee that holds in only one of the two modes. If anything ever
routes through `model_validate_json`, an arbitrary string reaches a Mongo `_id` filter. Found
2026-07-30. Seeded into backend audit pass B2's validation-mode check.

### 26 · OPS-2 — nothing validates the contents of a restored `.env`

**Found 2026-08-01**, the hard way, during the server re-clone that followed the history rewrite.

`deploy.sh` checks that `fl_backend/.env`, `fl_frontend/.env`, `nginx/prod.conf` and `certs/` all
**exist** before it pulls anything, and Compose refuses to start a service whose `env_file` is
missing. **Nothing checks that a value inside those files is well-formed**, and both `.env` files are
gitignored — so every server restore recreates them by hand, unverified.

**What that cost.** The restore produced a `MONGODB_URI` whose host had been truncated from
`…mongodb.net` to `…mon>`, most likely a shell redirection swallowing part of the string as the file
was written. Every preflight passed: file present, key present, URI syntactically parseable. pymongo
then resolved an SRV record that cannot exist, the startup ping raised `ConfigurationError`, the
backend crash-looped, nginx never started because it waits on `service_healthy`, and the site was
down until the character was found by reading a stack trace.

**Nothing checks a restored value today**, manually or automatically. A restore recreates both
`.env` files by hand from the password manager, every existing preflight tests only that files and
keys exist, and a malformed value surfaces as a container that never becomes healthy — diagnosed
from its log, not from any check.

**The options, none obviously right:**

| Option                                                  | Catches                                 | Cost                                                                                     |
| ------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------- |
| Leave it unchecked                                      | Nothing automatically                   | Zero. The failure is loud, contained and roughly ten minutes to diagnose once recognised |
| Name-presence preflight in `deploy.sh`                  | A missing key                           | Small. **Would not have caught this incident** — the key was present and merely wrong    |
| Resolve the Mongo SRV record in `deploy.sh` before `up` | Exactly this class, plus a dead cluster | Adds a network dependency to a deploy step, and a DNS blip becomes a refused deploy      |

**The trade to weigh** is that the third option is the only one that would have helped, and it makes
deployment fail for reasons unrelated to the deployment. Given the failure is already contained —
nginx serves nothing rather than serving something broken — the honest question is whether a faster
diagnosis is worth a new way for `deploy.sh` to refuse.

**Trigger to revisit:** the second time a restore breaks this way, or any move to a setup where the
site cannot tolerate the minutes between a bad deploy and a human reading the log. Ops audit pass O1
(`_auditing/prompts/ops/1-build-deploy.md`, check 4) covers script failure modes and owns this.

### 27 · OPS-3 — the crawler policy is split between robots.txt and Cloudflare, and neither knows about the other

**Found 2026-08-01 while diagnosing a missing WhatsApp link preview. Not acted on.**

`app/robots.ts` disallows nine named AI crawlers, `meta-externalagent` among them. That file is a
**request**: robots.txt is advisory and a crawler chooses whether to obey it.

Cloudflare is separately enforcing something stronger. Measured against the live site:

| User-Agent                | page | image |
| ------------------------- | ---- | ----- |
| `WhatsApp/2.x`            | 200  | 200   |
| `facebookexternalhit/1.1` | 200  | 200   |
| `Twitterbot/1.0`          | 200  | 200   |
| `meta-externalagent/1.1`  | 403  | 403   |

The 403 carries `Server: cloudflare` and a `CF-RAY`, and `nginx/prod.conf` contains zero user-agent
or `deny` rules — so the block is an edge setting, made in a dashboard this repository does not
configure and does not record.

**Why it matters, and why it is not urgent.** Link previews on Meta's products are fetched by
`facebookexternalhit`, which is served normally, so nothing is broken today. The risk is that Meta
has been consolidating its crawlers: if preview fetching ever moves behind `meta-externalagent`, every
WhatsApp and Facebook preview for this site stops working, the failure is silent, and nothing in the
repository would explain it. The 403 is invisible from the codebase.

**What a rework has to decide, rather than assume:**

- Whether the AI opt-out belongs in robots.txt, at the edge, or both — and if both, which one is the
  source of truth when they disagree. They already disagree in kind: one asks, one enforces.
- Whether blocking an agent Meta also uses for product features is the intended trade. The opt-out
  was aimed at training, not at previews.
- Whether the edge configuration should be recorded here at all, given `docs/ops/overview.md` states
  that this repository does not configure Cloudflare. A setting that can break a user-visible feature
  and leaves no trace in the repo is the argument for writing it down somewhere.

**Cheap early-warning:** re-run the four-agent table above after any Cloudflare bot-protection change,
and whenever previews are reported broken. It takes one `curl` per agent and distinguishes an edge
block from a markup problem immediately — which is exactly the distinction that cost time this round.
