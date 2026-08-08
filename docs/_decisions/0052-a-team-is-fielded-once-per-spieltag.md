# ADR-0052 — A team is fielded once per Spieltag, and an ineligible one is refused where it is fielded

**Status:** Accepted
**Date:** 2026-08-06
**Surface:** backend, frontend
**Supersedes:** —
**Superseded by:** —
**Source:** Open item FB-9, in two reproductions: a manual slot accepting a disqualified team
silently, and a team picked into two fixtures of one matchday with nothing anywhere saying so. The
eligibility tiers were first recorded the same day (retired number 0049); this decision carries
them and adds the occupancy rule.

## Context

A team can reach a knockout slot by two routes and only one of them asked whether it is allowed to
be there.

**The seeded route is checked.** A slot fed by a `gruppe` source resolves through
`fl_backend/app/api/teams/services.py :: _may_hold_a_platz`, which excludes a disqualified team from
holding a placing at all, so the placings walk past it and the team below takes the place.

**The manual route was checked nowhere.** A side whose `quelle` is `None` is the admin's own
(ADR-0042), and every layer declined it in turn: the picker mapped every team of the season without
reading the `is_disqualified` each one carries; `find_wiring_refusal`'s four rules each begin by
skipping a side with no source (ADR-0046); the handler `$set` the side as submitted; the resolution
leaves a source-less slot alone by design; and `FLBracketFault` had no variant for an occupant,
since ADR-0047's five are contradictions between references. So a disqualified team that never
qualified from its group could be picked onto a semi-final, the save succeeded, and nothing
anywhere said a word.

**The reference model does not have this hole, and the reason it does not is instructive.** On
platforms of the Toornament and Challonge class, and in federation administration software,
eligibility is a property of a _participant_ and is enforced where a participant enters the
competition — registration, check-in, lineup submission. A disqualified entrant stops being an
entrant, so no later stage can select it, and the bracket needs no rule of its own.

**That moment does not exist here.** ADR-0033 settled that a team never leaves a season: there is
no delete on `saison_teams`, and disqualification is the only way out — recorded on the junction
row rather than as a removal from the entry list. The team therefore remains a selectable
participant for the whole season by deliberate design. The check the reference model performs once,
at the boundary, has no equivalent boundary in this system, which is precisely why every rule below
sits **where a team is fielded** instead.

**The occupancy rule is a second rule of the same class, found while building the edit page's
pickers.** A team could be picked into two fixtures of the same Spieltag. Nothing refused it,
nothing reported it, and the second pick left the team standing in both — a club playing two
matches on one matchday, which is not a thing that can happen. Neither mechanism the database
applies can express it: a `$jsonSchema` validator sees exactly one document (ADR-0027), and a
unique index reads one key per document while the team sits in **either** of two embedded fields —
so a club in `team1` of one fixture and in `team2` of another is a collision no index can be built
to refuse. It is the same shape as the bracket faults: a contradiction between documents
(ADR-0047). Checked on 2026-08-06 against the live database before any of this shipped: 58 occupied
(Spieltag, team) pairs across 5 Spieltage, maximum one fixture per team per Spieltag — zero
offenders.

## Decision

**Eligibility is three tiers, and which tier a case lands in is decided by whether the fact is
declared or sporting.**

**Refused: newly fielding a disqualified team, and fielding a team with no junction row.**
`is_disqualified` is declared state, set by a person and changed by no result, so a payload
fielding such a team contradicts the season _as it stands at the write_ — ADR-0046's class of rule,
not the result-dependent class it rejected. The refusal is a pure sibling of
`fl_backend/app/api/spiele/services.py :: find_wiring_refusal` rather than a fifth rule inside it:
that function's contract is wiring and its input carries no membership data. Two rules:

- **O1 — a disqualified team is never _newly_ fielded.** Resubmitting the stored occupant unchanged
  passes. Without that clause a fixture already holding a disqualified team becomes uneditable,
  including by the very edit that would resolve it.
- **O2 — a fielded team holds a `saison_teams` row for the fixture's season.** A missing row is a
  dangling reference rather than an odd draw, and only a stale form or a hand-crafted request
  produces one.

**Both occupant rules apply only to a team the payload NEWLY fields** — O2 for the identical
reason as O1: without the clause, a fixture already holding such a team becomes uneditable,
including by the edit that would resolve it, which is the fixture an admin most needs to open.

**Reported: an occupant disqualified after being placed.** A sixth `FLBracketFault` variant
carrying the fixture, the team id and the team name — the name because the save's message has no
`spiele` list to join against, and it cannot go stale because faults are derived per request off a
field the rename fan-out maintains (ADR-0028). Derived over the _effective_ sides of knockout
fixtures whose effective result is `None`: a played fixture is history and reports nothing, and a
since-disqualified winner reports on the fixture it arrives in. **The slot is never changed by
this** — only a person chooses between a forfeit and a replacement.

**Warned and never refused: a manual pick that did not qualify from its group.** Undecidable while
the groups are still running, and on the one slot type that can hold it, frequently deliberate — a
replacement team is the manual mode's intended use (ADR-0042). The form states that the system does
not judge sporting qualification on a manual side. **No computed "nicht qualifiziert" badge**: it
would re-implement the tiebreak chain on the client and produce a second answer to who finished
second (ADR-0043).

**A team is fielded at most once per Spieltag, enforced at the write path.** The rule lives in
`fl_backend/app/api/spiele/services.py :: judge_spieltag_occupancy`, pure, beside the wiring rules
rather than inside them.

**On a clash, move a manual side; refuse against a maintained one.** Fielding a team here is a
statement about where it plays, so the other fixture gives it up — and loses its own result with
it, for exactly the reason an advancement does: the goals were scored against the team being
removed. Two cases refuse instead, and both because moving would not stick:

- **The occupied side carries a `quelle`** — the resolution owns it, and emptying it is undone.
- **Both sides of the payload name one club** — there is nothing to move it to, since the only side
  to empty is one the caller has just filled in. This is also the one shape the wiring rules cannot
  see: they key a source by identity, and two hand-set sides carry no source at all (ADR-0046).

Every side emptied this way is named in `released_sides`, for the reason
[ADR-0051](0051-a-voided-result-is-named-before-it-is-lost.md) names a voided result: a write the
caller did not ask for is one whose effects have to be visible.

**An occupant refusal answers its own 409 code, one per rule.** `REQ-ELIGIBILITY-001` is a
disqualified team newly fielded, `REQ-ELIGIBILITY-002` a team with no `saison_teams` row for the
season, and `REQ-SPIELTAG-001` the clash above. Never `REQ-WIRING-001`'s code: its advice is
"reload the page", which is right for a season that has moved under the form and wrong for every
one of these, where the season has not moved at all.

**The form places the message on the side that caused it, and the code is what tells it which rule
fired.** A failure body is `{error_code, correlation_id}` and nothing else (ADR-0039), so the code
is the only channel — and it stays **one code per rule**, because "team1 is disqualified" and
"team2 is disqualified" are one failure mode and the code table's own rule is one code per mode.
The side is the client's to determine, which it can: the predicates are the ones `FormTeamPicker`
already evaluates to disable a team and put a chip on it, over the same data. A side it cannot
identify falls back to a toast, so a refusal is never swallowed.

**The frontend carries three pieces**, on whichever surface holds the form: disqualified teams
disabled in the picker with an inline label that is also in `textValue`, so search and screen
readers still find them; a live warning under the picker when the current payload holds a
disqualified team, which covers the pre-selected stored occupant that disabling cannot; and an
`actionError.ts` branch for each new code. The rules are surface-independent.

**`--check` reports the cross-document rules it cannot apply.** `report_relations` in
`fl_backend/app/core/constraints.py` counts the stored groups each one is broken by, alongside the
validators and the indexes, and its offenders count into the same verdict. It is reported and never
applied: the question `--check` exists to answer is whether the data satisfies a rule that is about
to be enforced, and a rule enforced at the write path leaves everything that predates it in place.

## Consequences

**A match write can now change a fixture on grounds that have nothing to do with the bracket.**
That is new, and it is the cost of the move. It is bounded — one Spieltag, sides with no `quelle`
only — and every one is reported, but a reader of `spiele` history will find a fixture emptied by a
save that never named it.

**A release destroys a result, and it is the only rule here that destroys anything.** The fixture
the team leaves loses its `ergebnis` and `elfmeterschiessen`, because they were scored against a
team no longer in it. The dry run of ADR-0051 names it before the save, and the undo toast covers
it after.

**Releases are applied before the resolution, on both paths.** A slot a release opens can be
refilled by the resolution that follows, so the reverse order would leave the season one pass
behind and the preview would name a different set of fixtures than the save moved.

**The write path gains a junction read inside its transaction**: sixteen rows, on a path that
already reads the season's fixtures, paid per match write rather than per page view. It reads
`saison_teams` directly rather than through `build_team_pipeline`, which skips match-fed seasons
and filters `inactive_since` — both of which would drop a row this rule must see. The fault variant
costs a second per-season junction read on the action-required route, which ADR-0047 already
flagged as the part of that route that grows with the archive.

**One accepted edge: swapping a stored disqualified occupant from one side to the other is
refused.** It counts as newly fielding under O1. Entering a historical season is therefore
field-first and disqualify-second, which is the order a season is actually recorded in anyway.

**The warned tier will read as an inconsistency, and it is the deliberate part.** Two teams that
both "should not be there" produce different outcomes: one is refused, the other merely noted. The
difference is that one is a fact somebody recorded and the other is a judgement about football.

**The one-per-Spieltag rule is about the matchday, never the season.** A team plays every round it
reaches, so the same club in a group fixture and in a semi-final is the ordinary case and must stay
free. Anything that widened this to the season would refuse the bracket.

**Enforcement leaves the past alone.** A stored violation predating this is not corrected by
anything and would only surface on the next edit of one of the two fixtures. That is why the check
is in `--check` rather than in a test: the answer changes with the data, not with the code.

**It does not make the bracket self-policing.** Nothing here stops an admin fielding a team that
lost every group match; that is the warned tier, and it stays a person's call.

## Alternatives considered

**Remove a disqualified team from the season, as the reference model does.** The clean answer
everywhere else, and it contradicts ADR-0033 head-on: no delete exists on `saison_teams`, a team's
matches and its standing row have to survive its disqualification, and the flag exists precisely so
the team keeps its row in the table while being unable to advance out of it (`_may_hold_a_platz`).
Reversing that would be a much larger decision than this one and would take the standings with it.

**Enforce eligibility in the picker only.** Cheapest, and it is a client-side rule with no server
behind it: a stale form, a second tab, or any request not made through the form places the team
anyway. It also cannot cover the occupant already stored in the slot, which is the case an admin is
most likely to meet.

**Refuse all three tiers, including the unqualified manual pick.** Symmetrical and wrong: whether a
team qualified is undecidable while the group phase runs, and the manual slot's intended use is
exactly the replacement of a team that did not qualify. It would refuse the feature.

**Report all tiers as derived faults and refuse nothing.** Consistent with ADR-0047's "derive, do
not store" and it gives up the one moment where the correction is free — the operator is looking at
the form, has the team list open, and can pick again. A fault list found later means reopening a
fixture whose date may have passed — and the occupancy clash, unlike the five reference faults, has
an obvious right answer that does not need a person.

**Refuse every clash, and let the admin empty the other fixture first.** Symmetrical, simpler to
implement, and it turns the most ordinary correction — a team was entered against the wrong
opponent — into a two-step procedure whose order matters. It also gives the admin a 409 for doing
the thing they meant to do.

**Move in every case, including a `quelle`-maintained side.** It reads as more consistent and it is
a write that does not hold: the resolution restores the occupant on the very next pass, quite
possibly inside the same request. A success response for a change that reverts itself is worse than
a refusal.

**Enforce the occupancy rule with a unique index.** Impossible rather than rejected, and worth
recording so nobody spends an afternoon on it: the team is in one of two embedded fields, so no key
spelling makes the two placements collide. A `$jsonSchema` validator is equally unable — it sees
one document.

**Widen `find_wiring_refusal` with the occupant rules.** It would need the membership map threaded
into a function whose whole contract is that it decides wiring from wiring, and it would make the
four existing rules' shared "skip a side with no source" preamble false for rules that apply
**only** to a side with no source.

**Per-side error codes, so the client needs no predicate of its own.** It would put the field in
the one channel a failure body has, and it doubles the code table for a distinction that is not a
failure mode. The codes are what make logs greppable; two codes meaning the same thing about
different fields is exactly the reuse the exceptions module forbids.
