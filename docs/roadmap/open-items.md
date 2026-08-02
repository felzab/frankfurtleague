# Open items

**Verified against:** `34886a2`, 2026-08-02

Findings and undecided questions with real analysis, plus the owner's ranked backlog (added
2026-08-02). The original entries migrated here from the documentation programme's ledger when that
file was retired (2026-08-01); each keeps its full reasoning so the eventual decision is taken with
the analysis in hand. The backend audit prompts (`docs/_auditing/prompts/backend-*.md`) seed several
of these as their starting checks.

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

| Status       | Means                                                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Open**     | Nothing decided, nothing blocking. Pick it up whenever.                                                                                                                                           |
| **Decided**  | The argument is settled and recorded as an ADR; the work is not done. The entry is now an instruction, not a question.                                                                            |
| **Blocked**  | Waiting on another entry that is still in this file. The `Depends on` column names which — a dependency marked _soft_ there is an ordering preference, not a block.                               |
| **Standing** | No scheduled action — a caution, or a finding with a recorded trigger rather than a plan.                                                                                                         |
| **Closed**   | Concluded, awaiting removal. **This status exists for exactly one commit.** See [Closing an entry](README.md#closing-an-entry-two-commits-not-one) — the removal is the next commit and cites it. |

**Every status is re-derived whenever any entry is closed**, not only the entry that moved — `Blocked`
is a claim about another row, so a closure changes statuses nobody edited. The derivation is in the
[README](README.md#re-derive-every-status-not-just-the-one-you-touched).

## The path at a glance

| #   | ID    | Item                                                   | Surfaces    | Effort | Status      | Depends on              |
| --- | ----- | ------------------------------------------------------ | ----------- | ------ | ----------- | ----------------------- |
| 1   | F4    | Statistics written to one document, read from another  | BE, DB      | M      | **Decided** | — (ADR-0026; fix open)  |
| 2   | FB-1  | Saisontabelle must count only Gruppenphase games       | FE, BE      | M      | Blocked     | F4                      |
| 3   | LOG-1 | Logging and error handling, surveyed then standardised | FE, BE, Ops | L      | Open        | — (parallel-safe)       |
| 4   | DB-2  | The database enforces its own invariants               | DB, BE, Ops | M      | **Decided** | — (ADR-0027; work open) |
| 5   | BE-4  | Write paths for `saisons`, `spieler`, `spieltage`      | BE, FE      | L      | Open        | — (after DB-2, soft)    |
| 6   | BE-9  | Replace the "TBD" placeholder team                     | BE, FE      | L      | Open        | — (BE-4's moment, soft) |
| 7   | FB-2  | Disqualification becomes a record, not a boolean       | FE, BE, DB  | M      | Open        | — (model decided)       |
| 8   | FB-3  | Admin pages for team and spieler data                  | FE, BE      | L      | Blocked     | BE-4                    |
| 9   | FB-4  | Playoff bracket: verify seeding, then auto-advance     | FE, BE      | M      | Open        | BE-9 (part 2 only)      |
| 10  | FB-5  | `is_disqualified` inside `FLSpiel`'s team fields       | FE, BE      | S      | Blocked     | FB-2 (field shape)      |
| 11  | FE-1  | Date ranges instead of specific dates                  | FE (+BE)    | XL     | Open        | — (batch with 10, 12)   |
| 12  | FE-2  | Optional per-game notes                                | FE (+BE)    | S      | Open        | — (batch with 10, 11)   |
| 13  | FE-3  | TeamDetailsView rework                                 | FE          | M      | Blocked     | FB-1, FB-2              |
| 14  | F7    | Hardcoded season badge on the landing page             | FE          | S      | Open        | — (before rollover)     |
| 15  | BE-10 | Cache the current-season default                       | BE          | S      | Open        | —                       |
| 16  | OPS-4 | One output standard for `scripts/`                     | Ops         | M      | Open        | —                       |
| 17  | F1    | Two definitions of `ausstehend`                        | FE, BE      | S      | Open        | — (latest with FE-1)    |
| 18  | F2    | Pydantic and Zod models are hand-mirrored              | FE, BE      | —      | Standing    | standing caution        |
| 19  | BE-7  | `typing` imports instead of `collections.abc`          | BE          | —      | Standing    | audit pass B4           |
| 20  | BE-6  | `CustomObjectId` validates nothing in JSON mode        | BE          | —      | Standing    | audit pass B2           |
| 21  | OPS-2 | Nothing validates the contents of a restored `.env`    | Ops         | —      | Standing    | trigger recorded        |
| 22  | OPS-3 | Crawler policy split between robots.txt and Cloudflare | Ops         | —      | Standing    | trigger recorded        |

---

## Tier 1 — data correctness

The statistics chain is wrong today — confirmed, not suspected — and its fix order is forced. F4
established where statistics live and that writes never reach them; the database structure review
that framed the fix is concluded, and its answer is
[ADR-0026](../_decisions/0026-team-statistics-are-derived-from-spiele.md): **statistics are derived
from `spiele`, never stored.** F4 now implements that, and FB-1 narrows the resulting table to the
Gruppenphase. Doing FB-1 first would filter a table nothing computes correctly.

### 1 · F4 — Team statistics are written to one document and read from another ⚠️

**Found 2026-08-01 while documenting the backend. CONFIRMED against the live database 2026-08-02.
The fix has not been made — its shape is the open half of this entry.**

The admin result edit updates team statistics on the **`teams`** collection. The teams endpoint
serves statistics from the **`saison_teams`** junction collection. They are different documents,
nothing copies between them, and **entering or correcting a result therefore does not move the
league table.**

The static evidence still holds and is directly checkable:

| #   | Fact                                                                                                                                                                                   | Location                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1   | `TeamsCollection` resolves to `db.teams`                                                                                                                                               | `fl_backend/app/core/db.py:70-73`             |
| 2   | `update_team_statistik` writes `{"$inc": {"statistik.<field>": …}}` to `teams_collection`, filtered by `_id` **only** — no season                                                      | `fl_backend/app/api/admin/services.py:49-105` |
| 3   | `build_team_pipeline` projects `"statistik": "$saison_data.statistik"`, i.e. from the `saison_teams` lookup                                                                            | `fl_backend/app/api/teams/services.py:73`     |
| 4   | With a `saison_id` always resolved, `strict_join` is true, so `$unwind` sets `preserveNullAndEmptyArrays: False` — the junction row must exist and its `statistik` is what is returned | `fl_backend/app/api/teams/services.py:58-66`  |
| 5   | **No code anywhere in the repository writes to `saison_teams`.** The name appears only as the lookup constant                                                                          | `grep saison_teams` across the repo           |

**History explains it.** `saison_teams` was introduced by commit `0b832d5` ("Added season-specific
and season-agnostic data separation"), which moved season-scoped data onto the junction. The read
path was updated; the statistics write path still targets the base collection.

#### How it was confirmed (2026-08-02)

Two independent observations, neither of which the original static reading had:

1. **The owner deleted two wrongly created `statistik` objects from a document in `teams`.** `$inc`
   on a document with no `statistik` field creates one, so the misdirected write leaves a visible
   artefact in the base collection — and did.
2. **A read-only comparison against the live database**, recomputing every team's statistics from
   the `spiele` documents and comparing both stored copies (season `2026`, 17 teams, 31 matches):

| Observation                                           | Result                                              |
| ----------------------------------------------------- | --------------------------------------------------- |
| `teams` documents carrying a `statistik` field        | **0 of 17**                                         |
| `saison_teams` rows for the active season             | 17 of 17 — every team has one, no orphans           |
| `saison_teams.statistik` vs. recomputed from `spiele` | **Identical on all seven fields, for all 17 teams** |

So the junction is authoritative and is currently accurate — **kept that way by hand, not by the
write path** — and every `statistik` the application has written to `teams` is an artefact.

The two hypotheses that would have overturned the finding are both dead: nothing regenerates the
junction from `teams` (the junction is right while `teams` holds nothing at all), and the deployed
data does not carry `statistik` in both places.

**Two details the static reading did not have, and both matter to the fix:**

- **The artefact is a _partial_ object.** `_build_increment_dict` drops zero-valued fields, so what
  `$inc` creates on `teams` carries only the fields that happened to be non-zero. `FLTeamStatistik`
  requires all seven; this never raises, because nothing reads it.
- **The write is not season-scoped at all**, its filter being `{"_id": team_id}`. Only one season
  exists (`2026`), so no cross-season merging has happened yet. It would begin at the first
  rollover.

#### What is left: the fix, whose shape is now decided

**The decision that blocked this is taken.**
[ADR-0026](../_decisions/0026-team-statistics-are-derived-from-spiele.md), 2026-08-02: `statistik`
is **derived from `spiele` on read, never stored**. So the fix is _not_ the mechanical one this entry
originally proposed — pointing `update_team_statistik` at `saison_teams` was rejected, because it
repairs this instance of the bug without removing the category. Read the ADR before writing code; the
summary below is not a substitute for its reasoning.

What the fix is, concretely:

- **`build_team_pipeline` computes the seven fields** from the season's matches. The response shape
  does not change — `statistik` stays an `FLTeamStatistik` on `FLTeam` and `FLTeamCompact` — so no
  frontend consumer moves.
- **`update_team_statistik` is deleted**, along with the `$inc` path. `patch_spiel_data` keeps its
  transaction for the match document itself. `get_stats_contribution` may survive as the shape of
  the per-match arithmetic, or may fold into the pipeline; that is an implementation choice.
- **A match counts exactly when it carries an `ergebnis`.** `is_canceled` is deliberately not
  consulted: a cancelled match with a result is a **forfeit** and counts. Three matches in season
  2026 are in that state. This is the behaviour the `$inc` path had by accident and is now the
  ratified rule (ADR-0026, owner 2026-08-02) — state it in the pipeline and check `docs/glossary.md`
  still says so.
- **Points come from `FLSaison.rules`** rather than a hardcoded 3/1/0, once the season is in the
  pipeline. That field exists and is currently read by nothing.
- **Delete `statistik` from the `saison_teams` documents** once the derived path is live. A stale
  copy left behind is exactly the condition this entry describes.

The switch is provably a no-op on the numbers before it is made: the 2026-08-02 recomputation
reproduced every stored figure exactly, on all seven fields for all 17 teams.

**Also resolved:** the recorded rationale for the `teams:saison_id:*` cache tag — that a result edit
rewrites team stats _within that season only_ — is false today and becomes true once the pipeline
derives them per season. See `fl_frontend/src/features/teams/queries.ts` and
[ADR-0001](../_decisions/0001-two-granular-cache-tags.md).

**When this lands, add a row to CLAUDE.md §9.** A table recomputed on every request reads as an
obvious optimisation target, and the next reader will propose caching or storing it. That is the
decision being reversed, not an improvement — cite ADR-0026 at the pipeline.

**Owner:** the backend audit — pass B1 (`_auditing/prompts/backend-1-consistency.md`) treats this as
its motivating check. Referenced from `docs/backend/spec.md` (invariant I1, §7) and
`docs/glossary.md`.

**Path:** the structure review that blocked it is concluded (ADR-0026). Still blocks FB-1 until the
read path computes the table correctly, and informs FE-3 (which displays the full statistics FB-1
separates out).

### 2 · FB-1 — The Saisontabelle must count only Gruppenphase games

**Owner's item, 2026-08-02.** The Saisontabelle currently tracks **all** games, not only the ones
from the Gruppenphase. **This is wrong** — a league table seeded by playoff results is not a group
table.

**It is live, not theoretical.** Measured against the database on 2026-08-02: 24 Gruppenphase
matches, all played; 4 Viertelfinale, 2 played; 2 Halbfinale and 1 Finale, none played. **The two
quarter-final results are in the group table right now**, and five more will join them as the
playoffs finish.

**It is no longer heavy, and the rating above has been cut from XL to M.** The owner's original
scoping — correcting data in the database, splitting the `statistik` field in `saison_teams`,
changing schemas to match — assumed a stored field.
[ADR-0026](../_decisions/0026-team-statistics-are-derived-from-spiele.md) settled that statistics are
derived from `spiele` on read, so **there is no field to split, no schema to change and no backfill
to run.** The Gruppenphase table is `$match: {saison_phase: "gruppenphase"}` inside the same pipeline
that already computes the numbers.

Details worth having in hand when it is worked:

- `FLSpiel` carries `saison_phase` on every match, so the discriminator is already in the data.
- The full, all-games statistics must **remain visible** — their home is `TeamDetailsView`, which is
  FE-3 below, deliberately a separate item. Under a derived table that is the same pipeline **without**
  the `$match`, so the two views cost one parameter rather than two stored objects.
- The real remaining work is therefore the API surface and the UI: how a caller asks for one table or
  the other, and how `TeamDetailsView` and the Saisontabelle each request the shape they need.

**Path:** blocked by F4 — the table has to be computed correctly before it is filtered. Feeds FE-3
(which shows the full statistics this item narrows away from the Saisontabelle).

---

## Tier 2 — foundations and enablers

LOG-1 is independent and parallel-safe — the reason it sits high is that every item below it is
easier to debug once it lands. DB-2 puts the constraints under the hand-editing that is currently the
only write path for three resources, which is why it precedes BE-4 rather than following it. The
last two are the data-model decisions that later features build on.

### 3 · LOG-1 — Logging and error handling, surveyed then standardised

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

**Path:** independent; can run in parallel with tier 1. Every later item benefits from landing it
early.

### 4 · DB-2 — The database enforces its own invariants

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
about.

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

### 5 · BE-4 — no write path for `saisons`, `spieler`, `spieltage`

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

**The natural moment is when BE-4's season write path is built**, because that is when season setup
becomes a real flow and the placeholder's junction rows would otherwise need to be created there
too — or the first time a season is created and the missing TBD row breaks a bracket.

**Path:** shapes FB-4's auto-advance — writing a winner into the next match's slot is exactly the
operation the placeholder currently fakes, so decide this model before building that workflow.

### 7 · FB-2 — Disqualification becomes a record, not a boolean

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

## Tier 3 — features, in dependency order

Ranks 10–12 all touch `FLSpiel`, its Pydantic/Zod mirrors and `AdminEditSpielDataForm`. **Batch
them**: F2's hand-mirrored schemas make every separate schema change a doubled edit with drift
risk, so one coordinated pass beats three.

### 8 · FB-3 — Admin panel pages for team and spieler data

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

### 9 · FB-4 — Playoff bracket: verify the seeding, then auto-advance winners

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

### 10 · FB-5 — `is_disqualified` inside `FLSpiel`'s team fields

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

### 11 · FE-1 — Date ranges instead of specific dates for games (heavy)

**Owner's item, 2026-08-02.** At some point, implement **date ranges** instead of specific dates
for games. A heavy change, in the owner's scoping: it would change `AdminEditSpielDataForm`, the
schemas, and possibly logic and UI elements **across the board**.

Known touchpoints to scope against when it is worked: `datum` in both schema mirrors and the DB
documents; `computeSpielStatus`'s date comparisons; `formatSpielDisplay` and the card layouts;
`sort_by=datum` on the backend; `searchable_datum` in the Spielsuche; and F1's `ausstehend`
semantics — a range makes the ausstehend/heute/vergangen ternary genuinely harder, so settle F1's
intent at the latest here.

**Path:** batch with FB-5 and FE-2 (one schema/mirror/form pass). Resolves or restates F1.

### 12 · FE-2 — Optional per-game notes

**Owner's item, 2026-08-02.** Similar in surface to FE-1: add a place for **small notes on every
game** — optional, containing information about the game such as exciting moments. **Editable in
the admin form** (`AdminEditSpielDataForm`).

An optional field on `FLSpiel` in both mirrors, a form section, and a display decision (where the
note appears — `SpielDetailsModal` is the obvious candidate) that is deliberately left open here.

**Path:** batch with FB-5 and FE-1 — same form, same schemas, one mirror pass.

### 13 · FE-3 — TeamDetailsView rework

**Owner's item, 2026-08-02.** Rework `TeamDetailsView` to look nicer — **especially the saison
progress line at the bottom**, which should also include important notes and milestones like "went
to playoffs".

Contents the rework must carry:

- the **full statistics** of the team — this view is where the all-games numbers live once FB-1
  narrows the Saisontabelle to the Gruppenphase;
- a **note on disqualified teams**, which is where FB-2's reason and date get displayed.

**Path:** last of the feature chain on purpose — it consumes FB-1's split statistics and FB-2's
disqualification record. Doing the visual rework first would mean reworking it twice.

---

## Tier 4 — independent items, schedule freely

Nothing here blocks or is blocked. Ordered by urgency: F7 has a real deadline.

### 14 · F7 — The landing page's season badge is hardcoded

`fl_frontend/src/app/(public)/page.tsx` renders "Saison 2026" as a literal. It is not derived from
the current season, so at the rollover the badge will still name the old year while the fixtures
below it — which _are_ season-aware — already show the new one.

Low severity and cosmetic, but it fails silently and on a date nobody will be watching. Documented
at the line; wiring it to `getCurrentSaison()` would give this page a data fetch it does not
currently have — a real trade-off rather than an obvious fix.

**Path:** independent, but deadline-bound — decide before the next season rollover.

### 15 · BE-10 — Cache the current-season default

**Owner's item, 2026-08-02.** The backend handles defaulting the `saison_id` when none is passed to
an endpoint ([ADR-0002](../_decisions/0002-omitted-season-means-current.md)) — but it **looks the
current season up every time**. `pull_current_saison` (`fl_backend/app/api/saisons/crud.py`) is the
single resolution point, and `/spiele`, `/spieltage`, `/teams` and `/saisons/current` all route
through it, so most public traffic pays a Mongo query for an answer that changes once a year. Find
a caching solution.

The consideration that makes it non-trivial: **invalidation**. Seasons are edited directly in Mongo
today (BE-4), so no code path observes the active season flipping — a naive process-lifetime cache
serves the old season after rollover until a restart. A TTL, or a hook on the ADR-0015
revalidation route, or BE-4's future write path are the candidate invalidation sources; the choice
is the actual work here, not the caching itself.

**Path:** independent; BE-4 would later give it a clean invalidation hook.

### 16 · OPS-4 — One output standard for `scripts/`

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

**Path:** independent.

### 17 · F1 — Two definitions of `ausstehend`

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

## Tier 5 — standing cautions and watch items

No scheduled action. F2 is a constraint on the work above; the rest have owners or recorded
triggers.

### 18 · F2 — Pydantic and Zod models are hand-mirrored

`fl_backend/app/api/spiele/schemas.py` and `fl_frontend/src/features/spiele/schemas.ts` (and their
siblings) are maintained as mirrors with no generation step. This is the main drift risk across the
boundary and the first thing to check when behaviour looks impossible. **Accepted, not a defect** —
recorded so it is stated plainly. The drift _between_ the mirrors is what backend audit pass B2's
contract table measures.

**Path:** the reason tier 3's schema items (FB-5, FE-1, FE-2) are batched — every schema change is
a doubled edit, so fewer passes mean less drift surface.

### 19 · BE-7 — `typing` imports instead of `collections.abc`

Several backend modules import `Mapping`/`Sequence`/`Optional`/`Callable` from `typing` — aliases
deprecated since Python 3.9, on a project running far newer. **Deliberately not fixed piecemeal:**
modernising one module while the rest keep the old spelling is worse than uniformity. The recorded
decision is to enable ruff's `UP` rules and migrate in one pass — which backend audit pass B4's
typing check owns.

### 20 · BE-6 — `CustomObjectId` validates nothing in JSON mode

Its `json_or_python_schema` passes a bare `str_schema()` for the JSON branch, so
`model_validate_json` accepts **any string** as an ObjectId while `model_validate` rejects it.
Unreachable through FastAPI today, which validates already-parsed dicts — which is precisely why
the existing tests certify a guarantee that holds in only one of the two modes. If anything ever
routes through `model_validate_json`, an arbitrary string reaches a Mongo `_id` filter. Found
2026-07-30. Seeded into backend audit pass B2's validation-mode check.

### 21 · OPS-2 — nothing validates the contents of a restored `.env`

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

### 22 · OPS-3 — the crawler policy is split between robots.txt and Cloudflare, and neither knows about the other

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
