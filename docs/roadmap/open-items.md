# Open items

**Verified against:** `c26c3e3`, 2026-08-08

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
| 1   | FB-16 | Nothing announces that a season rollover is due         | Ops, BE     | M      | Open     | — (clock: the rollover)   |
| 2   | FE-8  | `SpielCardCompact` does not survive a narrow screen     | FE          | S      | Open     | — (overlaps FE-3)         |
| 3   | FE-7  | The delete confirmation loses its backdrop blur         | FE          | S      | Open     | —                         |
| 4   | BE-13 | A malformed id is a 404 in a path, a 422 in a query     | BE          | S      | Open     | —                         |
| 5   | F1    | Two definitions of `ausstehend`                         | FE, BE      | S      | Open     | — (latest with FE-1)      |
| 6   | OPS-9 | Nothing lints or tests the repository's own hooks       | Ops         | S      | Open     | —                         |
| 7   | FB-7  | Cancelled matches are invisible in the games count      | FE, BE      | M      | Open     | — (batch with FE-2, FE-1) |
| 8   | FE-2  | Optional per-game notes                                 | FE (+BE)    | S      | Open     | — (batch with FB-7, FE-1) |
| 9   | FE-1  | Date ranges instead of specific dates                   | FE (+BE)    | XL     | Open     | — (batch with FB-7, FE-2) |
| 10  | FE-3  | TeamDetailsView rework                                  | FE          | M      | Open     | — (ADR-0059 settles it)   |
| 11  | FE-6  | A way to report an error from the error page            | FE          | S      | Open     | —                         |
| 12  | BE-12 | Nothing purges a row whose `inactive_since` is old      | BE, DB      | M      | Open     | — (ADR-0032's follow-on)  |
| 13  | BE-15 | An admin action log, and a smarter undo over it         | BE, DB, FE  | L      | Open     | — (ADR-0051's follow-on)  |
| 14  | LOG-2 | Full trace context: `traceparent`, spans, a destination | FE, BE, Ops | L      | Open     | — (ADR-0039 is the floor) |
| 15  | FB-15 | A group move is only defensible as a swap, unoffered    | FE, BE      | M      | Open     | —                         |
| 16  | FB-9  | A manual slot accepts a disqualified team, silently     | FE, BE      | M      | Decided  | — (ADR-0049 settles it)   |
| 17  | BE-7  | `typing` imports instead of `collections.abc`           | BE          | —      | Standing | audit pass B4             |
| 18  | BE-6  | `CustomObjectId` validates nothing in JSON mode         | BE          | —      | Standing | audit pass B2             |
| 19  | BE-14 | The certainty walk gives up in a group of six or more   | BE          | —      | Standing | trigger recorded          |
| 20  | OPS-2 | Nothing validates the contents of a restored `.env`     | Ops         | —      | Standing | trigger recorded          |
| 21  | OPS-3 | Crawler policy split between robots.txt and Cloudflare  | Ops         | —      | Standing | trigger recorded          |

## The bracket, end to end

**The bracket maintains itself from the group phase to the final, with no admin input in the best case**
(the owner's framing), and every behavioural piece of that is built. This section is an index over what
built it and what is left, and states no dependency of its own — each entry's own `Path` line governs.

**No production data change is outstanding.** All three of the bracket programme's backfills have run:
`python -m app.core.constraints --check` reported zero offenders across all nine validators and all
four unique indexes on 2026-08-06, `spiele` included — and `elfmeterschiessen` is a required key of the
`spiele` validator, so a document still missing it would be counted there. That is the check to re-run
before any deploy that carries a required-field change, and
[ADR-0044](../_decisions/0044-a-shoot-out-is-its-own-scoreline.md) carries the runbook for the one this
closed.

- **FB-4 is concluded**, in [`f023414`](https://github.com/felzab/frankfurtleague/commit/f023414) —
  row 18 of [`closed-items.md`](closed-items.md).
- **FB-10 and FE-4 are concluded**, in
  [`aebf43d`](https://github.com/felzab/frankfurtleague/commit/aebf43d) — rows 19 and 20 of
  [`closed-items.md`](closed-items.md).
- **FB-8 is concluded**, in [`ab20403`](https://github.com/felzab/frankfurtleague/commit/ab20403) —
  row 21 of [`closed-items.md`](closed-items.md). It was the last behavioural gap: a level knockout now
  records its shoot-out and advances a side.
- **FB-12 is concluded**, in [`6331791`](https://github.com/felzab/frankfurtleague/commit/6331791) —
  row 22 of [`closed-items.md`](closed-items.md), and
  [ADR-0046](../_decisions/0046-the-write-path-refuses-wiring-the-season-cannot-hold.md). An unwired
  knockout slot is action-required on both ends, the form is source-first, and the write path refuses
  wiring the season cannot hold.
- **FB-13 is concluded**, in [`125f1cc`](https://github.com/felzab/frankfurtleague/commit/125f1cc) —
  row 23 of [`closed-items.md`](closed-items.md), and
  [ADR-0047](../_decisions/0047-a-bracket-fault-is-derived-on-demand.md). All five stored bracket
  faults are derived on every admin read of the action-required list, and none is stored.
- **FB-2 is concluded**, in [`3669cc7`](https://github.com/felzab/frankfurtleague/commit/3669cc7) —
  row 28 of [`closed-items.md`](closed-items.md), and
  [ADR-0059](../_decisions/0059-a-disqualification-is-a-record-and-its-absence-is-the-null.md). A
  disqualification carries the reason and the date, and it reaches the bracket only through who may
  hold a group placing, which was already decided.
- **FB-11 is concluded**, in [`dfec0fa`](https://github.com/felzab/frankfurtleague/commit/dfec0fa) —
  row 30 of [`closed-items.md`](closed-items.md), and
  [ADR-0057](../_decisions/0057-a-draw-is-reviewed-as-a-table-of-provenance.md). A season's draw is
  reviewable as a draw at `/admin/finalrunden`: one row per knockout fixture, each side stating its
  source over its occupant. **The editor half is deliberately not built and is not scheduled** — a
  whole-draw save needs a transaction over several fixtures, which `PATCH /spiele/{spiel_id}` does
  not offer, and the read view is most of the value.
- **FB-6 is concluded**, in [`fa5832a`](https://github.com/felzab/frankfurtleague/commit/fa5832a) —
  row 33 of [`closed-items.md`](closed-items.md), and
  [ADR-0063](../_decisions/0063-a-matchday-list-is-the-seasons-skeleton.md) with
  [ADR-0064](../_decisions/0064-a-matchdays-position-is-derived-not-stored.md). `FLSaison.rules` is
  editable on the Regeln panel of `/admin/saisons/[saison_id]`, so the qualifier count is no longer set
  by hand.

**Two entries remain, both concluded and neither scheduled.**
**[FB-9](#16--fb-9--a-manual-knockout-slot-accepts-a-disqualified-team-and-nothing-says-a-word)** — a
manual slot takes a disqualified team and no layer says a word. The design is ratified as
[ADR-0049](../_decisions/0049-eligibility-is-checked-where-a-team-is-fielded.md); the owner's deferral
of the work stands.
**[BE-14](#19--be-14--the-certainty-walk-gives-up-in-a-group-of-six-or-more)** — the seeding walk is
capped at ten outstanding fixtures, which is a group of five, and a group of six would stop seeding
with nothing said. The audit established that no faster exact algorithm exists to replace it, so the
cap is a design boundary rather than debt.

## The admin surface, end to end

**Opened 2026-08-06 at the owner's direction, as one unbroken chain of sessions.** The owner reported
an eligibility hole and asked for a researched, textbook-standard pass over seeding and advancement,
the match edit surface, the toasts, the action-required page and the database structure — worked as one
string, each session handing the next its starting prompt. Three decisions were taken the same day and
each member entry states the ones it builds on: the rethink is **evaluation-first** (rewrite where the
evidence demands it, keep what survives scrutiny), the match editor becomes a **dedicated page**, and
eligibility enforcement is **layered** (refuse a newly fielded disqualified team, warn on the merely
unusual), ratified as
[ADR-0049](../_decisions/0049-eligibility-is-checked-where-a-team-is-fielded.md). A fourth decision
followed the same day: **FB-9's implementation is deferred** — one admin, a known hole, no interim
risk — so it is a specified entry nobody has scheduled, not a session of the string.

**The evaluation that opened the string is finished**, and it rewrote the entries below into
instructions before any of them was worked. It produced
[ADR-0048](../_decisions/0048-a-voided-result-is-named-not-implied.md) and ADR-0049 — row 24 of
[`closed-items.md`](closed-items.md).

**The string's first session is finished too**, and the surface every later member renders on, links
into or copies from now exists: the match editor is a page at `/admin/spiele/[spiel_id]`, the modal is
gone, and [ADR-0050](../_decisions/0050-a-form-that-outgrows-a-dialog-becomes-a-page.md) carries the
four decisions it took — row 25 of [`closed-items.md`](closed-items.md).

**The string's second session is finished**, and the feedback channel every later member reports
through now has one shape: a toast is built from this app's own render function rather than patched in
CSS, its duration follows its text, and its dismiss control is reachable without a hover —
[ADR-0053](../_decisions/0053-a-toast-is-built-in-tsx-not-patched-in-css.md), row 26 of
[`closed-items.md`](closed-items.md).

**The draw review is finished as well**: a season's wiring is one page at `/admin/finalrunden`, one
row per knockout fixture with each side's source stated over its occupant —
[ADR-0057](../_decisions/0057-a-draw-is-reviewed-as-a-table-of-provenance.md), row 30 of
[`closed-items.md`](closed-items.md). Its editor half is deliberately unscheduled, for the reason the
ADR carries.

This section is an index over the string and states no dependency of its own — each entry's `Path`
line governs. The admin tables' phone layout is finished as well: all four CRUD tables render as
stacked cards below `md`, from one set of render helpers each (row 31 of
[`closed-items.md`](closed-items.md), and the spieler table follows the same pattern). What is left
of the string:
**Nothing.** FB-6 was the last of it, and it is concluded in
[`fa5832a`](https://github.com/felzab/frankfurtleague/commit/fa5832a) — row 33 of
[`closed-items.md`](closed-items.md). The saisons and spieltage pages adopted the edit page's patterns
([ADR-0050](../_decisions/0050-a-form-that-outgrows-a-dialog-becomes-a-page.md)) as the string intended,
and the rollover control sits on the season's own editor
([ADR-0063](../_decisions/0063-a-matchday-list-is-the-seasons-skeleton.md)). What the rollover still has
no prompt for is its SEQUENCE, which is [FB-16](#1--fb-16--nothing-announces-that-a-season-rollover-is-due)
and a different kind of thing.

**[FB-9](#16--fb-9--a-manual-knockout-slot-accepts-a-disqualified-team-and-nothing-says-a-word)** and
**[BE-14](#19--be-14--the-certainty-walk-gives-up-in-a-group-of-six-or-more)** are not sessions of the
string. Both are concluded: FB-9's design is ratified and its implementation stays deferred, and
BE-14's cap is measured as a boundary the competition's size does not reach.

---

## Tier 1 — leverage and clocks

One clock. FB-16 is the reason nobody will be reminded the rollover is due at all, and it is due
on a date nobody will be watching.

### 1 · FB-16 — Nothing announces that a season rollover is due

**Opened 2026-08-08, when FB-6 closed**, and recorded rather than built at the owner's direction.

**Every STEP of a rollover now has a page; the SEQUENCE has nothing.** `/admin/saisons` creates the
season, the Umstellung panel on `/admin/saisons/[saison_id]` activates it
([ADR-0033](../_decisions/0033-one-active-season-and-one-path-to-it.md)), the team and player editors
carry the junction rows, and `/admin/spieltage` builds the skeleton
([ADR-0063](../_decisions/0063-a-matchday-list-is-the-seasons-skeleton.md)). Each clears its own caches
as it saves. What no surface does is notice that the sequence has not started, or that it stopped
half-way — `docs/workflows/README.md` walks the five steps and nothing prompts for one that is skipped.

**It is a clock, which is what puts it in this tier.** A rollover is due on a date nobody is watching,
and the failure is silent in a specific way: an omitted step leaves the site serving last season as
though it were this one, and every read of it is a correct read of stale data.

**Why it shares nothing with FB-6's pages.** A reminder is a scheduled job, not a surface — nothing
renders it, nobody navigates to it, and it has to run when no admin is present. This repository has no
scheduler at all: there is no cron, no queue, no worker, and `scripts/deploy.sh` starts three containers
none of which is one. That, rather than the email, is the actual scope.

**Three things to settle when it is worked:**

- **What triggers it.** A season's `end_date` is the obvious clock and is the wrong one on its own — a
  season is over when its fixtures are played, and an early rollover is legitimate (ADR-0033). The
  honest trigger is probably a date approaching with the next season absent, which is two reads.
- **What runs it.** A container with a cron, a scheduled GitHub Actions workflow hitting a guarded
  endpoint, or the host's own crontab. The second needs no new runtime and the first needs no public
  surface; the trade is where the credential lives.
- **What it says.** The value is the checklist, not the alarm: a reminder naming which of the five steps
  are already done is a different message from one saying a date passed, and only the first is worth
  reading twice.

**Path:** independent. Nothing blocks it and it blocks nothing; the clock is the only reason it ranks
where it does.

### 2 · FE-8 — `SpielCardCompact` does not survive a narrow screen

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

### 3 · FE-7 — The two-step delete confirmation loses its backdrop blur

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

### 4 · BE-13 — A malformed id is a 404 in a path and a 422 in a query

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

### 5 · F1 — Two definitions of `ausstehend`

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
semantics anyway. The Spielsuche's Status facet already exposes these semantics to a reader and
resolved the disagreement its own way — it filters through `computeSpielStatus`, the client's
definition, which is the one on screen. That narrows this entry to the backend's `spiel_status`
parameter rather than closing it.

### 6 · OPS-9 — Nothing lints or tests the repository's own hooks

**Found 2026-08-05, while fixing a bypass in one of them.** `.claude/hooks/` holds five shell scripts
that gate every assistant session: the two branch guards, the local-compose guard, the stale-type-class
guard and the orphan-server warning. **No part of `./scripts/verify.sh` reads any of them.**
`selfcheck.sh` runs `bash -n` and shellcheck over `scripts/*.sh` and reaches no further, and
`ci_scopes.sh` maps `.claude/*` to the `docs` and `format` scopes, neither of which parses a shell
script. The first `bash -n` one of these files gets is from the session that trips it.

**It is not hypothetical.** `guard-branch.sh` carried a path-containment test that compared raw strings,
so four ordinary spellings of a path inside the repository — a `.` segment, a `..` segment, a doubled
separator and the `//?/` device form — all read as being outside it and were allowed while HEAD was
`main`. Nothing in the repository could have reported that, and nothing did.

**What it would cost.** Adding them to `selfcheck.sh` needs an arm in `ci_scopes.sh` mapping
`.claude/hooks/*` to the `scripts` scope, so a hook edit then selects `--scripts` and with it the
backend venv that scope already requires. Editing those two files is itself a `scripts/*.sh` change,
which selects every scope once
([ADR-0037](../_decisions/0037-the-gate-refuses-an-undersized-scope.md)). A syntax check is also not
what would catch a bypass like that one — that needs a behavioural test against a throwaway repository
— so the honest scope is both, and the second half is the larger one.

**The argument against, stated fairly:** these are development tooling, they run on one machine, and a
hook that stops working announces itself the first time a session does the thing it was meant to stop.
Against that, a guard is exactly the code whose failure is least likely to be noticed — nobody observes
a refusal that does not happen.

**Path:** independent. Small either way; the decision is whether a guard deserves a gate.

---

## Tier 3 — the work those decisions carry

Dependency order, and most of it is the admin-surface string in its working order. The surface the tier
was built around exists: the match editor is a page at `/admin/spiele/[spiel_id]`
([ADR-0050](../_decisions/0050-a-form-that-outgrows-a-dialog-becomes-a-page.md)), so the schema/form
batch at ranks 10–12 renders on it and the triage list links into it, so neither has to be built
against a dialog first and then again. The FB-7/FE-2/FE-1
batch keeps its one-pass
rule: one schema surface, one form, one mirror pass, now aimed at the page rather than the modal
([ADR-0040](../_decisions/0040-the-zod-mirror-is-checked-against-the-published-document.md) makes a
mirror that falls behind a gate failure that names the field). The last three are prospective rather
than dependent: BE-12 is real now that the spieler pages make retiring a row possible at all, BE-15
becomes real the moment a second person can write, and LOG-2 improves the fidelity of a logging
convention that already works. FB-15 closes the tier: the group swap the team editor's lock names as
the one defensible mid-season move.

### 7 · FB-7 — Cancelled matches are invisible in the Saisontabelle's games count

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

**The underlying shape, named 2026-08-06:** `is_canceled` carries two meanings at
once. Reference bracket models keep a **forfeit** — a match awarded without being played — as its own
property of the result, separate from whether the match happened. Here both are `is_canceled: true`
and the only thing distinguishing them is whether an `ergebnis` is also present. That encoding is
deliberate and ADR-0026 depends on it, so this item does not reopen it; it is the reason the badge
needs a new counted field rather than a filter over the flag.

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

**Path:** batch with FE-2 and FE-1 — one schema and mirror pass, landing on the edit page. Its
display half depends on
nothing. The eighth `FLTeamStatistik` field lands in both mirrors and in
`fl_backend/openapi.json`, which the gate compares (ADR-0040).

### 8 · FE-2 — Optional per-game notes

**Owner's item, 2026-08-02.** Add a place for **small notes on every game** — optional, containing
information about the game such as exciting moments. **Editable in the admin form**
(`AdminEditSpielDataForm`).

An optional field on `FLSpiel` in both mirrors, a form section, and a display decision (where the
note appears — `SpielDetailsModal` is the obvious candidate) that is deliberately left open here.

**Path:** batch with FB-7 and FE-1 — same form, same schemas, one mirror pass. The form is
`/admin/spiele/[spiel_id]`, and the display decision is untouched by that.

### 9 · FE-1 — Date ranges instead of specific dates for games (heavy)

**Owner's item, 2026-08-02.** At some point, implement **date ranges** instead of specific dates
for games. A heavy change, in the owner's scoping: it would change `AdminEditSpielDataForm`, the
schemas, and possibly logic and UI elements **across the board**.

Known touchpoints to scope against when it is worked: `datum` in both schema mirrors and the DB
documents; `computeSpielStatus`'s date comparisons; `formatSpielDisplay` and the card layouts;
`sort_by=datum` on the backend; `searchable_datum` in the Spielsuche; and F1's `ausstehend`
semantics — a range makes the ausstehend/heute/vergangen ternary genuinely harder, so settle F1's
intent at the latest here.

**Path:** batch with FB-7 and FE-2 (one schema/mirror/form pass, on the edit page). Resolves or
restates F1.

### 10 · FE-3 — TeamDetailsView rework

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
- a **note on disqualified teams**, which is where the reason and date get displayed. Both fields are
  on `FLTeam.disqualifikation` and both are public by decision
  ([ADR-0059](../_decisions/0059-a-disqualification-is-a-record-and-its-absence-is-the-null.md)), so
  the note renders `grund` as authored rather than mapping it to a label.

**Path:** nothing blocks it — the record it renders exists. FE-8 fixes the compact card this view is
the only consumer of.

### 11 · FE-6 — A way to report an error from the error page

**Owner's item, 2026-08-04, with the evaluation he asked for**: is a report affordance worth having
when everything is already logged?

**Worth having, narrowly, for what a log line cannot carry.** Crashes are recorded on both sides
now — `onRequestError` logs server errors and the error boundary posts client crashes to
`fl_frontend/src/app/api/client-error/route.ts` (`docs/logging.md`) — but **what the user was doing
is in no log**, and it is usually the difference between a report that reproduces and one that does
not. The affordance's remaining job is the human half: intent, steps, expectation.

**A digest names an error class, not an incident** (measured 2026-08-05, recorded in
`docs/logging.md`): Next derives it from the message, so every `APINetworkError` shares one digest.
A report quoting only a digest locates every occurrence of that message rather than the reader's
own — so the affordance should carry the digest, the route AND the time, which together pin the
exact log entry and its correlation ids.

**Keep it to a `mailto:`.** The Kontakt page already publishes the address, so a link carrying the
digest, the route and the time in its subject costs one component and adds no write path. A form
posting to an endpoint would be a second public, unauthenticated write for the same information —
the crash itself already travels through the rate-limited ingest route, and a human report does not
need a machine path.

**Path:** independent. Every request carries an edge-minted correlation id and the joining recipe
is `docs/logging.md` (ADR-0039), so the affordance quotes real coordinates. Nothing waits on this.

### 12 · BE-12 — Nothing purges a row whose `inactive_since` is old enough

**Opened 2026-08-03, when BE-4 closed. It is the reason that field is a date rather than a boolean**
([ADR-0032](../_decisions/0032-soft-deletion-is-a-date-not-a-flag.md)).

Six collections now carry `inactive_since`: `teams`, `spieler`, `saison_spieler`, `spieltage`,
`spielorte`, `schiedsrichter`. A retired row stays forever, keeps its slot in whatever unique index
covers it, and is filtered out of every default read. Nothing removes one, ever.

**Today that is fine and the numbers say so.** Nothing is retired anywhere: 0 rows across all six,
against 16 teams, 362 players, 362 squad rows, 6 matchdays, 6 venues and 7 referees (re-measured
2026-08-06). This is a
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

**Path:** independent, and now real: the spieler pages retire both a person and a squad row, so rows
with an `inactive_since` can accumulate for the first time.

### 13 · BE-15 — An admin action log, and a smarter undo over it

**Opened 2026-08-06, out of the evaluation of this system against established practice.** It is the
one place where that evaluation found this system materially behind the reference model on the data
side, rather than differently shaped.

**Nothing records who changed what, when, or what it replaced.** Every admin write overwrites in
place: a result is `$set` over its predecessor, `is_disqualified` flips with no trace of who flipped
it or why, and the write that destroys the most is one nobody asked for — applying a bracket
advancement clears the advanced fixture's `ergebnis` and `elfmeterschiessen`
(`fl_backend/app/api/spiele/crud.py :: advance_bracket_winners`), so correcting a quarter-final
silently deletes a semi-final scoreline that a person had entered.
[ADR-0048](../_decisions/0048-a-voided-result-is-named-not-implied.md) makes that destruction
**visible** and deliberately does not make it **recoverable** — which is the question this entry
carries.

**What the reference model does.** Federation administration software treats a disciplinary action as
a case with an audit trail, because a disqualification is a decision somebody has to be able to
justify later, and because a sanction that nobody can trace is a sanction that gets disputed. Half of
it is built — a disqualification carries a reason and a date
([ADR-0059](../_decisions/0059-a-disqualification-is-a-record-and-its-absence-is-the-null.md)) — but a
reason and a date on the current state is not a history: it says why the team is disqualified now, not that it was
undisqualified last week.

**Why it is not urgent, stated fairly.** There is exactly one admin, who is the only person who could
dispute an entry, and no result has been lost that anybody has missed. The cost of not having it is
paid only when something goes wrong and somebody asks what happened.

**What it has to answer, none of it decided:**

- **What is recorded.** Every write, or only the ones that destroy something a person entered? The
  second is far cheaper and covers the case ADR-0048 exposed; the first is what makes a dispute
  answerable.
- **Where it goes.** A collection, an append-only log stream, or the existing JSON log lines — which
  are destroyed on every deploy, because `deploy.sh` recreates the containers (`docs/logging.md`), so
  the logging route needs LOG-2's shipping question answered first.
- **How long it is kept**, and whether it holds personal data. A squad row names a person, so a
  history of squad edits is a retention decision rather than a storage one.
- **Whether a restore is offered at all.** Recording that a result was destroyed is much cheaper than
  being able to put it back, and the two are separable — the first is worth having on its own.

**What the owner has since asked this to become (2026-08-06).** An **admin action-log page** listing
every edit and every add, with a **smarter undo built over it**. That settles two of the four questions
above and reshapes a third:

- **What is recorded:** every write, not only the destructive ones. A page listing edits is a page, and
  a page that lists half of them is a page nobody trusts.
- **Where it goes:** a collection, because the page reads it. The log-stream option is out — deploy
  recreates the containers and the history would end at the last deploy.
- **Whether a restore is offered:** yes, and that is the "smarter undo". The bound to beat is the one
  [ADR-0051](../_decisions/0051-a-voided-result-is-named-before-it-is-lost.md) already ships: fifteen
  seconds, held in the browser, gone on reload. An undo over a stored log survives both, and it can
  restore a write nobody was watching at the time — which is the case the client-held one cannot reach.

Still open: **how long it is kept and whether it holds personal data**, unchanged from above.

**Path:** independent, and not scheduled. ADR-0059 gives disqualification a reason and a date and is
the nearest thing to a first instalment; LOG-2 owns the destination question only if the answer ever
becomes a log rather than a collection, which the owner's direction above makes unlikely. Neither
blocks this and this blocks neither. ADR-0051 raises the value of doing it: the client-held undo makes
the gap visible on the one surface an admin uses most.

### 14 · LOG-2 — Full trace context: `traceparent`, spans, and somewhere to send them

**Owner's item, 2026-08-05, opened out of LOG-1: implement the industry-standard shape of what
LOG-1 built a subset of.**

[ADR-0039](../_decisions/0039-one-correlation-id-per-request-one-document-per-line.md) settled **one
id per request, propagated by an ordinary header, written into three JSON streams**. The recognised
standard for the same job is **W3C Trace Context** — a `traceparent` header carrying a trace id, a
span id and flags — usually implemented through **OpenTelemetry**, which records not just an id but
a _span per operation_ with parent links, timings and attributes. Next.js ships first-class support
for it (`instrumentation.ts` is the documented hook), and FastAPI/Starlette and pymongo all have
maintained instrumentation packages.

**What the standard buys over what exists.** Three things, in descending order of how much they are
worth here:

- **A CACHED read's backend call joins to the page render that triggered it.** This is the one the
  hand-rolled scope provably cannot reach: `"use cache"` forbids request APIs, so no application
  code can carry the request's id into a cache fill (`docs/logging.md`, the cache-fill boundary).
  OpenTelemetry propagates through the framework's own internals instead. It covers eleven of the
  twelve queries; the twelfth is uncached and already joins.
- **Timings become a tree rather than three separate numbers.** Today nginx reports
  `upstream_duration_s` and the backend reports `duration_ms`, and relating them is manual. A span
  tree shows where a slow request actually spent its time, including inside Mongo.
- **A vocabulary other tools already speak**, so a future collector, dashboard or alerting rule
  needs no bespoke parser.

**The question this entry exists to answer, and it is not "which library".** It is
**where the telemetry goes**. This repository has _no aggregation of any kind_ — reading production
logs is `ssh` plus `docker compose logs`, and those logs are destroyed on every deploy because
`deploy.sh` recreates the containers (`docs/logging.md`). **OpenTelemetry with no collector behind
it is strictly worse than what exists**: a dependency on all three surfaces, a heavier runtime, and
the same lost-on-deploy stream at the end of it. So the ordering is:

1. **Decide the destination first.** A self-hosted collector on the same box (Jaeger, Grafana
   Tempo/Loki, SigNoz), a hosted backend, or nothing. Each carries a resource cost on a server whose
   three services are already capped at 2.8 CPU and about 2.8 GB, and a hosted one puts request
   metadata for a public site into a third party.
2. **Only then instrument.** The libraries are the cheap half.

**One cheaper thing that is a real improvement on its own**, and a legitimate answer to "not yet" on
the whole programme: **ship the logs off the host before they are lost.** A rotating copy, or a log
driver other than `json-file`. This is the gap that actually costs something today — `deploy.sh`
recreates the containers and their logs go with them — and it is independent of tracing.

**The avoidable half of the propagation gap is already closed**, so this entry does not carry it:
`fl_frontend/src/shared/utils/correlationScope.ts :: runWithIncomingCorrelationId` seeds the scope
for every dynamic caller, the one uncached page-render query included. What is left for
OpenTelemetry is the half no application code can reach.

**What it would supersede.** ADR-0039's decision that the identifier is a single id on a custom
header. Reversing that means a new ADR carrying `Supersedes: ADR-0039`, and ADR-0039 gaining its two
`Superseded by` lines and nothing else ([`_standard/4-adr-guide.md`](../_standard/4-adr-guide.md)).
The parts of ADR-0039 that would survive untouched are the stream contract, the error-code system
and the edge's refusal of a client-supplied id — a `traceparent` from an untrusted client carries
exactly the same log-injection risk and must be validated or replaced the same way.

**Not measured:** the runtime cost of the instrumentation packages on this application, and whether
a collector fits on the current host beside three capped services. Both are input to step 1 and
neither should be guessed.

**Path:** independent. ADR-0039 is the floor it builds on, not a blocker — logging works today, and
this is fidelity rather than function. Nothing waits on it.

### 15 · FB-15 — A mid-season group move is only defensible as a swap, and nothing offers one

**Owner's item, 2026-08-07, out of the admin teams work.** The club editor locks the Gruppe select
the moment the selected season is underway and the club has a fixture in it: a group decides which
table counts the club's results and which bracket slot its placing seeds (ADR-0043), so moving one
club mid-season falsifies two standings at once. The lock's own message names the one move that
would be defensible: **two clubs exchanging groups**, which keeps both group sizes and both
schedules intact.

**Why it is not a pair of junction PATCHes.** `PATCH /teams/{team_id}/saisons/{saison_id}` addresses
one row, so a swap done as two calls has a window in which one group holds five clubs and the other
three — and a failure after the first call leaves the season in that state. A swap is one decision
and wants one transaction over two junction rows, which no endpoint offers. This is the same
endpoint question FB-11's editor half recorded for fixtures, on a smaller surface.

**A second bound, also the owner's:** once the knockout rounds have begun, no swap is defensible
either — the standings have been consumed by the seeding, and a group change behind a played
bracket rewrites what its slots meant. The control must refuse then, not merely warn.

**Where it lands is open.** The club editor addresses one club, so a two-club operation sits
awkwardly there; `/admin/saisons/[saison_id]` addresses the season, which is the thing a swap belongs
to, and it now exists. Decide when one of the two is next touched.

**Path:** independent. Nothing blocks it, and it blocks nothing — the lock in the club editor is the
interim answer, and today's data has no case that needs a swap.

---

## Tier 4 — standing cautions and watch items

No scheduled action. Each of these has a recorded trigger rather than a plan, and most have an owner
elsewhere: two are seeded into backend audit passes and two into ops, and FB-9 is a settled design
whose implementation the owner has deferred. BE-14 is the exception and carries its own trigger — a group of six teams —
because no pass covers a constant that is correct at today's group size and wrong at a larger one.

### 16 · FB-9 — A manual knockout slot accepts a disqualified team, and nothing says a word

**Owner's item, 2026-08-06, reported as a reproduction — and deferred the same day, by the owner:**
the site has exactly one admin, who is the person who found the hole, so the interim risk is priced
at nil and fixing ahead of the evaluation buys nothing.

**The verdict, 2026-08-06: implement as recorded.** The evaluation measured the recorded design
against how established systems handle eligibility and found nothing to supersede. It also found the
reason this system needs a rule those systems do not: on a bracket platform a disqualified entrant
stops being an entrant, so no later stage can select it — while here ADR-0033 settles that a team
never leaves a season and disqualification is a flag on the junction row, so the team stays selectable
by design and the check has to sit where a team is fielded instead. The three tiers below are now
ratified as
[ADR-0049](../_decisions/0049-eligibility-is-checked-where-a-team-is-fielded.md), and the reasoning,
the rejected alternatives and the accepted edge live there.

**The argument is settled; the work is not scheduled.** The owner's deferral covers implementation and
still stands — this entry is the specification, and the ADR is why.

**The reproduction:** a team that is disqualified — and never qualified from its group — can be
manually picked onto a semi-final side, the save succeeds, and no entry appears under "Fehlerhafte
Verweise".

**Measured 2026-08-06, and the rule genuinely does not exist at any layer.** The one eligibility
predicate in the system, `fl_backend/app/api/teams/services.py :: _may_hold_a_platz`, is reachable
only through a `gruppe`-typed source, and a manual side has none by definition:

| Layer                              | Checks a manual side's team?                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| Picker (`FormTeamPicker`)          | No — maps every season team; `is_disqualified` and `gruppe` sit unread on each     |
| Write path (`find_wiring_refusal`) | No — all four rules begin `if quelle is None: continue` (ADR-0046, by design)      |
| Handler (`patch_spiel_data`)       | No — never reads `teams` or `saison_teams`; the side is `$set` as submitted        |
| Resolution (`resolve_bracket`)     | No — a null-`quelle` slot is the admin's own and is read by nothing (ADR-0042)     |
| Fault report (`FLBracketFault`)    | No variant for an ineligible occupant (ADR-0047 covers wiring contradictions only) |
| Action-required filter             | No — "Offene Besetzung" needs a side with _neither_ team _nor_ source              |

**The design, layered enforcement — owner's decision of 2026-08-06, ratified as ADR-0049:**

- **Refused: newly fielding a disqualified team.** `is_disqualified` is declared state on the
  `saison_teams` junction, set by a person and changed by no result — so a payload fielding such a
  team contradicts the season _as it stands at the write_, which is ADR-0046's class of rule, not the
  result-dependent class it rejected. A new pure sibling `find_occupant_refusal` taking the payload,
  the season and a membership map, beside `find_wiring_refusal` (not a fifth rule inside it: that
  function's contract is wiring and its input carries no membership data), a distinct 409 code
  `REQ-OCCUPANT-001`, the junction read inside the transaction (`SaisonTeamsCollection` exists in
  `app/core/dependencies.py`). Two rules: **O1** a disqualified team is never _newly_ fielded —
  resubmitting the stored occupant unchanged passes, or a fixture holding a DQ team becomes
  uneditable, including the edit that resolves it; **O2** a fielded team holds a `saison_teams` row
  for the fixture's season — a missing row is a dangling reference, not an odd draw, and only a stale
  form or a hand-crafted request can produce one.
- **Reported: an occupant disqualified after being placed.** A sixth fault variant,
  `reason: "occupant_disqualified"`, carrying `spiel_id`, `spiel_nr`, `team_id` and `team_name` —
  the name because the save toast has no `spiele` list to join against, and it cannot go stale
  because faults are derived per request off a field the rename fan-out maintains (ADR-0028 rule 3).
  Derived in `resolve_bracket` over the _effective_ sides of knockout fixtures whose effective result
  is `None`: a played fixture is history and reports nothing, and a since-disqualified winner reports
  on the fixture it arrives in. The slot is never changed — only a person can pick between a forfeit
  and a replacement. `find_bracket_faults` reads the junction directly
  (`{"is_disqualified": True}`, projected) rather than through `build_team_pipeline`, which skips
  match-fed seasons, is the per-season cost ADR-0047 flagged, and filters `inactive_since`.
- **Warned, never refused: a manual pick that did not qualify from the groups.** Undecidable while
  the groups run, and on the only slot type that can hold it, frequently deliberate — a replacement
  team is the manual mode's intended use (ADR-0042). A real-time note in the form says the system
  does not judge sporting qualification on a manual side. Deliberately **no** computed
  "nicht qualifiziert" badge: it would re-implement the tiebreak chain client-side — a second answer
  to who finished second.
- **Frontend:** disqualified teams disabled in the picker with an inline " — disqualifiziert" label
  (and in `textValue`, so search and screen readers still find them); an `aria-live` warning under
  the picker when the current payload holds a DQ team, which covers the pre-selected stored occupant
  the disabling cannot; an `actionError.ts` branch for `REQ-OCCUPANT-001` whose advice differs from
  REQ-WIRING-001's "reload". Whichever surface holds the form when the verdict lands — the modal, or
  `/admin/spiele/[spiel_id]` — carries these; the rules are surface-independent.

**Tests:** a new `tests/api/test_occupant_refusal.py` mirroring
`test_wiring_refusal.py` (legal edits including resubmit-unchanged and the warn-only-unqualified pin;
DQ refusals on both phases; membership refusals), `TestReportingAFault` additions in the house
report-plus-containment style (played-fixture silence, the arriving DQ winner, dedupe across both
sides, the empty-default back-compat pin, ordering), and the frontend utils and categorisation cases.

**Triggers to schedule the work:** a second admin gaining access; any evidence a stored knockout
occupant is disqualified or holds no junction row (`python -m app.core.constraints --check` does not
cover this — it is a cross-collection relation); or the hole being exercised by accident rather than
in a test. Absent one of those it stays unscheduled, and the page it is built onto is
`/admin/spiele/[spiel_id]`.

### 17 · BE-7 — `typing` imports instead of `collections.abc`

Several backend modules import `Mapping`/`Sequence`/`Optional`/`Callable` from `typing` — aliases
deprecated since Python 3.9, on a project running far newer. **Deliberately not fixed piecemeal:**
modernising one module while the rest keep the old spelling is worse than uniformity. The recorded
decision is to enable ruff's `UP` rules and migrate in one pass — which backend audit pass B4's
typing check owns.

### 18 · BE-6 — `CustomObjectId` validates nothing in JSON mode

Its `json_or_python_schema` passes a bare `str_schema()` for the JSON branch, so
`model_validate_json` accepts **any string** as an ObjectId while `model_validate` rejects it.
Unreachable through FastAPI today, which validates already-parsed dicts — which is precisely why
the existing tests certify a guarantee that holds in only one of the two modes. If anything ever
routes through `model_validate_json`, an arbitrary string reaches a Mongo `_id` filter. Found
2026-07-30. Seeded into backend audit pass B2's validation-mode check.

### 19 · BE-14 — The certainty walk gives up in a group of six or more

**Found 2026-08-05, reviewing the bracket after FB-8 closed. Not a defect today, and the numbers say why.**

`_decide_one_gruppe` walks every combination of outcomes for a group's outstanding fixtures and reports a
placing only when the same team holds it in all of them (ADR-0043). The walk is capped at ten outstanding
fixtures per group (`fl_backend/app/api/teams/services.py :: CERTAINTY_FIXTURE_LIMIT`); past that it
reports no placing at all, which is the safe direction and, at ten unplayed matches, the honest one.

**The cap is a group size in disguise**, because a group played out in full has one fixture per pair:

| Teams in a group | Fixtures to play | Against the cap of ten |
| ---------------- | ---------------- | ---------------------- |
| 4                | 6                | walks                  |
| 5                | 10               | walks, exactly at it   |
| 6                | 15               | **reports nothing**    |

Season 2026 has 16 teams in four groups — four apiece, six fixtures — comfortably inside it. A sixth team
in any one group would silently stop that group from seeding the bracket at any point in its life, and
the symptom would be an empty knockout slot with nothing said about it, because a placing that is merely
undecided is deliberately reported to nobody (invariant I24c).

**Raising the constant is not the fix.** The enumeration is `3^n`, so eleven fixtures is three times
the work of ten and fifteen is 243 times, and it runs once per referenced group inside
`PATCH /spiele/{spiel_id}`'s transaction. The walk already deduplicates by the points table each
outcome set produces and stops the moment no placing survives every table
(`fl_backend/app/api/teams/services.py :: _decide_one_gruppe`), so the ranking work is bounded by the
distinct tables — but the `3^n` enumeration itself is not pruned, which is what the cap still guards.

**Nor is a cleverer algorithm the fix, and the reason was settled on 2026-08-06.** The
question this walk answers — is a team's placing the same however the remaining fixtures go — is the
complement of the classical sports elimination problem. That problem has an efficient exact solution
by network flow **only under a win/draw scheme where a match distributes a fixed number of points**;
under the three-points-for-a-win rule a win creates a point that a draw does not, and deciding
elimination becomes NP-complete (Bernholt, Gülich, Hofmeister and Schmitt, _Football Elimination Is
Hard to Decide Under the 3-Point-Rule_, 1999). Season 2026 scores 3/1/0 through `FLSaisonRules`, and
`win_points` is configurable per season, so the hard case is the one this system has to serve. **There
is therefore no polynomial exact replacement to write**, and the honest options are the cap that
exists, an approximation that would sometimes seed a placing a later result overturns, or a person.

**The textbook fallback is a person, and this system deliberately does not have one.** Established
platforms do not infer finality at all: a group's standing becomes available to seed the next stage
only when the organiser **validates** it, and validation also locks the group's matches. Measured
against that, this system is doing strictly more — it seeds a placing the moment it is clinched, which
a validation model cannot do at all because it requires every match played first. The cap is the price
of that extra reach. So if a group ever does grow to six, the cheap answer is an explicit
"this group is final" control feeding the same `DecidedStanding`, not a faster walk.

**None of that is a reason to build anything today.** It is the analysis the trigger below should be
resolved with, recorded so it is not re-derived.

**Not measured:** how long the walk takes at the cap. Four-team groups make it `3^6` = 729 raw
iterations per group, which is unmeasurable; at the cap it is `3^10` = 59,049 per group — cheap per
iteration once deduplicated, but inside a transaction with a 60-second ceiling. Nobody has timed it,
and nobody needs to until a group grows.

**Trigger to revisit:** a season drawn with six or more teams in any group, or any change to how groups
are sized.

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
