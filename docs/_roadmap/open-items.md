# Open items

**Verified against:** `a42bf5bd`, 2026-08-25\
**Purpose:** what is open on the product, ranked — each entry carrying the analysis its decision needs

| Section                                               | Answers                                                  |
| ----------------------------------------------------- | -------------------------------------------------------- |
| [How this page is ordered](#how-this-page-is-ordered) | What produced the order, and what belongs here at all    |
| [What every entry carries](#what-every-entry-carries) | Which fields an entry states, and what each one may hold |
| [The path at a glance](#the-path-at-a-glance)         | Which items are open, and where each ranks               |
| [The items in rank order](#the-items-in-rank-order)   | Each entry in full, in the working order                 |

**The toolchain, the gate and the documentation corpus are on
[`tooling-items.md`](tooling-items.md)**, and which of the two pages an entry belongs on is
[`protocol.md`](protocol.md)'s. **Look in [`closed-items.md`](closed-items.md) before concluding
that an id never existed.**

## How this page is ordered

**Reading top to bottom is the suggested working order.** One ranked run with no bands, so a
`Status` of `Standing` rather than a section is what says an entry has no scheduled action. Rank by
what it costs to leave an item undone, and let effort break ties toward the cheaper item; the tests
that produce that order — and what must never decide a rank — are in
[`protocol.md`](protocol.md#1-how-a-page-is-ranked).

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
| **Status**   | One value from the closed set derived below                                                                                                          |
| **Surfaces** | Which of FE, BE, DB, Ops and Docs the work would touch, in that order                                                                                |
| **Effort**   | **S** an afternoon · **M** a day or two · **L** a work package across several sessions · **XL** a programme touching data, schemas and UI end to end |
| **Path**     | What the entry blocks, and what blocks it                                                                                                            |

**A status is derived, never chosen**, by the first matching row of
[`protocol.md`](protocol.md#3-re-derive-every-status-not-just-the-one-you-touched) — which is also
where each value's meaning is fixed. A closure re-derives every entry's, not only its own, because
`Blocked` is a claim about another row.

## The path at a glance

| #   | ID    | Item                                                           | Surfaces        | Effort | Status   | Depends on |
| --- | ----- | -------------------------------------------------------------- | --------------- | ------ | -------- | ---------- |
| 1   | BE-15 | The recording exists; the restore over it does not             | FE, BE, DB      | M      | Open     | —          |
| 2   | BE-23 | Consent's writer is deferred to an expert who has not answered | BE, DB, Docs    | M      | Standing | —          |
| 3   | BE-18 | Gaps the domain declaration does not reach                     | BE              | M      | Open     | —          |
| 4   | FB-19 | An undo restores a whole fixture from a list read before it    | FE, BE          | L      | Open     | —          |
| 5   | FB-16 | Nothing announces that a season rollover is due                | BE, Ops         | M      | Standing | —          |
| 6   | FB-17 | Season setup is hand-run, and only an admin enters a squad     | FE, BE, DB, Ops | XL     | Open     | —          |
| 7   | BE-17 | Every server-ordered name list sorts in byte order             | BE, FE          | M      | Open     | —          |
| 8   | BE-19 | Nothing says a multi-write request writes atomically           | BE, Docs        | S      | Open     | —          |
| 9   | BE-20 | The certainty walk never hypothesises a called-off fixture     | BE, Docs        | L      | Open     | —          |
| 10  | FE-17 | A never-clause bounds toast CSS short of the stylesheet        | FE, Docs        | S      | Open     | —          |
| 11  | BE-21 | The seeding table is keyed on a list nothing joins it          | BE              | S      | Open     | —          |
| 12  | FE-24 | A pupil's consent is stored and served, and shown by nothing   | FE              | S      | Open     | —          |
| 13  | FE-21 | The editor shell's widest layout step is unrendered            | FE              | S      | Open     | —          |
| 14  | FE-18 | A vendored stylesheet may reach nothing it declares            | FE              | S      | Open     | —          |
| 15  | FE-19 | One failure sentence, written out at every call site           | FE              | M      | Open     | —          |
| 16  | FE-23 | One adverb is written two ways across the product              | FE              | S      | Open     | —          |
| 17  | FE-1  | A fixture carries one date, not a play window                  | FE, BE          | XL     | Open     | —          |
| 18  | LOG-2 | A cached read's call joins to no render                        | FE, BE, Ops     | L      | Open     | —          |
| 19  | FB-18 | Only the match editor marks a field somebody waits on          | FE, BE          | L      | Open     | —          |
| 20  | BE-12 | No retention sweep selects a retired row on its age            | BE, DB          | M      | Open     | —          |
| 21  | BE-25 | A club's street address is served to an anonymous caller       | BE              | S      | Open     | —          |
| 22  | BE-26 | Two rule summaries name a fixture state the code excludes      | BE              | S      | Open     | —          |
| 23  | BE-24 | An unnarrowed squad read scans an unindexed collection         | BE              | S      | Open     | —          |
| 24  | FE-20 | Search parameters default against an absent value              | FE              | S      | Open     | —          |
| 25  | BE-7  | `typing` imports instead of `collections.abc`                  | BE              | —      | Decided  | —          |
| 26  | BE-14 | The certainty walk gives up in a group of six or more          | BE              | —      | Standing | —          |

**No entry on this page blocks another**, which is why every `Depends on` cell is an em dash. What
each entry waits on that is _not_ an entry — a page, a decision, a scheduled audit pass — is on its
own `Path` line.

---

## The items in rank order

### 1 · BE-15 — The recording exists; the restore over it does not

**Status:** Open\
**Surfaces:** FE, BE, DB\
**Effort:** M — the recording and the page are built\
**Path:** Independent — what dates it is a second writer arriving this year, not another entry.

**What is built.** Every write funnels through `fl_backend/app/core/crud.py`, so the log records there
and is complete by construction rather than by discipline — a router that forgets to record cannot
exist, because no write reaches the driver outside that module. Several routers do reach it for
reads, so the property is about writes rather than about access, and a write added in that shape
would escape. A row carries the actor, the request, the collection, the
document and the image the write replaced (`fl_backend/app/core/recording.py`), and `/admin/aktionen`
lists them. The actor travels as a header the frontend composes from its own session, and an admin
write carrying none is refused rather than attributed to nobody (`docs/backend/spec.md :: I41`).

**What remains is the restore, and it is blocked on a measurement.** A row holds what its write
replaced, so replaying one is a small change over the spine the seven undo handlers already share.
But `docs/frontend/spec.md` §1.3 admits a route handler for a page-owned editor and refuses one for a
row control, and a restore on a log row is a row control. Whether Next's E592 reproduces on a page
that stays mounted is what decides between a server action and an eighth handler, and nobody has
measured it. Retention is the other half, and it sits with the Datenschutzexperte.

**Two gaps in what shipped, both found by a review that had not seen the work written.**

- **A log write that fails outside a transaction reports a failure for a write that committed.**
  `record_write` runs after the domain write, so where the caller opened no transaction — every
  create, and every retire and revive through `set_inactive_since` — a failed log insert answers 500
  while the row exists. An administrator then retries and creates a duplicate. The honest fix is that
  a write and its log row commit together or not at all, which is **BE-19**'s subject rather than
  this entry's; recorded here because this entry is what gave BE-19 a case with a legal consequence
  instead of a data-integrity one.
- **The log page reads at most 1024 rows and sends the API none of its filters.** Search and the
  facets run client-side over whatever that first page held, so once the log passes
  `LIST_LIMIT_MAX` the older rows cannot be reached through the interface at all, and the hint
  telling an administrator to search by correlation id stops finding anything older. The endpoint
  already takes `collection`, `operation` and `correlation_id`; nothing sends them.

**What this settles for the domain programme.** D30 gates round 3 on this entry, reasoning that
writes made before an action log exists are writes nobody can reconstruct. The recording is what that
gate wanted, and the restore is a convenience over the log rather than the thing being waited for — so
the gate lifts when the recording reaches `main`, not when it is written. Round 3's phases 1 and 2
write no data and never depended on it; the phases that migrate and generate do, and for those "the
log exists" has to mean the tree those writes run against.

**Almost every admin write overwrites in place; what changed is that the log keeps what it
replaced.** A result is `$set` over its predecessor, and the write that destroys the most is one
nobody asked for — applying a bracket advancement clears the advanced fixture's `ergebnis`, its `elfmeterschiessen` and a
no-show recorded on it (`fl_backend/app/api/spiele/crud.py :: advance_bracket_winners`), so correcting
a quarter-final deletes a semi-final scoreline that a person had entered, as a consequence of an edit
somewhere else. That destruction is now recorded
and attributable. Making it **recoverable** past the fifteen-second undo is what this entry still
carries.

**Two writes sit outside what any restore could replay, and for different reasons.** A pupil's
erasure keeps no image at all, the values being what it destroys; a confirmed replace of a season's
draw keeps an array of every removed document, and `/spiele` has neither a create nor a delete, so
nothing exists to replay one into (`docs/backend/spec.md :: I48`, `:: I26`). Both are records for a
person to read rather than anything a restore can reach, which is a bound on this entry rather than
work inside it.

**What the reference model does.** Federation administration software treats a disciplinary action as
a case with an audit trail, because a disqualification is a decision somebody has to be able to
justify later, and because a sanction that nobody can trace is a sanction that gets disputed. Part of
that is built — an `austritt` names the route out, the reason and the date — but a
record of the current state is not a history: it says why the club is out, never
what its standing was a week ago.

**What I asked this to become (2026-08-06): an admin action-log page listing every edit and every add,
with a smarter undo built over it.** What is recorded and where it goes are settled; the restore is not:

- **What is recorded:** every write, not only the destructive ones — a page that lists half of them is
  a page nobody trusts. Settled by recording at the one chokepoint every write passes through, so
  completeness is structural rather than a discipline anyone can lapse from.
- **Where it goes:** a collection, because the page reads it. A log stream is out — `deploy.sh`
  recreates the containers and the history would end at the last deploy (`docs/logging/spec.md`).
- **Whether a restore is offered:** yes, and that is the part still open. The bound to beat is the one
  the editor already ships: fifteen seconds, held in the browser, gone on reload. A restore over the
  stored log outlives that and survives a reload, and it reaches a write nobody was watching at the
  time — the case the client-held one cannot.

**Still open: how long it is kept, and whether it holds personal data.** A squad row names a person, so
a history of squad edits is a retention decision rather than a storage one, and it sits with the
Datenschutzexperte. No log row is ever dropped, so whatever they answer is additive rather than a
migration. A third question arrived with the design and is answered: a row keeps the document its
write replaced, so erasing a person has to reach the log or it leaves them intact there — which
`redacted_at` is for, emptied and stamped in place (`docs/backend/spec.md :: I42`).

**What made it urgent was a second person who can write, and that is now covered.** I confirmed on
2026-08-12 that a second person will be writing in the season plan this year, and the cost of delay
was the part that cannot be recovered: a log records from the day it exists and never backwards. That
day has passed. What is left carries no such clock — an unrestorable write is recoverable by hand from
the row that recorded it, slowly, which is a different order of problem from one nobody can
reconstruct at all.

### 2 · BE-23 — The consent gate's writer is deferred to an expert who has not answered, and the log accumulates meanwhile

**Status:** Standing\
**Surfaces:** BE, DB, Docs\
**Effort:** M\
**Trigger to revisit:** the Datenschutzexperte answers. Nothing here is scheduled until then, and
nothing here is a legal conclusion — `domain-assessment.md` §4.0's caveat stands and must not be
relied on as one.

**`einwilligung.bestaetigt_am` has a schema and no writer.** D64 defers who sets it, and records that
**the schema is identical under every answer they can give** — `umfang`, `erteilt_von`, `datum` and
`bestaetigt_am` are written either way, so the field, the rule that publishes nobody without a
recorded consent, and the registration form are all built before the answer arrives, and the answer
selects a writer **without a migration**. What
changes is only which of three designs is built:

- **the registrant**, if a self-declared over-16 consent suffices;
- **a guardian following their own link** — the design that removes the administrator from both
  paths, and the one to build if the answer permits it;
- **an administrator**, round 1's fallback, which needs no further design.

**A fourth option belongs in the same conversation**, and it is the one that would remove the
question rather than answer it: reduce the public surface until a consent stops being load-bearing at
all. _Jugend trainiert für Olympia_ publishes school by school and names no pupil.

**Four things worth putting to them while they are there.** Each is settled in the corpus and each
rests on a judgement nobody qualified has reviewed:

- **Every existing pupil is stamped as publicly consented.** D59 backfills `umfang:
"kader_oeffentlich"` for all of them so nothing changes on deploy. The reservation is recorded at
  the decision: this asserts a consent for which no evidence is held, and D24 establishes that a
  published Datenschutzerklärung does not by itself create a lawful basis. The decision was taken
  with that stated. Round 3 makes the record truthful by keeping a backfilled consent
  **distinguishable** from a collected one.
- **The action log keeps a copy of every person it touches, and it is accumulating now.** D83 found
  that BE-15 stores the prior document on every write, so the log holds a copy of every `spieler` and
  `saison_spieler` row it has ever touched. D60 declined anonymising a pupil because anonymisation
  "answers a pupil's erasure request by keeping a record of them" — and a prior-document log is
  exactly that record, reached from a direction D60 never looked. **An erasure request is answered
  there too**: `DELETE /spieler/{spieler_id}/erasure` empties and stamps every log row naming that
  person or one of their squad rows, inside the transaction that removes them
  (`docs/backend/spec.md :: I42`). What no request reaches is the copy the log holds of every OTHER
  pupil, which nobody has asked about and no rule bounds — so what accumulates is the record of those
  who did not ask, and **how long that is kept is this entry's question rather than the erasure's**.
- **A pupil is hard-deleted and a referee is only anonymised**, and both are built —
  `DELETE /spieler/{spieler_id}/erasure` against
  `POST /schiedsrichter/{schiedsrichter_id}/anonymisieren`. D60's asymmetry is forced by the data
  — `spiele` holds no player reference of any kind, while it embeds a referee's name and id on every
  fixture — but whether the asymmetry is the right answer is not a data question.
- **"Under 16 needs a guardian" cannot be enforced by any server rule.** No birthdate is stored and
  `stufe` is only a proxy, so it lives at the form as a warning on `E1` and `E2`. D64 **declines
  storing `geburtsdatum`**, on the reasoning that it answers a privacy problem by storing a strictly
  more identifying fact about a minor than the one being protected. That decline is the part most
  worth having confirmed or overturned.

**What the public surface is today**, so the expert can judge it rather than reconstruct it: a pupil
is published as a forename and a surname initial, and never with a `stufe`. Publication is NOT gated
on a recorded consent -- the field is stored and the registration form fills it, but no read consults
it. Every stored pupil carries one, `kader_oeffentlich` and marked `bestandsuebernahme`, the carry-over
the schema names for a record nobody was asked for.

**Path:** Independent of every other entry on this page. It blocks round 4's registration path, which
is not on this page, and it has the longest lead time of anything remaining in the programme — asking
early costs nothing, because the schema does not move whichever way it is answered.

### 3 · BE-18 — Gaps the domain declaration does not reach

**Status:** Open\
**Surfaces:** BE\
**Effort:** M\
**Path:** Independent — `fl_backend/app/core/domain.py` holds both halves and
`fl_backend/tests/core/test_domain.py` is where a resolution is asserted.

**`domain.py` is the answer to "may this happen?", in two lists.** `RULES` names every refusal the
application implements, each pointing at the function that implements it and the test that covers
it; `UNENFORCED` names every state the application permits **and has decided to permit**, each with
the reason. `fl_backend/tests/core/test_domain.py` resolves `RULES` in both directions — a refusal
with no row fails, and a row naming no refusal fails.

**The gaps that sit in neither list:**

| The gap                                                                                                                                                                                                                                                                                                                                                                             | Where                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `REQ-CLASH-001` compares only fixtures sharing a calendar date, so two bookings of one venue at 23:30 and 00:30 are sixty minutes apart and both pass                                                                                                                                                                                                                               | `fl_backend/app/api/spiele/services.py :: find_clash_refusal`, whose loop skips a slot on `if slot.datum != datum`                 |
| A fixture given a **`sonderereignis` that frees its slot** is still judged against `REQ-CLASH-001`, so recording one on a fixture that clashes is refused and the admin has to move it first. The opposite direction is already right — the booking read matches `SONDEREREIGNIS_KEEPING_ITS_SLOT`, so a fixture called off, forfeited or annulled frees the ground and the referee | `fl_backend/app/api/spiele/admin_router.py :: patch_spiel_data`, where the clash block is entered on the payload's `datum` alone   |
| `advance_bracket_winners` writes both sides of a fixture without consulting `REQ-SPIELTAG-001`, so the RESOLUTION can create a Spieltag fielding one club twice. The state itself is declared, and every appearance of it is reported on `/admin/action_required` as a `fielded_twice` fault; what neither list reaches is the write that creates it, which consults no rule        | `fl_backend/app/api/spiele/crud.py :: advance_bracket_winners`; `judge_spieltag_occupancy` is reached from `patch_spiel_data` only |
| `REQ-ENTER-003`'s count-then-insert is not transactional, so two concurrent entries can both pass a group's capacity check and take it over its cap                                                                                                                                                                                                                                 | `fl_backend/app/api/teams/admin_router.py :: post_saison_team`                                                                     |
| `REQ-DATE-008`'s neighbour read is not transactional either, so two matchdays of one phase dated at once can each pass against the other's absence and leave the phase out of order. Unlike the entry above, a session would not help: the two writes touch different documents, so nothing conflicts                                                                               | `fl_backend/app/api/spieltage/admin_router.py :: patch_spieltag`, at the two `find_one` neighbour reads                            |

**One of them has a date on it, and the date is this year.**
`fl_backend/app/api/teams/admin_router.py :: post_saison_team` accepts its race in a comment at the
count it reads: the single-admin surface makes the race a non-concern, and losing it costs one team
over a planning bound rather than corrupt data. That reasoning is sound and it rests entirely on
there being one writer. BE-15 records that a second person will be writing in the season plan this
year, confirmed 2026-08-12. When that lands the justification is gone and only the code is left, and
nothing joins the two: the concession lives at the call site rather than in `UNENFORCED`, where a
reader looking for what this system tolerates would find it.

**The declaration's own machinery is not what is left.** An entry in `UNENFORCED` is checked in full
from the day it is written — the refusal codes it sits near, the test that executes the state it
claims, and the surface it says a person can see it on, all resolved against the code and the
frontend tree ([`docs/domain.md`](../domain.md)). What no check can reach is the decision nobody
took, and that is the whole of this entry: a state permitted because somebody weighed it and a state
permitted because nobody looked still read identically until one of them is written down.

**Each state is one of two answers: refuse it, or write it into `UNENFORCED` with the reason.** Both
are cheap, and choosing is the work — which is why they are one entry rather than one apiece. The
precedent is set: the duplicate squad number in one team and season was answered by declaring it,
because the live data already holds the state and refusing it would make those rows uneditable.

### 4 · FB-19 — An undo restores a whole stored fixture from a list read before the save

**Status:** Open\
**Surfaces:** FE, BE\
**Effort:** L — the write path's payload contract moves with it, and the published document and its Zod mirror move with that\
**Path:** Independent. `.claude/CLAUDE.md` §7 fixes two edges a repair may not cross — the undo offer is scoped to the destructive save, and a route-handled undo may not sit outside a page-owned editor — so what moves is the payloads rather than where the undo lives. BE-15's restore over the action log answers the same question in a wider place and blocks nothing here.

**A save on `/admin/spiele/[spiel_id]` can rewrite fixtures nobody opened, and the undo offered for it
puts each of them back as a whole document.**
`fl_backend/app/api/spiele/admin_router.py :: patch_spiel_data` resolves the bracket inside its
transaction, so one save clears results on advanced fixtures and releases sides on others.
`fl_frontend/src/features/spiele/utils.ts :: buildUndoPayloads` then composes one payload per moved
fixture through `:: toPatchPayload`, which lists every field the endpoint takes because the update is
a wholesale `$set` — `fl_backend/app/api/spiele/schemas.py :: FLPatchSpielDataPayload` says so at each
field, and an omitted one is overwritten with nothing. So an undo writes back `datum`, `uhrzeit`,
`notiz`, both quellen and both sides of a fixture whose slot was the only thing that moved.

**The values come from a snapshot, and the snapshot is a different read from the write it corrects.**
The moved fixtures are picked out of the season list the admin context holds
(`fl_frontend/src/features/spiele/utils.ts :: listMovedSpiele`):
`fl_frontend/src/features/admin/components/providers/AdminContextWrapper.tsx` fetches it once per page
render through `fl_frontend/src/features/spiele/queries.ts :: getAdminSpiele`, and
`fl_frontend/src/features/admin/components/providers/AdminContextProvider.tsx` holds it for the life of
the mounted editor. That read is uncached, so the window is one page visit rather than a cache
lifetime — and inside it, anything another writer changes on a moved fixture is reverted by the undo,
silently, with nothing in the payload marking a field the resolution never touched.

**One half of the shape is closed, and the reason it is closed does not generalise.** A payload built
from that list alone would blank `mietpreis` and `payment`, which the season list does not carry, so
the editor reads each moved fixture's booking through
`fl_frontend/src/features/spiele/actions.ts :: readAdminSpielBookingsAction` after the write and merges
it in. That is sound for exactly one reason, stated at the line: the resolution rewrites slots and
results and never a ground or a referee, so the booking read after the write is the booking that stood
before it. No other field has that property.

**The response already names what it rewrote, and stops one step short of what a narrow restore
needs.** `fl_backend/app/api/spiele/schemas.py :: FLSpielAdvancement` and `:: FLSpielReleasedSide`
report per fixture the `voided_ergebnis`, `voided_elfmeterschiessen` and `voided_sonderereignis` a
rewrite destroyed, and which `side` was released. Neither carries enough to rebuild those fields: an
`ergebnis` is a formatted string rather than the goal counts a payload takes, and a released side names
its club rather than the `team_id` a payload takes.

**Two answers, and they are different sizes.**

- **Carry the prior values on the response and restore only the fields it names.** The write path then
  has to accept a payload naming fewer fields than `FLPatchSpielDataPayload` declares, which is the
  whole reason every field there is required — so the endpoint's contract, `fl_backend/openapi.json`,
  the Zod mirror checked against it and the payload builder all move in one change.
- **Restore over the action log instead.** `fl_backend/app/core/recording.py` keeps the document each
  write replaced, so a restore reading it is correct by construction and needs no prior value on the
  response at all. That is BE-15's remaining half, and taking this route makes this entry a consumer of
  that work rather than a repair of its own.

**Not measured:** whether a moved fixture has ever changed under a mounted editor. One person writes
today, so the window is a single administrator's page visit; BE-15 records a second writer arriving in
the season plan this year, confirmed 2026-08-12, which is what turns that window into a shape two
people can meet inside.

### 5 · FB-16 — Nothing announces that a season rollover is due

**Status:** Standing\
**Surfaces:** BE, Ops\
**Effort:** M\
**Path:** Independent — its leverage is that it settles where a scheduled job can run here at all,
which BE-12 leans on for its own "what runs it".

**Deferred by me on 2026-08-12: not worth building yet.** The trigger that turns it into work is a
rollover actually being missed.

**Every step of a rollover has a page; the sequence has nothing.** `/admin/saisons` creates the
season, the team and player editors carry the junction rows, the Spielplan panel on
`/admin/saisons/[saison_id]` draws the matchdays and fixtures, each matchday's own editor dates it, and
the Umstellung panel on that same season page activates it. Each clears its own caches as it saves. What
no surface does is notice that the sequence has not started, or that it stopped half-way: nothing
prompts for a step that is skipped.

**The failure is silent in a specific way.** An omitted step leaves the site serving last season as
though it were this one, and every read of it is a correct read of stale data.

**A reminder is a scheduled job, not a surface** — nothing renders it, nobody navigates to it, and it
has to run when no admin is present. This repository runs **no application-level scheduler**: there
is no queue, no worker, each image's `CMD` starts its one server and nothing else, and nothing
`scripts/deploy.sh` starts is a scheduler either. What runs on a clock here is
`.github/workflows/codeql.yml`, which carries a weekly `schedule: cron` and analyses source — so the
mechanism exists in CI and reaches nothing inside the running application. That, rather than the
message, is the actual scope.

**What has to be settled when it is worked:**

- **What triggers it.** A season's `end_date` is the obvious clock and is the wrong one on its own — a
  season is over when its fixtures are played, and an early rollover is legitimate. The
  honest trigger is probably a date approaching with the next season absent.
- **What runs it.** A container with a cron, a scheduled GitHub Actions workflow hitting a guarded
  endpoint, or the host's own crontab. The workflow needs no new runtime and is already proven here by
  `codeql.yml`, which neither the container nor the host crontab is; the container needs no public
  surface. The trade is where the credential lives.
- **What it says.** The value is the checklist, not the alarm: a reminder naming which steps are
  already done is a different message from one saying a date passed, and only the first is worth
  reading twice.

### 6 · FB-17 — Setting up a season is a hand-run sequence, and only an admin can enter a squad

**Status:** Open\
**Surfaces:** FE, BE, DB, Ops\
**Effort:** XL\
**Path:** Independent — nothing on this page blocks it, and the model the generation half stands on
is settled. BE-15 ahead of it is an ordering preference and not a block. It changes what FB-16's
reminder would have to say and removes no part of the need for one.

**My item, 2026-08-13.** The Saison create form becomes a guided workflow that takes an admin through
a whole new season — its dates, which clubs play it, which clubs are new, and the rules it runs
under — and the season is then built behind that flow, as automatically as it can be. Beside it, an
admin page of the school and team representatives: each is told their team is in the new season and
given a link or a code to paste into that team's group chat. The link leads to a page, also new,
where the players of that team enter themselves with their position, squad number and the rest — a
returning player recognised rather than duplicated, a number clash raised rather than stored. The
Saison page and its editor change with it.

**What ranks it is the rollover.** Everything here is worth having before the next season is set up
and worth much less after: a season set up by hand is a season this work does nothing for, and its
squads are typed by one person either way. That is the test — a clock — that separates it from FE-1,
which carries no date. It ranks under BE-15 because BE-15's cost is the unrecoverable one, and
because this entry is the largest new source of writes on the page: every write is recorded, and until
BE-15 lands there is nothing that puts one back.

**It is a programme, and its parts are not one change.**

| Part                                                        | Needs first                                   | Could ship alone |
| ----------------------------------------------------------- | --------------------------------------------- | ---------------- |
| The guided creation flow, as a page over the create payload | —                                             | Yes              |
| Drawing the season from that flow rather than by hand       | the flow                                      | No               |
| A representatives-and-contacts admin surface                | somewhere to keep a contact                   | Yes              |
| Telling a representative their team is in                   | the contacts surface                          | No               |
| A shareable link or code, and what it authorises            | a ruling on the authorisation model           | No               |
| The public self-registration page                           | the link, and a public write path             | No               |
| Recognising a returning player                              | the registration page                         | No               |
| Raising a squad-number clash                                | the registration page; the reissue hole below | The hole, alone  |
| Rework of the Saison page and its editor                    | whichever of the above lands                  | Yes              |

**The season's structure is not this entry's to build.**
`fl_backend/app/api/saisons/schedule.py :: schedule_for` takes a season's rules and returns, per
phase the season actually plays, how many matchdays it takes and how many matches each holds;
`:: expected_matches` is what a matchday's `anzahl_spiele` reports, and a rules combination that
cannot be played is refused (`fl_backend/app/api/saisons/services.py :: find_rules_refusal`). The
draw writes that answer out: `POST /saisons/{saison_id}/spielplan` composes every matchday and every
fixture of the season from those rules and the clubs entered into it, in one transaction
([`docs/backend/spec.md`](../backend/spec.md) I46), and `spiel_nr` is contiguous from 1 in playing
order because the draw assigns it rather than a caller choosing one. So the shape of a season is a
pure function of what a create form collects, and the flow's structural half is showing that
function's answer while the admin is still choosing, then calling the draw once.

**What the flow owes the draw is the ORDER, not the arithmetic.** The draw refuses a season already
finished (`REQ-SPIELPLAN-003`) and a group holding anything but the teams its rules ask for (`-004`),
so every club still has to be entered before it runs, and a wizard reaching it early is refused
rather than left half-drawn. A season already holding a fixture or a matchday is refused too
(`-001`, `-002`) **unless the request confirms a replace**, which removes both lists and draws them
again inside the same transaction; `REQ-SPIELPLAN-005` holds that to a `future` season with nothing
recorded, and `REQ-RULES-011`'s freeze on the shape rules steps aside in the same window, so a
season drawn from the wrong rules is repairable. The draw is therefore repeatable for as long as the
setup lasts, and a flow that draws early and draws again after a correction is a shape the API
supports — at the price of a confirmation, because a replace destroys the whole schedule rather than
the part that was wrong, and nothing writes one back. Today it is a panel an admin presses on
`/admin/saisons/[saison_id]` once the clubs are in
(`fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/FormSpielplanSection.tsx`),
which is the hand-run sequence this entry is about rather than a flow.

**Ending the flow by making the season live is the one thing it must not do.**
`POST /saisons/{saison_id}/activate` is the only code path in the system that writes `status`, a
created season is always `future`, and creating and activating are two steps **on purpose** — a
single "create it and make it live" call turns a typo in a four-character season id into a silent
rollover of the running season, produced by a form field. A guided workflow that finishes
by making the season current is exactly that call with a wizard in front of it. The flow ends at a
season that is ready and `future`; the rollover stays the panel on `/admin/saisons/[saison_id]`,
where the outgoing season's unfinished fixtures are listed rather than counted.

**A matchday follows from the rules rather than from a person, which is what makes generating a
season a consequence rather than a feature.** A phase takes exactly the matchdays its rules imply —
one per round, so a knockout round is one matchday and not several — and `position` and
`saison_phase` are the draw's, on no payload afterwards. `/admin/spieltage` lists what the draw wrote, and a matchday's own editor
sets the span the draw leaves null. What remains of the structural half is therefore the flow that
collects the rules, not a second writer of anything: `spiele.spieltag_id` still has no fixture-level
create or delete, and nothing needs one — the one endpoint that removes a matchday removes that
season's fixtures in the same transaction, so the reference cannot dangle
(`fl_backend/app/core/domain.py :: REFERENCES`).

**A public write into application data would be the first of its kind here.** Every write that
touches the league's own data sits behind `verify_access_admin`, declared at router level and
inherited by the endpoints under it; the browser
side of that is an email allowlist checked at sign-in and re-derived on every session read
(`fl_frontend/src/core/auth.ts`). The public unauthenticated writes that exist touch no application
data — the sign-in action, which triggers an outbound email and writes into the Auth.js store alone, and
`fl_frontend/src/app/api/client-error/route.ts`, which writes a log line — and each has its own
`limit_req_zone` in `nginx/prod.conf`, keyed so that only the POST is limited. A self-registration
page is the first that inserts a person. What that opens is listed under the undecided questions
below rather than answered here.

**Recognising a returning player has a shape already, and the tempting version of it is refused.**
`spieler` holds the person and the `saison_spieler` junction holds everything a squad list shows;
`uniq_spieler_id_saison_id` gives a person one row per season, so bringing back somebody who
already has a retired row for that season is
`POST /spieler/{spieler_id}/saisons/{saison_id}/reactivate` and never a second create. Making a
create idempotent on a natural key was rejected because a two-letter shorthand cannot distinguish
the same club returning from a different one wanting those letters, and getting it wrong repoints
history silently. **A typed name is a weaker key than a shorthand**, so the same argument binds
harder here: matching on a name
has to propose a candidate rather than resolve one, and the resolution belongs to somebody who can be
wrong out loud. `is_nachgetragen` is the field that already records a squad entry arriving after the
season began, derived from the chosen season's status rather than asked
(`fl_frontend/src/features/spieler/components/forms/AdminCreateSpielerForm.tsx`), and a
self-registration into a running season is precisely that case.

**The squad number is reported rather than refused, and this page owes the same report.** A shared
shirt is a permitted state on every write path (`fl_backend/app/core/domain.py :: UNENFORCED`), so
nothing here has a refusal to inherit — what it inherits is the obligation to say so where the entry
happens. The admin surfaces do that in two shapes:
`fl_frontend/src/features/spieler/utils.ts :: isSquadNummerNewlyShared` decides only on a state the
draft introduces, and the squad editor raises it as a `warning`, which routes the save through the
confirmation.
A page where a whole team enters itself multiplies those writes and has no admin reading them, so
whether a self-registered player may take a shirt somebody in the squad already wears — and who is
told — is a product call this entry owns.

**What the Saison page and its editor inherit.** The create form is a dialog today
(`fl_frontend/src/features/saisons/components/modals/AdminCreateSaisonModal.tsx` over
`fl_frontend/src/features/saisons/components/forms/AdminCreateSaisonForm.tsx`), and what happens
when a form outgrows one is already fixed: it becomes a page at its own route, with panels per
section, a field judged when it is left, one save bar, a discard guard and an undo route handler. A flow that
also picks clubs and creates them passes that threshold by a distance, so the guided workflow is a
page rather than a larger modal, and the pattern to copy is on
`/admin/saisons/[saison_id]` — `fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/AdminSaisonEditForm.tsx`
and the panels beside it, the Spielplan draw among them. The editor is where a wrong
answer from the flow is corrected, so every field the flow collects has to be editable afterwards,
and the narrowing refusals `find_rules_refusal` performs are what the flow has to state while a
value is still being chosen.

**Undecided, and each needs a ruling before the part depending on it starts:**

- **What the link authorises, and what a leaked one can do.** A code per team per season, or a signed
  URL; whether it expires with the registration window; whether it can be revoked and reissued; and
  whether it identifies the team alone or the team and the person. A link pasted into a group chat is
  a link that leaves the group chat.
- **Whether a self-registered entry is live on submission or waits to be admitted.** A squad list is a
  public page, so a public write that lands straight in one is public text written by an
  unauthenticated stranger — the trust `teams.description` and an `austritt`'s `grund` already
  carry, extended to somebody the league has not authenticated.
- **What the form may ask for, and where the notice saying so lives.** `stufe` is the Hessen
  Oberstufe, so the people
  typing into this page are school pupils. The public route group
  `fl_frontend/src/app/(public)/(meta)/` holds `about`, `kontakt` and `team`.
- **Where a representative's contact is kept.** `fl_backend/app/api/teams/schemas.py :: FLTeamRecord`
  carries a club's name, shorthand, description, site and address and no person, so this is a new
  collection or a new embedded record — and a new collection is a member of
  `fl_backend/app/core/collections.py :: Collection`, a hand-written `$jsonSchema` and its indexes in
  `fl_backend/app/core/constraints.py`, and a row in every table that mirrors them.
- **What sends the notification.** Resend is already the transport for the sign-in link, reached
  through Auth.js's provider rather than as a service anything else can call
  (`fl_frontend/src/core/auth.ts`, `fl_frontend/src/core/authEmail.ts`). A second sender is either a
  second call site against the same API or a reason to lift the transport out from under the provider.
- **Whether the flow may enter a club it has just created.** No junction row is ever removed —
  `saison_teams` has a POST, a PATCH and a replace, and no DELETE — but a club does leave a season
  two ways, and the WRONG club is the repairable one:
  `POST /teams/{team_id}/saisons/{saison_id}/replace` hands the row to the club that should have been
  entered, reseeding its identity copy and carrying the change into the season's fixtures, refused in
  a `past` season and once any of those fixtures has left a record (`REQ-REPLACE-001`, `-002`). What
  it does not reach is the club too MANY: a replacement brings one club in for one going out, and
  refuses a club the season already holds (`-003`), so a wizard that enters a club nobody should have
  entered still ends in an `austritt` — a public record with a reason on it, which is a heavy
  consequence for a step in a flow designed to be fast.
- **What a rate limit for this surface should be.** The existing zones are sized for a person signing
  in and for a crashing browser; a whole squad filling a form in one break is a different shape of
  traffic on the same edge.

### 7 · BE-17 — Every server-ordered name list sorts in byte order, so a German name lands in the wrong place

**Status:** Open\
**Surfaces:** BE, FE\
**Effort:** M\
**Path:** Independent — the pipelines and the facet builders both exist, and neither waits on
anything.

**No `$sort` in the backend attaches a collation**, so every server-ordered list is ordered by
Mongo's default binary collation: „Ö" sorts after „Z" rather than beside „O", and a lower-case
initial sorts after every upper-case one. `grep -rn "collation" fl_backend/app` is the whole
measurement, and it returns nothing.

The sorts that decide what a reader sees: `fl_backend/app/api/teams/services.py ::
build_team_pipeline` orders on the requested field and breaks ties on `name`;
`:: build_team_memberships_pipeline` orders every club on `name`; and
`fl_backend/app/api/spieler/services.py :: build_spieler_pipeline` breaks its own ties on `vorname`
and `nachname`, which `:: build_spieler_memberships_pipeline` sorts a squad by outright.

**The frontend disagrees with itself in the same place.**
`fl_frontend/src/features/spiele/facets.ts` sorts its facet options with `localeCompare(…, "de")`;
`fl_frontend/src/features/spieler/facets.ts :: buildSpielerFacets` maps the backend's order straight
into options and sorts nothing. So the same clubs, in a facet carrying the same label, appear in one
order on the Spielsuche and a different one on `/admin/spieler` — which is the version of this a
person notices first, because the two are one navigation apart.

**Two answers, and they are not the same answer.**

- **Attach a `de` collation to the affected `$sort` stages.** It fixes every consumer at once,
  including a paginated read, which is the case the frontend cannot reach. The cost is that a
  collation changes which index a sort may use, so each affected stage needs re-checking against
  `fl_backend/app/core/constraints.py`'s indexes rather than assumed.
- **Sort in the frontend, where a German collator already exists.** Cheaper to write and provably
  correct where the whole list is in hand — and wrong the moment a list is served in pages, because
  a page sorted after it arrives is a page sorted against itself.

**What ranks it here is that the cost is paid per site written before the answer.** Every new
name-ordered pipeline or facet builder added meanwhile is another place to revisit, and the two ends
are already inconsistent enough that a reader cannot tell which one is deliberate.

### 8 · BE-19 — Nothing states that a request making more than one write makes them together

**Status:** Open\
**Surfaces:** BE, Docs\
**Effort:** S\
**Also covers:** the action log's own pairing. Every write now appends a log row
(`fl_backend/app/core/recording.py`), and where the caller opened no transaction the two are separate
writes — so a failed log insert answers 500 for a domain write that committed, and the administrator's
retry duplicates it. That is this entry's rule applied to a path where getting it wrong costs an
attribution nobody can reconstruct rather than a row nobody can join. See BE-15.\
**Path:** Independent — the sweep is below and is done. What is left is where the rule is recorded,
and whether anything holds a later endpoint to it. Backend audit pass B1's multi-document write check
(`docs/_auditing/prompts/backend/1-consistency.md`) asks the same question of the code.

**Every request in `fl_backend/app/` that makes more than one write already makes them inside a
transaction, and no written source says it has to.** Measured 2026-08-20 by reading every call site
of the write helpers in `fl_backend/app/core/crud.py` — `:: patch_one_in_db`, `:: patch_many_in_db`
and `:: post_one_to_db` — together with the helpers layered over them, and every direct driver call
under `fl_backend/app/`. `:: post_many_to_db` is not in that reading: it is a later helper, and the
sweep answers for the tree it was taken over rather than for this one.

**What the sweep leaves out on purpose.** The venue, referee and club patch endpoints each wrap their
rename and its fan-out in `with_transaction` and argue that choice at the line, so they are not the
shape being looked for. What the sweep asks is whether that shape survives anywhere else: a write
that lands, followed by a further write nothing can take back.

**It does not, and each surviving multi-write path argues itself at the line.**

| The path                                                           | How it writes                                                                                         |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `fl_backend/app/api/saisons/admin_router.py :: activate_saison`    | A transaction, demoting whichever season holds `active` and promoting the target inside it            |
| `fl_backend/app/api/saisons/admin_router.py :: swap_gruppen`       | `with_transaction`, judging through the session so a retry after a write conflict re-reads            |
| `fl_backend/app/api/spiele/admin_router.py :: patch_spiel_data`    | `with_transaction` around the save, the sides another fixture gives up, and the bracket's resolution  |
| `fl_backend/app/api/saisons/admin_router.py :: generate_spielplan` | `with_transaction` over the judgement, a confirmed replace's removals, both inserts and the watermark |
| `fl_backend/app/api/spieler/admin_router.py :: erase_spieler`      | `with_transaction` over the person, every squad row and the log rows the erasure redacts              |
| `fl_backend/app/api/teams/admin_router.py :: replace_saison_team`  | `with_transaction` over the season's fixtures and then the junction row that changes hands            |

**The draw, the erasure and the replacement sit outside that reading, and each was read on its own
rather than by a sweep** — which is the entry's point restated: the rule holds because whoever wrote
each of them chose to follow it, and nothing tells the next one.

**What the sweep found instead are neighbouring shapes, and each is already answered.**

- **A read that decides a write.** `fl_backend/app/api/teams/admin_router.py :: post_saison_team`
  counts a group's occupants and then inserts, and the comment at the count accepts the race on a
  single-admin surface. BE-18 carries that acceptance and the date on it.
  `fl_backend/app/api/spieltage/admin_router.py :: patch_spieltag` joined it with `REQ-DATE-008`: it
  reads its two dated neighbours and then writes the span between them, and accepts the race in the
  same words plus one of its own — the interleaving writes two different documents, so a session
  finds no write conflict and both commit. It is read-write skew, which snapshot isolation is
  defined not to detect. The soft deletes share the shape —
  `fl_backend/app/api/spielorte/admin_router.py :: delete_spielort` reads what is still booked and
  then stamps — and none of them writes more than once.
- **Applying the database's own constraints.**
  `fl_backend/app/core/constraints.py :: apply_constraints` writes a validator per collection and
  an index per rule and raises on the first failure, which its own docstring argues for: a run
  that stops part-way looks exactly like one that finished. It is idempotent and runs at boot, so
  the next successful boot reapplies from the start.
- **A restore that spans requests.** `fl_frontend/src/app/api/admin/teams/undo/route.ts` calls the
  club patch and then the membership patch, which is the same shape across the wire, where no
  transaction is available at all. Its answer is to name which half committed rather than to hide it,
  and `fl_frontend/src/shared/utils/undoRoute.ts :: handleUndoRequest` is what carries that refusal
  string back to the browser. A different answer to the same question, taken where the backend's is
  out of reach.

**The question this entry asks is where the rule lives, given that the code already follows it.**
Nothing tells a session writing the next endpoint that a request making more than one write makes
them together, and nothing reports one that does not. `fl_backend/app/core/domain.py` is the obvious
home and is refused one: `.claude/CLAUDE.md` §7 forbids importing it from `app/`, generating it and
enforcing it, so a line there would be a list a reader consults rather than a control. The
alternatives are an invariant on [`docs/backend/spec.md`](../backend/spec.md), whose §2 already
records each transactional write path separately — I46 holds the season's draw to atomicity across
its three collections and reaches no other endpoint, which is the shape of the gap rather than a
closing of it — and a sweep of the source tree in the shape
`fl_backend/tests/api/test_route_order.py` already uses.

**Not measured:** whether such a sweep can tell a genuine multi-write handler from a helper that
merely accepts an optional session. The enumeration above was read rather than executed, and that
reading is what a check would have to mechanise.

### 9 · BE-20 — The certainty walk never hypothesises a called-off fixture, and a call-off can move a placing

**Status:** Open\
**Surfaces:** BE, Docs\
**Effort:** L — my estimate, and it rests on three answers rather than one: which endings the walk enumerates, what a wider set costs inside a write transaction, and how the invariant states the claim afterwards\
**Path:** Independent. It shares a function with BE-14 and asks a different question of it — that entry is the cap on how many outstanding fixtures the walk enumerates at all, this one is the set of endings it enumerates per fixture — so neither blocks the other, and either one's arithmetic moves the other's.

**`fl_backend/app/api/teams/services.py :: _decide_one_gruppe` walks `product((1, 0, 2), repeat=len(open_pairs))` — a win to one side, a win to the other, or a draw — and an outstanding fixture has a fourth ending.** A `sonderereignis` of `ausgefallen` or `annulliert` awards nothing to either club, and `fl_backend/app/api/spiele/schemas.py :: SONDEREREIGNIS_WITHOUT_A_RESULT` is the set that both the walk's own open set and `fl_backend/app/api/teams/services.py :: _still_to_play` exclude on. So a call-off does two things none of the three endings can express: it withholds points the walk assumed one of three ways, and it lowers what a club still has to play — which is half of `:: _may_hold_a_platz`, so a club that has played nothing and whose last outstanding fixture is called off leaves `placeable` and stops holding a placing at all.

**What that reaches is the bracket rather than a table.** `fl_backend/app/api/spiele/crud.py` hands each group's `by_platz` straight to the bracket resolution, so a placing the walk certifies is seeded into a knockout slot. A later call-off that moves it is corrected on the next save, and re-resolving an advancement clears the advanced fixture's stored result — the destruction BE-15 carries.

**Measured on 2026-08-21, against a ground-truth oracle enumerating four endings per open fixture.** Across 3,500 randomised groups and 275,000 exhaustive ones, the shipped walk contradicts the oracle's set in 1.4% to 6.9% of the groups that declare a placing at all — a spread across the generated shapes rather than a confidence bound. **What validates the oracle rather than the walk is the control:** the same comparison, with the oracle restricted to the three endings the walk already knows, finds no contradiction anywhere.

**Two mechanisms produce it, and only one of them needs unusual rules.**

- **Points.** A call-off leaves both clubs exactly where they stood, and no branch of a three-ending walk does — a draw lifts both, a win lifts one. The run separates this mechanism only where `draw_points` is 2 or more, so a season scoring the conventional 3/1/0 does not meet it.
- **Placeability.** `_may_hold_a_platz` admits a club with a match that counts or still could, and a call-off removes the second half. Where a club has played nothing and its only outstanding fixture is called off, it leaves `placeable`, every club under it in the order moves up a number, and no table the walk built holds that ordering. This one is reachable at 3/1/0.

**Widening the alphabet is not the fix, and neither obstacle is arithmetic alone.** The enumeration is `3^n` and would become `4^n`: measured at `fl_backend/app/api/teams/services.py :: CERTAINTY_FIXTURE_LIMIT` on 2026-08-21, the four-ending product takes 7.20 seconds against the three-ending 0.79, and BE-14 records where that time is spent — once per referenced group, inside a transaction whose lifetime is bounded. The second obstacle is structural: `placeable` and `settled` are derived once before the loop, from the fixtures as they stand, and a hypothesised call-off changes both — so each would have to be recomputed per outcome vector, and the deduplication by points table that keeps the walk affordable would no longer identify which iterations may be skipped.

**What [`docs/backend/spec.md`](../backend/spec.md) I24a already says, and what it does not.** I24a states that a placing is written into a bracket slot only when no combination of the group's outstanding results could change who holds it, and it carves out one case: a fixture whose `sonderereignis` awards nothing counts as never coming, so a no-show recorded on one later can overturn a placing that was already final. That carve-out runs the other way — an already-called-off fixture that later receives a result — while the direction measured here, an open fixture later called off, sits inside the sentence the carve-out qualifies. Whichever way this is answered, that invariant moves with it.

**Not measured:** whether the state has ever arisen in the live database, and what the walk contradicts on this season's own shape rather than on generated groups. Against the season shape and rules BE-14 records, only the placeability mechanism above is reachable.

### 10 · FE-17 — A never-clause bounds what a stylesheet may say about a toast, and the stylesheet says more

**Status:** Open\
**Surfaces:** FE, Docs\
**Effort:** S\
**Path:** Independent — `.claude/CLAUDE.md` §7 forbids touching one of its lines without an
instruction naming it, so this entry is the instruction being asked for.

**`.claude/CLAUDE.md` §7 permits a toast to be styled from CSS at the shell and at the frontmost
close button, and `fl_frontend/src/app/globals.css` styles a surface past both.** The block there
sets `.toast` and each of its `--<variant>` modifiers, the close button under `[data-frontmost]`, and
the timer bar — its animation, and the pause the region's hover and focus put on it.

**The same rule is stated in a wider place, and the wider statement is the one that fits the code.**
[`docs/frontend/spec.md`](../frontend/spec.md) I23 states it as a ban on adding — never a new
`.toast*` rule in a stylesheet — which names the surface rather than counting it. §7 states it as a
bound on what may be styled at all, and the bound it names falls short of what the stylesheet holds.
PRE-1's ladder puts the code above the spec sheet and the spec sheet above `.claude/CLAUDE.md`, so
the clause is the loser of both.

**Which parts are genuinely in question, verified against `@heroui/styles` 3.2.4 on 2026-08-20 by
enumerating the selectors its `toast.css` declares:**

- **The variant modifiers are the shell.** HeroUI writes `toast` and its `--<variant>` modifier onto
  one element, so a rule tinting that element's border styles the shell rather than something beside
  it. Every modifier the stylesheet overrides is declared by that file.
- **`toast-region` is never a rule's subject.** It occurs only as the ancestor in the selectors that
  pause the timer, and the property lands on the timer.
- **The timer bar is this app's own element, and its rules are what the clause does not name.**
  `toast.css` declares no `toast__timer` selector, and
  `fl_frontend/src/core/providers/AppToaster.tsx :: toastCard` is what puts the class on the
  element. Its keyframes and its paused state are keyed on an ancestor's hover and focus, which a
  utility on the element cannot express — so a stylesheet is the only route, which is the argument
  the close button's rule already rests on.

**My recommendation, for the ruling this entry asks for:** move the clause rather than the
stylesheet. Naming the surface the way I23 does — the toast rules a stylesheet may hold are the ones
markup cannot reach, and a new one is a breach — states the same bound without a figure that goes
stale the next time a rule is genuinely forced into CSS.

**Context rather than proposal:** `table__column` and the secondary variant's row hover are vendored
selectors overridden in the same file, and no clause governs them. §1.11 of the frontend spec sheet
is what governs both cases, and it already asks a stylesheet rule to name the HeroUI version it was
written against.

### 11 · BE-21 — The bracket's seeding table is keyed on a phase list nothing holds it to

**Status:** Open\
**Surfaces:** BE\
**Effort:** S\
**Path:** Independent — the table, the subscript and the constant that decides the keys sit in
separate modules, and `fl_backend/tests/api/test_spielplan.py :: TestTheTableCoversTheWritePath` is
what stands in front of them today.

**`fl_backend/app/api/saisons/spielplan.py :: BRACKET_SEEDING` is a stored literal holding one row
per `(number_of_groups, qualifiers_per_group)` pair a season can be saved in, and
`:: draw_spielplan` takes its row with a bare subscript.** Pinning the rows rather than deriving
them is argued at the table, and it is also how every competition publishes a bracket, so what is in
question is the key, never the seeding.

**Which keys are legal is settled somewhere else, and nothing in the code joins the two.**
`fl_backend/app/api/spiele/schemas.py :: MAX_QUALIFIERS` is `2 ** len(KNOCKOUT_PHASES)`, so a round
added at the wide end of `:: PHASE_ORDER` doubles the qualifier count a bracket accepts;
`fl_backend/app/api/saisons/services.py :: find_rules_refusal` then stops answering
`REQ-RULES-001` for the rules that reach it, those seasons save, and the pair they present at the
draw has no row. The subscript raises `KeyError`, which leaves
`POST /saisons/{saison_id}/spielplan` answering 500 on a season the write path called legal.

**What makes that live rather than theoretical is that the addition is invited.**
`fl_backend/app/api/saisons/schedule.py :: knockout_phases_for` reads from the END of the phase list
so that a round can be added at the wide end without renaming a round anybody plays, and its
docstring says so. Adding one is an edit to a single tuple, and nothing at that tuple mentions a
seeding table.

**The mitigation is real, it sits in the tests, and that is the whole of the complaint.**
`:: test_it_holds_exactly_the_combinations_a_season_can_be_saved_in` derives what the table must
hold by walking the rules' own ceilings through `find_rules_refusal`, so a widened phase list fails
the gate before any request can reach the subscript. **Nothing in the code states the coupling**:
the table names no phase list, the subscript states no precondition, and whoever widens
`PHASE_ORDER` meets the answer in a test file rather than at the line that would break.

**Two answers, and they buy different things.**

- **Say it where it binds.** A comment at the table naming what its key set is derived from, and one
  at the subscript naming what guarantees the key. Cheapest, and it leaves the 500 reachable for
  anybody who narrows the test rather than the table.
- **Make the write path answer it.** A missing row becomes a refusal naming the rules no bracket is
  drawn for, which needs an error code of its own and a row in the table that publishes it. Dearer,
  and it removes the 500 instead of documenting it.

**Not measured:** what else a widened phase list would move. This reading follows one table and one
subscript and stops at the draw.

### 12 · FE-24 — A pupil's consent is stored and served, and shown by nothing

**Status:** Open\
**Surfaces:** FE\
**Effort:** S\
**Path:** Independent. It decides nothing BE-23 owns and waits on nothing BE-23 waits on; what it serves is the moment BE-23's answer arrives.

**`fl_backend/app/api/spieler/schemas.py :: FLEinwilligung` records what a pupil agreed may be
published — its `umfang`, who gave it in `erteilt_von`, and the dates beside them — and no surface in
the product renders it.** `POST /spieler` composes one through
`fl_backend/app/api/spieler/services.py :: registration_einwilligung`; `fl_backend/app/core/domain.py`
declares the field `IMMUTABLE`, no payload carrying it, so a manual database edit is the only other
writer; `GET /spieler/memberships` serves it on
`fl_backend/app/api/spieler/schemas.py :: FLSpielerWithMemberships`; and
`fl_frontend/src/features/spieler/schemas.ts :: FLEinwilligungSchema` mirrors the shape. No component
under `fl_frontend/src` reads the field.

**Putting it on an admin page is new product surface rather than a repair**, which is why it is filed
instead of built. The placement is the decision — which admin view carries it, the squad editor, the
player editor, or a read view beside the person's other stored facts — and an immutable record shown
beside editable fields owes the reader a word saying which it is.

**What it would show is uniform, measured against the live database on 2026-08-22:** each of the 362
stored pupils carries a consent, every one `umfang: kader_oeffentlich` and
`erteilt_von: bestandsuebernahme`, each with a confirmation date. That is D59's backfill rather than a
collected consent, and it is what makes the display worth something: a record nobody can see is a
record nobody can check, and whether that backfill should stand at all is BE-23's subject.

**What it must not quietly become.** Rendering the field is not gating publication on it, not making it
writable, and not marking a backfilled consent as distinguishable from a collected one — that last is
round 3's, and BE-23 carries the reservation the backfill was taken with. An admin page that shows the
record and changes nothing else is the whole of this entry.

### 13 · FE-21 — The shared editor shell's widest layout step has never been rendered

**Status:** Open\
**Surfaces:** FE\
**Effort:** S\
**Path:** Independent — `fl_frontend/src/shared/components/ui/EditFormLayout.tsx` is the file, and
every entity editor renders through it.

**`fl_frontend/src/shared/components/ui/EditFormLayout.tsx :: EditFormLayout` declares a layout step
at the `2xl` breakpoint that nothing has ever exercised.** What has been rendered is the single
column below `xl` and the grid inside `xl`, where it resolves to `minmax(0px, 1fr) 340px` with the
rail sticky at 24px. Past `2xl` — 96rem in the installed Tailwind 4.3.3, the theme declaring no
breakpoint of its own — the rail becomes 380px and the gap widens, and nobody has looked at it.

**Read from the source, the step moves width the wrong way.** The rail gains 40px and the gap gains
8px, and both come out of the form column, so crossing that breakpoint narrows the fields by 48px
while the viewport grows. Whether the wrapper is at `--container-page`'s cap or short of it does not
change the transfer, only the widths either side of it. That arithmetic is derived from the class
list and the token rather than measured in a browser, and confirming it is the work's first step.

**The question is which way the step goes, not merely whether it is tested.** Either the wider rail
earns the width it takes at that size and the step stays, or it is a default nobody chose and the
shell keeps a single grid past `xl`. Both are cheap; neither is answerable without rendering it.

**Where it has to be rendered, and why that is not free.** Every editor sits behind the admin
sign-in, and the sidemenu takes its share of the viewport before the shell sees any of it, so the
breakpoint and the space the shell actually gets are different numbers.
[`docs/_auditing/lessons.md`](../_auditing/lessons.md) §6 records that a session cannot sign in, so
the honest scope is a look at one editor past 96rem, in a real browser, by somebody who can.

### 14 · FE-18 — A vendored stylesheet ships on every route, and nothing may render what it declares

**Status:** Open\
**Surfaces:** FE\
**Effort:** S\
**Path:** Independent — the header comment in `fl_frontend/src/app/globals.css` moves with it,
because the claim it makes covers a sibling import as well.

**`fl_frontend/src/app/globals.css` imports HeroUI's `disclosure-group.css`, and the class it
declares may be rendered by nothing here.** Read against the installed `@heroui/styles` 3.2.4 on
2026-08-20: that stylesheet declares the lone selector `disclosure-group`; the only component
emitting that class is HeroUI's own `DisclosureGroup` root, through the base slot of
`disclosureGroupVariants`; and no module under `fl_frontend/src` imports `DisclosureGroup`. The app's
accordion is `AccordionRoot`, which renders react-aria's `DisclosureGroup` primitive under the
`accordion` class from `accordionVariants`.

**The proof is short of what removing an import here has to establish.** Enumerating the
selectors and grepping both HeroUI packages are done and are above. What is not done is diffing the
compiled stylesheet either side of the removal, which is what separates a selector nothing renders
from one a component reaches through a path the source does not show. That step needs a build, and it
is the whole remaining work.

**The header comment moves with it, and it is wrong in a direction this entry has to settle.** The
comment above the import list states that `disclosure` and `disclosure-group` back `Accordion`. For
`disclosure-group` that is false. For `disclosure` it is true through `accordion__heading` alone, the
only accordion selector `disclosure.css` declares — and `accordion.css` declares the same selector
with the same declaration, so the accordion would render identically without it. Every other selector
in `disclosure.css` is a `disclosure__*` name whose element the accordion's slots never emit, react-aria's
own default class names being replaced wherever HeroUI passes one.

**What it is worth is a byte figure per route rather than an argument**, and the pair is small. The
value is that the import list and the comment above it stop asserting something the code does not do.
§1.11 of [`docs/frontend/spec.md`](../frontend/spec.md) is the procedure both imports were added
under, and its own instruction is to establish membership from the import graph.

### 15 · FE-19 — One failure sentence is written out at every call site, behind a fallback nothing reaches

**Status:** Open\
**Surfaces:** FE\
**Effort:** M\
**Path:** Independent — both halves land in one change, because deleting the fallbacks removes most
of the literal and a constant covers what is left.

**The literal `"Ein unerwarteter Fehler ist aufgetreten."` occurs 20 times across 18 files under
`fl_frontend/src` (measured 2026-08-25), and
`fl_frontend/src/shared/utils/actionError.ts :: toActionErrorResult` already owns that
vocabulary** — it is the module whose whole job is turning a thrown API error into the sentence a
form renders, and the same literal is its own last branch.

**Almost every copy sits behind a fallback the runtime cannot take.** Each call site spells
`res.error ?? …` or `res.error || …`. `fl_frontend/src/shared/types/types.ts :: FormState` types
`error` as optional, so the checker requires the fallback; whether it can ever run is a runtime
contract rather than a type claim, and the contract holds.
`fl_frontend/src/shared/utils/adminMutation.ts :: runAdminMutation` answers a thrown error with
`toActionErrorResult`, whose every branch sets `error`; and every failing return under
`fl_frontend/src` carries an `error` beside it, measured 2026-08-20 by scanning each such return with
the lines around it.

**Both halves are one change, and neither is worth making alone.** A constant on its own leaves a
sentence imported everywhere and visible nowhere. Deleting the fallbacks on its own needs the type
narrowed — `FormState` becoming a union whose failing member requires its `error` — and that
narrowing is what turns each remaining fallback into a compile error rather than a judgement call per
site. The constant is then what a genuinely new failure message is written from.

**What makes it more than a rename.** `fl_frontend/src/shared/components/ui/EntityForm.tsx` and
`fl_frontend/src/shared/components/ui/ConfirmDeleteModal.tsx` reach the sentence through
`res.error || res.message || …`, and their `res` comes from a caller-supplied function rather than
from an action — so the narrowing has to reach the props those shared components declare, not the
actions alone. The nearby sentences that read almost the same, which each action returns when an
operation comes back unacknowledged, are a different string with a different subject; folding them in
is a copy decision rather than a refactor.

**Not decided:** whether the sentence should stay generic at all. §1.12 of
[`docs/frontend/spec.md`](../frontend/spec.md) fixes the copy rules these messages are written to, and
`toActionErrorResult` states its own reason for a generic message — the diagnosis is already in the
server log, and what an admin needs is whether retrying can help.

### 16 · FE-23 — One adverb is written two ways, and the split runs through the whole product

**Status:** Open\
**Surfaces:** FE\
**Effort:** S\
**Path:** Independent. Cheapest run string by string with `docs/frontend/spec.md` §1.12 open, the
way the `Mannschaft` sweep was run — a find-and-replace is what breaks it, because the two words are
not interchangeable in every sentence position.

**`bereits` and `schon` both mean _already_, and the product uses each about half the time.**
`docs/frontend/spec.md` §1.12 asks for one German
word per concept, and this is the same defect the `Mannschaft` sweep closed for _Team_, one
register lower.

**Why it is filed rather than fixed.** The season slice was settled on `schon` while its refusals
were being rewritten, because two surfaces there stated the identical rule in different words. The
rest was left alone deliberately: a sweep across slices nobody was otherwise editing would have put
unreviewed copy changes into a branch about the fixture draw.

**A clock, mild but real.** Every string a later phase adds in the losing word is another to catch,
which is the argument that moved the `Mannschaft` sweep early rather than late.

**`docs/audit/` is out of scope and stays that way.** Those pages quote the strings that stood when
they were written, so a sweep through them would falsify a record rather than correct a claim.

### 17 · FE-1 — A fixture carries one date, and a play window cannot be expressed

**Status:** Open\
**Surfaces:** FE, BE\
**Effort:** XL\
**Path:** Independent — `/admin/spiele/[spiel_id]` is the page it lands on, and it exists.

**A fixture's `datum` is a single day, so a match scheduled across a window cannot be recorded as one**
(my item, 2026-08-02). Implementing ranges is heavy in my scoping: it would change the match editor's
form (`AdminEditSpielDataForm.tsx :: AdminEditSpielDataForm`), the schemas, and possibly logic and UI
elements **across the board**.

The Zod mirror is not a fourth place to keep in step by hand: it is checked against the published
document, so one that falls behind `datum`'s new shape is a gate failure naming the field.

Touchpoints to scope against when it is worked: `datum` in each schema mirror and in the DB documents;
`computeSpielStatus`'s date comparisons and `formatSpielDisplay`'s labels, each in
`fl_frontend/src/features/spiele/utils.ts`, and the card layouts over them; `sort_by=datum` on the
backend; `searchable_datum` in the Spielsuche; and the `ausstehend` semantics, where a filter
selects and a label partitions — a range makes the ausstehend/heute/vergangen ternary genuinely
harder, and the intent (a fixture whose play window includes today is found by the upcoming filter
and labelled `heute`) is what the range arithmetic has to preserve. Working it re-derives both
definitions under ranges.

### 18 · LOG-2 — A cached read's call joins to no render, and telemetry has nowhere to go

**Status:** Open\
**Surfaces:** FE, BE, Ops\
**Effort:** L\
**Path:** Independent — the correlation id is a floor; tracing waits on new dependencies and on a
destination.

**Implement the industry-standard shape of the correlation scope this repository runs a subset of** (my
item, 2026-08-05). What runs today is **one id
per request, propagated by an ordinary header, written into each service's JSON stream**. The
recognised standard for the same job is **W3C Trace Context** — a `traceparent` header carrying a
trace id, a span id and flags — usually implemented through **OpenTelemetry**, which records not just
an id but a _span per operation_ with parent links, timings and attributes. Next.js documents
`instrumentation.ts` as the hook for it and this repository already has
`fl_frontend/src/instrumentation.ts`; FastAPI/Starlette and pymongo have maintained instrumentation
packages. **Neither upstream claim has been re-verified here** (COR-9).

**What the standard buys over what exists**, in descending order of what it is worth here:

- **A cached read's backend call joins to the page render that triggered it.** This is the one the
  hand-rolled scope provably cannot reach: `"use cache"` forbids request APIs, so no application code
  can carry the request's id into a cache fill (`docs/logging/spec.md`, the cache-fill boundary).
  OpenTelemetry propagates through the framework's own internals instead. It covers every cached read;
  the uncached page-render reads already join.
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
   metadata for a public site into a third party. Whichever answer wins, it lands in
   `docker-compose.yml` and in `scripts/`, which is where the stack is defined and deployed — so this
   step is an ops change before it is a code one.
2. **Only then instrument.** The libraries are the cheap half, and each of them is a new dependency:
   the backend's in `fl_backend/pyproject.toml`, the frontend's in `fl_frontend/package.json`.

**One cheaper thing that is a real improvement on its own**, and a legitimate answer of "not yet" to
the whole programme: **ship the logs off the host before they are lost.** A rotating copy, or a log
driver other than `json-file`. This is the gap that actually costs something today, and it is
independent of tracing.

**The avoidable half of the propagation gap is already closed**, which is what bounds this entry:
`fl_frontend/src/shared/utils/correlationScope.ts :: runWithIncomingCorrelationId` seeds the scope for
every dynamic caller, the uncached page-render reads included. What is left for OpenTelemetry is the
half no application code can reach.

**What it would reverse.** That the identifier is a single id on a custom header. The reversal is
recorded where it will be read — a comment at the line it constrains, a `.claude/CLAUDE.md` §7 line,
or an invariant on `docs/logging/spec.md` — and the argument for it goes in the closing commit's
body. What survives untouched is the stream contract, the error-code system and the edge's refusal
of a client-supplied id — a `traceparent` from an untrusted client carries exactly the same
log-injection risk and must be validated or replaced the same way.

**Not measured:** the runtime cost of the instrumentation packages on this application, and whether a
collector fits on the current host beside the capped services. Each is input to step 1 and neither
should be guessed.

### 19 · FB-18 — Only the match editor tells an admin which empty field somebody is waiting on

**Status:** Open\
**Surfaces:** FE, BE\
**Effort:** L\
**Path:** Independent of every entry here. What it waits on is a product ruling per entity rather
than a page or another item.

**The Fehlt and Empfohlen markers exist on the match editor alone, and putting them on the other
entity editors is a domain question before it is a UI one.**
`fl_frontend/src/features/spiele/components/forms/AdminEditSpielDataForm/ExpectedMarker.tsx :: ExpectedMarker`
renders a marker only where a field is empty **and** a triage category is waiting on it. Those
categories are `fl_frontend/src/features/spiele/types.ts :: ActionRequiredCategory`, each
classifies a fixture, and `fl_frontend/src/features/admin/utils.ts :: ACTION_REQUIRED_LABELS` is
where each is spelled out with the urgency it carries.

**The frontend half is already built.**
`fl_frontend/src/shared/components/ui/FieldLabel.tsx :: FieldLabel` takes an `extraMarker`, every
editor's label goes through it, and §1.14 of
[`docs/frontend/spec.md`](../frontend/spec.md) records the match editor as the one composer filling
that slot — stating in terms that the rows behind it are a concept no other entity has.

**What cannot be borrowed is the meaning.** For a club, a venue, a referee, a player, a squad row, a
matchday and a season, somebody has to say what "the competition is waiting on this field" means, and
whether an empty field there stops anything at all. A marker that fires on emptiness alone is a
different feature wearing the same disc, and it would say Fehlt about a description nobody needs.

**And the backend has nothing equivalent to read.**
`fl_backend/app/api/spiele/admin_router.py :: get_spiele_action_required` is the only route answering
"what needs attention", and its qualifying set is a fixture's. A marker on a club's editor either
derives its answer in the browser from what that page already holds, or asks for a route per entity —
and which of those it is decides whether this is a page change or a contract change.

**What ranks it here is that it is a feature rather than a doubt.** Nothing is wrong today: the
markers are absent rather than misleading, and every other editor already says what it needs through
its required fields and the rail's Hinweise. Its cost is the per-entity ruling, and that cost does
not grow while it waits.

### 20 · BE-12 — No retention sweep selects a retired row on its age

**Status:** Open\
**Surfaces:** BE, DB\
**Effort:** M\
**Path:** Independent — the spieler pages retire rows, so an `inactive_since` can accumulate at all.

**`inactive_since` is a date rather than a flag so that a retired row can eventually be purged**, and
no sweep selects on it.

**One removal exists and it is not that sweep.** `DELETE /spieler/{spieler_id}/erasure` takes the
person, every one of their squad rows and their values in the action log, in one transaction, and
`REQ-PURGE-001` makes retirement its PRECONDITION rather than its trigger — so it answers a request
about one named subject and never a date about many
(`fl_backend/app/core/domain.py :: UNENFORCED`). It narrows this entry rather than closing it: what
is still owed is the selection on age, and the collections nothing removes from at all.

The field is carried by `teams`, `spieler`, `saison_spieler`, `spielorte` and
`schiedsrichter`. A retired `teams`, `spielorte` or `schiedsrichter` row stays forever, keeps its
slot in whatever unique index covers it, and is filtered out of every default read; a retired
`spieler` or `saison_spieler` row stays until somebody asks to be erased.

**Today that is fine and the numbers say so.** Nothing is retired anywhere: 0 rows across those
collections, against 16 teams, 362 players, 362 squad rows, 6 venues and 7 referees
(measured 2026-08-06). This is a prospective item: it exists so the field's purpose is recorded rather
than rediscovered.

**What a purge has to answer, none of it decided:**

- **How old is old enough**, and is it one threshold or one per collection? A venue nobody has booked
  for three years and a squad row from a season that was played are different kinds of stale.
- **What still references the row.** This is the hard half and it is why the delete was soft in the
  first place: `spiele` embeds a copy of a venue, a referee and each team, and references each by id.
  A purge that is not preceded by a reachability check reintroduces exactly the orphaned references
  the soft delete refused. `saison_spieler` is the collection with no such embedding, and `spieler`
  has none either — which is what let the erasure remove both outright.
- **Whether releasing a shorthand from `uniq_shorthand` is a feature or a hazard.** Purging a retired
  club frees its shorthand for reuse, which is the point — and it also means a future club can hold
  letters that historical matches still name, if any survived the check above.
- **What runs it.** A scheduled job, a script I run by hand, or an admin control. The repository runs
  no application-level scheduler — the weekly `cron` in `.github/workflows/codeql.yml` analyses source
  and reaches nothing this could hang off, as FB-16 sets out — which makes the hand-run script the
  cheapest by a distance.

`saisons`, `saison_teams` and `spieltage` carry no such field and need none. Nothing removes a
`saisons` or a `saison_teams` row at all, and a `spieltage` row is removed only wholesale, by a
confirmed replace of the season's draw that writes fresh ones in the same transaction
(`REQ-SPIELPLAN-005`) — so none of them can accumulate a row a purge would have to find.

### 21 · BE-25 — A club's street address is served to an anonymous caller

**Status:** Open\
**Surfaces:** BE\
**Effort:** S\
**Path:** Independent — one response model, and the decision below is what any change to it has to
be argued against.

**`GET /teams` and `GET /teams/{team_id}` serve `FLTeam` on the base tier, and it carries `address`,
`full_name` and `website_url`.** `fl_backend/app/api/teams/schemas.py :: FLTeam` composes from
`_TeamWritable` and inherits all three, so a club's postal address reaches an unauthenticated caller
on both reads.

**Nothing is over-served today.** `/dashboard/teams/[team_id]` renders the address through
`TeamIdentityCard`, so the field has a surface that needs it, and no `READ-*` rule covers a club's
address — `READ-ADDRESS-001` governs a VENUE's and says that one is public through `maps_link`.

**What is owed is a decision, not a fix.** The read-projection work stated the principle that a
public model is an allow-list of what its surface renders, and argued the standings row down to
`FLGruppenTeam` on the ground that _"a club's address is a school's street"_. That argument reaches
`FLTeam` too, and `format=list` in particular serves the address for every club in a season to a
caller rendering none of them. Either the list shape is narrowed the way the standings row was, or
the reasoning is written down as not applying here. **Leaving it unstated is the thing to avoid**,
because the next reader re-derives it from scratch.

### 22 · BE-26 — Two rule summaries name a fixture state the code excludes

**Status:** Open\
**Surfaces:** BE\
**Effort:** S\
**Path:** Independent — two `summary=` strings if they are the wrong half, and a constant more than
the swap reads if they are not.

**`REQ-SWAP-002` and `REQ-SWAP-004` in `fl_backend/app/core/domain.py :: RULES` both read _"played,
called off or given a goal count"_.** The refusal they describe is
`fl_backend/app/api/teams/services.py :: find_gruppe_swap_refusal`, over
`fl_backend/app/api/spiele/schemas.py :: SONDEREREIGNIS_PRODUCING_A_RECORD`, which holds
`abgebrochen`, `nichtantreten_team1` and `nichtantreten_team2`. **`ausgefallen` — which is what
"called off" names — is not in it**, so a called-off fixture does not block a swap and the summaries
say it does.

**Nothing catches it.** `fl_backend/tests/core/test_domain.py` resolves each rule's `implemented_by`
and `tested_by` and asserts the code appears in both, and reads no `summary=` string; the gate
compares no sentence against the code it describes. The register is also what
`docs/logging/error-codes.md` and the frontend's German are written from, so the wrong reading
propagates rather than staying put.

**Decide which is wrong before editing either, and the constant is not the swap's alone.**
`REQ-REPLACE-002` and `REQ-SPIELPLAN-005` are judged over it too, so adding `ausgefallen` would also
stop a club replacement and a confirmed redraw on any season holding a called-off fixture — the case
each of those is meant to be able to move. If the summaries are right, the constant is missing
`ausgefallen`, and every refusal reading it lets through a fixture nobody will replay. If the
constant is right, the summaries want "abandoned" in place of "called off" — which is how `REQ-REPLACE-002` already
words the same membership, so the register states both readings and matches the code in only one of
them. The constant's own comment argues that a called-off fixture is one that never took place,
which points at the summaries; that remains a domain call rather than a recorded decision.

### 23 · BE-24 — An unnarrowed squad read scans an unindexed collection to learn what it may not serve

**Status:** Open\
**Surfaces:** BE\
**Effort:** S\
**Path:** Independent. The candidate homes for an answer are `fl_backend/app/core/constraints.py :: SUPPORT_INDEXES` and `fl_backend/app/api/saisons/cache.py`, and neither waits on anything.

**`GET /spieler` with no `saison_id` reads every withheld season's id before it reads a player.**
`fl_backend/app/api/spieler/router.py` calls
`fl_backend/app/api/saisons/visibility.py :: withheld_saison_ids` on exactly that shape, and
`fl_backend/app/api/spieler/services.py :: build_spieler_pipeline` excludes the answer inside its
junction lookup. What it closes is real: a base-tier caller naming no season would otherwise be served
squad rows from every season, a season still being drawn up included.

**Nothing indexes what that query filters on.** `saisons` carries no index on `status` —
`fl_backend/app/core/constraints.py :: SUPPORT_INDEXES` names the action log and nothing else — so the
read is a collection scan. Measured on 2026-08-22: 1.00 ms against the smallest collection in the
database, and the gate as a whole takes an unnarrowed read from about 60 ms to about 71 ms on a
600-player corpus, cold and warm alike. The shape weighed against it measured three times worse —
folding the exclusion into a nested `$lookup` took 193 ms.

**No rendered page pays it.** The base-tier caller of this route is
`fl_frontend/src/app/dashboard/(shared-views)/spieler/[team_id]/page.tsx`, which passes a `team_id` and
a `saison_id` together, so every read behind a page takes the narrowed branch and the query never runs.
What pays is a caller reaching the API directly.

**Two answers, and one carries a trap.**

- **An index on `saisons.status`**, declared as a `SupportIndex` with the rule string that structure
  asks for. It removes the scan and leaves the round trip.
- **A season cache that can hold a set.** `withheld_saison_ids` states at the line why it does not: the
  cache is keyed by season id, so it holds no set — and **a miss on such a key must not be
  indistinguishable from an empty set**, because an empty set narrows on nothing and serves every
  withheld season's rows. That is the direction that leaks, and any caching answer has to make it
  impossible rather than unlikely.

**One bound the read already carries**, which either answer keeps: the query asks for one row more than
`LIST_LIMIT_DEFAULT` and raises where it gets it, because a truncated set narrows on fewer seasons than
exist ([`docs/backend/spec.md`](../backend/spec.md) I45).

### 24 · FE-20 — A page's search parameters are defaulted against a value the checker says cannot arrive

**Status:** Open\
**Surfaces:** FE\
**Effort:** S\
**Path:** Independent — `.claude/CLAUDE.md` §7 protects this function's redirect and the season
selector's fallback beside it, and names nothing about the defaulting.

**`fl_frontend/src/features/saisons/resolvers.ts :: resolveSaisonId` opens by defaulting its awaited
search parameters to an empty object, and what it awaits is not typed as optional.**
`fl_frontend/src/shared/types/types.ts :: NextPageProps` declares `searchParams` as a `Promise` of a
record, `fl_frontend/tsconfig.json` sets `strict`, and every call site is a page or a component a
page hands its own props to — so no caller the checker admits can supply the value the default
exists for.

**What the default buys if it is reached at all.** Without it, an absent object throws where the next
line reads a key. With it, the function degrades to the backend's own default season. So it trades a
loud failure for a silent one, on a path the checker says nothing reaches.

**What I could not verify (COR-9).** Whether Next.js itself ever renders a page without
`searchParams`. The type this repository relies on is its own declaration rather than the framework's,
and Next 16.3.0 emits its own page-props type into a build directory this session has no build for.
The cheapest way to settle it is to read that generated type after a build, or the framework's
reference for the page convention. The reading I chose is that the branch is unreachable; the reading
I rejected is that the framework may omit the value on some render path, which nothing here refutes.

**What ranks it here.** One token, and almost no doubt removed by taking it out — but the same token
is what a reader has to decide about every time this function is edited, and this function is what
every season-scoped page opens with.

### 25 · BE-7 — `typing` imports instead of `collections.abc`

**Status:** Decided\
**Surfaces:** BE\
**Effort:** —\
**Path:** Independent — backend audit pass B4's typing check owns the migration.

Several backend modules import `Mapping`, `Sequence`, `Optional` and `Callable` from `typing` — aliases
deprecated since Python 3.9, on a project running far newer. **Deliberately not fixed piecemeal:**
modernising one module while the rest keep the old spelling is worse than uniformity. The decision is
to enable ruff's `UP` rules and migrate in one pass, which is why `fl_backend/pyproject.toml`'s ruff
selection leaves that family out.

### 26 · BE-14 — The certainty walk gives up in a group of six or more

**Status:** Standing\
**Surfaces:** BE\
**Effort:** —\
**Path:** Independent — no pass covers it, and only the trigger below reopens it.

**Not a defect today, and the numbers say why** (found 2026-08-05, reviewing the bracket).

`_decide_one_gruppe` walks every combination of outcomes for a group's outstanding fixtures and reports
a placing only when the same team holds it in all of them.
The walk is capped per group by `fl_backend/app/api/teams/services.py :: CERTAINTY_FIXTURE_LIMIT` — ten
outstanding fixtures when it was measured on 2026-08-05 — and past the cap it reports no placing at
all, which is the safe direction and, at ten unplayed matches, the honest one.

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
