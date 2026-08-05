# ADR-0048 — A resolution that voids a stored result names it, and the edit surface says so first

**Status:** Accepted
**Date:** 2026-08-06
**Surface:** backend, frontend
**Supersedes:** —
**Superseded by:** —
**Source:** Open item FB-14, the evaluation of this system against established tournament platforms.

## Context

`resolve_bracket` recomputes a season's whole bracket on every match write and emits a
`SlotAdvancement` for each fixture whose occupant changed
(`fl_backend/app/api/spiele/services.py :: resolve_bracket`). Applying one clears four fields at once
(`fl_backend/app/api/spiele/crud.py :: advance_bracket_winners`): both sides are written with their
goals stripped, and `ergebnis` and `elfmeterschiessen` are set to `None`. That is correct and ADR-0042
and ADR-0044 both require it — goals scored by a team no longer in the fixture are not that fixture's
result, and a shoot-out left behind would hand the slot below it a winner from a match neither side
played.

**The write is right and the report of it is incomplete.** `fl_frontend/src/features/spiele/utils.ts ::
formatSpielUpdateMessage` names the affected fixtures in one sentence about the **Paarung** — "Die
Paarungen in den Spielen 30 und 31 wurden ebenfalls aktualisiert". An admin correcting a
quarter-final therefore reads that a later fixture's pairing moved, and is told nothing about the
scoreline that was deleted from it. The response carries `advanced_to` as a list of `spiel_nr` and
nothing distinguishes a slot that filled from empty — the ordinary, harmless case — from one whose
recorded result the same transaction destroyed.

Two established platforms treat this as the moment that needs the operator's attention, and both
place their intervention **before** the write rather than after it. Challonge warns on an edit to a
completed match that dependent matches are affected and that the match "will reward a different
participant as the winner", and reopens the dependent match so it requires a new score. Toornament
takes the stricter route and locks a match that has been reached or resulted, so the destructive edit
cannot be made without first undoing the round above it.

Neither route is available here unchanged. This system stores no propagated advancement to reconcile
— the bracket is recomputed from its wiring on every write — so there is no dependent match to reopen
and nothing that could go stale. What survives from both is the principle: **the operator learns that
a result will be destroyed, from the surface that is about to destroy it.**

## Decision

**An advancement that voids a stored result is reported as its own class.** The write path
distinguishes a fixture whose slot merely filled or emptied from one that also had an `ergebnis` at
the moment the resolution ran, and the patch response carries the distinction rather than one flat
list of numbers. Both schema mirrors and `fl_backend/openapi.json` move with it (ADR-0040).

**The success message names the destroyed results separately from the moved pairings.** A sentence
about a `Paarung` describes a slot changing occupant; a result that was cleared is a different fact
about a different thing and gets its own sentence naming the fixtures it happened to. The wording
belongs to `fl_frontend/src/features/spiele/utils.ts :: formatSpielUpdateMessage`, which already
serves this message.

**The edit surface warns before the write, and warns statically.** A fixture that feeds another slot
is already derivable in the form — `listFeederSpiele` and `collectUsedQuelleKeys` compute the season's
wiring for the source pickers — so an edit that changes the result of a fixture something else is fed
by carries a note saying that results recorded in the fixtures it feeds can be cleared by saving.
**It does not simulate the resolution to predict which.** The warning states the mechanism; the
response states the outcome.

## Consequences

**The ordinary case gets no new noise.** Filling an empty semi-final slot from a quarter-final result
voids nothing, emits no second sentence, and shows no warning — because the fixture being edited is
the one being filled from, and it holds no result of its own to lose.

**The warning is imprecise on purpose, and will sometimes fire where nothing is destroyed.** Deciding
exactly which downstream results a submitted payload would clear means running the resolution against
the payload before accepting it, which is a preview endpoint and a second execution of the algorithm
inside the request. A note that says what can happen costs nothing and is honest; a prediction that is
right most of the time trains an operator to trust it the time it is wrong.

**The response grows a shape, and the mirror pass pays for it.** `advanced_to` stops being a bare list
of integers, which is a breaking change to the patch response consumed by
`fl_frontend/src/features/spiele/actions.ts`. It lands with the schema batch rather than alone.

**It does not preserve the destroyed result.** The scoreline is still gone, and this decision only
makes its going visible. Keeping it is a history question — who wrote what, when, and what it replaced
— which this repository answers nowhere and which is larger than one message.

## Alternatives considered

**Lock a fixture that has been resulted, as Toornament does.** It removes the destructive edit by
removing the edit, and it is the wrong trade for a system whose entire bracket is derived: the value
ADR-0042 bought is that a corrected group result flows to the final with no manual reconciliation, and
a lock reintroduces exactly the manual step — unlock the round below, re-enter, re-lock. It also
solves a staleness problem this system does not have.

**A confirmation dialog before every save that would advance something.** It interrupts the common
case, which is a slot filling from empty and destroying nothing, and it cannot tell the two apart
without the preview run rejected above. An interruption that fires mostly on harmless saves is
dismissed unread by the second week.

**Say nothing, on the ground that "aktualisiert" already covers it.** The message does not stop at
"aktualisiert": it names the `Paarung` as the thing that changed. A reader told specifically which
part moved reasonably concludes the other parts did not, so the sentence is more misleading than
silence would be.

**Refuse the edit when it would void a result downstream.** It makes correcting a mistyped
quarter-final impossible without first deleting the semi-final result by hand, which is the
reconciliation ADR-0042 exists to remove, and it turns a data-entry correction into a multi-step
procedure whose order matters.

**Store the voided result so it can be restored.** The right answer to a different question, and the
larger one: it needs a retention rule, a place to put it, and a decision about every other admin write
that has the same gap. Recorded as its own roadmap entry rather than smuggled in behind a toast.
