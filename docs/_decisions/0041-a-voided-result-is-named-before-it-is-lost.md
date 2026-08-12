# ADR-0041 — A voided result is named before it is lost, by a dry run rather than a guess

**Status:** Accepted\
**Date:** 2026-08-06\
**Surface:** backend, frontend\
**Supersedes:** —\
**Superseded by:** —\
**Source:** Open item FB-14, the evaluation of this system against established tournament platforms;
the dry run replaces a static warning shipped the same day under a decision since retired, reversed after
seeing it on the page.

## Context

`resolve_bracket` recomputes a season's whole bracket on every match write and emits a
`SlotAdvancement` for each fixture whose occupant changed
(`fl_backend/app/api/spiele/services.py :: resolve_bracket`). Applying one clears four fields at
once (`fl_backend/app/api/spiele/crud.py :: advance_bracket_winners`): both sides are written with
their goals stripped, and `ergebnis` and `elfmeterschiessen` are set to `None`. That is correct and
ADR-0034 and ADR-0036 both require it — goals scored by a team the fixture does not hold are not that
fixture's result, and a shoot-out left behind would hand the slot below it a winner from a match
neither side played.

**The write is right and the report of it was incomplete.** The success message named the affected
fixtures in one sentence about the **Paarung** — an admin correcting a quarter-final read that a
later fixture's pairing moved, and was told nothing about the scoreline deleted from it. The
response carried `advanced_to` as a bare list of `spiel_nr`, so nothing distinguished a slot that
filled from empty — the ordinary, harmless case — from one whose recorded result the same
transaction destroyed.

Established platforms treat this as the moment that needs the operator's attention, and place their
intervention **before** the write: Challonge warns that an edit to a completed match affects
dependent matches and reopens them for a new score; Toornament locks a resulted match outright.
Neither route fits a system that stores no propagated advancement — the bracket is recomputed from
its wiring on every write, so there is no dependent match to reopen and nothing to go stale. What
survives from both is the principle: **the operator learns that a result will be destroyed, from
the surface that is about to destroy it.**

The first answer to that principle, since retired, had two halves. The response half was right
and this decision keeps it: the patch response distinguishes a fixture whose slot merely filled
from one that also lost an `ergebnis`. The warning half was static — a note on any fixture that
feeds another slot, saying results in the fixtures it feeds "can" be cleared by saving — and it was
argued for on a premise this decision rejects:

> Deciding exactly which downstream results a submitted payload would clear means running the
> resolution against the payload before accepting it, which is a preview endpoint and a second
> execution of the algorithm inside the request. A note that says what can happen costs nothing and
> is honest; a prediction that is right most of the time trains an operator to trust it the time it
> is wrong.

**Two of those three claims do not survive contact with the code.** `resolve_bracket` is already
pure: it takes a list of fixtures and a standings mapping and returns what every slot should hold,
with no I/O and no session. Running it against a payload is not a second execution of the algorithm
— it is the same function on a list built in memory, which is what `find_bracket_faults` already
does over every season on an admin route. And a "prediction that is right most of the time"
describes an approximation. This is not one: the resolution is deterministic over the season it is
handed, so a run against the payload is the save's own answer, computed without the write.

**The static warning as shipped was the thing that trains an operator to ignore it.** It fired
whenever the edited fixture feeds anything — which on a knockout bracket is most fixtures, most of
the time — and said a result "can" be cleared. On the season this was measured against, the common
edit is a kick-off time on a quarter-final that feeds a semi-final holding no result at all, and the
warning appeared every time and was right on none of them. The static half named the
false-alarm failure mode and then produced it by a different route: a warning that is almost always
a false alarm is scrolled past exactly as fast as one that is occasionally wrong.

**Its one remaining premise was that a preview needs a second endpoint**, with a second copy of the
write path's normalisation — `ergebnis` derived from the goals, the goals stripped from an
unresolved fixture, a shoot-out discarded outside a level knockout. That copy is the real risk, and
it is avoidable: the normalisation is extractable as a pure function, and then the preview and the
save cannot hold different opinions about what the payload means.

## Decision

**The warning is computed by a read-only dry run of the write path, and it names fixtures.**

`PATCH /spiele/{spiel_id}?dry_run=true` takes the same payload, runs the same refusals, applies the
same normalisation and resolves the same bracket — against a season assembled in memory — and
returns the same response model. It opens **no transaction and writes nothing**. The edit surface
calls it on a debounce as the draft's bracket-relevant fields settle, and renders a banner naming
exactly the fixtures a save would take a stored result from. No fixtures, no banner.

**The normalisation is extracted first, and that ordering is not incidental.**
`fl_backend/app/api/spiele/services.py :: apply_payload_to_spiel` is the single pure statement of
what a payload means, and the route handler states none of it for itself. A preview that normalised
differently from the save would name the wrong fixtures with total confidence, which is worse than
the warning it replaces.

**Every refusal runs on both paths, in one place.** A preview that succeeded where the save is
refused would promise a write that cannot happen. `judge` in the handler is called by both, so a
rule added to one is added to both by construction.

**`advance_bracket_winners` reports what it cleared, not only what it moved.** Each entry of
`advanced_to` carries the `voided_ergebnis` and `voided_elfmeterschiessen` the fixture held when the
resolution ran, both `null` when the slot merely filled from empty. The success message gives a
destroyed scoreline **its own sentence** — a moved `Paarung` and a deleted result are two facts, and
a reader told specifically that a pairing changed reasonably concludes the score did not.

**Every save offers an undo for fifteen seconds, and no save is preceded by a confirmation
dialog.** Confirmation and undo are alternatives, not companions: a dialog interrupts every save
to ask about a case that is usually harmless, and the thirty-first one is dismissed unread.

**The offer is not scoped to the destructive save**, over a narrower first draft that scoped it:
scoping answered "what did this destroy" and left "I did not mean to save that" with no answer at
all — which is the more common mistake, and the one noticed one second too late. It costs nothing
to widen, because with no other fixture affected the replay is the edited fixture's own pre-edit
payload, which is exactly what taking an edit back means. What the destructive case changes is the
**grade**: an ordinary save is a success that happens to be reversible, a save that deleted a
scoreline elsewhere is a warning that happens to be reversible, and the two must not look alike at
a glance.

The undo is **held by the client**, because nothing on the server holds a previous value (roadmap
BE-15) — the page that was looking at the season is the only place those results still exist. It
replays the edited fixture's pre-edit payload first, so the resolution restores the occupants, and
then each voided fixture's own payload, so its scoreline goes back after the bracket has stopped
moving.

**`deriveSpielDraftStatus` is the edit page's single contract**, and it is recorded here because
this is the decision that adds a surface to it. Every marker, badge, list, count and guard on the
page reads it (`fl_frontend/src/features/spiele/draftStatus.ts`); a new field is one descriptor
row; **no surface reads a draft field directly.** That property is what keeps the page cheap to
extend, and it is invisible in any one component — which is why it is written down rather than left
to be re-litigated by the first reader who finds a shorter route.

## Consequences

**The ordinary case gets no new noise.** Filling an empty semi-final slot from a quarter-final
result voids nothing, emits no second sentence, and shows no banner — because the fixture being
edited is the one being filled from, and it holds no result of its own to lose.

**A preview costs a request per settled edit, on an admin route.** One `spiele` read, one
`saison_teams` read, and a teams aggregation only where a slot seeds from a group — the same reads
the save makes, minus the writes. It is debounced and gated on the fixture being able to affect
anything at all, so a group-phase fixture that feeds nothing never issues one.

**The undo is bounded to the page session, and cannot be otherwise.** Reload the page and the
previous values are gone, because they were only ever in the browser. That is the honest shape of
an undo built on a system that records no writes, and it is why BE-15 carries the durable version.

**The undo restores the cause and the results, not the intervening history.** It replays payloads
through the ordinary write path, so a third party's edit landing between the save and the undo is
overwritten by it. Fifteen seconds is short enough that this is a narrow window and long enough to
read the sentence, which is the whole reason the duration is what it is.

**A partial undo is possible and is reported as one.** The replay stops at the first failure and
names how far it got, rather than reporting a success it did not achieve — a half-restored season
is a worse state than either end of it, and the admin has to know which end they are at.

**`dry_run` on a PATCH is unusual, and it is the price of the property that matters.** A verb that
writes nothing on one query parameter reads oddly against REST. The alternative spellings each
reintroduce a second code path, and preview-and-save agreement is the entire value here.

**The response shape is a breaking change**: `advanced_to` stops being a list of integers, which
reaches the patch response consumed by `fl_frontend/src/features/spiele/actions.ts`. The Zod mirror
and the regenerated `fl_backend/openapi.json` move in the same commit as the Pydantic models
([ADR-0033](0033-the-zod-mirror-is-checked-against-the-published-document.md)).

**It still does not preserve what is destroyed beyond the undo window.** The scoreline is gone once
the toast is; this makes its going visible, reversible for fifteen seconds, and no more. Who wrote
what and when is BE-15.

## Alternatives considered

**The static warning** — the retired first answer: a note on any fixture that feeds another slot,
stating the mechanism rather than the outcome. Reversed on measurement rather than aesthetics: on
this season it fires on most knockout edits and is correct on almost none of them. Its own argument
against imprecision applies to it.

**Lock a fixture that has been resulted, as Toornament does.** It removes the destructive edit by
removing the edit, and it is the wrong trade for a system whose entire bracket is derived: the
value ADR-0034 bought is that a corrected group result flows to the final with no manual
reconciliation, and a lock reintroduces exactly the manual step — unlock the round below, re-enter,
re-lock. It also solves a staleness problem this system does not have.

**A confirmation dialog before every save that would advance something.** It interrupts the common
case, which is a slot filling from empty and destroying nothing. Now that the dry run _can_ tell
the two apart, the narrower pairing — a dialog only on the destructive case — is still rejected: a
dialog is a cost paid at the moment of highest confidence, the admin has just decided to save, and
its value depends entirely on being rare. Undo moves the cost to the cases that actually went
wrong, and it is the only one of the two that helps when the admin was not paying attention, which
is the case worth designing for.

**Refuse the edit when it would void a result downstream.** It makes correcting a mistyped
quarter-final impossible without first deleting the semi-final result by hand, which is the
reconciliation ADR-0034 exists to remove, and it turns a data-entry correction into a multi-step
procedure whose order matters.

**Say nothing, on the ground that "aktualisiert" already covers it.** The message does not stop at
"aktualisiert": it names the `Paarung` as the thing that changed. A reader told specifically which
part moved reasonably concludes the other parts did not, so the sentence is more misleading than
silence would be.

**Build the preview as its own endpoint, `POST /spiele/{spiel_id}/preview`.** Cleaner as a URL and
worse in the only way that counts: it would take the payload model and re-derive the normalisation
and refusals beside it, and the day the two disagreed the warning would be confidently wrong.
Sharing a handler is what makes "the preview cannot lie" a structural property rather than a review
item.

**Compute the preview on the client from the loaded season.** No request at all, and it would mean
a second implementation of `resolve_bracket` in TypeScript — including the group-standings
certainty walk, which
[ADR-0035](0035-a-group-placing-is-ranked-by-one-chain-and-seeded-only-when-final.md) keeps off the
client precisely so there is one answer to who finished second.

**Report the voided result as a bracket fault.** It is not a fault: the write is correct, ADR-0034
requires it, and nothing needs correcting. Faults are contradictions a person must resolve
([ADR-0039](0039-a-bracket-fault-is-derived-on-demand.md)), and putting an ordinary consequence in
that list is how the list stops being read.

**Store the voided result so it can be restored after a reload.** The right answer to a larger
question — it needs a retention rule, a place to put it, and a decision about every other admin
write with the same gap. That is BE-15, and it is not smuggled in behind a toast.
