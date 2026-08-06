# ADR-0049 — Eligibility is refused where a team is newly fielded, and warned where the judgement is sporting

**Status:** Superseded
**Date:** 2026-08-06
**Surface:** backend, frontend
**Supersedes:** —
**Superseded by:** [ADR-0052](0052-a-team-is-fielded-once-per-spieltag.md)
**Source:** Open item FB-9, reported as a reproduction on 2026-08-06 and deferred the same day behind
FB-14's evaluation, which this records the verdict of: implement as recorded.

## Context

A team can reach a knockout slot by two routes and only one of them asks whether it is allowed to be
there.

**The seeded route is checked.** A slot fed by a `gruppe` source resolves through
`fl_backend/app/api/teams/services.py :: _may_hold_a_platz`, which excludes a disqualified team from
holding a placing at all, so the placings walk past it and the team below takes the place. That
predicate is the only eligibility rule in the system.

**The manual route is checked nowhere.** A side whose `quelle` is `None` is the admin's own
(ADR-0042), and every layer declines it in turn: the picker maps every team of the season without
reading the `is_disqualified` each one carries; `find_wiring_refusal`'s four rules each begin by
skipping a side with no source (ADR-0046); the handler `$set`s the side as submitted; the resolution
leaves a source-less slot alone by design; and `FLBracketFault` has no variant for an occupant, since
ADR-0047's five are contradictions between references. So a disqualified team that never qualified
from its group can be picked onto a semi-final, the save succeeds, and nothing anywhere says a word.

**The reference model does not have this hole, and the reason it does not is instructive.** On
platforms of the Toornament and Challonge class, and in federation administration software, eligibility
is a property of a _participant_ and is enforced where a participant enters the competition —
registration, check-in, lineup submission. A disqualified entrant stops being an entrant, so no
later stage can select it, and the bracket needs no rule of its own.

**That moment does not exist here.** ADR-0033 settled that a team never leaves a season: there is no
delete on `saison_teams`, and disqualification is the only way out — recorded as a flag _on the
junction row_ rather than as a removal from the entry list. The team therefore remains a selectable
participant for the whole season by deliberate design. The check the reference model performs once, at
the boundary, has no equivalent boundary in this system, which is precisely why the rule has to sit
where a team is fielded instead.

## Decision

Three tiers, and which tier a case lands in is decided by whether the fact is **declared** or
**sporting**.

**Refused: newly fielding a disqualified team.** `is_disqualified` is declared state, set by a person
and changed by no result, so a payload fielding such a team contradicts the season _as it stands at
the write_ — ADR-0046's class of rule, not the result-dependent class it rejected. The refusal is a
pure sibling of `fl_backend/app/api/spiele/services.py :: find_wiring_refusal` rather than a fifth
rule inside it: that function's contract is wiring and its input carries no membership data. It takes
the payload, the season and a membership map, reads the junction inside the caller's transaction, and
answers a distinct 409 code of its own, never `REQ-WIRING-001`'s — the advice differs, and "reload the
page" is wrong advice for this one. Two rules:

- **O1 — a disqualified team is never _newly_ fielded.** Resubmitting the stored occupant unchanged
  passes. Without that clause a fixture already holding a disqualified team becomes uneditable,
  including by the very edit that would resolve it.
- **O2 — a fielded team holds a `saison_teams` row for the fixture's season.** A missing row is a
  dangling reference rather than an odd draw, and only a stale form or a hand-crafted request produces
  one.

**Reported: an occupant disqualified after being placed.** A sixth `FLBracketFault` variant carrying
the fixture, the team id and the team name — the name because the save's message has no `spiele` list
to join against, and it cannot go stale because faults are derived per request off a field the rename
fan-out maintains (ADR-0028, rule 3). Derived over the _effective_ sides of knockout fixtures whose
effective result is `None`: a played fixture is history and reports nothing, and a since-disqualified
winner reports on the fixture it arrives in. **The slot is never changed by this** — only a person
chooses between a forfeit and a replacement.

**Warned and never refused: a manual pick that did not qualify from its group.** Undecidable while the
groups are still running, and on the one slot type that can hold it, frequently deliberate — a
replacement team is the manual mode's intended use (ADR-0042). The form states that the system does
not judge sporting qualification on a manual side. **No computed "nicht qualifiziert" badge**: it
would re-implement the tiebreak chain on the client and produce a second answer to who finished
second.

**The frontend carries three pieces**, on whichever surface holds the form: disqualified teams
disabled in the picker with an inline label that is also in `textValue`, so search and screen readers
still find them; a live warning under the picker when the current payload holds a disqualified team,
which covers the pre-selected stored occupant that disabling cannot; and an `actionError.ts` branch
for the new code. The rules are surface-independent — the modal today, FE-10's page once it exists.

## Consequences

**One accepted edge: swapping a stored disqualified occupant from one side to the other is refused.**
It counts as newly fielding under O1. Entering a historical season is therefore field-first and
disqualify-second, which is the order a season is actually recorded in anyway.

**The write path gains a junction read inside its transaction.** `SaisonTeamsCollection` already
exists in `fl_backend/app/core/dependencies.py`, so this is one more read on a path that already reads
the season's fixtures — small at sixteen junction rows, and it is a cost paid per match write rather
than per page view.

**The fault variant costs a per-season junction read on the action-required route**, which ADR-0047
already flagged as the part of that route that grows with the archive. It reads the junction directly
for `is_disqualified` rather than going through `build_team_pipeline`, which skips match-fed seasons
and filters `inactive_since`.

**The warned tier will read as an inconsistency, and it is the deliberate part.** Two teams that both
"should not be there" produce different outcomes: one is refused, the other merely noted. The
difference is that one is a fact somebody recorded and the other is a judgement about football.

**It does not make the bracket self-policing.** Nothing here stops an admin fielding a team that lost
every group match; that is the warned tier, and it stays a person's call.

## Alternatives considered

**Remove a disqualified team from the season, as the reference model does.** The clean answer
everywhere else, and it contradicts ADR-0033 head-on: no delete exists on `saison_teams`, a team's
matches and its standing row have to survive its disqualification, and the flag exists precisely so
the team keeps its row in the table while being unable to advance out of it (`_may_hold_a_platz`).
Reversing that would be a much larger decision than this one and would take the standings with it.

**Enforce in the picker only.** Cheapest, and it is a client-side rule with no server behind it: a
stale form, a second tab, or any request not made through the form places the team anyway. It also
cannot cover the occupant already stored in the slot, which is the case an admin is most likely to
meet.

**Refuse all three tiers, including the unqualified manual pick.** Symmetrical and wrong: whether a
team qualified is undecidable while the group phase runs, and the manual slot's intended use is
exactly the replacement of a team that did not qualify. It would refuse the feature.

**Report all three as derived faults and refuse nothing.** Consistent with ADR-0047's "derive, do not
store" and it gives up the one moment where the correction is free — the operator is looking at the
form, has the team list open, and can pick again. A fault list found later means reopening a fixture
whose date may have passed.

**Widen `find_wiring_refusal` with a fifth rule.** It would need the membership map threaded into a
function whose whole contract is that it decides wiring from wiring, and it would make the four
existing rules' shared "skip a side with no source" preamble false for one of them — the rule that
applies _only_ to a side with no source.
