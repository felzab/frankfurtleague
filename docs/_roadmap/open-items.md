# Open items

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

| #   | ID    | Item                                                              | Surfaces        | Effort | Status   | Depends on |
| --- | ----- | ----------------------------------------------------------------- | --------------- | ------ | -------- | ---------- |
| 1   | BE-44 | A decision drains no queue, and marking spans the loaded rows     | FE, BE, Docs    | M      | Open     | —          |
| 2   | BE-15 | The recording exists; the restore over it does not                | FE, BE          | M      | Open     | —          |
| 3   | BE-23 | Consent's writer is deferred to an expert who has not answered    | BE, DB, Docs    | M      | Standing | —          |
| 4   | BE-48 | No birthdate is stored, and every age rule guesses from `stufe`   | FE, BE, DB      | M      | Decided  | —          |
| 5   | BE-18 | Gaps the domain declaration does not reach                        | BE              | M      | Open     | —          |
| 6   | FB-19 | An undo restores a whole fixture from a list read before it       | FE, BE          | L      | Open     | —          |
| 7   | FB-16 | Nothing announces that a season rollover is due                   | BE, Ops         | M      | Standing | —          |
| 8   | FB-22 | The season's shape is offered wider than it can be saved          | FE, BE, Docs    | M      | Open     | —          |
| 9   | FB-17 | Season setup is hand-run, and only an admin enters a squad        | FE, BE, DB, Ops | XL     | Open     | —          |
| 10  | BE-49 | The action log page filters one read, and a toast promises more   | FE, BE          | M      | Open     | —          |
| 11  | BE-29 | Two irreversible operations judge from a capped read              | BE              | S      | Standing | —          |
| 12  | BE-20 | The certainty walk never hypothesises a called-off fixture        | BE, Docs        | L      | Open     | —          |
| 13  | FE-17 | A never-clause bounds toast CSS short of the stylesheet           | FE, Docs        | S      | Open     | —          |
| 14  | FE-28 | A squad-row return is offered where the cap refuses it            | FE, BE          | M      | Open     | —          |
| 15  | FE-24 | A pupil's consent is stored and served, and shown by nothing      | FE              | S      | Open     | —          |
| 16  | FE-21 | The editor shell's widest layout step is unrendered               | FE              | S      | Open     | —          |
| 17  | FE-30 | `Team` names a club and the league's own people                   | FE, Docs        | S      | Open     | —          |
| 18  | FE-31 | Every admin success is stated twice, and once invisibly           | FE              | M      | Open     | —          |
| 19  | FE-19 | Every call site writes a fallback the runtime cannot take         | FE              | M      | Open     | —          |
| 20  | FE-1  | A fixture carries one date, not a play window                     | FE, BE          | XL     | Open     | —          |
| 21  | LOG-2 | A cached read's call joins to no render                           | FE, BE, Ops     | L      | Open     | —          |
| 22  | FB-18 | Only the match editor marks a field somebody waits on             | FE, BE          | L      | Open     | —          |
| 23  | BE-47 | A sort option nothing sends scans the archive it sorts            | BE              | S      | Standing | —          |
| 24  | BE-39 | A refusal composes a repair the product refuses to perform        | FE, BE, Docs    | S      | Open     | —          |
| 25  | BE-50 | A list-wrapped window passes the open-window query, then 500s     | BE              | S      | Open     | —          |
| 26  | BE-37 | Wiring the write path refuses stands unreported in storage        | FE, BE, Docs    | M      | Open     | —          |
| 27  | FE-34 | Three entry refusals are rendered twice and compared by nothing   | FE, Docs        | M      | Open     | —          |
| 28  | FE-35 | A fourth rendering of one refusal sits outside the helper's reach | FE              | S      | Open     | —          |
| 29  | BE-42 | Acceptance publishes a school's street address as the club's      | Docs            | S      | Decided  | —          |
| 30  | BE-7  | `typing` imports instead of `collections.abc`                     | BE              | —      | Decided  | —          |
| 31  | BE-14 | The certainty walk gives up in a group of six or more             | BE              | —      | Standing | —          |
| 32  | BE-45 | A tie-break that cannot fire blocks the index it was written for  | BE              | S      | Standing | —          |

**No entry on this page blocks another**, which is why every `Depends on` cell is an em dash. What
each entry waits on that is _not_ an entry — a page, a decision, a scheduled audit pass — is on its
own `Path` line.

---

## The items in rank order

### 1 · BE-44 — Deciding an application does not drain the queue, and duplicates are marked only across the rows one read served

**Status:** Open\
**Surfaces:** FE, BE, Docs\
**Effort:** M\
**Path:** Independent. **BE-42** stands on the same acceptance and holds the decided question of
what that write publishes rather than what the queue can show, and neither blocks the other. **FB-17** would add the second
surface a stranger writes rows through, so whatever answers this is what that flow inherits.
`.claude/rules/frontend.md` fixes one edge a repair sits inside: a triage option is not withdrawn on a
zero count, and the offer's order comes from the label table —
`fl_frontend/src/features/bewerbungen/constants.ts :: BEWERBUNG_STATUS_OPTIONS`, which holds the
states in the order the triage works them down.

**What is built is a read that says when its answer is short.**
`fl_backend/app/api/bewerbungen/router.py :: get_bewerbungen` asks one row past the limit and serves
at most `fl_backend/app/shared/schemas/bounds.py :: LIST_LIMIT_DEFAULT`, so
`fl_backend/app/api/bewerbungen/schemas.py :: FLBewerbungenListResponse` answers **`vollstaendig`**
without counting the filtered set — the unbounded work the read exists to avoid, and the shape
`docs/backend/spec.md :: I45` fixes for every read bounded by the list cap. A caller's own `limit`
is capped rather than obeyed; every `fl_backend/app/core/constraints.py :: SUPPORT_INDEXES` row over
this collection ends in `eingereicht_am` then `_id`, and `fl_backend/app/api/bewerbungen/services.py
:: build_bewerbungen_sort` breaks that tie in the request's own direction, so the pair is the
index's key or its exact inverse and neither the default read nor the reversed one sorts in memory;
`fl_frontend/src/features/bewerbungen/components/ui/BewerbungenUnvollstaendigNotice.tsx` raises a
standing warning where the answer was cut; and `?order=` turns the read around, so the oldest
applications at the far end can be reached. `docs/ops/runbooks.md` §5 is the operator's half of the
same state. **All of it reports on the queue and none of it repairs it**, which is what is left.

**The marking spans the rows one read served, and it is what a ruling rests on.**
`fl_frontend/src/features/bewerbungen/duplicates.ts :: findBewerbungDubletten` walks the list the page
was handed, groups the `eingereicht` rows on season plus club or season plus Kürzel, and marks every
member of a group of two or more. A colliding pair split across the endpoint's cut falls into no group,
so neither half is marked and nothing names the pair — the notice can say that a pair is unmarked and
cannot say which. **That is not cosmetic, because the marking is what the write's silence buys.**
Uniqueness on an unauthenticated form is itself a denial of service, so the write refuses no duplicate
and the queue shows them instead; a queue that shows them across part of its set honours that ruling
across part of its set.

**A decision leaves the row, so the working set never shrinks.**
`fl_backend/app/api/bewerbungen/admin_router.py :: ablehnen_bewerbung` sets `status` to `abgelehnt` and
stamps who decided and why; the row stays, deliberately, the submission being the record the decision
was taken against. The triage page sends no `status` (`fl_frontend/src/app/admin/bewerbungen/page.tsx`),
so a decided application of any season keeps its place among the rows served. **An administrator who
declines every one of them sees the list unchanged and the notice unchanged**, and no endpoint removes
an application, so nothing reachable from the product clears the state. That is what makes a flood a
standing condition rather than an episode: the hours it costs to build buy a queue whose marking cannot
be trusted for that season and every one after it.

**The obvious repair collides with the facet, and that collision is most of the effort.** Decided rows
leaving the default view means a `status` term on the server read. The panel then counts each option
against the rows it was handed — `fl_frontend/src/shared/utils/facets.ts :: countFacetOptions` over the
loaded list — and `fl_frontend/src/shared/components/ui/FilterPanel.tsx` disables an option standing at
zero unless it is already picked. Narrow the server read to `eingereicht` and both other statuses stand
at zero, so both go dead and the archive is unreachable from the control that hid it. The **admin**
clause in `.claude/rules/frontend.md` forbids withdrawing an option on a zero count, and disabling one arrives in the same place by another route.
**So the counts have to come from the server in the same change**, or the narrowing has to be stated
somewhere the facet does not read.

**There is no bulk action**, so clearing a flood is one press per row, each with its own confirmation
and its own round trip. That is what makes the paragraph above bite in practice rather than in
principle, and it is the cheapest of these gaps to close once the read has somewhere to put a
narrowing.

**Two answers are closed, and each looks right from the code alone.**

- **Per-school uniqueness on the write is refused by my ruling.** An index over unauthenticated input
  hands whoever fills the field first the power to own it, so a real school meets a refusal holding its
  own name and the rule meant to protect it locks it out. The marking is what the league has **instead**
  of that index, and the argument is recorded at the function it constrains
  (`fl_frontend/src/features/bewerbungen/duplicates.ts :: findBewerbungDubletten`) and stated again in
  `docs/frontend/spec.md`.
- **Pagination is refused because a cursor splits the set the marking runs over.** Paging would remove
  the mechanism the ruling above rests on, and remove it silently, with no surface saying that a pair
  split across a page boundary goes unmarked — `FLBewerbungenListResponse`'s own declaration records
  that the list is served whole for exactly this reason. It also lands in the facet the way the
  server-side filter does: a page holding one season's open applications leaves every other status and
  every other season at zero, so the archive and the cross-season view both go dead.

Neither is a candidate to weigh again. **What is open is a third shape** — a narrowing the facet is told
about rather than one it has to infer from what arrived, with the marking's set decided by the server
rather than by what a single read happened to serve.

**Why it ranks here, and the honest reading of what it costs.** Reaching the state takes a deliberate
flood: the ceiling is `nginx/prod.conf`'s `bewerbung48` zone, whose own comment puts filling the list
from a single allocation at roughly three hours of sustained work, and closing the season's application
window stops new rows at once.
So it costs less than a defect an administrator meets on an ordinary press; it carries neither the leverage **FB-16** and
**FB-22** hold for the entries that lean on them, nor the dated clock **BE-18** and **FB-19**
each carry. What lifts it over **FB-17** is the last test alone — the same M repairing a live surface's
own purpose, against a programme.

**What is read and what is not** (COR-9). Every gap above is read off a branch rather than measured:
`findBewerbungDubletten`'s loop, `ablehnen_bewerbung`'s `$set`, and the list `countFacetOptions` is
handed. **Nothing here was driven against a truncated queue**, and the sort's plan rests on the
measurement recorded beside `SUPPORT_INDEXES`'s application rows rather than on anything the gate
executes.

### 2 · BE-15 — The recording exists; the restore over it does not

**Status:** Open\
**Surfaces:** FE, BE\
**Effort:** M — the recording, the log page and the undo spine are built; the restore is a change over them\
**Path:** Independent. Landing it is what lets **FB-19** consume the log instead of reworking its
own payloads, which is the leverage that holds this rank. A second person will be writing in the
season plan this year (confirmed 2026-08-12), which multiplies the writes nobody was watching — the
case only a stored restore reaches.

**This entry is the restore alone.** Every write funnels through `fl_backend/app/core/crud.py` and
is recorded with the actor, the request, the collection, the document and the image the write
replaced (`fl_backend/app/core/recording.py`); `/admin/aktionen` lists the rows, narrows to one
document's history, and its answer says when it is short (`vollstaendig`). **How far that page can
reach past its one read is not this entry's** — the filters it sends, the client-side search and
facets over the loaded rows, and the copy toast that promises more than either can give are
**BE-49**. A row therefore holds what a replay needs, and replaying one is a small change over the
spine the editors' undo handlers already share. What is missing is the control that does it: a
restore offered on a log row, past the editor's fifteen-second, browser-held undo — one that
survives a reload and reaches a write nobody was watching at the time.

**What blocks it is a measurement.** `docs/frontend/spec.md` §1.3 admits a route handler for a
page-owned editor and refuses one for a row control, and a restore on a log row is a row control.
Whether Next's E592 reproduces on a page that stays mounted is what decides between a server action
and a route handler of its own, and nobody has measured it.

**Retention is settled: the action log is kept indefinitely.** Decided 2026-08, Datenschutzexperte
consulted. No log row is ever dropped, and erasing a person reaches the log as `redacted_at`,
emptied and stamped in place (`docs/backend/spec.md :: I42`) — the values leave, the rows stay.

**Two kinds of write sit outside what any restore could replay — a pupil's erasure, and taking a
season's draw away — and for different reasons.** The erasure keeps no image at all, the values being
what it destroys; the removal, whether a confirmed replace or an undraw that writes none back, keeps
an array of every removed document, and `/spiele` has neither a create nor a delete, so nothing
exists to replay one into (`docs/backend/spec.md :: I48`, `:: I26`). Both are records for a
person to read rather than anything a restore can reach, which is a bound on this entry rather than
work inside it.

**The write worth building it for is the one nobody asked for.** Applying a bracket advancement
clears the advanced fixture's `ergebnis`, its `elfmeterschiessen` and a no-show recorded on it
(`fl_backend/app/api/spiele/crud.py :: advance_bracket_winners`), so correcting a quarter-final
deletes a semi-final scoreline that a person had entered, as a consequence of an edit somewhere
else. That destruction is recorded and attributable; recoverable past the fifteen seconds is what
this entry adds. Until it lands, an unrestorable write is recovered by hand from the row that
recorded it — slowly, which is the cost of leaving this open rather than a loss.

### 3 · BE-23 — The consent gate's writer is deferred to an expert who has not answered, and the log accumulates meanwhile

**Status:** Standing\
**Surfaces:** BE, DB, Docs\
**Effort:** M\
**Path:** Independent of every other entry on this page. It blocks round 4's registration path, which
is not on this page, and it has the longest lead time of anything remaining in the programme — asking
early costs nothing, because the schema does not move whichever way it is answered.

**It reopens when the Datenschutzexperte answers.** Nothing here is scheduled until then, and
**nothing on this page is a legal conclusion or may be relied on as one.** What is established here is
an engineering fact — no schema records a consent, its scope or who gave it — and every sentence below
touching a lawful basis is a question for somebody qualified rather than an answer from one.

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

**What is worth putting to them while they are there.** Each is settled in the corpus and each
rests on a judgement nobody qualified has reviewed:

- **Every existing pupil is stamped as publicly consented.** D59 backfills `umfang:
"kader_oeffentlich"` for all of them so nothing changes on deploy. The reservation is recorded at
  the decision: this asserts a consent for which no evidence is held, and D24 establishes that a
  published Datenschutzerklärung does not by itself create a lawful basis. The decision was taken
  with that stated. Round 3 makes the record truthful by keeping a backfilled consent
  **distinguishable** from a collected one.
- **The action log keeps a copy of every person it touches, and it is accumulating now.** D83 found
  that the recording stores the prior document on every write, so the log holds a copy of every `spieler` and
  `saison_spieler` row it has ever touched. D60 declined anonymising a pupil because anonymisation
  "answers a pupil's erasure request by keeping a record of them" — and a prior-document log is
  exactly that record, reached from a direction D60 never looked. **An erasure request is answered
  there too**: `DELETE /spieler/{spieler_id}/erasure` empties and stamps every log row naming that
  person or one of their squad rows, inside the transaction that removes them
  (`docs/backend/spec.md :: I42`). What no request reaches is the copy the log holds of every OTHER
  pupil — so what accumulates is the record of those who did not ask. **How long it is kept is
  settled: the log is kept indefinitely** (decided 2026-08, Datenschutzexperte consulted; **BE-15**
  states it beside the restore that reads the log), so what stays worth their eyes is the
  accumulation itself rather than a retention term.
- **A pupil is hard-deleted and a referee is only anonymised**, and both are built —
  `DELETE /spieler/{spieler_id}/erasure` against
  `POST /schiedsrichter/{schiedsrichter_id}/anonymisieren`. D60's asymmetry is forced by the data
  — `spiele` holds no player reference of any kind, while it embeds a referee's name and id on every
  fixture — but whether the asymmetry is the right answer is not a data question.
- **"Under 16 needs a guardian" is carried by nothing.** No birthdate is stored and `stufe` is only
  a proxy, so no server rule can refuse a registration on age — and no surface states the rule
  either: `fl_frontend/src/features/spieler/components/forms/AdminCreateSpielerForm.tsx` and
  `fl_frontend/src/features/spieler/components/forms/AdminSpielerEditForm/FormKaderSection.tsx` each
  render a bare Stufe picker, and the only guardian copy in the product belongs to an application's
  contact person, an adult and a different subject. **Whether a warning should stand at the form is
  an open product question and not a gap being reported here.** D64 **declines storing
  `geburtsdatum`**, on the reasoning that it answers a privacy problem by storing a strictly
  more identifying fact about a minor than the one being protected. That decline is overturned by
  **BE-48** — an optional `geburtsdatum`, collected at registration going forward, no backfill —
  the assistant's call under a standing instruction and open to reversal, so what remains for the
  expert here is that reversal itself.
- **The consent a registration composes asserts a guardian, and the caller is an administrator.**
  `fl_backend/app/api/spieler/services.py :: registration_einwilligung` writes `erteilt_von` as
  `erziehungsberechtigt` and sets `bestaetigt_am` to the same day, and the one endpoint calling it —
  `fl_backend/app/api/spieler/admin_router.py :: post_spieler` — sits on a router guarded by
  `verify_access_admin`. A pupil registered through the admin surface is therefore stored as
  consented by a guardian on the day of registration, and nothing distinguishes that row from one a
  guardian actually filed. The comment at the line gives the reasoning as the guardian being the one
  filing it, which is true of no caller the system has. The vocabulary already carries a value for
  the honest case — `bestandsuebernahme` marks a carried-over record — so the enum can express
  "nobody was asked" and cannot express "an administrator composed this on a guardian's behalf".
  Whether the answer is a further value, a different default, or a form that collects the fact is
  the expert's call as much as an engineering one, which is why it sits here rather than in an entry
  of its own.

**What the public surface is today**, so the expert can judge it rather than reconstruct it: a pupil
is published as a forename and a surname initial, and never with a `stufe`. Publication is NOT gated
on a recorded consent -- the field is stored and the registration form fills it, but no read consults
it. Every stored pupil carries one at `kader_oeffentlich`. The backfilled population is marked
`bestandsuebernahme`, the carry-over the schema names for a record nobody was asked for; every pupil
registered since through `POST /spieler` carries `erziehungsberechtigt` instead.

### 4 · BE-48 — No birthdate is stored, and every age rule guesses from `stufe`

**Status:** Decided\
**Surfaces:** FE, BE, DB\
**Effort:** M\
**Path:** Independent. **BE-23** holds the consent-writer question this field informs — "under 16
needs a guardian" is judged by nothing at all until a birthdate exists — and neither blocks the
other. **FB-17**'s self-registration page is the second surface that would collect the field, and
landing this first is what keeps that form from being built and then reopened.

**Decided 2026-08: `geburtsdatum` becomes an optional field on a pupil, collected at registration
from now on, with no backfill.** The decision is the assistant's, taken under my standing
mature-judgment instruction, and stands open to my reversal. Its parts:

- **Optional, never required.** A registration without the date is stored, not refused.
- **Collected going forward only.** No channel exists to reach existing pupils or their guardians
  for a date after the fact, so there is no backfill and none is planned: every pupil registered
  before the field stays `null` for good.
- **The age rule splits on presence.** Where a birthdate is stored, an under-16 check can run on
  the fact; where it is `null` there is no fact to run on, and `stufe` is the only signal left — a
  proxy that says which grade a pupil attends and not how old they are. **Nothing judges the
  under-16 case today on either side of that split** (**BE-23**), so what this decision supplies is
  the fact rather than a rule over it. A null is an honest "not known", never a refusal.

**What it supersedes.** D64 declines storing `geburtsdatum`, reasoning that it answers a privacy
problem by storing a strictly more identifying fact about a minor than the one being protected —
the decline **BE-23** puts to the Datenschutzexperte. This decision overturns it: I want the date,
and an optional field collected at registration is the narrowest form of having it. The tension
D64 names does not vanish — a birthdate is more identifying than a `stufe` — which is one reason
the reversal stays explicitly open, and why the field is optional rather than required.

**What the work is, when picked up.** The field on the `spieler` model with its hand-written
copies — the validator line in `fl_backend/app/core/constraints.py` and the Zod mirror — moved in
the same commit; the registration form's input; the presence split in whatever judges the
under-16 case. It is not a migration: existing documents simply lack the key, and the read models
default it.

**What ranks it here is a clock the rubric's earlier tests do not reach for its neighbours.** A
birthdate not collected at a pupil's registration is a birthdate this league never gets — no
backfill exists — so every intake that runs before the field lands grows the `null` population
for good, and the next intake arrives with the coming season. **BE-18** waits on a second writer
whose damage is repairable after the fact; this one's is not, which is what test 3 separates on.

### 5 · BE-18 — Gaps the domain declaration does not reach

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

| The gap                                                                                                                                                                                                                                                                                                                                                                             | Where                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REQ-CLASH-001` compares only fixtures sharing a calendar date, so two bookings of one venue at 23:30 and 00:30 are sixty minutes apart and both pass                                                                                                                                                                                                                               | `fl_backend/app/api/spiele/services.py :: find_clash_refusal`, whose loop skips a slot on `if slot.datum != datum`                                                     |
| A fixture given a **`sonderereignis` that frees its slot** is still judged against `REQ-CLASH-001`, so recording one on a fixture that clashes is refused and the admin has to move it first. The opposite direction is already right — the booking read matches `SONDEREREIGNIS_KEEPING_ITS_SLOT`, so a fixture called off, forfeited or annulled frees the ground and the referee | `fl_backend/app/api/spiele/admin_router.py :: patch_spiel_data`, where the clash block is entered on the payload's `datum` alone                                       |
| `advance_bracket_winners` writes both sides of a fixture without consulting `REQ-SPIELTAG-001`, so the RESOLUTION can create a Spieltag fielding one club twice. The state itself is declared, and every appearance of it is reported on `/admin/action_required` as a `fielded_twice` fault; what neither list reaches is the write that creates it, which consults no rule        | `fl_backend/app/api/spiele/crud.py :: advance_bracket_winners`; `judge_spieltag_occupancy` is reached from `patch_spiel_data` only                                     |
| `REQ-ENTER-003`'s count-then-insert is not transactional, so two concurrent entries can both pass a group's capacity check and take it over its cap                                                                                                                                                                                                                                 | `fl_backend/app/api/teams/admin_router.py :: post_saison_team`                                                                                                         |
| `REQ-DATE-008`'s neighbour read is not transactional either, so two matchdays of one phase dated at once can each pass against the other's absence and leave the phase out of order. Unlike the entry above, a session would not help: the two writes touch different documents, so nothing conflicts                                                                               | `fl_backend/app/api/spieltage/admin_router.py :: patch_spieltag`, at the two `find_one` neighbour reads                                                                |
| `REQ-SQUAD-003`'s count-then-insert is not transactional either, and it is reached from three endpoints while one of them carries the concession: a create, a transfer and a return to a squad each judge the season's `max_kadergroesse` from a count taken outside any session                                                                                                    | `fl_backend/app/api/spieler/admin_router.py :: _refuse_a_full_squad`, shared by `:: post_saison_spieler`, `:: patch_saison_spieler` and `:: reactivate_saison_spieler` |
| Two venues or two referees sharing a name. No unique index reaches either collection's `name` and no refusal covers it, so the state is reachable and declared nowhere. It is the one gap here still waiting on something that does not exist — a way to merge two rows — rather than on a decision                                                                                 | `fl_backend/app/core/constraints.py :: UNIQUE_INDEXES`, which names neither collection                                                                                 |

**The concession with a date on it is recorded at more than one call site, and the date is this year.**
`fl_backend/app/api/teams/admin_router.py :: post_saison_team` accepts its race in a comment at the
count it reads: the single-admin surface makes the race a non-concern, and losing it costs one team
over a planning bound rather than corrupt data.
`fl_backend/app/api/spieler/admin_router.py :: post_saison_spieler` accepts the squad cap's race in
the same words and names that line for them, so the two stand or fall together. That reasoning is
sound and it rests entirely on there being one writer. BE-15 records that a second person will be
writing in the season plan this year, confirmed 2026-08-12, and FB-17 would put the squad cap's race
in front of strangers rather than colleagues — the only bound on a leaked registration link is the
cap that race defeats. When that lands the justification is gone and only the code is left, and
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

### 6 · FB-19 — An undo restores a whole stored fixture from a list read before the save

**Status:** Open\
**Surfaces:** FE, BE\
**Effort:** L — the write path's payload contract moves with it, and the published document and its Zod mirror move with that\
**Path:** Independent. `.claude/rules/frontend.md` fixes two edges a repair may not cross — the undo offer is scoped to the destructive save, and a route-handled undo may not sit outside a page-owned editor — so what moves is the payloads rather than where the undo lives. BE-15's restore over the action log answers the same question in a wider place and blocks nothing here.

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
  response at all. That is BE-15's subject, and taking this route makes this entry a consumer of
  that work rather than a repair of its own.

**Not measured:** whether a moved fixture has ever changed under a mounted editor. One person writes
today, so the window is a single administrator's page visit; BE-15 records a second writer arriving in
the season plan this year, confirmed 2026-08-12, which is what turns that window into a shape two
people can meet inside.

### 7 · FB-16 — Nothing announces that a season rollover is due

**Status:** Standing\
**Surfaces:** BE, Ops\
**Effort:** M\
**Path:** Independent — its leverage is that it settles where a scheduled job can run here at all.

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

### 8 · FB-22 — The season's shape is typed into number fields, and two of the three have no contiguous legal range

**Status:** Open\
**Surfaces:** FE, BE, Docs\
**Effort:** M\
**Path:** Leverage for FB-17, whose flow "has to state the narrowing refusals while a value is still
being chosen" — that sentence is this entry. An ordering preference rather than a block: FB-17 could
build its own offer, at the price of building it twice. Raising the group cap also adds seeding keys
`fl_backend/app/api/saisons/spielplan.py :: BRACKET_SEEDING` does not hold, which the comment at
that table states.

**`number_of_groups`, `qualifiers_per_group` and `teams_per_group` are `SaisonRuleNumberField`
steppers in both the create modal and the Regeln panel, and the combinations they accept are wider
than the ones a season can be saved in.** The **saisons** clause in `.claude/rules/cross-surface.md`
bars exactly this — _Offer in the form wiring the write path refuses_ — and the three shape fields are where the product still does it. The clearest
instance needs no arithmetic at all:
`fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/spielplanShape.ts ::
SHAPE_FIELDS` gives `qualifiers_per_group` a `minValue` of 1 and **no maximum**, so the stepper walks
upward without end into a refusal.

**The legal set is small, and two of the three fields cannot be expressed by an interval.**
`fl_backend/app/api/saisons/schedule.py :: qualifier_count` is `number_of_groups ×
qualifiers_per_group`, and `REQ-RULES-001` requires that product to be a power of two in
`[2, MAX_QUALIFIERS]` — `:: knockout_phases_for` returns an empty tuple otherwise, and
`fl_backend/app/api/saisons/services.py :: find_rules_refusal` turns that into the refusal.
`fl_backend/app/api/spiele/schemas.py :: MAX_QUALIFIERS` is `2 ** len(KNOCKOUT_PHASES)`, and
`:: PHASE_ORDER` names four knockout rounds, so the ceiling is 16. A product is a power of two only
where the group count is one, so **the legal group counts are 1, 2, 4, 8 and 16 — never 3, 5, 6 or
7** — and that holds at today's cap, not only at a raised one. `qualifiers_per_group` is bounded the
same way from the other side, and `REQ-RULES-007` adds that it may not exceed `teams_per_group`.

So `number_of_groups` and `qualifiers_per_group` want selects: their legal values are
**non-contiguous**, and a stepper with a floor and a ceiling is structurally incapable of stating a
set that skips. `teams_per_group` wants to stay a stepper, its legal values being a genuine range —
`max(2, qualifiers_per_group)` upward — with bounds derived from the other two rather than written
into `SHAPE_FIELDS` by hand. The distinction is the entry's point: the defect is not that a number
field is the wrong control, it is that two of these three fields do not describe intervals.

**`SHAPE_FIELDS` is where the offer belongs.** Its own docstring says it is "One table for the fields
and the confirmation both, so no readout can label a number differently from the field above it", so
the redraw confirmation inherits a corrected offer for free.
`fl_frontend/src/shared/components/ui/refusableOption.ts :: pickIfOffered` and
`fl_frontend/src/shared/components/ui/RefusableSelect.tsx :: RefusableSelect`
are the mechanism already built for an option that closes, and they fix the repository's answer to a
stored value the offer no longer holds: a closed option resolves to `null`. Where the stored value
must stay visible rather than clear, the pattern is the Herkunft picker's — keep the row only where
it IS the current choice, so it reads as a statement rather than an offer.

**The redraw panel gains the most.** `REQ-SPIELPLAN-004` demands that every offered group hold
exactly `teams_per_group` after a redraw, so that panel can offer only shapes whose group count times
team count equals the clubs already entered. That collapses three interacting fields into a short
reachable list, on the one panel where a wrong guess costs a failed draw rather than a refused save.

**What selects can and cannot design out.** `REQ-RULES-001` and `REQ-RULES-007` are arithmetic on the
three numbers alone, so an offer can guarantee them. `REQ-RULES-002`, `REQ-RULES-003` and
`REQ-RULES-006` read the season's own occupancy and fixtures, and
`.../AdminSaisonEditForm/FormRegelnSection.tsx` is handed three freeze flags and no occupancy today.
Threading the group fill counts in would reach the first two, and it is cheaper than it sounds:
`REQ-RULES-011` freezes all three fields absolutely once a fixture exists, so the only editable case
is an undrawn season, where occupancy is the sole remaining stored constraint.

**No backend rule is removed, and the entry is written down so a later session does not reach for
one.** The selects eliminate a round trip, never a rule. A stale tab holds an offer derived from rules
that have since changed; the API is reachable without the form; and a derived offer is a further
mirror of backend rules that can drift —
`fl_frontend/src/features/saisons/schemas.ts :: hasPlayableBracket` is already the second, and
`.claude/rules/cross-surface.md` holds the Zod mirror to presence, required, nullable, type and enum, so `fl_frontend/src/core/apiContract.test.ts`
compares no numeric bound and would not catch the drift. The offer therefore needs a test of its own
pinning it against the backend's rule functions;
`fl_frontend/src/features/saisons/recordedFactMirror.test.ts` is the precedent for parsing the Python
side rather than restating it. Where a rule should genuinely stop holding,
`fl_backend/app/core/domain.py :: UNENFORCED` is the mechanism and deletion is not.

**Raising the cap to 16 is my direction, and these are the hazards it turns live.** Each was
read 2026-08-27 and none is reachable while the cap and the closed name set agree.

| Site                                                           | What it does                                                                                                                                                                                                                                                                                                    | Loud or silent                                                                                                                 |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `fl_backend/app/api/teams/services.py :: offered_gruppen`      | `get_args(FLGruppenNames)[:number_of_groups]` — a bare slice that returns four names for eight and raises nothing. `find_entry_refusal`, `REQ-SPIELPLAN-004` and `fl_backend/app/api/saisons/spielplan.py :: _squads` all inherit it                                                                            | **Silent.** Held shut today only by `fl_backend/tests/api/test_reference_models.py`, which asserts the cap equals the set size |
| `fl_frontend/src/features/teams/utils.ts :: buildGruppeOffer`  | The identical slice in TypeScript, so clubs could not be entered into the new groups at all                                                                                                                                                                                                                     | Silent                                                                                                                         |
| `fl_frontend/src/features/teams/schemas.ts :: FLGruppenSchema` | A `z.object` with four required keys, and `z.object` strips unknown ones — a fifth group is dropped on parse and the standings page renders four tables with no error                                                                                                                                           | Silent at runtime; `apiContract.test.ts` catches the drift                                                                     |
| `fl_backend/app/api/teams/services.py :: build_gruppen`        | Seeds from the name set rather than the season, so a wider set renders empty group cards on every smaller season. Changing it moves `docs/backend/spec.md :: I10`, the glossary's trap and `FLGruppenSchema`'s shape together                                                                                   | Silent                                                                                                                         |
| `.../AdminEditSpielDataForm/FormTeamPicker.tsx`                | Hardcodes the group list with `satisfies`, which type-checks against a wider union and quietly stops offering the new groups                                                                                                                                                                                    | Silent                                                                                                                         |
| `FormRegelnSection.tsx` and `AdminCreateSaisonForm.tsx`        | Two hand-written `maxValue={4}` steppers, pinned by no test                                                                                                                                                                                                                                                     | Silent                                                                                                                         |
| `fl_backend/app/api/spiele/admin_router.py` and `:: crud.py`   | Season-scoped fixture reads raise past `LIST_LIMIT_DEFAULT` (1024) as a 500 rather than a refusal. `fl_backend/app/api/saisons/schemas.py :: TeamsPerGroup`'s comment states its ceiling of 16 was chosen to keep the largest legal season inside that limit, so raising the group cap makes that comment false | Loud, as a 500                                                                                                                 |

**What is unexpectedly clean.** No layout anywhere is sized per group — every grid in
`fl_frontend/src` is card responsiveness, no tab strip or filter row carries one entry per group, and
no table has a column per group. Nothing on the frontend sorts group names, so the byte-order hazard
`docs/backend/spec.md :: I54` guards against does not reach this. The standings page stacks one card per group and grows, which
is a design question at sixteen groups rather than a breakage.

**Not verified.** Nothing here was seen rendering — no admin session is available to the sessions that
read it — so every claim about a control is read off source and class strings. The legal-set
arithmetic is derived from the rule functions rather than executed. The bracket's own seeding table
(`fl_backend/app/api/saisons/spielplan.py :: BRACKET_SEEDING`) was not re-measured here.

### 9 · FB-17 — Setting up a season is a hand-run sequence, and only an admin can enter a squad

**Status:** Open\
**Surfaces:** FE, BE, DB, Ops\
**Effort:** XL\
**Path:** Independent — nothing on this page blocks it, and the model the generation half stands on
is settled. BE-15 ahead of it is an ordering preference and not a block, and so is FB-22, which builds the shape offer this flow would otherwise build a second time. It changes what FB-16's
reminder would have to say and removes no part of the need for one. OPS-78 on
[`tooling-items.md`](tooling-items.md) names this entry as what makes it timely, and does not
block it.

**My item, 2026-08-13.** The Saison create form becomes a guided workflow that takes an admin through
a whole new season — its dates, which clubs play it, which clubs are new, and the rules it runs
under — and the season is then built behind that flow, as automatically as it can be. Beside it,
`/admin/kontakte` lists the school and team representatives a season holds. An accepted application
tells its own contacts
(`fl_frontend/src/features/bewerbungen/notifications.ts :: sendBewerbungMail`); what is still owed is
that message for a team entered by hand, and a link or a code to paste into that team's group chat.
The link leads to a page, also new, where the players of that team enter themselves with their
position, squad number and the rest — a returning player recognised rather than duplicated, a number
clash raised rather than stored. The
Saison page and its editor change with it.

**What ranks it is the rollover.** Everything here is worth having before the next season is set up
and worth much less after: a season set up by hand is a season this work does nothing for, and its
squads are typed by one person either way. That is the test — a clock — that separates it from FE-1,
which carries no date. It ranks under BE-15 because this entry is the largest new source of writes
on the page: every write is recorded, and until BE-15's restore lands, putting one back is a hand
replay from the row that recorded it.

**It is a programme, and its parts are not one change.**

| Part                                                        | Needs first                                   | Could ship alone |
| ----------------------------------------------------------- | --------------------------------------------- | ---------------- |
| The guided creation flow, as a page over the create payload | —                                             | Yes              |
| Drawing the season from that flow rather than by hand       | the flow                                      | No               |
| Telling a representative entered by hand their team is in   | —                                             | Yes              |
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
recorded. The replace CARRIES the new shape rules and writes them in that same transaction, which
is what makes a season drawn from the wrong numbers repairable: a season's shape rules and its
draw are one fact, so `REQ-RULES-011` keeps them off the patch entirely rather than lifting. The draw is therefore repeatable for as long as the
setup lasts, and a flow that draws early and draws again after a correction is a shape the API
supports — at the price of a confirmation, because a replace destroys the whole schedule rather than
the part that was wrong, and nothing writes one back. **What a replace reaches is the qualifier count**, the group
shape being fixed by the clubs already entered; `DELETE /saisons/{saison_id}/spielplan` undraws the
season instead, which is the way back from a group shape guessed wrong, and
[`docs/domain.md`](../domain.md) carries the sequence. Today it is a panel an admin presses on
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

**A public write into application data has one precedent, and it inserts no person into the league.**
The application form's `POST /bewerbungen` is base-tier and stores what a school submitted, decided by
nobody until the triage reaches it ([`docs/backend/spec.md`](../backend/spec.md) §1.1). Every other
write that touches the league's own data sits behind `verify_access_admin`, declared at router level and
inherited by the endpoints under it; the browser
side of that is an email allowlist checked at sign-in and re-derived on every session read
(`fl_frontend/src/core/auth.ts`). The remaining public unauthenticated writes touch no application
data — the sign-in action, which triggers an outbound email and writes into the Auth.js store alone, and
`fl_frontend/src/app/api/client-error/route.ts`, which writes a log line — and each public write has its
own `limit_req_zone` in `nginx/prod.conf`, keyed so that only the POST is limited. A self-registration
page is the first that inserts a person, and the first whose text reaches a public page with no decision
standing between. What that opens is listed under the undecided questions
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

**Nothing refuses a shared squad number and nothing reports one, so this page inherits a question
rather than a pattern.** A shared shirt is a permitted state on every write path
(`fl_backend/app/core/domain.py :: UNENFORCED`). The squad editor's rail raises no banner about a number
(`fl_frontend/src/features/spieler/components/forms/AdminSpielerEditForm/banners.ts :: buildSpielerBanners`),
and the create form judges `nummer` on its format alone
(`fl_frontend/src/features/spieler/components/forms/AdminCreateSpielerForm.tsx`); the editor's save
routes through a confirmation for any banner above `info`
(`fl_frontend/src/shared/components/ui/railBanner.ts :: resolveBlockingBanners`), and the only one it
raises is `spieler.team-changed` — a transfer rather than a shirt.
A page where a whole team enters itself multiplies those writes and has no admin reading them, so
whether a self-registered player may take a shirt somebody in the squad already wears — and who is
told — is a product call this entry owns, and no admin surface answers it first.

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

**Where a representative's contact is kept is fixed, and the flow inherits it rather than choosing
it.** The block is embedded rather than given a collection of its own: on the `saison_teams` junction
(`fl_backend/app/api/teams/schemas.py :: FLSaisonTeamKontakte`) and on an application row, both
validated through one sub-schema (`fl_backend/app/core/constraints.py :: _KONTAKTE_PROPERTIES`), so a
role added to the block reaches both collections in the commit that adds it. `/admin/kontakte` reads
the junction's copy, and `fl_backend/app/api/kontakte/admin_router.py :: erase_kontaktperson` is the
one route that removes a person from either.

**What a failed notification does is fixed too, and this entry inherits it rather than choosing
it** — a decision's message reaches every person the application names and no failure to deliver it
retracts the decision ([`docs/frontend/spec.md`](../frontend/spec.md) I39). What is local to this entry is how
little of that surface there is to copy from: `fl_frontend/src/core/mail.ts :: sendMail` has two
callers today, the triage's fan-out in
`fl_frontend/src/features/bewerbungen/notifications.ts :: sendBewerbungMail` and the sign-in link
through the Resend provider's override in `fl_frontend/src/core/auth.ts`. Telling a representative
entered by hand that their team is in adds the third.

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
- **What a rate limit for this surface should be.** The zones that exist are sized for a person
  signing in, for a crashing browser, and for one school submitting one application; a whole squad
  filling a form in one break is a different shape of traffic on the same edge, so
  `zone=bewerbung` ([`docs/ops/spec.md`](../ops/spec.md) §1.3) is the nearest precedent rather than
  the answer.

### 10 · BE-49 — The action log's page narrows one capped read, and its search, its facets and a copy toast all stop there

**Status:** Open\
**Surfaces:** FE, BE\
**Effort:** M — sending the terms is small; making the facet counts honest is the rest\
**Path:** Independent. **BE-15** builds the restore over the same log and neither blocks the other.
**BE-44** is this same shape on the application queue — a server narrowing that would leave a
client-side facet counting zero — so whatever answers it there is what this should follow rather
than solve a second time.

**The page asks for one page of the log and narrows it by one key.**
`fl_frontend/src/app/admin/aktionen/page.tsx :: AktionenTable` composes its request from
`document_id` alone, so what arrives is
`fl_backend/app/shared/schemas/bounds.py :: LIST_LIMIT_DEFAULT` rows of the newest history and
nothing else. The endpoint is not the constraint:
`fl_backend/app/api/aktionen/admin_router.py :: get_aktionen` already takes `collection`,
`operation` and `correlation_id` and composes each into its query. Nothing sends them.

**Search and the facets then run over the rows that arrived.**
`fl_frontend/src/features/aktionen/facets.ts :: AKTIONEN_FACETS` reads every option's members off
the loaded list, and `fl_frontend/src/features/aktionen/components/views/AdminAktionenView.tsx`'s
`SEARCH_KEYS` matches the same rows, so both narrow within one read rather than within the log.
**Most of that is disclosed rather than silent.** Where the answer was cut, `AdminAktionenView`
raises a standing warning saying in as many words that the search and the filters reach the loaded
rows alone, and the `vollstaendig` flag it reads is `docs/backend/spec.md :: I45`'s shape.

**One surface promises otherwise, and it is the one an administrator is following.** Copying a
row's Vorgangsnummer raises a toast reading "Suche danach, um jede Zeile dieses Vorgangs zu sehen"
(`fl_frontend/src/features/aktionen/components/collections/AdminAktionenTable.tsx`). A Vorgang
whose rows straddle the cut is one that search cannot show whole, and the toast is unconditional
where the warning above it is not — so the instruction is given at the moment nothing is saying it
may not hold.

**What makes this grow rather than sit.** No log row is ever dropped and the log is kept
indefinitely (**BE-15** carries the decision), and every admin write appends one, so the share of
the log this page can reach only falls. `get_aktionen`'s own comment states the consequence: the
cap arrives by ordinary use.

**Why it ranks here.** Nothing is built on this entry, so the first test puts it under every one
above it that another consumes — **BE-15**, **FB-19**, **FB-16**, **FB-22** and **FB-17**. The
second gives it a clock, a log that only grows against a fixed cap, which lifts it over the
entries below, each a standing defect with no date. Against **BE-18**, which carries a clock of
its own, the third test separates: its answer decides what later work is written against, while
nothing has to be redone after this one — the endpoint already takes the three
terms, so the narrowing is additive whenever it lands.

**What is read and what is not** (COR-9). Every claim here is read off the source rather than
measured: the request the page composes, the terms the endpoint accepts, the two client-side
narrowings, and the toast's copy. **Nothing was driven against a log past the cap**, and how many
rows the collection holds today was not counted, so how soon the state arrives is unknown.

### 11 · BE-29 — The replace and the undraw judge their window from a capped read

**Status:** Standing\
**Surfaces:** BE\
**Effort:** S\
**Path:** Independent — nothing blocks it and it blocks nothing. It reopens on one thing alone: a
season reaching the API whose fixtures were not drawn by it, through an import, a hand-built season or
a migration.

**Both irreversible operations count what they must not destroy from one capped read.**
`fl_backend/app/api/saisons/admin_router.py :: generate_spielplan` and `:: undraw_spielplan` each call
`fl_backend/app/core/crud.py :: pull_many_from_db` on `spiele` filtered by `saison_id` with no `limit`
argument, which takes `fl_backend/app/shared/schemas/bounds.py :: LIST_LIMIT_DEFAULT` as a real
ceiling on the cursor — `cursor.limit()`, as that helper's own docstring says. A `sum` over
`fl_backend/app/api/saisons/services.py :: holds_a_recorded_fact` across the returned list is then
what `REQ-SPIELPLAN-005` and `REQ-SPIELPLAN-006` are judged on. **A season holding more fixtures than
the ceiling has everything past it invisible to both refusals, and both operations then remove it.**
`len(stored_spiele)` feeds the replace's own `fixtures_drawn` in the same call, so its count is capped
too — while the matchday count beside it is a `count_documents` and is not.

**No season the API can draw comes close, and the ceiling that guarantees it is documented as existing
for this reason.** `fl_backend/app/api/saisons/schemas.py :: TeamsPerGroup` states at the line that its
ceiling "keeps the largest legal season inside `app/shared/schemas/bounds.py :: LIST_LIMIT_DEFAULT`,
past which a season-scoped read truncates and its refusals cannot be trusted". So the exposure is not
a season this API produced.

**One entry rather than two, because the exposure is one read shape and both operations share it.**
They also share the repair: either the count is a `count_documents` on the same filter, which has no
ceiling and is what a refusal actually needs — the shape one argument above it already uses — or the
read asks for one row more than the limit and raises on getting it, which is what
`docs/backend/spec.md :: I45` fixes for a narrowing read and what
`fl_backend/app/api/saisons/visibility.py :: withheld_saison_ids` does. The second is the closer match,
because both call sites want the rows as well as the count: they project `RECORDED_FACT_FIELDS` and
iterate them.

**Why it is `Standing` and not `Open`.** Fixing it costs almost nothing, and leaving it costs nothing
at all until a season arrives from outside the draw. What the entry buys today is that the guarantee is
written down as resting on a bound in one file rather than on the read being safe.

### 12 · BE-20 — The certainty walk never hypothesises a called-off fixture, and a call-off can move a placing

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

### 13 · FE-17 — A never-clause bounds what a stylesheet may say about a toast, and the stylesheet says more

**Status:** Open\
**Surfaces:** FE, Docs\
**Effort:** S\
**Path:** Independent — `.claude/CLAUDE.md` §7 forbids touching one of its clauses, wherever it loads
from, without an instruction naming it, so this entry is the instruction being asked for.

**`.claude/rules/frontend.md` permits a toast to be styled from CSS at the shell and at the frontmost
close button, and `fl_frontend/src/app/globals.css` styles a surface past both.** The block there
sets `.toast` and each of its `--<variant>` modifiers, the close button under `[data-frontmost]`, and
the timer bar — its animation, and the pause the region's hover and focus put on it.

**The same rule is stated in a wider place, and the wider statement is the one that fits the code.**
[`docs/frontend/spec.md`](../frontend/spec.md) I23 states it as a ban on adding — never a new
`.toast*` rule in a stylesheet — which names the surface rather than counting it. The **toast** clause
states it as a bound on what may be styled at all, and the bound it names falls short of what the stylesheet holds.
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

### 14 · FE-28 — Two surfaces offer a squad-row return the season's cap will refuse

**Status:** Open\
**Surfaces:** FE, BE\
**Effort:** M\
**Path:** Independent. FB-17 rebuilds the squad surfaces and would subsume it; nothing blocks it
meanwhile.

**`REQ-SQUAD-003` refuses a reactivation, and neither surface that offers one can see it coming.**
`fl_backend/app/api/spieler/admin_router.py :: reactivate_saison_spieler` calls
`:: _refuse_a_full_squad`, whose docstring states the reason plainly — the cap is a property of the
destination squad, not of the verb — so create, transfer and reactivate are judged the same way. The
two front-end paths to that endpoint are the player editor's Kader section and the squad row's restore
control on the list, and **neither states the refusal before the press** — but what a gate would cost
the two of them is not the same.

**The editor already holds both facts the refusal is computed from**, and that is the half of this
entry the squad-role work answered.
`fl_frontend/src/app/admin/spieler/[spieler_id]/page.tsx` reads every player's memberships for the
season and folds them per club through
`fl_frontend/src/features/spieler/utils.ts :: collectHeldRollen`, so the live row count is a fold
away; the season it reads beside them carries `rules.max_kadergroesse`.
`REQ-SQUAD-004` is the worked precedent — a per-club, per-season fact computed on that page and raised
in the rail as `spieler.rolle-vergeben` before any press. **What the editor's half needs is that fold
and a banner**, not new page data.

**What an administrator gets is correct and late.**
`fl_frontend/src/features/spieler/actions.ts :: mapSquadRefusal` maps the code to a German sentence
naming both repairs — raise the cap in the season rules, or take another player out first — and the
reactivate action routes its 409 through it. So the press produces an accurate red toast rather than
the generic conflict message, which is the treatment the editor already gives every other squad
refusal. **Matching that treatment was the right call**: a second mechanism for one refusal would be
the split this product keeps avoiding.

**What the list page's half would cost, which is the part worth writing down.** That page
needs neither the cap nor per-club counts for anything else it renders —
`fl_frontend/src/shared/components/ui/RowActions.tsx :: RowActionRestore` takes a `disabledReason` and
would use one, and its own comment states the principle, but nothing on that page computes it today.
Threading it means the season's rules and a live count per club reaching a list that is otherwise a
flat read, and keeping that count fresh across the writes the same page performs. **That is a real
page-data change for a refusal an administrator meets rarely**, which is why the remaining half is a
ranked entry rather than a fix.

**Low severity, and the entry should not inflate it.** The endpoint refuses correctly, the message is
actionable, and no data is at risk. What it costs is one press and one toast, on a squad that is
already full.

### 15 · FE-24 — A pupil's consent is stored and served, and shown by nothing

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

### 16 · FE-21 — The shared editor shell's widest layout step has never been rendered

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

### 17 · FE-30 — `Team` names a club and the people who run the league, and the public site renders both

**Status:** Open\
**Surfaces:** FE, Docs\
**Effort:** S — the sweep is small; what it waits on is the naming decision, not the work.\
**Path:** Independent. §1.12 of [`docs/frontend/spec.md`](../frontend/spec.md) is the rule the answer
is written against, and [`docs/glossary.md`](../glossary.md) is where it is recorded.

**[`docs/glossary.md`](../glossary.md) defines `Team` as a club, and `/team` is a page about the
people who run the league.** Its heading is `Frankfurt-League Team`
(`fl_frontend/src/features/meta/components/views/MetaTeamView.tsx :: MetaTeamView`), its metadata
title is the bare word, and the navigation renders it twice more — in
`fl_frontend/src/shared/components/layout/topnav/TopNav.tsx :: TopNav` and in
`fl_frontend/src/shared/components/layout/footer/Footer.tsx :: Footer`. The same navigation offers
`Saisonübersicht` beside it, and everything under that — the league table's column, the popover and
every fixture card — calls a club a `Team`.

**§1.12 of [`docs/frontend/spec.md`](../frontend/spec.md) states the rule from the other side** — one
German word per concept, and a club is a `Team`, never `Mannschaft`. That polices two words for one
concept. This is one word for two, which nothing can check: both senses are ordinary German, and
neither is a misspelling of the other.

**A season's squad is not a third sense**, which is what keeps this decidable. The squad is `Kader`
everywhere it is rendered — the public squad page's heading and metadata, and the entry beside
`Team-Details` in
`fl_frontend/src/features/teams/components/ui/TeamPopoverMenu.tsx :: TeamPopoverMenu`. So the
collision is exactly two senses, and only one of them is the domain entity.

**What the decision costs, either way it goes.** Relabelling the page touches four strings —
its heading, its metadata title and the two navigation links — and nothing else. Renaming the _route_
as well changes a published address, so it also touches `fl_frontend/src/app/sitemap.ts` and the
page's own canonical, and that half is a redirect and an indexed URL rather than a copy edit. Nothing
under `/docs` cites the route, so the corpus cost is the glossary line alone.

**Where the answer goes.** The glossary's `Team` entry is the club's, so the second sense belongs
either as a trap on that entry or as a row in the same page's `Terms that are not domain vocabulary`
table, which already holds the words that only look like domain vocabulary. Leaving it undecided is
what makes the next public string naming either sense a coin toss.

### 18 · FE-31 — Every admin write states its success twice, and the second sentence cannot render

**Status:** Open\
**Surfaces:** FE\
**Effort:** M\
**Path:** Independent, and worth executing with **FE-19** — one narrowing of
`fl_frontend/src/shared/types/types.ts :: FormState` settles both entries, a member each.

**Twenty distinct German sentences stand ready for a success that will never render one of them — 24
occurrences across 23 files under `fl_frontend/src`, measured 2026-08-26.** Behind each of them is an
action whose terminal return sets `message`, and each of them writes a fallback beside the value that
always arrives.

Three shapes:

- **A fallback under a `success` guard**, twelve of them: `res.message ?? "Spielort reaktiviert"` and
  its like, in the tables and views that reactivate a row and in the two panels that add one to a
  season — for instance
  `fl_frontend/src/features/spielorte/components/collections/AdminSpielorteTable.tsx :: handleReactivate`
  and
  `fl_frontend/src/features/teams/components/forms/AdminTeamEditForm/FormSaisonSection.tsx :: handleEnterSaison`.
- **A `successMessage` prop**, nine of them.
  `fl_frontend/src/shared/components/ui/EntityForm.tsx :: EntityForm` and
  `fl_frontend/src/shared/components/ui/ConfirmDeleteModal.tsx :: ConfirmDeleteModal` each raise
  `res.message || successMessage`, and the prop is required — so every create form and every
  retirement dialog supplies a sentence it cannot show.
- **Three one-offs**: the match editor's undo toast, the sign-in panel's confirmation, and
  `fl_frontend/src/shared/hooks/useSignOut.ts :: useSignOut`, whose one supplier is `signOutAction`.
  The sign-in one is the sharpest — `fl_frontend/src/features/auth/actions.ts :: neutralResult`
  composes the neutral sentence deliberately, and
  `fl_frontend/src/features/auth/components/forms/SignInForm.tsx :: SignInForm` writes the same
  sentence out again as the fallback beneath it.

**Why the runtime always wins.** `fl_frontend/src/shared/utils/adminMutation.ts :: runAdminMutation`
answers a thrown error through `toActionErrorResult`, which sets `success: false`; a `success` of true
is therefore always the action's own terminal return, and at every site above, that return sets its
`message`. The match editor is the case that looks like an exception and is not:
`fl_frontend/src/features/spiele/actions.ts :: patchAdminSpielDataAction` composes its message through
`fl_frontend/src/features/spiele/utils.ts :: formatSpielUpdateMessage`, whose first sentence is
unconditional, so the empty string that would let its `||` through cannot be produced.

**Nine of the twenty say something different from what renders**, which is what makes this more than
dead weight. `successMessage="Spielort stillgelegt"` stands where the action sends `"Spielort
stillgelegt. Seine Spiele bleiben erhalten."`; `"Team aufgenommen"` where the season is named;
`"Gespeichert"` where the row's own verb is; and the match editor's `"Die Spieldaten wurden
aktualisiert."` where the same sentence arrives without the full stop and with the fan-out behind it.
So a copy pass can correct the wrong string, watch nothing change, and leave the rendered sentence
standing.

**What the fix is, and why the type moves first.** `FormState` types `message` as optional, so the
checker requires each fallback and cannot be shown that none is reachable — the same wall **FE-19**
meets on `error`. Narrowing `FormState` into a union whose succeeding member requires its `message`
turns every fallback into a compile error rather than a judgement per site, and the two shared
components go with it: `successMessage` stops being required, or stops existing.

**What must survive the sweep.** The undo toasts' fallbacks read the same way and are live:
`fl_frontend/src/shared/utils/undoDispatch.ts :: offerUndo` renders `message ?? fallback`, and the
`message` the entity editors pass is `undefined` on an ordinary save, so there the fallback is the
ordinary case. Reading the `??` alone does not separate the two.

### 19 · FE-19 — Every call site writes a fallback for a failure message that always arrives

**Status:** Open\
**Surfaces:** FE\
**Effort:** M\
**Path:** Independent, and worth executing with **FE-31** — one narrowing of
`fl_frontend/src/shared/types/types.ts :: FormState` settles both entries, a member each.

**Forty consumer sites under `fl_frontend/src`, across 28 files, spell `res.error ?? …` or
`res.error || …` for a value that always arrives** (measured 2026-08-26). `FormState` types `error`
as optional, so the checker requires each one; whether any can run is a runtime contract rather than a
type claim, and the contract holds.
`fl_frontend/src/shared/utils/adminMutation.ts :: runAdminMutation` answers a thrown error with
`fl_frontend/src/shared/utils/actionError.ts :: toActionErrorResult`, whose every branch sets `error`,
and every failing return under `fl_frontend/src` carries an `error` beside it.

**Seventeen of those sites fall back to a sentence of their own rather than to the shared one**, in
eight files, and one family inside them is a second sentence with no home: the undo's refusal
`"Die Änderung steht weiterhin."` is spelled out 19 times across 10 files — eight page-owned
editors, a route handler and a test — and no module owns it. §1.12 of
[`docs/frontend/spec.md`](../frontend/spec.md) is where a refusal's vocabulary is fixed and it names
the two homes a new failure message is written from —
`fl_frontend/src/shared/utils/refusal.ts :: buildRefusal` for a refusal that can name a cause, and
`:: UNKNOWN_REFUSAL` for one that cannot.

**The type is what has to move first.** `FormState` becoming a union whose failing member requires
its `error` turns each remaining fallback into a compile error rather than a judgement call per site;
short of that, deleting one is an argument to be had 40 times.

**What makes it more than deleting a token.** `fl_frontend/src/shared/components/ui/EntityForm.tsx`
and `fl_frontend/src/shared/components/ui/ConfirmDeleteModal.tsx` reach the sentence through
`res.error || res.message || …`, and their `res` comes from a caller-supplied function rather than
from an action — so the narrowing has to reach the props those shared components declare, not the
actions alone. And the seventeen own sentences are a copy decision each: a fallback that is dead
weight and a fallback that is the only sentence naming what did not happen read identically at the
`??`.

**Not decided:** whether the shared sentence should stay generic at all. `toActionErrorResult` states
its own reason for one — the diagnosis is already in the server log, and what an admin needs is
whether retrying can help.

### 20 · FE-1 — A fixture carries one date, and a play window cannot be expressed

**Status:** Open\
**Surfaces:** FE, BE\
**Effort:** XL\
**Path:** Independent — `/admin/spiele/[spiel_id]` is the page it lands on, and it exists.

**A fixture's `datum` is a single day, so a match scheduled across a window cannot be recorded as one**
(my item, 2026-08-02). Implementing ranges is heavy in my scoping: it would change the match editor's
form
(`fl_frontend/src/features/spiele/components/forms/AdminEditSpielDataForm/AdminEditSpielDataForm.tsx :: AdminEditSpielDataForm`),
the schemas, and possibly logic and UI elements **across the board**.

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

### 21 · LOG-2 — A cached read's call joins to no render, and telemetry has nowhere to go

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
recorded where it will be read — a comment at the line it constrains, a `.claude/CLAUDE.md` §7 line or
a `.claude/rules/` clause, or an invariant on `docs/logging/spec.md` — and the argument for it goes in the closing commit's
body. What survives untouched is the stream contract, the error-code system and the edge's refusal
of a client-supplied id — a `traceparent` from an untrusted client carries exactly the same
log-injection risk and must be validated or replaced the same way.

**Not measured:** the runtime cost of the instrumentation packages on this application, and whether a
collector fits on the current host beside the capped services. Each is input to step 1 and neither
should be guessed.

### 22 · FB-18 — Only the match editor tells an admin which empty field somebody is waiting on

**Status:** Open\
**Surfaces:** FE, BE\
**Effort:** L\
**Path:** Independent of every entry here. What it waits on is a product ruling per entity rather
than a page or another item.

**The Fehlt and Offen markers exist on the match editor alone, and putting them on the other
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

### 23 · BE-47 — A sort option nothing sends scans the archive it sorts

**Status:** Standing\
**Surfaces:** BE\
**Effort:** S\
**Path:** Independent — no pass covers it, and only the trigger below reopens it. **BE-45** is the same
mechanism where a bound rather than an absent caller is what makes it harmless, and **BE-44** owns
everything else about this collection's growth. Neither blocks this.

**Not a defect today, and what makes it harmless is that nothing reaches it.**
`fl_backend/app/api/bewerbungen/schemas.py :: FLBewerbungenSortOptions` offers `saison_id` beside
`eingereicht_am`, and every read that names it plans a blocking sort: no index over `bewerbungen` leads
with `saison_id` as a sort key, the three in
`fl_backend/app/core/constraints.py :: SUPPORT_INDEXES` all ending in `eingereicht_am` then `_id`
(measured 2026-08-30 at 60,000 rows, across every combination of the season and status filters with
each order; the reads narrowing on neither filter scan the collection whole). **No caller sends it.**
`fl_frontend/src/app/admin/bewerbungen/page.tsx` sends `order` alone, and no other surface reads this
endpoint, so the option is reachable only by composing the request by hand against an admin-guarded
API.

**Both exits are wrong, which is what makes this a decision rather than a repair.** Two more indexes
would buy a sort nobody performs and would be carried, applied at every boot and re-read by every
future reader of `SUPPORT_INDEXES`, for no caller. Narrowing `FLBewerbungenSortOptions` to the one
option that is used is a wire change: it moves `fl_backend/openapi.json` and the hand-written Zod
mirror, and it takes an offered capability away rather than adding one. Which is right depends on
whether sorting the archive by season is a thing this product means to offer, and that has not been
asked.

**The discriminator this entry adds to BE-45's.** That entry records that a blocking sort is judged on
whether anything bounds the collection, not on whether it blocks. Here the bound is absent —
`bewerbungen` grows with every submission and no path removes a row, which is **BE-44**'s subject — and
the read is harmless anyway, because **nothing reaches it**. So a blocking sort is judged on two
questions before its plan matters: what bounds the collection, and what reaches the read.

**Trigger to revisit:** any surface gaining a season sort over this list, which turns the option from
unreachable into the ordinary path and makes the plan above the one an administrator waits on.

**What was measured and what was not** (COR-9). The plans were measured, at a row count the collection
does not hold. That no caller sends `sort_by` was read off the page and the absence of another consumer
rather than proven by instrumenting the endpoint.

### 24 · BE-39 — A refusal composes a repair the product refuses to perform

**Status:** Open\
**Surfaces:** FE, BE, Docs\
**Effort:** S\
**Path:** Independent — the composed message, its German arm and the pages repeating the loop move
together. **OPS-74** on [`tooling-items.md`](tooling-items.md) guards the pairing of the first two and
says nothing about what either claims.

**`REQ-RULES-011` names an undraw whose window is narrower than the refusal's own.**
`fl_backend/app/api/saisons/services.py :: find_rules_refusal` composes a repair per moved field, and
the one for `number_of_groups` and `teams_per_group` tells an admin to undraw the Spielplan, change the
entries, then draw it again. `fl_backend/app/api/saisons/services.py :: find_undraw_refusal` permits
that undraw only while the season is `future` and no fixture carries anything recorded against it;
every other season is answered `REQ-SPIELPLAN-006`. **The refusal itself is under no such window** —
`fl_backend/tests/api/test_rules_refusal.py :: TestADrawnSeasonKeepsTheShapeItWasDrawnFrom` pins it
holding whatever the season is doing — so on a running season, and on a planned one carrying a result,
the repair names a write nothing will perform. `REQ-RULES-012`'s own window sits inside that set and is
not the size of it: a played knockout fixture is a recorded one, and so is a called-off group fixture
in a season nobody has activated.

**What an admin meets is a closed control rather than a second refusal.**
`fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/blockedReasons.ts :: spielplanUndrawBlockedReason`
mirrors the same window and answers _"Zurücknehmen lässt sich der Spielplan nur, solange die Saison
geplant ist."_, which contradicts the sentence that sent them there.
[`docs/frontend/spec.md`](../frontend/spec.md)'s copy standard exempts the continuation of a repair a
refusal has already started, on the ground that a loop broken at its second step leaves an admin
exactly where the refusal sent them; this is that loop broken at its second step.

**The claim is repeated where it is not owned**, so whatever is decided moves those with it:
[`docs/domain.md`](../domain.md)'s reading of what an undraw opens,
[`docs/logging/error-codes.md`](../logging/error-codes.md)'s draw-freeze paragraph and
[`docs/frontend/spec.md`](../frontend/spec.md)'s undraw loop each state it as the way back from a group
shape guessed wrong — true in the planning window it was written for, and in no other.

**This entry picks no repair.** The sentence could narrow to the window it holds in, leaving a season
past that window told plainly that the two numbers are fixed for the rest of its life. Or the undraw's
window is the half that is wrong, a season that has drawn and recorded nothing being arguably still in
setup whatever `status` says — which is a domain call about what an `active` season may become, and not
a message fix. **The German is a hand-written second copy either way**
(`fl_frontend/src/features/saisons/actions.ts`, its `REQ-RULES-011` arm), so a repair that stops at the
backend leaves an admin reading the old instruction.

**What ranks it here.** Above **BE-37**: that costs an operator who has already reached for the
database, where this misleads an admin on a path the product offers them.

### 25 · BE-50 — The open-window read filters into arrays and subscripts whatever comes back

**Status:** Open\
**Surfaces:** BE\
**Effort:** S\
**Path:** Independent — nothing on this page blocks it and it blocks nothing. The guard it needs
already stands on the sibling route, so the work is one call and one test row. **BE-37** files
against the same class of document and is argued from this entry's side below.

**`fl_backend/app/api/bewerbungen/public_router.py :: get_offenes_fenster` selects the season with a
dotted query — `bewerbung.offen`, `bewerbung.von`, `bewerbung.bis` — and hands
`open_seasons[0]["bewerbung"]` straight to `:: _fenster`, which subscripts all three by name.** A
dotted path in a MongoDB filter matches into an array of embedded documents, so a season storing
`bewerbung: [{offen, von, bis}]` — the window wrapped in a list — satisfies every term of the query
and reaches `_fenster` as a list. `bewerbung["offen"]` on a list raises `TypeError`, and
`GET /bewerbungen/fenster` answers **500 on the public tier**. It is the one malformed shape the
query lets through: a string or a number has no `bewerbung.offen` to match, and an object short of a
field fails the term that names it, so neither reaches the subscript on this route.

**The sibling route is guarded and this one is not.** `:: _pull_window`, behind
`GET /bewerbungen/fenster/{saison_id}` and the colour read, passes the stored value through
`fl_backend/app/api/bewerbungen/services.py :: recorded_window` and answers 404 where it is not a
mapping carrying all three fields; the comment at that call says why — `_fenster` subscripts, so a
shape check alone would 500. `get_offenes_fenster` takes the shape from a query that already asserts
the three fields exist, and array matching is exactly what breaks that inference.
`:: window_is_running` inside `_fenster` carries the same guard, and `_fenster` subscripts before it
gets there.

**Why nothing produces it today.** `fl_backend/app/core/constraints.py :: _SAISON_BEWERBUNG` types
the field as a nullable object with the three keys required, and the collection runs under
`validationLevel: strict` with `validationAction: error`, so no write through the driver stores a
list there. The field and its validator landed in one commit
([`df661b94`](https://github.com/felzab/frankfurtleague/commit/df661b94), 2026-08-28), so no season
carried the key before the rule existed. What remains is a write past the validator — a
`bypassDocumentValidation` write, a dump restored from elsewhere, the validator dropped and
re-applied — the class of document **BE-37** files against, and the one
`fl_backend/tests/api/test_bewerbung_public_read.py :: MALFORMED_WINDOWS` already names for the
per-season reads, its list-wrapped case included.

**What it costs when one does arrive.** The read is made by
`fl_frontend/src/features/bewerbungen/components/ui/BewerbungOffenBand.tsx` on the public start page
and the contact page, and
`fl_frontend/src/features/bewerbungen/queries.ts :: getOffenesBewerbungFenster` turns a 404 into "no
window" and rethrows everything else — so the 500 is thrown inside a server component rather than
rendered as the band's absence.

**Done is the guard on this path and the case that pins it.** `get_offenes_fenster` passes
`open_seasons[0]["bewerbung"]` through `recorded_window` and answers the 404 an empty result already
answers: a season whose stored window cannot be read is one taking no applications, which is what
the route's docstring promises for "none". And
`fl_backend/tests/api/test_bewerbung_public_read.py :: TestAStoredWindowThatIsNotAnObject` drives
the list-wrapped case against `GET /bewerbungen/fenster` beside the two per-season paths in
`:: WINDOW_READS`. On this route that case is the only non-vacuous member of `MALFORMED_WINDOWS`,
the other two never passing the query, and the test's own comment already claims the class it
belongs to.

**What ranks it here.** Tests 1 to 3 separate nothing: no leverage, no clock, nothing redone later.
On test 4 it sits below **BE-39**, whose path is one the product offers an admin today, and above
**BE-37**, which files against the same class of document at M where this costs S, and whose
symptom is a triage page that shows nothing where this one is a 500 on a public endpoint. A public
500 reachable only through a document nothing writes is the whole of the rank.

**Established by reading, not driven** (COR-9). The array matching, the `TypeError` and the band's
rethrow were read off the query, `_fenster`, the filter semantics and the two frontend files; no
list-wrapped season was seeded and no request was made against `/fenster`, and what the start page
renders on that throw was not exercised. The commit dating the validator was read from `git log -S`.

### 26 · BE-37 — Wiring the write path refuses stands unreported once it is in storage

**Status:** Open\
**Surfaces:** FE, BE, Docs\
**Effort:** M\
**Path:** Independent — nothing on this page blocks it. A fault variant reaches
`fl_backend/openapi.json` and the hand-written mirror beside it, which puts the gate at
`--backend --db --frontend --docs`.

**I27's shapes and I28's faults do not line up, and the difference is what nothing states.**
`fl_backend/app/api/spiele/services.py :: find_wiring_refusal` judges each side on the source the
save moves, which is what keeps a fixture wired out of rule editable in every other respect — and it
leaves the read path as the only thing that could name a shape already in storage.
`fl_backend/app/api/spiele/services.py :: resolve_bracket` derives a fault for two of I27's shapes: a
`spiel` source naming no match in the season, and a chain of references that closes on itself.

**What falls between them.** A `quelle` on a Gruppenphase fixture, a `spiel` source naming a
Gruppenphase match, and a group placing seeding a round past the one this season's bracket opens on
each resolve cleanly, so the walk reaches no fault and the triage page has nothing to show. Two more
are covered only in part: a source not strictly earlier in the running order is named only where it
closes a cycle, and one outcome feeding two slots only where both slots sit on one fixture — and
then as `same_team`, which states that two sources resolve to one club
(`fl_backend/app/api/spiele/schemas.py :: FLBracketFaultSpiel`) rather than that one source is read
twice. One shape is faulted and misnamed: a placing in a group the season does not run reaches
`gruppe_too_small`, true of the arithmetic — an unrun group stands nobody — and wrong about the
cause, which is that the group is not in the season at all.

**Only a hand edit puts a fixture in that state, and that is what ranks it here.** The draw composes
its wiring from the bracket's own shape rather than from a caller
(`fl_backend/app/api/saisons/spielplan.py :: draw_spielplan`), and a save that INTRODUCES a shape is
refused, so neither product path reaches one. What stands in the gap is a row written into the
database directly — the route [`docs/backend/spec.md`](../backend/spec.md) §4 already assumes when it
asks for `python -m app.core.constraints --check` after a hand edit to `spiele`, and the case an
operator repairing by hand has the least help with.

**A variant costs more than a `reason` string.** A fault is a member of
`fl_backend/app/api/spiele/schemas.py :: FLBracketFault`, a case in
`fl_backend/app/api/spiele/services.py :: _fault_order`, a mirror in
`fl_frontend/src/features/spiele/schemas.ts` that `.claude/rules/cross-surface.md` holds to hand-writing, a
published property in `fl_backend/openapi.json`, and a German sentence in each of
`fl_frontend/src/features/spiele/utils.ts :: formatBracketFault` and `:: describeBracketFaultOnCard`.
Both switches are exhaustive, so the compiler names them; nothing names the German. I28's own
enumeration moves in the same commit.

**What ranks it here.** It removes real doubt — an operator repairing wiring by hand gets no
signal for most of what the write path calls unholdable — and its own cost is paid only after
somebody edits the database. The pair it makes with **FE-34** is argued from that entry's side.

### 27 · FE-34 — Three entry refusals are rendered twice, and nothing holds either half to the other

**Status:** Open\
**Surfaces:** FE, Docs\
**Effort:** M — six strings in two constructions, and a copy question that may amend a rule rather than a sentence\
**Path:** Independent. **FE-35** widens the same helper for a fourth rendering of a different code,
and the two settle nothing for each other.

**`REQ-ENTER-001`, `-002` and `-003` each reach an administrator through two mappers, and the German
differs in every pair.** `fl_backend/app/core/domain.py` declares all three against
`POST /teams/{team_id}/saisons` and against `POST /bewerbungen/{bewerbung_id}/annehmen`, acceptance
reusing the season's own entry services rather than restating them. So each code has two frontends:
`fl_frontend/src/features/bewerbungen/actions.ts :: mapTriageRefusal`, which answers for the application
being triaged, and `fl_frontend/src/features/teams/actions.ts :: mapEntryRefusal`, which answers for the
three club-editor write paths that create a club into a season, enter an existing one, or move one
between groups — `postTeamAction`, `postSaisonTeamAction` and `patchSaisonTeamAction`, measured 2026-08-28.

| Code            | `mapTriageRefusal` renders                                                                                                       | `mapEntryRefusal` renders                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `REQ-ENTER-001` | A `buildRefusal` pair: the application's season has left planning, entry being into a planned one, then „Lehne die Bewerbung ab" | A written-out pair: „Diese Saison läuft schon oder ist abgeschlossen. Nimm das Team in eine geplante Saison auf." |
| `REQ-ENTER-002` | A `gruppe` field message naming „die Saison der Bewerbung"                                                                       | The same field message naming „die gewählte Saison"                                                               |
| `REQ-ENTER-003` | „Diese Gruppe ist voll. Wähle eine andere."                                                                                      | „Diese Gruppe ist schon voll."                                                                                    |

**Two of the three are a surface addressing its own reader**, which is what makes this a ruling rather
than a correction. `-002` says which season is meant, and the two readers stand on different ones.
`-001` is the sharper pair: the triage states the rule, the club editor enumerates the two statuses that
failed it. [`docs/frontend/spec.md`](../frontend/spec.md) §1.12 asks for the rule rather than the
situation that met it — and the club editor's own neighbours, the `team.not-in-saison-*` bodies in
`fl_frontend/src/features/teams/components/forms/AdminTeamEditForm/banners.ts :: buildTeamBanners`,
enumerate the same two statuses in nearly the same words. So either that enumeration is the surface's
settled house style, or three sentences move together.

**`-003` is the one that can leave an administrator with nothing named to do.** §1.12 holds that a
refusal names the repair wherever one exists, and that one shortened past its second sentence has become
a dead end; the club editor's stops at the state. The rule pulling the other way is in the same section:
the FIELD register declared at `fl_frontend/src/shared/utils/adminMutation.ts :: VALIDATION_FAILED` keeps
a field message to one sentence about the value, and both of these render under the `gruppe` picker,
which is itself the way out. §1.12's own precedence line — the worked example outranks the
generalisation drawn from it, and the rule is what gets amended — is why this is a ruling to take rather
than a defect to fix, and why the `Docs` surface is on this entry.

**One half is composed and the other is written out.** The triage builds its FORM message through
`fl_frontend/src/shared/utils/refusal.ts :: buildRefusal`, which is what guarantees the two-sentence
shape and frames the panel name inside the helper. `mapEntryRefusal` returns its FORM strings as
literals, so nothing holds their shape, and an assertion spanning a pair has to read two constructions.

**What nothing does today is hold a pair together.**
`fl_frontend/src/features/bewerbungen/actions.test.ts :: renderingsOf` is built for exactly this: it cuts
every branch answering one code out of the sources it is handed and grades them as one set — the state
word, the neuter agreement „Team" forces, and the imperative a repair is written in. It is called once,
on `REQ-ENTER-005` (measured 2026-08-28). `fl_frontend/src/features/teams/actions.test.ts` asserts that
`mapEntryRefusal` answers every code the entry endpoint declares and then grades the replacement mapper's
German in detail; it reads none of the entry mapper's own sentences. So an edit can move either half of
any of these three pairs and leave the other standing, and the gate stays green.

**Three routes, and this entry picks none.** Rule each pair to one sentence and assert the halves equal,
which is the cheapest thing to check and the likeliest to be wrong about `-002`. Or keep each surface's
wording and widen `renderingsOf`'s call to these three codes, asserting only what must agree across a
pair — the state word, the agreement, the imperative, and that a repair stands wherever one exists —
which is the shape the helper was written for and the harder set of assertions to word. Or record at each
branch, as a comment, why its wording is its own, and leave the pairing to a reader.

**What ranks it here.** Below **BE-37**: that entry leaves an operator repairing wiring by hand with no
signal at all, where every one of these six sentences reaches its reader true today and what is at stake
is what a later edit does to one of them. What holds it above the entries under it is the other half of
that: it settles a copy question on two admin surfaces and closes a coupling the helper beside it was
written to close.

### 28 · FE-35 — A fourth rendering of the retired-club refusal sits outside the helper that grades the other three

**Status:** Open\
**Surfaces:** FE\
**Effort:** S\
**Path:** Independent. **FE-34** would widen the same helper for a different set of codes, so whichever
lands first leaves the other a smaller change; neither settles the other.

**`REQ-ENTER-005` is rendered in four places and graded as three.**
`fl_frontend/src/features/bewerbungen/actions.test.ts :: renderingsOf` collects every branch answering
one refusal code and holds them to one vocabulary and one grammar — „stillgelegt" rather than an
austritt's words, „Team" as the noun, the neuter determiner and pronoun that noun forces, and an
imperative wherever a repair is written. It is handed the triage's mapper and
`fl_frontend/src/features/teams/actions.ts`, whose two mappers answer this code about different clubs,
and it asserts that it found three branches before judging any of them. The fourth is the
`team.not-in-saison-retired` banner in
`fl_frontend/src/features/teams/components/forms/AdminTeamEditForm/banners.ts :: buildTeamBanners`, which
renders the same stored `teams.inactive_since` state as one body per season status: the reactivation and
the entry for a `future` season, and for the other two a sentence saying the reactivation alone would not
open one.

**The code is at that branch, and in the one form the helper cannot see.** The banner names
`REQ-ENTER-005` in a `//` comment, and `renderingsOf` splits on the double-quoted literal; its
comment-stripping step would drop that comment before any assertion read it, so a comment can never be
the anchor. The cut is shaped for a mapper besides — it runs from the literal to the next `case`, the
next `serverErrorCode ===`, a `default:`, or a `}` at column zero, and `banners.ts` carries none of the
first three, so a slice taken there would run from the anchor to the end of the function and sweep the
austritt banners' German in with it.

**The four say the same thing today, so this is a coverage hole rather than a defect** (read
2026-08-28). The banner calls the club „das stillgelegte Team", stands „es" in for it a clause later, and
writes its repair as an imperative, so it holds the vocabulary and the agreement the three graded
branches are held to.

**One rule inside that battery would refuse it even so.** `renderingsOf`'s callers require the object of
„Reaktiviere" to be exactly „es", and the `future` body writes „Reaktiviere das stillgelegte Team" —
correct German, and the sentence `mapEntryRefusal` names as the source of its own words. That rule was
drawn from three sentences that had each named the club already, so pointing it at a fourth which names
the club inside the imperative means widening it to a neuter phrase rather than the bare pronoun. **The
reach is therefore not the whole of what is missing.**

**The banner's own module carries part of the vocabulary.**
`fl_frontend/src/features/teams/components/forms/AdminTeamEditForm/banners.test.ts` pins „stillgelegte"
as the state word, pins that neither „Austritt" nor „ausgeschieden" appears, and pins that only the
`future` body promises the entry control. Of the agreement and imperative battery it carries nothing, and
it compares the banner against no other rendering.

**The coupling is already written down, at the branch that depends on it.** `mapEntryRefusal`'s
`REQ-ENTER-005` arm says in a comment that its words are `buildTeamBanners`'s, because the mapper fires
only while the page still believes the club is active and the banner is what the same panel shows once
the page catches up. So the two are meant to read alike, one of them is graded, and which one that is
was settled by where a string literal happens to sit.

**Two fixes, and each costs something.** A `"REQ-ENTER-005"` literal at the banner would put the code
where the helper's split already looks — but `buildTeamBanners` renders state and never a server code, so
a literal there asserts a coupling the runtime does not have, and the cut would still have to learn where
a branch ends inside an object literal. Or `renderingsOf` takes the banner as a source of its own, with
an extraction that reads a built banner's `body` and `title` rather than a slice of text — the honest
shape, costing the helper a second mode, and the only one that reaches the title at all, a template
literal being invisible to a match written for quoted sentences. **Either route pays for the
„Reaktiviere" rule's widening**, and neither may skip it: a battery pointed at this banner unchanged
fails on a sentence that is right.

**What ranks it here.** The four sentences say the same thing today, so what is at stake is a later
edit's freedom to part them rather than anything a reader meets now — which is what keeps it below
the entries above it. What keeps it this high is that the gap is answered only by noticing that a
helper's reach stops short of a module, which nothing on either side says.

### 29 · BE-42 — Acceptance copies a school's postal address into the club, where an anonymous read serves it

**Status:** Decided\
**Surfaces:** Docs\
**Effort:** S\
**Path:** Independent. The decision below settles the read tier as well as the copy, and
`READ-ADDRESS-002` carries the read tier in `docs/backend/spec.md`'s registry; what this entry still
carries is the crossing itself, and nothing else waits on it.

**`fl_backend/app/api/bewerbungen/admin_router.py :: annehmen_bewerbung` builds a club out of the
school's own block and inserts it into `teams`, the address included.**
`fl_backend/app/api/bewerbungen/services.py :: compose_new_club` maps the school's `address` straight
into the club document through `_CLUB_FIELDS_FROM_SCHULE`, beside `team_name`, `full_name`,
`shorthand`, `schulform` and `website_url`, and the acceptance writes that document inside its
transaction.

**Decided 2026-08, Datenschutzexperte consulted: the address stays public, and the form says so
where it is asked for.** The rule stands at the read that serves the field
(`fl_backend/app/api/teams/schemas.py :: _TeamWritable`), the application form states beside its
address block that the address will stand on the public team page
(`fl_frontend/src/features/bewerbungen/components/forms/BewerbungForm/FormSchuleSection.tsx`), and
`docs/backend/spec.md`'s known-open row records the crossing as accepted. The alternatives —
narrowing the public model, or not copying the field at acceptance — are rejected by that decision,
so neither is to be proposed again without overturning it.

**What remains is the crossing itself.** The registry answers for both ends of it:
`READ-CONTACT-001` withholds the application that carries the school's address, and
`READ-ADDRESS-002` declares a club's public. Each governs ONE read and the acceptance sits between
them, so whether a school's correspondence address is the league's to copy into a club is a question
about the write, which no read rule can answer — and the registry holds no write rule that says.

**`docs/backend/spec.md`'s known-open row and this entry agree, and it is worth saying which each
carries.** The row calls the crossing accepted, because the decision above settled it and the
landing side is ruled. This entry stays `Decided` for the sentence the registry is still missing: a
write rule saying the acceptance may copy the field. That is the whole of its `Docs` surface, and
nothing in it reopens the decision.

### 30 · BE-7 — `typing` imports instead of `collections.abc`

**Status:** Decided\
**Surfaces:** BE\
**Effort:** —\
**Path:** Independent — backend audit pass B4's typing check owns the migration.

Several backend modules import `Mapping`, `Sequence`, `Optional` and `Callable` from `typing` — aliases
deprecated since Python 3.9, on a project running far newer. **Deliberately not fixed piecemeal:**
modernising one module while the rest keep the old spelling is worse than uniformity. The decision is
to enable ruff's `UP` rules and migrate in one pass, which is why `fl_backend/pyproject.toml`'s ruff
selection leaves that family out.

### 31 · BE-14 — The certainty walk gives up in a group of six or more

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

### 32 · BE-45 — A tie-break that provably cannot fire is what stops the index being walked

**Status:** Standing\
**Surfaces:** BE\
**Effort:** S\
**Path:** Independent — no pass covers it, and only the trigger below reopens it. **BE-29** rests on
the same bound this entry does, so whatever removes that bound reopens both. **BE-47** is the shape
again where a third thing answers it: nothing reaches the read at all. `.claude/rules/backend.md` keeps
`fl_backend/app/api/spiele/services.py` free of an `await` and a collection, and the repair needs
neither.

**Not a defect today, and the bound rather than the plan is why.**
`fl_backend/app/api/spiele/services.py :: build_spiele_sort` appends `datum` to a `spiel_nr` sort. That
tie-break can never fire: `fl_backend/app/core/constraints.py :: UNIQUE_INDEXES` carries
`uniq_saison_id_spiel_nr` over `(saison_id, spiel_nr)`, so within the one season the read has already
resolved, no two fixtures share a `spiel_nr`. Appending it is nonetheless what stops MongoDB walking
the index, because a compound sort it cannot satisfy from an index key is completed in memory
(measured 2026-08-30, at 500 documents):

| The sort                                       | The plan                       |
| ---------------------------------------------- | ------------------------------ |
| `spiel_nr` then `datum`, which the code builds | `SORT` over `FETCH`, `IXSCAN`  |
| `spiel_nr` alone, as a control                 | `LIMIT` over `FETCH`, `IXSCAN` |

Every other sort the endpoint can build blocks the same way, and
`fl_backend/app/api/spieltage/services.py :: build_spieltage_sort` has the shape too, over a collection
holding a season's matchdays.

**What makes it harmless is that nothing lets the collection grow.** `GET /spiele` resolves a season
before it reads — `fl_backend/app/api/spiele/router.py` fills an absent `saison_id` from
`fl_backend/app/api/saisons/crud.py :: pull_current_saison_id` — so every read is season-scoped, and a
season's fixture count is capped by its shape validators.
`fl_backend/app/api/saisons/schemas.py :: TeamsPerGroup` records that ceiling's purpose at the line:
it keeps the largest legal season inside `fl_backend/app/shared/schemas/bounds.py :: LIST_LIMIT_DEFAULT`.
So the in-memory sort is over a set with a ceiling on it, and nothing in the product moves that ceiling.

**The pattern is the reason to record this, and the instance is not.** The mechanism recurs wherever
a sort chains a tie-break onto its leading key: the chained key is what puts the sort outside the
index written for that read. `aktionen`, `spiele`, `spieltage` and `bewerbungen` each build one, and
each was answered differently. `aktionen` got an index whose key is the read's whole sort, `at` then
`_id`, because `fl_backend/app/core/constraints.py :: SUPPORT_INDEXES` states at the line that it is
the collection which only ever grows and so cannot be left to a scan. `bewerbungen` got neither an
index nor a removal: `fl_backend/app/api/bewerbungen/services.py :: build_bewerbungen_sort` turns
the tie-break to follow the request, so the pair is the existing index's key or its exact inverse.
`spiele` and `spieltage` got nothing, and are this entry. **So the discriminator is not whether the
sort blocks — it is whether anything bounds the collection**, and a reader who finds a blocking sort
and asks only the first question will either panic at this one or dismiss the next `aktionen`.

**Trigger to revisit:** the season narrowing in `fl_backend/app/api/spiele/router.py` being removed, or
any read of `spiele` being allowed to span seasons. Either removes the bound, at which point this
collection is `aktionen` and the sort needs the index rather than the argument.

**Why it is filed rather than fixed.** `:: build_spiele_sort` carries a decision at the line it governs:
its order is defined by that code under PRE-1, and moving it is its own change rather than a side effect
of one. Taking it quietly inside a branch about something else is what that comment exists to prevent.

**What was measured and what was not** (COR-9). The plans above were measured; the uniqueness, the
season resolution and the shape ceiling were read off `UNIQUE_INDEXES`, `pull_current_saison_id` and
`TeamsPerGroup` rather than executed. **The explain was not re-run for this entry**, so the two rows
stand on that measurement rather than on anything the gate repeats.
