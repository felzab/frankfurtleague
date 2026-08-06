# ADR-0051 — A voided result is named before it is lost, by a dry run rather than a guess

**Status:** Accepted
**Date:** 2026-08-06
**Surface:** backend, frontend
**Supersedes:** [ADR-0048](0048-a-voided-result-is-named-not-implied.md)
**Superseded by:** —
**Source:** Open item FB-14, and the owner's verdict on ADR-0048's warning after seeing it on the page.

## Context

[ADR-0048](0048-a-voided-result-is-named-not-implied.md) settled that an admin must learn a stored
result is about to be destroyed **from the surface that is about to destroy it**, and shipped two
halves of that. The first half was right and stands: the patch response distinguishes a fixture whose
slot merely filled from one that also lost an `ergebnis`. The second half was a static warning, and it
was argued for on a premise this decision rejects:

> Deciding exactly which downstream results a submitted payload would clear means running the
> resolution against the payload before accepting it, which is a preview endpoint and a second
> execution of the algorithm inside the request. A note that says what can happen costs nothing and is
> honest; a prediction that is right most of the time trains an operator to trust it the time it is
> wrong.

**Two of those three claims do not survive contact with the code.** `resolve_bracket`
(`fl_backend/app/api/spiele/services.py :: resolve_bracket`) is already pure: it takes a list of
fixtures and a standings mapping and returns what every slot should hold, with no I/O and no session.
Running it against a payload is not a second execution of the algorithm — it is the same function on a
list built in memory, which is what `find_bracket_faults` already does over every season on an admin
route. And a "prediction that is right most of the time" describes an approximation. This is not one:
the resolution is deterministic over the season it is handed, so a run against the payload is the
save's own answer, computed without the write.

**The warning as shipped is the thing that trains an operator to ignore it.** It fires whenever the
edited fixture feeds anything — which on a knockout bracket is most fixtures, most of the time — and
says a result "can" be cleared. On the season this was measured against, the common edit is a kick-off
time on a quarter-final that feeds a semi-final holding no result at all, and the warning appears
every time and is right on none of them. ADR-0048 named the failure mode and then produced it by a
different route: a warning that is almost always a false alarm is scrolled past exactly as fast as one
that is occasionally wrong.

**Its one remaining premise was that a preview needs a second endpoint**, with a second copy of the
write path's normalisation — `ergebnis` derived from the goals, the goals stripped from an unresolved
fixture, a shoot-out discarded outside a level knockout. That copy is the real risk, and it is
avoidable: the normalisation is extractable as a pure function, and then the preview and the save
cannot hold different opinions about what the payload means.

## Decision

**The warning is computed by a read-only dry run of the write path, and it names fixtures.**

`PATCH /spiele/{spiel_id}?dry_run=true` takes the same payload, runs the same refusals, applies the
same normalisation and resolves the same bracket — against a season assembled in memory — and returns
the same response model. It opens **no transaction and writes nothing**. The edit surface calls it on
a debounce as the draft's bracket-relevant fields settle, and renders a banner naming exactly the
fixtures a save would take a stored result from. No fixtures, no banner.

**The normalisation is extracted first, and that ordering is not incidental.**
`fl_backend/app/api/spiele/services.py :: apply_payload_to_spiel` is the single pure statement of what
a payload means, and the route handler states none of it for itself. A preview that normalised
differently from the save would name the wrong fixtures with total confidence, which is worse than the
warning it replaces.

**Every refusal runs on both paths, in one place.** A preview that succeeded where the save is refused
would promise a write that cannot happen. `judge` in the handler is called by both, so a rule added to
one is added to both by construction.

**`advance_bracket_winners` reports what it cleared, not only what it moved.** Each entry of
`advanced_to` carries the `voided_ergebnis` and `voided_elfmeterschiessen` the fixture held when the
resolution ran, both `null` when the slot merely filled from empty. The success message gives a
destroyed scoreline **its own sentence** — a moved `Paarung` and a deleted result are two facts, and a
reader told specifically that a pairing changed reasonably concludes the score did not.

**A save that destroyed something offers an undo for fifteen seconds, and there is no confirmation
dialog anywhere on the page.** Confirmation and undo are alternatives, not companions: a dialog
interrupts every save to ask about a case that is usually harmless, and the thirty-first one is
dismissed unread. The undo is **held by the client**, because nothing on the server holds a previous
value (roadmap BE-15) — the page that was looking at the season is the only place those results still
exist. It replays the edited fixture's pre-edit payload first, so the resolution restores the
occupants, and then each voided fixture's own payload, so its scoreline goes back after the bracket
has stopped moving.

**`deriveSpielDraftStatus` is the edit page's single contract**, and it is recorded here because this
is the decision that adds a surface to it. Every marker, badge, list, count and guard on the page
reads it (`fl_frontend/src/features/spiele/draftStatus.ts`); a new field is one descriptor row; **no
surface reads a draft field directly.** That property is what keeps the page cheap to extend, and it
is invisible in any one component — which is why it is written down rather than left to be
re-litigated by the first reader who finds a shorter route.

## Consequences

**A preview costs a request per settled edit, on an admin route.** One `spiele` read, one
`saison_teams` read, and a teams aggregation only where a slot seeds from a group — the same reads the
save makes, minus the writes. It is debounced and gated on the fixture being able to affect anything
at all, so a group-phase fixture that feeds nothing never issues one.

**The undo is bounded to the page session, and cannot be otherwise.** Reload the page and the previous
values are gone, because they were only ever in the browser. That is the honest shape of an undo built
on a system that records no writes, and it is why BE-15 carries the durable version.

**The undo restores the cause and the results, not the intervening history.** It replays payloads
through the ordinary write path, so a third party's edit landing between the save and the undo is
overwritten by it. Fifteen seconds is short enough that this is a narrow window and long enough to
read the sentence, which is the whole reason the duration is what it is.

**A partial undo is possible and is reported as one.** The replay stops at the first failure and names
how far it got, rather than reporting a success it did not achieve — a half-restored season is a worse
state than either end of it, and the admin has to know which end they are at.

**`dry_run` on a PATCH is unusual, and it is the price of the property that matters.** A verb that
writes nothing on one query parameter reads oddly against REST. The alternative spellings each
reintroduce a second code path, and preview-and-save agreement is the entire value here.

**The response shape is a breaking change**, as ADR-0048 anticipated: `advanced_to` stops being a list
of integers. The Zod mirror and the regenerated `fl_backend/openapi.json` move in the same commit as
the Pydantic models ([ADR-0040](0040-the-zod-mirror-is-checked-against-the-published-document.md)).

**It still does not preserve what is destroyed beyond the undo window.** The scoreline is gone once
the toast is; this makes its going visible, reversible for fifteen seconds, and no more. Who wrote
what and when is BE-15.

## Alternatives considered

**Keep ADR-0048's static warning.** It is the decision being reversed, and the reason is measured
rather than aesthetic: on this season it fires on most knockout edits and is correct on almost none of
them. Its own argument against imprecision applies to it.

**Add a confirmation dialog to the destructive case, now that the destructive case can be identified.**
The obvious pairing, and the owner's call is that it is the wrong one. A dialog is a cost paid at the
moment of highest confidence — the admin has just decided to save — and its value depends entirely on
being rare. Undo moves the cost to the cases that actually went wrong, and it is the only one of the
two that helps when the admin was not paying attention, which is the case worth designing for.

**Build the preview as its own endpoint, `POST /spiele/{spiel_id}/preview`.** Cleaner as a URL and
worse in the only way that counts: it would take the payload model and re-derive the normalisation and
refusals beside it, and the day the two disagreed the warning would be confidently wrong. Sharing a
handler is what makes "the preview cannot lie" a structural property rather than a review item.

**Compute the preview on the client from the loaded season.** No request at all, and it would mean a
second implementation of `resolve_bracket` in TypeScript — including the group-standings certainty
walk, which [ADR-0043](0043-a-group-placing-is-ranked-by-one-chain-and-seeded-only-when-final.md)
keeps off the client precisely so there is one answer to who finished second.

**Report the voided result as a bracket fault.** It is not a fault: the write is correct, ADR-0042
requires it, and nothing needs correcting. Faults are contradictions a person must resolve
([ADR-0047](0047-a-bracket-fault-is-derived-on-demand.md)), and putting an ordinary consequence in
that list is how the list stops being read.

**Store the voided result so the undo survives a reload.** The right answer to a larger question — it
needs a retention rule, a place to put it, and a decision about every other admin write with the same
gap. That is BE-15, and it is not smuggled in behind a toast.
