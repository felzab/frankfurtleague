# Open items

**Verified against:** `84d43da`, 2026-08-10\
**Purpose:** what is open, ranked — each entry carrying the analysis its decision needs

| Section                                                         | Answers                                                  |
| --------------------------------------------------------------- | -------------------------------------------------------- |
| [How this file is ordered](#how-this-file-is-ordered)           | What produced the order, and what belongs here at all    |
| [What every entry carries](#what-every-entry-carries)           | Which fields an entry states, and what each one may hold |
| [The path at a glance](#the-path-at-a-glance)                   | Which items are open, and where each ranks               |
| [Tier 1 — leverage and clocks](#tier-1--leverage-and-clocks)    | What has a date on it                                    |
| [Tier 3 — independent](#tier-3--independent)                    | What blocks nothing and waits on nothing                 |
| [Tier 4 — standing](#tier-4--standing-cautions-and-watch-items) | What has no scheduled action, and what would reopen it   |

**Look in [`closed-items.md`](closed-items.md) before concluding that an id never existed.**

## How this file is ordered

**Reading top to bottom is the suggested working order.** Entries are grouped into tiers and ordered
within each tier. The tests that produce that order — and what must never decide a rank — are in
[`protocol.md`](protocol.md#1-how-the-file-is-ranked). Rank by what it costs to leave an item undone,
and let effort break ties toward the cheaper item.

Each entry keeps its full reasoning so the eventual decision is taken with the analysis in hand. Some
entries are seeded into an audit pass under `docs/_auditing/prompts/` as one of its starting checks;
where that holds, the entry's own `Path` line names the pass.

Some entries are issue-shaped feature work parked here at my direction, so that the ordering lives in
one place; everything else belongs here only while the reasoning, rather than the work, is the
deliverable.

## What every entry carries

An entry is a `### <rank> · <ID> — <the problem, not the solution>` heading, then one metadata line
per field in the order below, then the analysis. **A field with nothing to say is an em dash, never
an absent line**, so an entry can be read down the same way every time.

| Field        | Holds                                                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**   | One value from the vocabulary below                                                                                                                  |
| **Surfaces** | Which of FE, BE, DB, Ops and Docs the work would touch, in that order                                                                                |
| **Effort**   | **S** an afternoon · **M** a day or two · **L** a work package across several sessions · **XL** a programme touching data, schemas and UI end to end |
| **Path**     | What the entry blocks, and what blocks it                                                                                                            |

**Status vocabulary**, a closed set:

| Status       | Means                                                                                                                                                                                                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Open**     | Nothing decided, nothing blocking. Pick it up whenever.                                                                                                                                                                                                                      |
| **Decided**  | The argument is settled and recorded as an ADR; the work is not done. The entry is now an instruction, not a question.                                                                                                                                                       |
| **Blocked**  | Waiting on another entry that is still in this file. The `Depends on` column names which — a dependency marked _soft_ there is an ordering preference, not a block.                                                                                                          |
| **Standing** | No scheduled action — a caution, or a finding with a recorded trigger rather than a plan.                                                                                                                                                                                    |
| **Closed**   | Concluded, awaiting removal. **This status exists for exactly one commit.** See [Closing an entry](protocol.md#3-closing-an-entry-two-commits-not-one) — the next commit deletes the entry, cites this one, and adds the item's row to [`closed-items.md`](closed-items.md). |

**Every status is re-derived whenever any entry is closed**, not only the entry that moved — `Blocked`
is a claim about another row, so a closure changes statuses nobody edited. The derivation is in
[`protocol.md`](protocol.md#4-re-derive-every-status-not-just-the-one-you-touched), and it is never
chosen by feel.

## The path at a glance

| #   | ID     | Item                                                    | Surfaces    | Effort | Status   | Depends on |
| --- | ------ | ------------------------------------------------------- | ----------- | ------ | -------- | ---------- |
| 1   | FB-16  | Nothing announces that a season rollover is due         | BE, Ops     | M      | Open     | —          |
| 2   | FE-1   | A fixture carries one date, not a play window           | FE, BE      | XL     | Open     | —          |
| 3   | OPS-11 | The compose guard cannot tell an invocation from a name | Ops         | S      | Open     | —          |
| 4   | OPS-10 | The comment-only classifier costs a process per file    | Ops         | S      | Open     | —          |
| 5   | FE-3   | TeamDetailsView's progress line names no milestone      | FE          | M      | Open     | —          |
| 6   | BE-12  | Nothing purges a row whose `inactive_since` is old      | BE, DB      | M      | Open     | —          |
| 7   | OPS-12 | Nothing checks a generated file against its generator   | FE, Ops     | S      | Open     | —          |
| 8   | DOC-2  | An enforcement claim is resolved in one direction only  | Docs        | M      | Open     | —          |
| 9   | BE-15  | Nothing records who changed what, or what it replaced   | FE, BE, DB  | L      | Open     | —          |
| 10  | LOG-2  | A cached read's call joins to no render                 | FE, BE, Ops | L      | Open     | —          |
| 11  | FB-15  | A group move is only defensible as a swap, unoffered    | FE, BE      | M      | Open     | —          |
| 12  | BE-7   | `typing` imports instead of `collections.abc`           | BE          | —      | Standing | —          |
| 13  | BE-6   | `CustomObjectId` validates nothing in JSON mode         | BE          | —      | Standing | —          |
| 14  | BE-14  | The certainty walk gives up in a group of six or more   | BE          | —      | Standing | —          |
| 15  | OPS-2  | Nothing validates the contents of a restored `.env`     | Ops         | —      | Standing | —          |
| 16  | OPS-3  | Crawler policy split between robots.txt and Cloudflare  | Ops         | —      | Standing | —          |
| 17  | DOC-3  | A rule pattern reaches less than the rule it enforces   | Docs        | —      | Standing | —          |
| 18  | DOC-4  | A stamp is required by a path and owed by a claim       | Docs        | —      | Standing | —          |

**No entry in this file blocks another**, which is why every `Depends on` cell is an em dash. What
each entry waits on that is _not_ an entry — a page, a decision, a scheduled audit pass — is on its
own `Path` line.

---

## Tier 1 — leverage and clocks

What sits here has a date on it. FB-16 is the reason nobody is told that the rollover is due, and it
is due on a date nobody is watching.

### 1 · FB-16 — Nothing announces that a season rollover is due

**Status:** Open\
**Surfaces:** BE, Ops\
**Effort:** M\
**Path:** Independent — the clock is the only reason it ranks where it does.

**Every step of a rollover has a page; the sequence has nothing.** `/admin/saisons` creates the
season, the Umstellung panel on `/admin/saisons/[saison_id]` activates it
([ADR-0026](../_decisions/0026-one-active-season-and-one-path-to-it.md)), the team and player editors
carry the junction rows, and `/admin/spieltage` builds the skeleton
([ADR-0050](../_decisions/0050-a-matchday-list-is-the-seasons-skeleton.md)). Each clears its own
caches as it saves. What no surface does is notice that the sequence has not started, or that it
stopped half-way: nothing prompts for a step that is skipped.

**The failure is silent in a specific way.** An omitted step leaves the site serving last season as
though it were this one, and every read of it is a correct read of stale data.

**A reminder is a scheduled job, not a surface** — nothing renders it, nobody navigates to it, and it
has to run when no admin is present. This repository has no scheduler at all: there is no cron, no
queue, no worker, and nothing `scripts/deploy.sh` starts is one. That, rather than the message, is
the actual scope.

**What has to be settled when it is worked:**

- **What triggers it.** A season's `end_date` is the obvious clock and is the wrong one on its own — a
  season is over when its fixtures are played, and an early rollover is legitimate (ADR-0026). The
  honest trigger is probably a date approaching with the next season absent.
- **What runs it.** A container with a cron, a scheduled GitHub Actions workflow hitting a guarded
  endpoint, or the host's own crontab. The workflow needs no new runtime and the container needs no
  public surface; the trade is where the credential lives.
- **What it says.** The value is the checklist, not the alarm: a reminder naming which steps are
  already done is a different message from one saying a date passed, and only the first is worth
  reading twice.

---

## Tier 3 — independent

Entries that block nothing and wait on nothing, ordered by value per cost. FE-1 opens the tier, and
the surface it was waiting on exists — the match editor is a page at `/admin/spiele/[spiel_id]`
([ADR-0040](../_decisions/0040-a-form-that-outgrows-a-dialog-becomes-a-page.md)) — so it renders
there and the triage list links into it, rather than being built against a dialog first and then
again. It still wants one pass over the schema surface, the form and the mirror
([ADR-0033](../_decisions/0033-the-zod-mirror-is-checked-against-the-published-document.md) makes a
mirror that falls behind a gate failure that names the field). OPS-11 and OPS-10 are the cheapest
entries here and the only ones a session pays for on every run: a guard that refuses commands it has
no business refusing, and a classifier that spends a process per file to answer a question about the
diff. FE-3 is presentation work on a surface that already exists. OPS-12 and DOC-2 are each a
boundary nothing currently watches — a generated file against the generator that owns it, and the
documentation standard's enforcement claims against the gate, which resolves them in the direction
that overstates and not in the direction that understates. BE-12, BE-15 and LOG-2 are prospective
rather than dependent:
BE-12 is real now that the spieler pages make retiring a row possible at all, BE-15 becomes real the
moment a second person can write, and LOG-2 improves the fidelity of a logging convention that
already works. FB-15 closes the tier with the group swap the team editor's lock names as the one
defensible mid-season move.

### 2 · FE-1 — A fixture carries one date, and a play window cannot be expressed

**Status:** Open\
**Surfaces:** FE, BE\
**Effort:** XL\
**Path:** Independent — `/admin/spiele/[spiel_id]` is the page it lands on, and it exists.

**A fixture's `datum` is a single day, so a match scheduled across a window cannot be recorded as one**
(my item, 2026-08-02). Implementing ranges is heavy in my scoping: it would change
`AdminEditSpielDataForm`, the schemas, and possibly logic and UI elements **across the board**.

Touchpoints to scope against when it is worked: `datum` in each schema mirror and in the DB documents;
`computeSpielStatus`'s date comparisons; `formatSpielDisplay` and the card layouts; `sort_by=datum` on
the backend; `searchable_datum` in the Spielsuche; and the `ausstehend` semantics
[ADR-0058](../_decisions/0058-a-status-filter-is-not-a-status-label.md) fixed — a range makes the
ausstehend/heute/vergangen ternary genuinely harder, and that ADR's intent (a fixture whose play
window includes today is found by the upcoming filter and labelled `heute`) is what the range
arithmetic has to preserve. Working it re-derives ADR-0058's definitions under ranges.

### 3 · OPS-11 — The local-compose guard cannot tell an invocation from a mention

**Status:** Open\
**Surfaces:** Ops\
**Effort:** S\
**Path:** Independent — `scripts/selfcheck.sh` already drives this hook the way the hook runner does.

**`.claude/hooks/guard-local-compose.sh` matches the command as text.** It denies a Bash command
containing `docker compose`, or `docker-compose` followed by a space, unless that same command also
names the local compose file. A search for the phrase and a heredoc writing it into a document each
contain it, so each is denied — with the message written for someone about to operate the production
stack by mistake.

**A false refusal costs more than the inconvenience.** A guard is worth obeying only while every
refusal it issues is worth obeying. One that fires on a command it has no business refusing invites
that command to be reworded rather than reconsidered, and a wording that gets around a false refusal
gets around a true one just as well.

**What the narrowing has to preserve.**
[ADR-0060](../_decisions/0060-the-branch-guard-compares-canonical-paths.md) settled the asymmetry for
the branch guard: a false refusal is one command away from resolved, while a hole is not observable
at all. The same asymmetry binds here, so the test to reach for is where the phrase sits rather than
whether it occurs. A match at a command position — the start of the command or the far side of a
separator, allowing a leading `sudo` or an environment assignment — still refuses
`docker compose --project-name x up`, which an allowlist of subcommands would let through.

**Done when:** the guard refuses every invocation shape and allows a command that only names one,
and `scripts/selfcheck.sh` asserts each. It already drives this hook for a bare invocation, for the
local file named, and for a command that is not compose at all, so the probes have a home.

### 4 · OPS-10 — Deciding whether a change is comments only costs a process per file

**Status:** Open\
**Surfaces:** Ops\
**Effort:** S\
**Path:** Independent — what the classifier answers does not change, only what the answer costs.

**`scripts/check_scope.py :: is_comment_only` spawns per file, and the gate runs it over the whole
diff.** Each changed file costs a `git show` for its earlier version, and each changed TypeScript
file then costs a fresh node process, because `scripts/check_scope.py :: typescript_same` hands one
pair at a time to `scripts/ts_normalize.mjs`. The cost therefore scales with how many files a branch
touched rather than with what is in them, and it is paid on every gate run at a docs or frontend
scope. `scripts/check_scope.py :: images_culprits` has the same shape on the failure path, running
`scripts/ci_scopes.sh` once per file to name which one required the image build.

**Why it is worth doing and why it is not urgent.** The gate is run before every push, so its
runtime is charged to every change, and a spawn is the part of this work that does not shrink with
the size of the file it is asked about. Against that, nothing is wrong with the answers: the
classifier is correct, and what a slow gate costs is patience.

**What must not change.** [ADR-0030](../_decisions/0030-the-gate-refuses-an-undersized-scope.md)
makes the carve-out reach exactly as far as a parser does, so a batched run still has to answer
"same" only where a parser proved it, and still has to count every error — a file that will not
parse, a missing toolchain, a crashed process — as code. A batch that loses which pair produced
which verdict, or that turns one file's parse failure into a verdict for the rest, is worse than the
spawning it replaced.

**Not measured:** what the spawns actually cost on this machine, and how much of a gate run is
attributable to them. The mechanism above is read from the code; the magnitude is not.

### 5 · FE-3 — TeamDetailsView's season progress line names no milestone

**Status:** Open\
**Surfaces:** FE\
**Effort:** M\
**Path:** Independent — the record it renders exists and the fetch it needs is written.

**`TeamDetailsView` should look better, and the season progress line at the bottom should carry the
notes and milestones a season produces** — "went to playoffs" is the shape (my item, 2026-08-02).

Contents the rework must carry:

- the **full statistics** of the team, which this view shows and is the only surface that does. The
  Saisontabelle counts the Gruppenphase; this page asks `GET /teams` for `statistik_scope=gesamt` and
  counts every phase
  ([ADR-0022](../_decisions/0022-the-league-table-counts-the-gruppenphase.md)). **The data question is
  settled and the fetch is written** — what remains here is presentation, plus the line of copy that
  explains the difference and should survive the rework in some form;
- a **note on disqualified teams**, which is where the reason and the date get displayed.
  `FLTeam.disqualifikation` carries each, and each is public by decision
  ([ADR-0047](../_decisions/0047-a-disqualification-is-a-record-and-its-absence-is-the-null.md)), so
  the note renders `grund` as authored rather than mapping it to a label.

The compact card this view is the only consumer of already survives narrow screens (the `FE-8` row of
[`closed-items.md`](closed-items.md)).

### 6 · BE-12 — Nothing purges a row whose `inactive_since` is old enough

**Status:** Open\
**Surfaces:** BE, DB\
**Effort:** M\
**Path:** Independent — the spieler pages retire rows, so an `inactive_since` can accumulate at all.

**`inactive_since` is a date rather than a flag so that a retired row can eventually be purged**
([ADR-0025](../_decisions/0025-soft-deletion-is-a-date-not-a-flag.md)), and nothing purges one.

The field is carried by `teams`, `spieler`, `saison_spieler`, `spieltage`, `spielorte` and
`schiedsrichter`. A retired row stays forever, keeps its slot in whatever unique index covers it, and
is filtered out of every default read.

**Today that is fine and the numbers say so.** Nothing is retired anywhere: 0 rows across those
collections, against 16 teams, 362 players, 362 squad rows, 6 matchdays, 6 venues and 7 referees
(measured 2026-08-06). This is a prospective item, opened so the field's purpose is recorded rather
than rediscovered.

**What a purge has to answer, none of it decided:**

- **How old is old enough**, and is it one threshold or one per collection? A venue nobody has booked
  for three years and a squad row from a season that was played are different kinds of stale.
- **What still references the row.** This is the hard half and it is why the delete was soft in the
  first place: `spiele` embeds a copy of a venue, a referee and each team, and references each by id.
  A purge that is not preceded by a reachability check reintroduces exactly the orphaned references
  ADR-0025 refused. `saison_spieler` is the collection with no such embedding.
- **Whether releasing a shorthand from `uniq_shorthand` is a feature or a hazard.** Purging a retired
  club frees its shorthand for reuse, which is the point — and it also means a future club can hold
  letters that historical matches still name, if any survived the check above.
- **What runs it.** A scheduled job, a script I run like the backfill, or an admin control. The
  repository has no scheduler, which makes the hand-run script the cheapest by a distance.

`saisons` and `saison_teams` carry no such field and need none: neither has a delete at all
([ADR-0026](../_decisions/0026-one-active-season-and-one-path-to-it.md)), so neither can accumulate a
row to purge.

### 7 · OPS-12 — Nothing checks a generated file against the generator that owns it

**Status:** Open\
**Surfaces:** FE, Ops\
**Effort:** S\
**Path:** Independent — `fl_backend/openapi.json` already carries the pattern this extends.

**`fl_frontend/src/shared/components/ui/FLLogo.tsx` is written by
`fl_frontend/scripts/generate-brand-assets.mjs`, and what keeps them in step is a banner asking a
reader not to edit the file.** A hand-edit type-checks, lints and builds. It then survives until
somebody runs `pnpm brand` for an unrelated reason — a new icon size, a manifest entry — at which
point the generator overwrites it inside a commit whose subject says something else entirely. Every
other asset that script emits sits behind the same banner: `icon.svg`, the favicon and the manifest
icons.

**The artifacts agree today.** What the generator emits for the component and what the repository
holds differ in whitespace alone — the script writes each JSX element on one line and the formatter
expands it — so the mark that renders is the mark the geometry produces, erosion filter included.
This entry is about the missing check, not about a divergence.

**The pattern exists already, on the other surface.** `fl_backend/openapi.json` is a committed
generated artifact whose freshness is a test: it regenerates the document and compares
([ADR-0033](../_decisions/0033-the-zod-mirror-is-checked-against-the-published-document.md),
`fl_backend/tests/openapi_document.py`). What is missing here is not the idea but its application to
the generator on the other surface, which is why the effort is small.

**What keeps it from being free.** Only the text artifact compares cleanly. The images go through
sharp, whose output is not guaranteed byte-identical across versions, so a check that diffs them
fails on a dependency bump rather than on a hand-edit — and a check that fails for reasons unrelated
to the defect is one that gets suppressed. The honest scope is the emitted component, compared after
the formatter has run over each side so the comparison is about content rather than layout.

**Done when:** the frontend scope of the gate regenerates the component into a temporary location
and fails where it differs from the committed one, and the images are left to review with that
exclusion written down rather than assumed.

### 8 · DOC-2 — An enforcement claim is resolved in one direction only

**Status:** Open\
**Surfaces:** Docs\
**Effort:** M\
**Path:** Independent — a chapter's `Enforced by` field and the check it claims move in one change.

**`scripts/check_docs.py :: check_enforced_by` fails a rule naming a gate check that does not
exist, and nothing resolves the opposite direction.** A rule may omit a check that enforces it, and
a rule may state something a parser can decide while its field reads that it is unenforced. Either
shape leaves the field claiming less than the gate delivers, which is the reading nobody verifies —
and the field is where the standard says what is mechanically defended.

**The clear instance is `anchor`.** It is emitted in the same pass as `link`, over a markdown page
and over a source comment alike, and it is what resolves the heading a link's fragment names. INC-6
names `link` and stops there; COR-6 names `citation`, `path`, `adr` and `line-citation` and stops
there. A reader of either rule learns that a link's target is verified and never that its anchor is.
Most of what no rule claims defends the gate itself rather than a rule — its own registry, its
inputs, the repository's line endings — and that is correct, which is why this direction cannot be
closed by requiring every check to be claimed.

**The clear unenforced clause is OUT-7's.** It fixes what a diagram may be, and part of that is
decidable by reading the page: a fence naming a diagram language that is not mermaid, a diagram
inside an ADR, and a `[` inside a quoted node label. The level clause is not decidable in general.
Its `Enforced by` field claims review judgment for the whole rule, so the part a parser could settle
is settled by nobody, and the field is accurate about it.

**Done when:** each rule's `Enforced by` names every check that enforces it, the clauses a parser
can decide carry one, and the direction the gate does not resolve is either mechanised or written
down as deliberate. PRE-4 closes that field's vocabulary at checks, commands and linters, so a check
added for OUT-7 lands with the field that claims it.

### 9 · BE-15 — Nothing records who changed what, or what a write replaced

**Status:** Open\
**Surfaces:** FE, BE, DB\
**Effort:** L\
**Path:** Independent, and not scheduled.

**Every admin write overwrites in place.** A result is `$set` over its predecessor, `is_disqualified`
flips with no trace of who flipped it or why, and the write that destroys the most is one nobody asked
for — applying a bracket advancement clears the advanced fixture's `ergebnis` and `elfmeterschiessen`
(`fl_backend/app/api/spiele/crud.py :: advance_bracket_winners`), so correcting a quarter-final
silently deletes a semi-final scoreline that a person had entered.
[ADR-0041](../_decisions/0041-a-voided-result-is-named-before-it-is-lost.md) makes that destruction
**visible** and deliberately does not make it **recoverable** beyond a fifteen-second undo — which is
the question this entry carries.

**What the reference model does.** Federation administration software treats a disciplinary action as
a case with an audit trail, because a disqualification is a decision somebody has to be able to
justify later, and because a sanction that nobody can trace is a sanction that gets disputed. Part of
that is built — a disqualification carries a reason and a date
([ADR-0047](../_decisions/0047-a-disqualification-is-a-record-and-its-absence-is-the-null.md)) — but a
reason and a date on the current state is not a history: it says why the team is disqualified, never
what its standing was a week ago.

**What I have asked this to become (2026-08-06): an admin action-log page listing every edit and every
add, with a smarter undo built over it.** That fixes what is recorded, where it goes, and whether a
restore is offered:

- **What is recorded:** every write, not only the destructive ones. A page that lists half of them is a
  page nobody trusts.
- **Where it goes:** a collection, because the page reads it. A log stream is out — `deploy.sh`
  recreates the containers and the history would end at the last deploy (`docs/logging/spec.md`).
- **Whether a restore is offered:** yes, and that is the smarter undo. The bound to beat is the one
  ADR-0041 already ships: fifteen seconds, held in the browser, gone on reload. An undo over a stored
  log outlives the fifteen seconds and survives a reload, and it can restore a write nobody was
  watching at the time — which is the case the client-held one cannot reach.

**Still open: how long it is kept, and whether it holds personal data.** A squad row names a person, so
a history of squad edits is a retention decision rather than a storage one.

**What makes it urgent is a second person who can write.** Until then the only person who could dispute
an entry is the one who made it, and the cost of having no log is paid when something goes wrong and
somebody asks what happened. ADR-0041 raises the value of doing it meanwhile: the client-held undo
makes the gap visible on the one surface an admin uses most.

### 10 · LOG-2 — A cached read's call joins to no render, and telemetry has nowhere to go

**Status:** Open\
**Surfaces:** FE, BE, Ops\
**Effort:** L\
**Path:** Independent — ADR-0032 is the floor it builds on, not a blocker.

**Implement the industry-standard shape of the correlation scope this repository runs a subset of** (my
item, 2026-08-05).
[ADR-0032](../_decisions/0032-one-correlation-id-per-request-one-document-per-line.md) settled **one id
per request, propagated by an ordinary header, written into each service's JSON stream**. The
recognised standard for the same job is **W3C Trace Context** — a `traceparent` header carrying a
trace id, a span id and flags — usually implemented through **OpenTelemetry**, which records not just
an id but a _span per operation_ with parent links, timings and attributes. Next.js documents
`instrumentation.ts` as the hook for it and this repository already has
`fl_frontend/src/instrumentation.ts`; FastAPI/Starlette and pymongo have maintained instrumentation
packages. **Neither upstream claim was re-verified when this entry was written** (COR-9).

**What the standard buys over what exists**, in descending order of what it is worth here:

- **A cached read's backend call joins to the page render that triggered it.** This is the one the
  hand-rolled scope provably cannot reach: `"use cache"` forbids request APIs, so no application code
  can carry the request's id into a cache fill (`docs/logging/spec.md`, the cache-fill boundary).
  OpenTelemetry propagates through the framework's own internals instead. It covers every cached read;
  the uncached page-render query already joins.
- **Timings become a tree rather than separate numbers.** Today nginx reports `upstream_duration_s` and
  the backend reports `duration_ms`, and relating them is manual. A span tree shows where a slow
  request actually spent its time, including inside Mongo.
- **A vocabulary other tools already speak**, so a future collector, dashboard or alerting rule needs no
  bespoke parser.

**The question this entry exists to answer is not "which library" — it is where the telemetry goes.**
This repository has _no aggregation of any kind_: reading production logs is `ssh` plus
`docker compose logs`, and those logs are destroyed on every deploy because `deploy.sh` recreates the
containers (`docs/logging/spec.md`). **OpenTelemetry with no collector behind it is strictly worse than
what exists** — a dependency on every surface, a heavier runtime, and the same lost-on-deploy stream at
the end of it. So the ordering is:

1. **Decide the destination first.** A self-hosted collector on the same box (Jaeger, Grafana
   Tempo/Loki, SigNoz), a hosted backend, or nothing. Each carries a resource cost on a server whose
   services are already capped by `docker-compose.yml`'s deploy limits, and a hosted one puts request
   metadata for a public site into a third party.
2. **Only then instrument.** The libraries are the cheap half.

**One cheaper thing that is a real improvement on its own**, and a legitimate answer of "not yet" to
the whole programme: **ship the logs off the host before they are lost.** A rotating copy, or a log
driver other than `json-file`. This is the gap that actually costs something today, and it is
independent of tracing.

**The avoidable half of the propagation gap is closed**, so this entry does not carry it:
`fl_frontend/src/shared/utils/correlationScope.ts :: runWithIncomingCorrelationId` seeds the scope for
every dynamic caller, the uncached page-render query included. What is left for OpenTelemetry is the
half no application code can reach.

**What it would supersede.** ADR-0032's decision that the identifier is a single id on a custom header.
Reversing that means a new ADR carrying `Supersedes: ADR-0032`, and ADR-0032's own Status and
`Superseded by` lines changing and nothing else
([`_standard/chapters/4-decisions.md`](../_standard/chapters/4-decisions.md), DEC-6). What survives
untouched is the stream contract, the error-code system and the edge's refusal of a client-supplied
id — a `traceparent` from an untrusted client carries exactly the same log-injection risk and must be
validated or replaced the same way.

**Not measured:** the runtime cost of the instrumentation packages on this application, and whether a
collector fits on the current host beside the capped services. Each is input to step 1 and neither
should be guessed.

### 11 · FB-15 — A mid-season group move is only defensible as a swap, and nothing offers one

**Status:** Open\
**Surfaces:** FE, BE\
**Effort:** M\
**Path:** Independent — the lock in the club editor is the interim answer.

**The club editor locks the Gruppe select the moment the selected season is underway and the club has a
fixture in it** (my item, 2026-08-07, out of the admin teams work). A group decides which table counts
the club's results and which bracket slot its placing seeds
([ADR-0035](../_decisions/0035-a-group-placing-is-ranked-by-one-chain-and-seeded-only-when-final.md)),
so moving one club
mid-season falsifies the table and the bracket at once. The lock's own message names the move that
would be defensible: **two clubs exchanging groups**, which keeps each group's size and each schedule
intact.

**Why it is not a pair of junction PATCHes.** `PATCH /teams/{team_id}/saisons/{saison_id}` addresses
one row, so a swap done as two calls has a window in which one group is a club short and the other a
club over — and a failure after the first call leaves the season in that state. A swap is one decision
and wants one transaction over two junction rows, which no endpoint offers. This is the same endpoint
question the draw editor recorded for fixtures
([ADR-0045](../_decisions/0045-a-draw-is-reviewed-as-a-table-of-provenance.md)), on a smaller surface.

**A further bound, also mine:** once the knockout rounds have begun, no swap is defensible either — the
standings have been consumed by the seeding, and a group change behind a played bracket rewrites what
its slots meant. The control must refuse then, not merely warn.

**Where it lands is open.** The club editor addresses one club, so a two-club operation sits awkwardly
there; `/admin/saisons/[saison_id]` addresses the season, which is the thing a swap belongs to, and it
exists. Decide when either is next touched. Today's data has no case that needs a swap.

---

## Tier 4 — standing cautions and watch items

No scheduled action. Each of these has a recorded trigger rather than a plan, and some are owned
elsewhere: BE-6 and BE-7 are seeded into backend audit passes, and OPS-2 into an ops pass. BE-14 and
OPS-3 carry their own triggers — a group of six teams, and the next Cloudflare bot-protection change —
because no pass covers either. DOC-3 and DOC-4 close the tier with the documentation gate's own
limits: each names a rule the gate decides by a narrower test than the rule states, and each fails by
saying nothing.

### 12 · BE-7 — `typing` imports instead of `collections.abc`

**Status:** Standing\
**Surfaces:** BE\
**Effort:** —\
**Path:** Independent — backend audit pass B4's typing check owns the migration.

Several backend modules import `Mapping`, `Sequence`, `Optional` and `Callable` from `typing` — aliases
deprecated since Python 3.9, on a project running far newer. **Deliberately not fixed piecemeal:**
modernising one module while the rest keep the old spelling is worse than uniformity. The recorded
decision is to enable ruff's `UP` rules and migrate in one pass.

### 13 · BE-6 — `CustomObjectId` validates nothing in JSON mode

**Status:** Standing\
**Surfaces:** BE\
**Effort:** —\
**Path:** Independent — backend audit pass B2's validation-mode check owns it.

Its `json_or_python_schema` passes a bare `str_schema()` for the JSON branch
(`fl_backend/app/shared/schemas/custom.py`), so `model_validate_json` accepts **any string** as an
ObjectId while `model_validate` rejects it. Unreachable through FastAPI, which validates
already-parsed dicts — which is precisely why the existing tests certify a guarantee that holds in the
Python mode alone. If anything ever routes through `model_validate_json`, an arbitrary string reaches
a Mongo `_id` filter. Found 2026-07-30.

### 14 · BE-14 — The certainty walk gives up in a group of six or more

**Status:** Standing\
**Surfaces:** BE\
**Effort:** —\
**Path:** Independent — no pass covers it, and only the trigger below reopens it.

**Not a defect today, and the numbers say why** (found 2026-08-05, reviewing the bracket).

`_decide_one_gruppe` walks every combination of outcomes for a group's outstanding fixtures and reports
a placing only when the same team holds it in all of them
([ADR-0035](../_decisions/0035-a-group-placing-is-ranked-by-one-chain-and-seeded-only-when-final.md)).
The walk is capped
per group by `fl_backend/app/api/teams/services.py :: CERTAINTY_FIXTURE_LIMIT` — ten outstanding
fixtures when it was measured on 2026-08-05 — and past the cap it reports no placing at all, which is
the safe direction and, at ten unplayed matches, the honest one.

**The cap is a group size in disguise**, because a group played out in full has one fixture per pair:

| Teams in a group | Fixtures to play | Against the cap      |
| ---------------- | ---------------- | -------------------- |
| 4                | 6                | walks                |
| 5                | 10               | walks, exactly at it |
| 6                | 15               | **reports nothing**  |

Season 2026 holds 16 teams in groups of four, six fixtures apiece (measured 2026-08-06) — comfortably
inside it. A group of six would silently stop that group from seeding the bracket at any point in its
life, and the symptom would be an empty knockout slot with nothing said about it, because a placing
that is merely undecided is deliberately reported to nobody (invariant I24c).

**Raising the constant is not the fix.** The enumeration is `3^n`, so each fixture past the cap triples
the work — a group of six is `3^15` against `3^10`, 243 times as much — and it runs once per referenced
group inside `PATCH /spiele/{spiel_id}`'s transaction. The walk already deduplicates by the points
table each outcome set produces and stops the moment no placing survives every table
(`fl_backend/app/api/teams/services.py :: _decide_one_gruppe`), so the ranking work is bounded by the
distinct tables — but the `3^n` enumeration itself is not pruned, which is what the cap guards.

**Nor is a cleverer algorithm the fix, and the reason was settled on 2026-08-06.** The question this
walk answers — is a team's placing the same however the remaining fixtures go — is the complement of
the classical sports elimination problem. That problem has an efficient exact solution by network flow
**only under a win/draw scheme where a match distributes a fixed number of points**; under the
three-points-for-a-win rule a win creates a point that a draw does not, and deciding elimination
becomes NP-complete (Bernholt, Gülich, Hofmeister and Schmitt, _Football Elimination Is Hard to Decide
Under the 3-Point-Rule_, 1999). Season 2026 scores 3/1/0 through `FLSaisonRules`, and `win_points` is
configurable per season, so the hard case is the one this system has to serve. **There is therefore no
polynomial exact replacement to write**, and the honest options are the cap that exists, an
approximation that would sometimes seed a placing a later result overturns, or a person.

**The textbook fallback is a person, and this system deliberately does not have one.** Established
platforms do not infer finality at all: a group's standing becomes available to seed the next stage
only when the organiser **validates** it, and validation also locks the group's matches. So if a group
ever does grow to six, the cheap answer is an explicit "this group is final" control feeding the same
`DecidedStanding`, not a faster walk.

**Not measured:** how long the walk takes at the cap. Groups of four make it `3^6` = 729 raw iterations
per group, which is unmeasurable; at the cap it is `3^10` = 59,049 per group — cheap per iteration once
deduplicated, but inside a transaction, whose lifetime is bounded.

**Trigger to revisit:** a season drawn with six or more teams in any group, or any change to how groups
are sized.

### 15 · OPS-2 — Nothing validates the contents of a restored `.env`

**Status:** Standing\
**Surfaces:** Ops\
**Effort:** —\
**Path:** Independent — ops audit pass O1 owns the script's failure modes.

**Found 2026-08-01**, the hard way, during a server re-clone.

`deploy.sh` checks that `fl_backend/.env`, `fl_frontend/.env`, `nginx/prod.conf` and `certs/` all
**exist** before it pulls anything, and Compose refuses to start a service whose `env_file` is missing.
**Nothing checks that a value inside those files is well-formed**, and each `.env` is gitignored — so
every server restore recreates them by hand from the password manager, unverified, and a malformed
value surfaces as a container that never becomes healthy.

**What that cost.** The restore produced a `MONGODB_URI` whose host had been truncated, most likely a
shell redirection swallowing part of the string as the file was written. Every preflight passed: file
present, key present, URI syntactically parseable. pymongo then resolved an SRV record that cannot
exist, the startup ping raised `ConfigurationError`, the backend crash-looped, nginx never started
because it waits on `service_healthy`, and the site was down until the truncation was found by reading
a stack trace.

**The options, none obviously right:**

| Option                                                  | Catches                                 | Cost                                                                                  |
| ------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------- |
| Leave it unchecked                                      | Nothing automatically                   | Zero. The failure is loud, contained, and quick to diagnose once recognised           |
| Name-presence preflight in `deploy.sh`                  | A missing key                           | Small. **Would not have caught this incident** — the key was present and merely wrong |
| Resolve the Mongo SRV record in `deploy.sh` before `up` | Exactly this class, plus a dead cluster | Adds a network dependency to a deploy step, and a DNS blip becomes a refused deploy   |

**The trade to weigh** is that resolving the SRV record is the only option that would have helped, and
it makes deployment fail for reasons unrelated to the deployment. Given the failure is already
contained — nginx serves nothing rather than serving something broken — the honest question is whether
a faster diagnosis is worth a new way for `deploy.sh` to refuse.

**Trigger to revisit:** the second time a restore breaks this way, or any move to a setup where the site
cannot tolerate the minutes between a bad deploy and a human reading the log. Ops audit pass O1
(`docs/_auditing/prompts/ops/1-build-deploy.md`, check 4) covers script failure modes and owns this.

### 16 · OPS-3 — The crawler policy is split between robots.txt and Cloudflare, and neither knows about the other

**Status:** Standing\
**Surfaces:** Ops\
**Effort:** —\
**Path:** Independent — no pass covers it, and the table below is the early warning.

**Found 2026-08-01 while diagnosing a missing WhatsApp link preview. Not acted on.**

`fl_frontend/src/app/robots.ts` disallows a named list of AI crawlers, `meta-externalagent` among them.
That file is a **request**: robots.txt is advisory and a crawler chooses whether to obey it.

Cloudflare is separately enforcing something stronger. Measured against the live site, 2026-08-01:

| User-Agent                | page | image |
| ------------------------- | ---- | ----- |
| `WhatsApp/2.x`            | 200  | 200   |
| `facebookexternalhit/1.1` | 200  | 200   |
| `Twitterbot/1.0`          | 200  | 200   |
| `meta-externalagent/1.1`  | 403  | 403   |

The 403 carries `Server: cloudflare` and a `CF-RAY`, and `nginx/prod.conf` contains no user-agent or
`deny` rules — so the block is an edge setting, made in a dashboard this repository does not configure
and does not record.

**Why it matters, and why it is not urgent.** Link previews on Meta's products are fetched by
`facebookexternalhit`, which is served normally, so nothing is broken today. The risk is
consolidation: if preview fetching ever moves behind `meta-externalagent`, every WhatsApp and Facebook
preview for this site stops working, the failure is silent, and nothing in the repository would explain
it. The 403 is invisible from the codebase.

**What a rework has to decide, rather than assume:**

- Whether the AI opt-out belongs in robots.txt, at the edge, or both — and if both, which one is the
  source of truth when they disagree. They already disagree in kind: one asks, one enforces.
- Whether blocking an agent Meta also uses for product features is the intended trade. The opt-out was
  aimed at training, not at previews.
- Whether the edge configuration should be recorded here at all, given `docs/ops/overview.md` states
  that this repository does not configure Cloudflare. A setting that can break a user-visible feature
  and leaves no trace in the repo is the argument for writing it down somewhere.

**Trigger to revisit:** any Cloudflare bot-protection change, or a report of broken previews. Re-running
the table above takes one `curl` per agent and distinguishes an edge block from a markup problem
immediately — which is exactly the distinction that cost time this round.

### 17 · DOC-3 — A rule pattern in the documentation gate reaches less than the rule it enforces

**Status:** Standing\
**Surfaces:** Docs\
**Effort:** —\
**Path:** Independent — no pass covers it, and only the triggers below reopen it.

**Not a defect today, and the corpus is why.** Each pattern below matches everything the repository
currently holds. Each is also narrower than the rule it serves, and where it falls short the gate
answers with silence rather than a finding.

**The rule families are spelt into the patterns.** `scripts/check_docs.py :: RULE_ID_RE` carries the
standard's prefixes as a closed alternation, and `RULE_HEAD_RE`, `CHAPTER_ROW_RE` and
`RULE_INDEX_LINE_RE` repeat the same list. A chapter written under a prefix none of them carries
falls outside all of them at once: citations of its rules resolve to nothing and dangle unreported,
its rules are not held to PRE-4's anatomy, and none of them is required to take a line in the rules
index. Widening the alternation by hand is not the answer, because the list is closed so that the
backend's error codes — which carry an extra segment — can never be read as rule ids. A pattern
whose prefixes disagree with the chapters is a divergence the gate could resolve on its own, the way
`scripts/check_docs.py :: roadmap_ids` derives the roadmap's ids from the tables defining them
instead of matching a shape.

**The metadata pattern is anchored at column 0.** `scripts/check_docs.py :: METADATA_LINE_RE`
requires its bold label to open the line, where `scripts/check_docs.py :: ADR_META_RE` and
`scripts/check_docs.py :: RULE_FIELD_RE` read metadata blocks of their own and each tolerate leading
whitespace — so `scripts/check_docs.py :: check_metadata_breaks` cannot see a metadata block
nested inside a list item or a blockquote, and COR-8's hard break goes unchecked there. Widening it
is not free: this is a discovery pattern run across every page, an indented bold label is a shape
ordinary prose also takes, and a check that reports prose is a check that gets ignored. What an
answer has to find is a way to reach the indented block without reaching indented prose.

**Trigger to revisit:** a chapter added to the standard under a prefix the patterns do not carry, or
the first page that needs a metadata block indented.

### 18 · DOC-4 — A stamp is required by a path and owed by a claim

**Status:** Standing\
**Surfaces:** Docs\
**Effort:** —\
**Path:** Independent — no pass covers it, and only the trigger below reopens it.

**CUR-3 decides a stamp by what a page claims and never by where the page sits.**
`scripts/check_docs.py :: check_stamp_missing` decides it by `STAMP_REQUIRED_GLOBS`, a list of
paths, and the check's own docstring says why: what a page claims is not something a check can read,
so the globs cover the part of the criterion a path settles and leave the rest to a reader.

**What the gap costs.** A page stating current state from outside those globs carries no stamp and
nothing reports the omission — and `branch-impact` arms only on a stamped page, so every file that
page cites may change under it with nothing ever asking for it to be re-verified. That is precisely
the staleness the stamp exists to measure, running unmeasured on the pages the stamp never reached.

**Why inverting the default is not free.** The exempt kinds CUR-3 names are decidable by path: an
ADR, a template, an instruction file, a document addressed to a reader outside this repository. The
class it leaves open is not. A page whose own content is the table that navigates elsewhere needs no
stamp and is not wrong to carry one, so an inverted rule reports it and the report names no defect.
Naming those pages in the check is the outcome to avoid — a list of names is what deciding by kind
was written to replace.

**Trigger to revisit:** a reference page added under `docs/` that sits outside
`STAMP_REQUIRED_GLOBS`, or any change to what the branch-impact check arms on.
