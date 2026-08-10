# ADR-0038 — The write path refuses wiring the season cannot hold, and the form offers only what it can

**Status:** Accepted\
**Date:** 2026-08-05\
**Surface:** backend, frontend\
**Supersedes:** —\
**Superseded by:** —\
**Source:** Open item FB-12, plus my report of two reproductions against the running admin
form on 2026-08-05.

## Context

ADR-0034 made the bracket resolve itself from `teamN_quelle` and, deliberately, enforced no
referential integrity at the endpoint: the admin form took a match number as typed, and the
resolution contained a reference it could not honour by leaving the slot alone. The containment is
right for stored data — erasing a team over a typo destroys more than it reports — but at the write
path it meant `PATCH /spiele/{spiel_id}` accepted wiring no season can hold, and said nothing.

Two reproductions, both mine against season 2026:

- **One match's winner was wired into two fixtures.** A semi-final's source was re-pointed at a
  quarter-final whose winner already fed the other semi-final. The write succeeded, and the bracket
  then stated that one club would play two semi-finals.
- **A team was picked onto a side a source maintains.** The resolution reverted it inside the same
  request — ADR-0034's rule working as specified — so the admin saw a success toast and no effect.
  A write that reports success and does not stick is worse than a refusal.

Both were reachable because the form's controls were independent: every team was pickable whatever
the side's source said, and a source was a number typed into a field, checked by nobody. The state
FB-12 opened on — a knockout side with no team and no source, which nothing resolves and nothing
reports — was reachable by exactly the same independence.

What the admin panels of established competition software do with a bracket slot: the slot's
_filling mode_ is the primary control, an automatically-filled slot is read-only, and a manual
override is an explicit mode switch — never a value typed over the automation.

## Decision

**`PATCH /spiele/{spiel_id}` refuses, with a 409 (`REQ-WIRING-001`), any payload whose wiring the
season cannot hold.** `fl_backend/app/api/spiele/services.py :: find_wiring_refusal` decides it,
inside the write's transaction and before anything is written. Four rules, each a contradiction
rather than a preference:

1. **A Gruppenphase fixture carries no wiring.** Its sides are drawn by the schedule; the mechanism
   a `quelle` names does not exist in that phase.
2. **A `spiel` source names a knockout match of the same season in a strictly earlier round.** A
   number the season does not have resolves to nothing forever; a same-round or later-round source —
   the fixture itself included — asks a match to be decided by one that follows it. Strictly-earlier
   also makes a cycle inexpressible through the endpoint. A group match never feeds a slot
   (ADR-0034: the first knockout round is seeded from the standings).
3. **One outcome fills one slot.** A `(spiel_nr, ausgang)` or `(gruppe, platz)` may feed at most one
   side of one fixture per season.
4. **A side with a source belongs to the resolution.** A submitted team that differs from the stored
   occupant is refused rather than silently reverted.

**The form offers only what the write path accepts, and the source decides what is editable.**
`FormTeamPicker` is source-first: a Gruppenphase fixture shows a team picker and no source controls;
a knockout side shows how it is filled — Sieger/Verlierer of a match, a group placing, or Manuell —
and only the manual answer shows a team picker. A side with a source shows its occupant read-only. A
source is picked, never typed: the match list holds the season's legal feeders minus the outcomes
other slots already take, and the placing list is bounded by the group and filtered the same way.
The season's fixtures reach the dialog through the admin context, which already carries the teams
for the same reason.

**The one legal state that stays broken by default is reported.** A knockout side with no team and
no source is the admin's own and is maintained by nobody (ADR-0034), so it is a seventh
action-required category — "Offene Besetzung" — in both halves of that surface: the `$or` arm in
`fl_backend/app/api/spiele/admin_router.py :: get_spiele_action_required` and the client
categorisation in `fl_frontend/src/features/admin/utils.ts :: categorizeActionRequired`. Scoped to
`saison_phase != "gruppenphase"`, because an unfilled group schedule is not an orphaned slot. It
lives in the action-required list rather than on a bracket page because the list exists and is
where an admin already looks; a wiring overview is FB-11's larger question and is not settled here.

**The resolution's containment is untouched.** `resolve_bracket` still leaves alone what it cannot
look up: a season hand-edited in Compass never passed through the endpoint, and the two boundaries
serve different callers.

## Consequences

**ADR-0034's "referential integrity is not enforced" consequence is narrowed, not reversed.** It
holds for the resolution and for hand-edited data, and not for the endpoint. The decision that ADR
records — the reference model, the resolution, the containment — stands, which is why this ADR
complements rather than supersedes it.

**A stale form is an explicit 409 rather than a silent self-heal.** Editing a venue on a fixture
whose occupant the resolution moved since the page loaded submits the stale occupant beside the
source, and rule 4 refuses it. The silent path — the write succeeds and the resolution re-reverts the
side in the same transaction — is invisible, and indistinguishable from the reproduction above. The
German message tells the admin to reload; the English detail names the rule in the log.

**The write path reads the season one extra time per edit.** The refusal validates against the
season as the transaction sees it, before the write; the resolution re-reads after. About thirty
documents on an admin-only path, and the price of refusing before mutating.

**The rules stop at contradictions.** Nothing enforces the draw's conventions — that a `gruppe`
reference appears only in the season's first knockout round, or that a fixture is fed by exactly two
matches of the round directly before. Those describe how this league draws a bracket, not what a
season can hold, and refusing them would refuse a legitimately odd draw (a third-place play-off fed
across a round, a short season entering at the semi-finals).

**A fixture edited outside its season's context degrades, and does not misoffer.** The
action-required route spans seasons while the admin context carries one, so a match from another
season finds no feeder matches there and the match-fed answers are simply absent; the manual and
group answers still work. The same mismatch already applied to the team list.

**Both editor routes serialise the season's fixtures into the admin context.** The match picker is
why the dialog finally holds its season — the cost ADR-0034 recorded as the reason the form took a
typed number.

## Alternatives considered

**Keep the silent revert and only fix the form.** The form cannot cover the second tab, the stale
page, or a concurrent admin; the reproduction where a success toast reported a write that did not
stick would remain reachable. The refusal is what makes the contract honest — the form filtering is
UX over it, not the enforcement.

**422 with field errors instead of 409.** Nothing about the payload is malformed; the same request
would succeed against a different season state. That is precisely `DocumentConflictException`'s
distinction, and the client already routes 409s to the toast rather than to fields.

**Refuse inside `resolve_bracket` instead of beside it.** The resolution runs over stored data on
every write, including data that never passed through the endpoint; refusing there would take an
unrelated admin edit down over a hand-edited document — the exact failure the containment exists to
prevent.

**Enforce the full draw convention** — group placings only in the first knockout round, exactly two
feeders per fixture. Rejected above, in Consequences: those rules have no contradiction behind them,
and every rule added here is a legitimate season someone cannot enter.

**A wiring overview page with the validation on it** (FB-11's shape). It answers a different
question — reviewing a whole draw — and leaves every rule unenforced at the endpoint that actually
takes the writes. It remains worth building; it is not this.

**Surface the orphaned slot in the save's toast rather than the action-required list.** The toast is
the reporting channel that already exists for bracket faults, and it is also the channel FB-13
records as insufficient — computed on a write, stored nowhere, gone with the toast. An orphaned slot
is durable state, so it belongs on the surface an admin can re-ask.
