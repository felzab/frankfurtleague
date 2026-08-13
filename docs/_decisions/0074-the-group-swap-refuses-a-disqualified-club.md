# ADR-0074 — The group swap refuses moving a disqualified club onto fixtures dated after its disqualification

**Status:** Accepted\
**Date:** 2026-08-13\
**Surface:** backend\
**Supersedes:** —\
**Superseded by:** —\
**Source:** The A5 domain-refusals review, gap G4; decision of 2026-08-13, taken against that review's own recommendation.

## Context

`fl_backend/app/api/saisons/admin_router.py :: _rewrite_gruppenphase_sides` writes `spiele` documents
directly, inside the swap's transaction, without passing `patch_spiel_data`. So the swap moves a club
onto its partner's group fixtures while consulting none of the occupant rules
[ADR-0042](0042-a-team-is-fielded-once-per-spieltag.md) put on the match write path — including
`REQ-ELIGIBILITY-001`, which refuses newly fielding a disqualified club on a fixture dated on or
after the day its disqualification took effect.

The result was one state refused by one endpoint and produced by another. A disqualified club keeps
its junction row and its group, so `find_gruppe_swap_refusal`'s five checks saw nothing wrong with it
as a swap partner, and the exchange put it on fixtures `patch_spiel_data` would have refused
one at a time.

**The window is narrower than it first reads.** `REQ-SWAP-004` already refuses a swap once either club
has a group fixture that has _taken place_, and `_has_taken_place` counts a cancellation as well as a
result. Disqualifying a club is usually followed by cancelling its remaining group fixtures, which
closes the swap window. What is left is a club disqualified before any of its group fixtures was
played or cancelled — a club withdrawing early, which is a real scenario rather than a contrived one.

**The A5 review recommended the opposite**, and recorded its reasoning: declare the state in
`UNENFORCED` rather than refuse it, on the ground that declaring fits the existing grain and that a
club disqualified mid-season could then no longer be swap-corrected. That is why this record exists —
the next reader will find a written argument for the other answer.

## Decision

**`find_gruppe_swap_refusal` refuses an exchange that would move a disqualified club onto a group
fixture dated on or after the day its disqualification took effect** (`REQ-SWAP-006`). The count comes
from `fl_backend/app/api/teams/services.py :: fixtures_newly_fielding_a_disqualified_club`, which
reads the same fixture list `REQ-SWAP-004` and the rewrite already read, so the rule and the write
cannot disagree about which fixtures move.

**The refusal reaches forwards and never backwards.** A fixture dated before the disqualification is
untouched, because ADR-0042's line is that enforcement leaves the past alone and a person chooses
between a forfeit and a replacement. **An undated fixture counts as forwards**: it can still be given
a date after the disqualification, and the swap is what would put the club there.

**A club standing on its own fixture is not newly fielded.** The exchange moves that side to the
partner, so the disqualified club arrives nowhere new. This is `REQ-ELIGIBILITY-001`'s O1 clause
applied to the swap, and it is what stops the rule refusing a state it did not create.

**It is answered last, after `REQ-SWAP-005`.** Both are repairable, and this is the more expensive
repair — lifting a disqualification and re-applying it, against moving one fixture.

**The guard is acceptable because it has a real escape**, which is the test
[ADR-0069](0069-the-activation-guard-has-an-override.md) sets. `AdminTeamEditForm` can lift a
disqualification — its own message is _"Die Disqualifikation ist aufgehoben"_ — and the record is a
nullable `disqualifikation` field, so the correction costs a two-step path rather than being blocked
outright. **A guard with no escape would not have been acceptable.**

## Consequences

**Correcting a mid-season disqualified club's group is now three operations instead of one**: lift,
swap, re-apply. That is the cost the review named when it recommended declaring instead, and it is
accepted rather than dismissed. The refusal's own message names the sequence, so an admin who meets
it is not left to work it out.

**The disqualification record briefly reads as absent during the repair.** Between the lift and the
re-apply the club shows as competing, and the public team page says so. Nothing here makes that
window atomic, and a swap failing between the two steps leaves the club looking eligible until
somebody finishes the sequence.

**The swap now reads `disqualifikation` off the junction rows it already loads**, and the group
fixture projection gains `datum`. Both are the same reads, one field wider.

**It does not close the whole of G4.** `_rewrite_gruppenphase_sides` still bypasses every other
occupant rule on the match write path; this closes only the eligibility one. `REQ-ELIGIBILITY-002`
cannot be reached through the swap — `REQ-SWAP-001` requires both clubs to hold junction rows — but
that is an argument about today's code rather than a guarantee the swap enforces.

## Alternatives considered

**Declare the state in `UNENFORCED` and leave the swap alone.** The A5 review's recommendation, on
the ground that `find_disqualified_occupants` already reports every resulting fixture at
`/admin/action_required`, so the state is contained rather than hidden, and that ADR-0042's warned
tier is the existing home for "this looks wrong and a person decides". Rejected: the stated goal
is to allow exactly what is necessary to run the league and no more, and one endpoint
producing a state another endpoint refuses is the inconsistency that goal is aimed at. Reporting a
state after the fact is weaker than not creating it when the escape is two clicks away.

**Refuse any swap involving a disqualified club, whatever the dates.** The simpler rule, and it needs
no fixture read at all. Rejected: it would refuse moving a club whose fixtures all predate its
disqualification, which contradicts ADR-0042 directly and would make a historical season — entered
field-first and disqualified-second, the order ADR-0042 records — unswappable for a reason that has
nothing to do with the swap.

**Route the swap's writes through `patch_spiel_data` so every occupant rule applies.** The answer
that would close G4 entirely. Rejected as out of proportion: that path resolves the bracket, judges
Spieltag occupancy, releases sides and voids results (ADR-0034, ADR-0041), none of which a group
exchange means to do, and [ADR-0062](0062-a-group-change-is-a-swap-or-it-is-refused.md) settled the
swap as a single transaction rewriting two junction rows and the sides that follow them.
