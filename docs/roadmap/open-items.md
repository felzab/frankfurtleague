# Open items

**Verified against:** `3a460d7`, 2026-08-02

Findings and undecided questions with real analysis, plus the owner's ranked backlog (added
2026-08-02). The original entries migrated here from the documentation programme's ledger when that
file was retired (2026-08-01); each keeps its full reasoning so the eventual decision is taken with
the analysis in hand. The backend audit prompts (`docs/_auditing/prompts/backend-*.md`) seed several
of these as their starting checks.

**Everything that has left this file is logged in [`closed-items.md`](closed-items.md)** — one row per
item, naming the commit that closed it. Look there before concluding that an id never existed.

## How this file is ordered

**The file is ranked (owner, 2026-08-02): reading top to bottom is the suggested working order.**
Entries are grouped into tiers, ordered within each tier, and each entry that participates in a
dependency carries a **Path** line naming what it blocks or waits on. Some entries are issue-shaped
feature work parked here at the owner's direction, so that the ordering lives in one place; the
"this folder or a GitHub issue?" boundary in the [README](README.md) still applies to everything
else.

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

| #   | ID    | Item                                                     | Surfaces    | Effort | Status      | Depends on              |
| --- | ----- | -------------------------------------------------------- | ----------- | ------ | ----------- | ----------------------- |
| 1   | LOG-1 | Logging and error handling, surveyed then standardised   | FE, BE, Ops | L      | Open        | — (parallel-safe)       |
| 2   | DB-2  | The database enforces its own invariants                 | DB, BE, Ops | M      | **Decided** | — (ADR-0027; work open) |
| 3   | BE-4  | Write paths for `saisons`, `spieler`, `spieltage`        | BE, FE      | L      | Open        | — (after DB-2, soft)    |
| 4   | BE-9  | Replace the "TBD" placeholder team                       | BE, FE      | L      | Open        | — (BE-4's moment, soft) |
| 5   | FB-2  | Disqualification becomes a record, not a boolean         | FE, BE, DB  | M      | Open        | — (model decided)       |
| 6   | FB-3  | Admin pages for team and spieler data                    | FE, BE      | L      | Blocked     | BE-4                    |
| 7   | FB-4  | Playoff bracket: verify seeding, then auto-advance       | FE, BE      | M      | Blocked     | BE-9 (part 2 only)      |
| 8   | FB-5  | `is_disqualified` inside `FLSpiel`'s team fields         | FE, BE      | S      | Blocked     | FB-2 (field shape)      |
| 9   | FE-1  | Date ranges instead of specific dates                    | FE (+BE)    | XL     | Open        | — (batch with 8, 10)    |
| 10  | FE-2  | Optional per-game notes                                  | FE (+BE)    | S      | Open        | — (batch with 8, 9)     |
| 11  | FE-3  | TeamDetailsView rework                                   | FE          | M      | Blocked     | FB-2                    |
| 12  | BE-10 | Nothing caches the season document, read every request   | BE          | S      | Open        | —                       |
| 13  | F7    | Hardcoded season badge on the landing page               | FE          | S      | Open        | — (before rollover)     |
| 14  | OPS-4 | One output standard for `scripts/`                       | Ops         | M      | Open        | — (batch with OPS-5)    |
| 15  | OPS-5 | Scripts and CI, audited and optimised for what they cost | Ops         | M      | Open        | — (batch with OPS-4)    |
| 16  | F1    | Two definitions of `ausstehend`                          | FE, BE      | S      | Open        | — (latest with FE-1)    |
| 17  | F2    | Pydantic and Zod models are hand-mirrored                | FE, BE      | —      | Standing    | standing caution        |
| 18  | BE-7  | `typing` imports instead of `collections.abc`            | BE          | —      | Standing    | audit pass B4           |
| 19  | BE-6  | `CustomObjectId` validates nothing in JSON mode          | BE          | —      | Standing    | audit pass B2           |
| 20  | OPS-2 | Nothing validates the contents of a restored `.env`      | Ops         | —      | Standing    | trigger recorded        |
| 21  | OPS-3 | Crawler policy split between robots.txt and Cloudflare   | Ops         | —      | Standing    | trigger recorded        |

---

## Tier 1 — foundations and enablers

LOG-1 is independent and parallel-safe — the reason it sits high is that every item below it is
easier to debug once it lands. DB-2 puts the constraints under the hand-editing that is currently the
only write path for three resources, which is why it precedes BE-4 rather than following it. The
last two are the data-model decisions that later features build on.

### 1 · LOG-1 — Logging and error handling, surveyed then standardised

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
else in this file. Every later item benefits from landing it early.

### 2 · DB-2 — The database enforces its own invariants

**Decided 2026-08-02, [ADR-0027](../_decisions/0027-the-database-enforces-its-own-invariants.md).
This entry carries the work, not the argument — read the ADR for why.** Found by the database
structure review, measured read-only against the live database on the same day.

Nine collections, and **not one validator or one index beyond `_id_`**. Neither costs anything in
performance and neither ever will — the whole database is about 130 KB and a season adds roughly that
much. What it costs is correctness, and the bill has already arrived.

**Step 1, and it is a live defect — do it first, and independently of the rest.** Two
`saison_spieler` rows carry `team_id: "Lessing-Gymnasium"`, a string where every other row carries an
`ObjectId`, and it is the team's `full_name` rather than a reference. Consequences today: Lessing's
squad page shows 21 players and the team has 23, and `GET /spieler` without a `team_id` returns
**422** (verified against the running backend) because `FLSpieler.team_id` refuses the string. No
call site does that today, so it is latent — one call site away from an outage nothing in the code
would explain. The fix is two documents in Compass, pointing at `_id` `69f534402e6b2243ba2f97d2`
(`name: "Lessing"`). **A unique index cannot be built over data that violates it, so this precedes
step 3 regardless.**

**Step 2 — `$jsonSchema` validators on every collection**, transcribed from the Pydantic models
rather than invented: BSON types, required fields, and the enumerations that are already `Literal`s
in Python (`saison_phase`, `gruppe`, `status`). Deliberately **not** ranges, formats or cross-field
rules — those stay Pydantic's job, and copying them would triple the drift surface F2 already warns
about. **`saison_teams` has no model of its own**, so its validator is transcribed from the documents
as they are — which is safe because they no longer carry a dead `statistik`: that field was `$unset`
from every row on 2026-08-02, executing
[ADR-0026](../_decisions/0026-team-statistics-are-derived-from-spiele.md).

**Step 3 — unique indexes on the four rules that are true today and enforced by nobody:**
`saison_teams` one row per `(saison_id, team_id)`, `saison_spieler` one per `(spieler_id, saison_id)`,
`spiele.spiel_nr` unique within a season, and `teams.shorthand` unique. Each was verified to hold on
2026-08-02; each would break silently. **Indexes for query performance are out of scope** — at this
size they would be theatre.

**Step 4 — declare both in the application and apply them at startup**, in `app/core/db.py`'s
lifespan or a module it calls. Never clicked into the Atlas console: a constraint that lives only in
a dashboard is invisible to this repository, unreviewable, and lost on a cluster restore. Startup
must fail loudly if a constraint cannot be applied, not skip it.

Two smaller findings from the same inspection, worth folding into whichever pass touches the data:

- **`spiele.ort.mietpreis` is an `int` in 13 documents and a `double` in 12.** Every float value is
  integral (`80.0`, `0.0`), so Pydantic accepts them all and nothing is visibly wrong. The split
  traces to origin — values written through the admin form arrive as `int`, hand-entered ones as
  `double`. A validator with `bsonType: "int"` both catches and prevents it, so normalise the
  existing rows in the same change.
- **`spieltage.anzahl_spiele` is a stored count of something countable**, maintained by hand, and
  correct on all six matchdays as measured. It is the same pattern
  [ADR-0026](../_decisions/0026-team-statistics-are-derived-from-spiele.md) removed for `statistik`
  and is the obvious second candidate. Recorded, **not decided** — it is a far smaller change and
  nothing forces it now.

**Path:** independent, and should precede BE-4. Hand-editing in Compass is the only write path for
`saisons`, `spieler` and `spieltage` until BE-4 lands a work package from now, so this is the control
for exactly the period it is most needed. BE-4 then inherits a database that already enforces what
its endpoints would have to.

### 3 · BE-4 — no write path for `saisons`, `spieler`, `spieltage`

**State: open.** No FastAPI write endpoints exist for these three resources. They are edited
**directly in MongoDB** — Compass, or an ad-hoc script. The application can only read them.

Two consequences follow. The frontend caches them for a day with no way to know they changed, which
is why [ADR-0015](../_decisions/0015-backend-triggered-revalidation-route.md) exists and why
`scripts/revalidate_reference_data.sh` has to be run by hand after such an edit. And nothing
validates the edit: the Pydantic models constrain what is _read_, so a bad value written directly
is discovered when a page fails to parse it, not when it is saved.

**What building it would resolve:** the manual revalidation step disappears entirely — a real write
path revalidates itself like every other mutation, and ADR-0015 becomes superseded rather than
merely retired. It would also put the season's `rules.win_points` / `draw_points` under validation,
which matters if the statistics calculation is ever wired to read them instead of hardcoding 3/1/0.

**Cost:** three CRUD surfaces plus admin UI for data that changes a few times a year.

**What DB-2 changes about the second half of that.** Once the database validates its own documents
([ADR-0027](../_decisions/0027-the-database-enforces-its-own-invariants.md)), these endpoints are not
introducing validation where there was none — they are agreeing with constraints Mongo already
enforces, which is a smaller and better-specified job. The `$jsonSchema` is the shape; Pydantic adds
the ranges and cross-field rules on top. The **"exactly one active season"** invariant is the one
DB-2 deliberately leaves alone: a validator cannot express it, so it stays this item's to enforce.

**Path:** blocks FB-3 (spieler editing needs a spieler write path) and is BE-9's recorded natural
moment. Follows DB-2 naturally rather than strictly. Also gives BE-10 an invalidation hook it
otherwise lacks.

### 4 · BE-9 — the "TBD" placeholder team

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

**The natural moment is when BE-4's season write path is built**, because that is when season setup
becomes a real flow and the placeholder's junction rows would otherwise need to be created there
too — or the first time a season is created and the missing TBD row breaks a bracket.

**Path:** shapes FB-4's auto-advance — writing a winner into the next match's slot is exactly the
operation the placeholder currently fakes, so decide this model before building that workflow.

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

**Path:** the structural half is settled; the field set is not. Feeds FB-5, FE-3 and FB-3 — decide
the fields here before those consume them.

---

## Tier 2 — features, in dependency order

Ranks 8–10 all touch `FLSpiel`, its Pydantic/Zod mirrors and `AdminEditSpielDataForm`. **Batch
them**: F2's hand-mirrored schemas make every separate schema change a doubled edit with drift
risk, so one coordinated pass beats three.

### 6 · FB-3 — Admin panel pages for team and spieler data

**Owner's item, 2026-08-02, with emphasis: make new admin panel pages for editing team and spieler
data.**

What exists to build on: the generic `AdminCrudView` / `AdminCrudShell` pair was built precisely so
"a third admin resource would otherwise be a third copy" — Schiedsrichter and Spielorte are
per-entity declarations over it, and teams/spieler would be the third and fourth.

What is missing underneath: `spieler` has **no write path at all** (BE-4), and teams have only the
statistics-increment write — no full CRUD endpoints. Both need backend surfaces before the pages
can exist.

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

**Path:** blocked by BE-4 for spieler. The natural UI home for FB-2's reason/date entry — build
these with that form section in mind.

### 7 · FB-4 — Playoff bracket: verify the seeding, then auto-advance winners

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
fills). Part 1 is cheap — a check plus a consultation — and can be pulled forward at any time.

### 8 · FB-5 — `is_disqualified` inside `FLSpiel`'s team fields

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

**Path:** field shape depends on FB-2; the storage question is settled. Batch with FE-1 and FE-2
(same schema surfaces, one mirror pass — see F2).

### 9 · FE-1 — Date ranges instead of specific dates for games (heavy)

**Owner's item, 2026-08-02.** At some point, implement **date ranges** instead of specific dates
for games. A heavy change, in the owner's scoping: it would change `AdminEditSpielDataForm`, the
schemas, and possibly logic and UI elements **across the board**.

Known touchpoints to scope against when it is worked: `datum` in both schema mirrors and the DB
documents; `computeSpielStatus`'s date comparisons; `formatSpielDisplay` and the card layouts;
`sort_by=datum` on the backend; `searchable_datum` in the Spielsuche; and F1's `ausstehend`
semantics — a range makes the ausstehend/heute/vergangen ternary genuinely harder, so settle F1's
intent at the latest here.

**Path:** batch with FB-5 and FE-2 (one schema/mirror/form pass). Resolves or restates F1.

### 10 · FE-2 — Optional per-game notes

**Owner's item, 2026-08-02.** Similar in surface to FE-1: add a place for **small notes on every
game** — optional, containing information about the game such as exciting moments. **Editable in
the admin form** (`AdminEditSpielDataForm`).

An optional field on `FLSpiel` in both mirrors, a form section, and a display decision (where the
note appears — `SpielDetailsModal` is the obvious candidate) that is deliberately left open here.

**Path:** batch with FB-5 and FE-1 — same form, same schemas, one mirror pass.

### 11 · FE-3 — TeamDetailsView rework

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
would mean reworking it twice.

---

## Tier 3 — independent items, schedule freely

Nothing here blocks or is blocked. Ordered by urgency: BE-10 is now on the hot path of every public
request, and F7 has a real deadline.

### 12 · BE-10 — Nothing caches the season document, and every request reads it

**Owner's item, 2026-08-02. Widened the same day, when the league table started being scored with the
season's `rules`.**

The backend defaults `saison_id` to the current season when none is passed
([ADR-0002](../_decisions/0002-omitted-season-means-current.md)) and **looks it up every time**.
`pull_current_saison` (`fl_backend/app/api/saisons/crud.py`) is the single resolution point, and
`/spiele`, `/spieltage`, `/teams` and `/saisons/current` all route through it, so most public traffic
pays a Mongo query for an answer that changes once a year.

**Two things make this worse than it was when the item was written.**

- **The query is no longer only for the default.** Since
  [ADR-0026](../_decisions/0026-team-statistics-are-derived-from-spiele.md), `GET /teams` needs the
  season's `rules.win_points` / `draw_points` to score the derived table, so it reads the season
  document on **every** call — including calls that name a season explicitly, which previously touched
  the `saisons` collection not at all. `pull_saison_id_and_rules` already folds both halves into one
  query, which is the cheap part of the fix and is done; the round trip itself is what remains.
- **`rules` is about as static as data gets.** It has never changed, and a season that changed its
  points scheme mid-season would be a different competition. The same is true of which season is
  active — twice a year at most, and by hand.

The consideration that makes it non-trivial is still **invalidation**. Seasons are edited directly in
Mongo today (BE-4), so no code path observes the active season flipping or the points changing — a
naive process-lifetime cache serves the old answer until a restart. The candidates: a TTL measured in
minutes, which bounds the staleness without needing an event; a hook on the ADR-0015 revalidation
route, which already exists and already fans a `saisons` edit out to the frontend's `spiele`,
`spieltage` and `teams` caches, so the backend cache is the one participant missing; or BE-4's future
write path. **Prefer the second if it can be made to work** — it is the only one where the existing
operational step (`./scripts/revalidate_reference_data.sh saisons`) already fires at exactly the right
moment, and it makes the frontend and backend caches invalidate from one action rather than two.

**Path:** independent; BE-4 would later give it a third invalidation hook. Nothing blocks it.

### 13 · F7 — The landing page's season badge is hardcoded

`fl_frontend/src/app/(public)/page.tsx` renders "Saison 2026" as a literal. It is not derived from
the current season, so at the rollover the badge will still name the old year while the fixtures
below it — which _are_ season-aware — already show the new one.

Low severity and cosmetic, but it fails silently and on a date nobody will be watching. Documented
at the line; wiring it to `getCurrentSaison()` would give this page a data fetch it does not
currently have — a real trade-off rather than an obvious fix.

**Path:** independent, but deadline-bound — decide before the next season rollover.

### 14 · OPS-4 — One output standard for `scripts/`

**Owner's item, 2026-08-02. A consultation item, ending in a recorded standard.**

Go over **all scripts** again and optimise their outputs — the way things are printed to the
terminal: **highly informative, readable, and consistent across every script**. The process the
owner wants: **provide options** (candidate output styles), **consult him on what he likes best**,
then apply the winner everywhere.

What exists today: `scripts/_lib.sh` already centralises `step` / `ok` / `warn` / `die`, so the
scripts share a vocabulary — the standard would formalise and extend it rather than start from
nothing.

**The decided standard must be recorded** — the owner asked for this explicitly. Candidate homes:
`scripts/README.md` (where script conventions already live) or `docs/_standard/`; decide with him.

**Path:** independent. **Batch with OPS-5** — both require reading every script in `scripts/` end to
end, and doing that twice is the only real cost either of them carries.

### 15 · OPS-5 — Scripts and CI, audited and optimised for what they cost

**Owner's item, 2026-08-02.** A full audit and following optimisation of **all scripts** and **the
whole CI pipeline**.

**This is a latency and structure item, and never a cost item.** `felzab/frankfurtleague` is public
and GitHub Actions is free on standard runners for public repositories with no minute cap, so every
second saved here buys developer waiting time and nothing else. Stating it up front because the
obvious framing — "optimise CI" — usually means a bill, and here there is none to reduce.

**The baseline, measured 2026-08-02** from the public Actions API over every completed run the API
returns:

| Workflow | Trigger        | n   | Median | Max  |
| -------- | -------------- | --- | ------ | ---- |
| `verify` | `pull_request` | 27  | 136s   | 157s |
| `verify` | `push` to main | 27  | 217s   | 411s |
| `codeql` | `pull_request` | 28  | 59s    | 73s  |
| `codeql` | `push` to main | 26  | 88s    | 169s |

The two workflows run concurrently, so a pull request waits on `verify` — about **136 seconds** —
and `codeql` is free in wall-clock terms. On `main` the full gate's two image builds are what
separate 217s from the PR's 136s, and the 411s outlier is what an uncached build costs.

**What this item should answer, none of it decided:**

- **Is `--quick` on a pull request and the full gate on `main` still the right split?** It is the
  single decision that shapes both numbers above, and `verify.yml` already documents the case where
  it is not sufficient (`src/core/config.ts`, `src/core/auth.ts`, `src/instrumentation.ts`).
- **Is `verify` a required status check on `main` at all?** The unauthenticated API reports
  `required_status_checks.enforcement_level: "off"` with no contexts — but that endpoint does not see
  repository **rulesets**, so it proves nothing and has to be read from the repository settings. If
  nothing is required, CI is advisory and a red pull request is mergeable, which would outrank every
  optimisation question in this entry.
- **Does the pipeline pay for work it does not need?** A backend-only change currently pays for
  `pnpm install` and `next build`; both workflows check out and set up independently; and
  `verify.sh` runs `pnpm verify` with prettier in **write** mode, which then requires a tree-diff
  step in CI to catch what the formatter just changed. Splitting jobs by surface and running the
  formatter in check mode are both real options with real trade-offs.
- **Are the `uv` and `pnpm` caches actually hitting?** Both are configured; neither is measured.
- **Inside `scripts/`, is the ordering still right?** `verify.sh` runs its six steps serially,
  cheapest-to-fail-first, which is a deliberate and good property — the question is whether any
  independent step could overlap without losing it.

**Two boundaries, so this does not become a third copy of work already scoped.**

- **Ops audit pass O1 owns correctness** (`_auditing/prompts/ops-1-build-deploy.md`): its check 4
  asks whether each script does what its header claims, and its check 5 builds the gate's coverage
  map and verifies `verify.yml` runs what it says. **This item asks what the pipeline costs and
  whether its structure is right** — a different question about the same files. Cite O1's findings
  here; never re-report them.
- **OPS-4 owns terminal output.** It is the same reading pass over `scripts/` for a different
  purpose, which is why the two are batched rather than merely adjacent.

**Path:** independent, and batched with OPS-4. **It has already inherited one job.**
[ADR-0030](../_decisions/0030-a-real-mongod-behind-a-deselected-marker.md) added `backend-db` to
`verify.yml` on 2026-08-02, running the backend tests that need a real `mongod`. That job is marked
provisional in the workflow itself and its shape belongs to this entry — merge it, cache it, put it
behind a path filter, or leave it. The `db` **marker** is not provisional and is not yours to change:
it is a property of the test suite, and `pytest -m db` selects those tests under any arrangement.

### 16 · F1 — Two definitions of `ausstehend`

`build_spiele_filter` (`fl_backend/app/api/spiele/services.py:30-31`) filters
`spiel_status="ausstehend"` as `datum >= today`, **including today**. `computeSpielStatus`
(`fl_frontend/src/features/spiele/utils.ts:16-17`) derives `ausstehend` as `datum > today`,
**excluding today** — a match today is `heute`.

Consequence: a match today is returned by the "upcoming" query and then labelled `heute` by its own
card. On the landing page's _Nächste Begegnungen_ that is very likely the desired behaviour.

**Verify the intent before changing either side.** Tightening the server bound to `>` would
silently drop today's matches off the landing page. Not filed as a bug. Related: the client takes
cancellation first (`isCanceled` wins over any date), while the server treats `is_canceled` and
`datum` as independent filters. Seeded into backend audit pass B2's semantic-contracts check.

**Path:** independent, but settle it at the latest inside FE-1, whose date ranges change these
semantics anyway.

---

## Tier 4 — standing cautions and watch items

No scheduled action. F2 is a constraint on the work above; the rest have owners or recorded
triggers.

### 17 · F2 — Pydantic and Zod models are hand-mirrored

`fl_backend/app/api/spiele/schemas.py` and `fl_frontend/src/features/spiele/schemas.ts` (and their
siblings) are maintained as mirrors with no generation step. This is the main drift risk across the
boundary and the first thing to check when behaviour looks impossible. **Accepted, not a defect** —
recorded so it is stated plainly. The drift _between_ the mirrors is what backend audit pass B2's
contract table measures.

**Path:** the reason tier 3's schema items (FB-5, FE-1, FE-2) are batched — every schema change is
a doubled edit, so fewer passes mean less drift surface.

### 18 · BE-7 — `typing` imports instead of `collections.abc`

Several backend modules import `Mapping`/`Sequence`/`Optional`/`Callable` from `typing` — aliases
deprecated since Python 3.9, on a project running far newer. **Deliberately not fixed piecemeal:**
modernising one module while the rest keep the old spelling is worse than uniformity. The recorded
decision is to enable ruff's `UP` rules and migrate in one pass — which backend audit pass B4's
typing check owns.

### 19 · BE-6 — `CustomObjectId` validates nothing in JSON mode

Its `json_or_python_schema` passes a bare `str_schema()` for the JSON branch, so
`model_validate_json` accepts **any string** as an ObjectId while `model_validate` rejects it.
Unreachable through FastAPI today, which validates already-parsed dicts — which is precisely why
the existing tests certify a guarantee that holds in only one of the two modes. If anything ever
routes through `model_validate_json`, an arbitrary string reaches a Mongo `_id` filter. Found
2026-07-30. Seeded into backend audit pass B2's validation-mode check.

### 20 · OPS-2 — nothing validates the contents of a restored `.env`

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

**What exists today** is manual: the shape checks in
[`scripts/README.md`](../../scripts/README.md) under "Restoring a server checkout" — required names
present, the Mongo host with credentials stripped, the three API keys 64 characters and matching.
They reveal structure without printing a secret, and running them would have caught this in seconds.
But they are a checklist someone has to remember, which is the same class of control that failed
here.

**The options, none obviously right:**

| Option                                                  | Catches                                 | Cost                                                                                                              |
| ------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Leave it manual                                         | Nothing automatically                   | Zero. The checklist exists and the failure is loud, contained and roughly ten minutes to diagnose once recognised |
| Name-presence preflight in `deploy.sh`                  | A missing key                           | Small. **Would not have caught this incident** — the key was present and merely wrong                             |
| Resolve the Mongo SRV record in `deploy.sh` before `up` | Exactly this class, plus a dead cluster | Adds a network dependency to a deploy step, and a DNS blip becomes a refused deploy                               |

**The trade to weigh** is that the third option is the only one that would have helped, and it makes
deployment fail for reasons unrelated to the deployment. Given the failure is already contained —
nginx serves nothing rather than serving something broken — the honest question is whether a faster
diagnosis is worth a new way for `deploy.sh` to refuse.

**Trigger to revisit:** the second time a restore breaks this way, or any move to a setup where the
site cannot tolerate the minutes between a bad deploy and a human reading the log. Ops audit pass O1
(`_auditing/prompts/ops-1-build-deploy.md`, check 4) covers script failure modes and owns this.

### 21 · OPS-3 — the crawler policy is split between robots.txt and Cloudflare, and neither knows about the other

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
