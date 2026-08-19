# Open items

**Verified against:** `65c7775b`, 2026-08-19\
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

| #   | ID    | Item                                                       | Surfaces        | Effort | Status   | Depends on |
| --- | ----- | ---------------------------------------------------------- | --------------- | ------ | -------- | ---------- |
| 1   | BE-15 | Nothing records who changed what, or what it replaced      | FE, BE, DB      | L      | Open     | —          |
| 2   | BE-18 | Five permitted states the domain declaration does not name | BE              | M      | Open     | —          |
| 3   | FB-16 | Nothing announces that a season rollover is due            | BE, Ops         | M      | Open     | —          |
| 4   | FB-17 | Season setup is hand-run, and only an admin enters a squad | FE, BE, DB, Ops | XL     | Open     | —          |
| 5   | BE-17 | Every server-ordered name list sorts in byte order         | BE, FE          | M      | Open     | —          |
| 6   | FE-1  | A fixture carries one date, not a play window              | FE, BE          | XL     | Open     | —          |
| 7   | LOG-2 | A cached read's call joins to no render                    | FE, BE, Ops     | L      | Open     | —          |
| 8   | BE-12 | Nothing purges a row whose `inactive_since` is old         | BE, DB          | M      | Open     | —          |
| 9   | BE-7  | `typing` imports instead of `collections.abc`              | BE              | —      | Standing | —          |
| 10  | BE-14 | The certainty walk gives up in a group of six or more      | BE              | —      | Standing | —          |

**No entry on this page blocks another**, which is why every `Depends on` cell is an em dash. What
each entry waits on that is _not_ an entry — a page, a decision, a scheduled audit pass — is on its
own `Path` line.

---

## The items in rank order

### 1 · BE-15 — Nothing records who changed what, or what a write replaced

**Status:** Open\
**Surfaces:** FE, BE, DB\
**Effort:** L\
**Path:** Independent — what dates it is a second writer arriving this year, not another entry.

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

**What makes it urgent is a second person who can write, and that now has a year on it.** I confirmed
on 2026-08-12 that a second person will be writing in the season plan this year. Today the only person
who can dispute an entry is the one who made it, and from the first shared write that stops being
true. The cost of delay is the part that cannot be recovered — a log records from the day it exists
and never backwards, so every write made before it lands is one nobody can reconstruct. ADR-0041
raises the value of doing it meanwhile: the client-held undo makes the gap visible on the one surface
an admin uses most.

### 2 · BE-18 — Five states the code permits are named by neither half of the domain declaration

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

**Five states are in neither list:**

| The state                                                                                                                                                                                                                                                                           | Where                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `REQ-CLASH-001` compares only fixtures sharing a calendar date, so two bookings of one venue at 23:30 and 00:30 are sixty minutes apart and both pass                                                                                                                               | `fl_backend/app/api/spiele/services.py :: find_clash_refusal`, whose loop skips a slot on `if slot.datum != datum`                 |
| A fixture being **cancelled** is still judged against `REQ-CLASH-001`, so cancelling one that clashes is refused and the admin has to move it first. The opposite direction is already right — the booking read filters `is_canceled: False`, so a cancelled fixture frees its slot | `fl_backend/app/api/spiele/admin_router.py :: patch_spiel_data`, where the clash block is entered on the payload's `datum` alone   |
| `advance_bracket_winners` writes both sides of a fixture without consulting `REQ-SPIELTAG-001`, so the resolution can field one club twice on a Spieltag — the state that rule exists to refuse on the request path                                                                 | `fl_backend/app/api/spiele/crud.py :: advance_bracket_winners`; `judge_spieltag_occupancy` is reached from `patch_spiel_data` only |
| `REQ-ENTER-003`'s count-then-insert is not transactional, so two concurrent entries can both pass a group's capacity check and take it over its cap                                                                                                                                 | `fl_backend/app/api/teams/admin_router.py :: post_saison_team`                                                                     |
| `PATCH /spiele/{spiel_id}` writes the payload's side back wholesale, `name` and `shorthand` included, so a caller can store a display name that disagrees with the club `team_id` points at                                                                                         | `fl_backend/app/api/spiele/schemas.py :: FLSpielTeamField`                                                                         |

The last row is about the two copied display fields alone. A fixture's `mietpreis` and `payment` are
per-fixture values rather than stale copies of a default
([ADR-0021](../_decisions/0021-store-what-was-true-then-derive-what-is-true-now.md)), and the same
`$set` is what makes them work.

**One of the five has a date on it, and the date is this year.** `post_saison_team`'s docstring
accepts its race in terms — "the count-then-insert is not transactional; the single-admin surface
makes the race a non-concern, and the cost of losing it is one team over a planning bound rather
than corrupt data". That reasoning is sound and it rests entirely on there being one writer. BE-15
records that a second person will be writing in the season plan this year, confirmed 2026-08-12.
When that lands the justification is gone and only the code is left, and nothing joins the two: the
concession lives in a docstring rather than in `UNENFORCED`, where a reader looking for what this
system tolerates would find it.

**The same file's third list is short in a direction as well.** `FIELD_POLICIES` declares when each
field may be written, and it is resolved one way only:
`fl_backend/tests/core/test_domain.py :: test_every_field_policy_names_a_real_field` proves every
declared policy names a real field, and nothing proves a real non-editable field carries a policy.
`FIELD_POLICIES` names no field of `spielorte` or `schiedsrichter` at all, and no check reports that.

**Each state is one of two answers: refuse it, or write it into `UNENFORCED` with the reason.** Both
are cheap, and choosing is the work — which is why they are one entry rather than five. The
precedent is set: the duplicate squad number in one team and season was answered by declaring it,
because the live data already holds the state and refusing it would make those rows uneditable.

**What makes this more than five edits is that nothing would have caught them.** An `Unenforced`
entry is asserted only to carry a non-empty reason, so a state that is real, permitted and
undeclared reads exactly like one somebody considered — and the whole value of the declaration is
that those two are distinguishable. Making each half resolvable against the code, the way `RULES`
already is, closes the class rather than the instances.

### 3 · FB-16 — Nothing announces that a season rollover is due

**Status:** Open\
**Surfaces:** BE, Ops\
**Effort:** M\
**Path:** Independent — its leverage is that it settles where a scheduled job can run here at all,
which BE-12 leans on for its own "what runs it".

**Deferred by me on 2026-08-12: not worth building yet.** The trigger that turns it into work is a
rollover actually being missed.

**Every step of a rollover has a page; the sequence has nothing.** `/admin/saisons` creates the
season, the Umstellung panel on `/admin/saisons/[saison_id]` activates it
([ADR-0026](../_decisions/0026-one-active-season-and-one-path-to-it.md)), the team and player editors
carry the junction rows, and `/admin/spieltage` builds the skeleton
([ADR-0072](../_decisions/0072-the-matchday-editor-becomes-a-page.md)). Each clears its own
caches as it saves. What no surface does is notice that the sequence has not started, or that it
stopped half-way: nothing prompts for a step that is skipped.

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
  season is over when its fixtures are played, and an early rollover is legitimate (ADR-0026). The
  honest trigger is probably a date approaching with the next season absent.
- **What runs it.** A container with a cron, a scheduled GitHub Actions workflow hitting a guarded
  endpoint, or the host's own crontab. The workflow needs no new runtime and is already proven here by
  `codeql.yml`, which neither the container nor the host crontab is; the container needs no public
  surface. The trade is where the credential lives.
- **What it says.** The value is the checklist, not the alarm: a reminder naming which steps are
  already done is a different message from one saying a date passed, and only the first is worth
  reading twice.

### 4 · FB-17 — Setting up a season is a hand-run sequence, and only an admin can enter a squad

**Status:** Open\
**Surfaces:** FE, BE, DB, Ops\
**Effort:** XL\
**Path:** Waits on the matchday-model question below, because until that is settled the generation
half is being built against a model that may move. BE-15 ahead of it is an ordering preference and
not a block. It changes what FB-16's reminder would have to say and removes no part of the need for
one.

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
because this entry is the largest new source of writes on the page: writes made before an action log
exists are writes nobody can reconstruct.

**It is a programme, and its parts are not one change.**

| Part                                                        | Needs first                                   | Could ship alone |
| ----------------------------------------------------------- | --------------------------------------------- | ---------------- |
| The guided creation flow, as a page over the create payload | —                                             | Yes              |
| Generating the season's structure behind it                 | the matchday-model question                   | No               |
| A representatives-and-contacts admin surface                | somewhere to keep a contact                   | Yes              |
| Telling a representative their team is in                   | the contacts surface                          | No               |
| A shareable link or code, and what it authorises            | a ruling on the authorisation model           | No               |
| The public self-registration page                           | the link, and a public write path             | No               |
| Recognising a returning player                              | the registration page                         | No               |
| Raising a squad-number clash                                | the registration page; the reissue hole below | The hole, alone  |
| Rework of the Saison page and its editor                    | whichever of the above lands                  | Yes              |

**Half of "generate the season fully" is arithmetic that already exists.**
`fl_backend/app/api/saisons/schedule.py :: schedule_for` takes a season's rules and returns, per
phase the season actually plays, how many matchdays it takes and how many matches each holds;
`:: expected_matches` is what a matchday's `anzahl_spiele` reports.
[ADR-0052](../_decisions/0052-a-seasons-schedule-is-derived-from-its-rules.md) stores none of it and
refuses a rules combination that cannot be played
(`fl_backend/app/api/saisons/services.py :: find_rules_refusal`). So the shape of a season is already
a pure function of what a create form collects, and the guided flow's structural half is a matter of
showing that function's answer while the admin is still choosing.

**The missing half is the draw, and its absence is a ratified decision rather than a gap.** `/spiele`
has no `POST` and no `DELETE`:
[ADR-0037](../_decisions/0037-a-seasons-fixtures-are-created-once.md) settled that a season's matches
are drawn once, outside the API, that correcting a draw means editing the database directly, and that
a `POST` would need a `spiel_nr` nobody can safely choose — the draw assigns it, and
[ADR-0034](../_decisions/0034-a-result-entry-resolves-the-whole-bracket.md) wires the bracket through
that number rather than through document ids. **Generating a season "fully" therefore means writing a
draw**, which is the largest single piece of new backend here and the one that runs straight at
ADR-0037. Whether the flow does that at all, or stops at a season whose structure is ready and leaves
the draw where ADR-0037 put it, is a ruling this entry needs before the work starts.

**Ending the flow by making the season live is the one thing it must not do.**
`POST /saisons/{saison_id}/activate` is the only code path in the system that writes `status`, a
created season is always `future`, and creating and activating are two steps **on purpose** — a
single "create it and make it live" call turns a typo in a four-character season id into a silent
rollover of the running season, produced by a form field (ADR-0026). A guided workflow that finishes
by making the season current is exactly that call with a wizard in front of it. The flow ends at a
season that is ready and `future`; the rollover stays the panel on `/admin/saisons/[saison_id]`,
where the outgoing season's unfinished fixtures are listed rather than counted (ADR-0072).

**The load-bearing question: a matchday row is created by hand, and whether it should be is open.**
`/admin/spieltage` creates one at a time, and what a row supplies is its phase and its date span —
its position, its name and its match count have each already left the document
([ADR-0051](../_decisions/0051-a-matchdays-position-is-derived-not-stored.md), ADR-0052). My
direction is that the rows should follow from the rules as well. **If they do, generating a season
stops being a feature and becomes a consequence**, because building the structure is then only
applying the rules — and the flow's generation half is a read of `schedule_for` rather than a writer
of anything. That is why the ordering matters: building the guided flow first means building
generation against a model that is about to change, and rewriting it afterwards. The question is not
free either — ADR-0051 keeps a knockout round splittable across several matchdays, and ADR-0037
leaves `spiele.spieltag_id` with no fixture-level create or delete to move a fixture off a row a
narrowing would remove.

**A public write into application data would be the first of its kind here.** Every write that
touches the league's own data sits behind `verify_access_admin`, declared at router level and
inherited by the endpoints under it
([ADR-0027](../_decisions/0027-the-write-path-is-resource-first-in-a-second-router.md)); the browser
side of that is an email allowlist checked at sign-in and re-derived on every session read
(`fl_frontend/src/core/auth.ts`). The public unauthenticated writes that exist touch no application
data — the sign-in action, which triggers an outbound email and writes into the Auth.js store alone
([ADR-0007](../_decisions/0007-authjs-owns-a-direct-mongoclient.md)), and
`fl_frontend/src/app/api/client-error/route.ts`, which writes a log line — and each has its own
`limit_req_zone` in `nginx/prod.conf`, keyed so that only the POST is limited. A self-registration
page is the first that inserts a person. What that opens is listed under the undecided questions
below rather than answered here.

**Recognising a returning player has a shape already, and ADR-0025 refused the tempting version of
it.** `spieler` holds the person and the `saison_spieler` junction holds everything a squad list
shows; `uniq_spieler_id_saison_id` gives a person one row per season, so bringing back somebody who
already has a retired row for that season is
`POST /spieler/{spieler_id}/saisons/{saison_id}/reactivate` and never a second create.
[ADR-0025](../_decisions/0025-soft-deletion-is-a-date-not-a-flag.md) rejected making a create
idempotent on a natural key because a two-letter shorthand cannot distinguish the same club returning
from a different one wanting those letters, and getting it wrong repoints history silently. **A typed
name is a weaker key than a shorthand**, so the same argument binds harder here: matching on a name
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
confirmation ([ADR-0070](../_decisions/0070-a-draft-carrying-a-warning-is-confirmed-before-it-saves.md)).
A page where a whole team enters itself multiplies those writes and has no admin reading them, so
whether a self-registered player may take a shirt somebody in the squad already wears — and who is
told — is a product call this entry owns.

**What the Saison page and its editor inherit.** The create form is a dialog today
(`fl_frontend/src/features/saisons/components/modals/AdminCreateSaisonModal.tsx` over
`fl_frontend/src/features/saisons/components/forms/AdminCreateSaisonForm.tsx`), and
[ADR-0040](../_decisions/0040-a-form-that-outgrows-a-dialog-becomes-a-page.md) already fixes what
happens when a form outgrows one: it becomes a page at its own route, with panels per section, a
field judged when it is left, one save bar, a discard guard and an undo route handler. A flow that
also picks clubs and creates them passes that threshold by a distance, so the guided workflow is a
page rather than a larger modal, and the pattern to copy is on
`/admin/saisons/[saison_id]` — `fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/AdminSaisonEditForm.tsx`
and the Zeitraum, Regeln, Gruppentausch and rollover sections beside it. The editor is where a wrong
answer from the flow is corrected, so every field the flow collects has to be editable afterwards,
and the narrowing refusals ADR-0052 lists are what the flow has to state while a value is still being
chosen.

**Undecided, and each needs a ruling before the part depending on it starts:**

- **What the link authorises, and what a leaked one can do.** A code per team per season, or a signed
  URL; whether it expires with the registration window; whether it can be revoked and reissued; and
  whether it identifies the team alone or the team and the person. A link pasted into a group chat is
  a link that leaves the group chat.
- **Whether a self-registered entry is live on submission or waits to be admitted.** A squad list is a
  public page, so a public write that lands straight in one is public text written by an
  unauthenticated stranger — the trust `teams.description` and a disqualification's `grund` already
  carry, extended to somebody the league has not authenticated.
- **What the form may ask for, and where the notice saying so lives.** `stufe` is the Hessen
  Oberstufe ([ADR-0048](../_decisions/0048-position-and-stufe-are-closed-sets.md)), so the people
  typing into this page are school pupils. The public route group
  `fl_frontend/src/app/(public)/(meta)/` holds `about`, `kontakt` and `team`.
- **Where a representative's contact is kept.** `fl_backend/app/api/teams/schemas.py :: FLTeamRecord`
  carries a club's name, shorthand, description, site and address and no person, so this is a new
  collection or a new embedded record — and a new collection is a member of
  `fl_backend/app/core/collections.py :: Collection`, a hand-written `$jsonSchema` and its indexes in
  `fl_backend/app/core/constraints.py`, and a row in every table that mirrors them
  ([ADR-0020](../_decisions/0020-the-database-enforces-its-own-invariants.md),
  [ADR-0024](../_decisions/0024-the-third-copy-of-the-schema-is-checked-not-generated.md),
  [ADR-0054](../_decisions/0054-one-declaration-of-the-collection-names.md)).
- **What sends the notification.** Resend is already the transport for the sign-in link, reached
  through Auth.js's provider rather than as a service anything else can call
  (`fl_frontend/src/core/auth.ts`, `fl_frontend/src/core/authEmail.ts`). A second sender is either a
  second call site against the same API or a reason to lift the transport out from under the provider.
- **Whether the flow may enter a club it has just created.** A club never leaves a season once it is
  entered: `saison_teams` has a POST and a PATCH and no DELETE, and the way out is disqualification
  (ADR-0026). A club entered by a misclick in a wizard is therefore disqualified rather than removed,
  which is a heavy consequence for a step in a flow designed to be fast.
- **What a rate limit for this surface should be.** The existing zones are sized for a person signing
  in and for a crashing browser; a whole squad filling a form in one break is a different shape of
  traffic on the same edge.

### 5 · BE-17 — Every server-ordered name list sorts in byte order, so a German name lands in the wrong place

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
`:: build_team_memberships_pipeline` orders a season's clubs on `name`; and
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

### 6 · FE-1 — A fixture carries one date, and a play window cannot be expressed

**Status:** Open\
**Surfaces:** FE, BE\
**Effort:** XL\
**Path:** Independent — `/admin/spiele/[spiel_id]` is the page it lands on, and it exists.

**A fixture's `datum` is a single day, so a match scheduled across a window cannot be recorded as one**
(my item, 2026-08-02). Implementing ranges is heavy in my scoping: it would change the match editor's
form (`AdminEditSpielDataForm.tsx :: AdminEditSpielDataForm`), the schemas, and possibly logic and UI
elements **across the board**.

The Zod mirror is not a fourth place to keep in step by hand: it is checked against the published
document, so one that falls behind `datum`'s new shape is a gate failure naming the field
([ADR-0033](../_decisions/0033-the-zod-mirror-is-checked-against-the-published-document.md)).

Touchpoints to scope against when it is worked: `datum` in each schema mirror and in the DB documents;
`computeSpielStatus`'s date comparisons and `formatSpielDisplay`'s labels, each in
`fl_frontend/src/features/spiele/utils.ts`, and the card layouts over them; `sort_by=datum` on the
backend; `searchable_datum` in the Spielsuche; and the `ausstehend` semantics
[ADR-0058](../_decisions/0058-a-status-filter-is-not-a-status-label.md) fixed — a range makes the
ausstehend/heute/vergangen ternary genuinely harder, and that ADR's intent (a fixture whose play
window includes today is found by the upcoming filter and labelled `heute`) is what the range
arithmetic has to preserve. Working it re-derives ADR-0058's definitions under ranges.

### 7 · LOG-2 — A cached read's call joins to no render, and telemetry has nowhere to go

**Status:** Open\
**Surfaces:** FE, BE, Ops\
**Effort:** L\
**Path:** Independent — ADR-0032 is a floor; tracing waits on new dependencies and on a destination.

**Implement the industry-standard shape of the correlation scope this repository runs a subset of** (my
item, 2026-08-05).
[ADR-0032](../_decisions/0032-one-correlation-id-per-request-one-document-per-line.md) settled **one id
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

### 8 · BE-12 — Nothing purges a row whose `inactive_since` is old enough

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
(measured 2026-08-06). This is a prospective item: it exists so the field's purpose is recorded rather
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
- **What runs it.** A scheduled job, a script I run by hand, or an admin control. The repository runs
  no application-level scheduler — the weekly `cron` in `.github/workflows/codeql.yml` analyses source
  and reaches nothing this could hang off, as FB-16 sets out — which makes the hand-run script the
  cheapest by a distance.

`saisons` and `saison_teams` carry no such field and need none: neither has a delete at all
([ADR-0026](../_decisions/0026-one-active-season-and-one-path-to-it.md)), so neither can accumulate a
row to purge.

### 9 · BE-7 — `typing` imports instead of `collections.abc`

**Status:** Standing\
**Surfaces:** BE\
**Effort:** —\
**Path:** Independent — backend audit pass B4's typing check owns the migration.

Several backend modules import `Mapping`, `Sequence`, `Optional` and `Callable` from `typing` — aliases
deprecated since Python 3.9, on a project running far newer. **Deliberately not fixed piecemeal:**
modernising one module while the rest keep the old spelling is worse than uniformity. The decision is
to enable ruff's `UP` rules and migrate in one pass, which is why `fl_backend/pyproject.toml`'s ruff
selection leaves that family out.

### 10 · BE-14 — The certainty walk gives up in a group of six or more

**Status:** Standing\
**Surfaces:** BE\
**Effort:** —\
**Path:** Independent — no pass covers it, and only the trigger below reopens it.

**Not a defect today, and the numbers say why** (found 2026-08-05, reviewing the bracket).

`_decide_one_gruppe` walks every combination of outcomes for a group's outstanding fixtures and reports
a placing only when the same team holds it in all of them
([ADR-0035](../_decisions/0035-a-group-placing-is-ranked-by-one-chain-and-seeded-only-when-final.md)).
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
