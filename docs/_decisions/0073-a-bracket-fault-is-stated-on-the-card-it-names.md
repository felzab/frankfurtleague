# ADR-0073 — A bracket fault is derived on demand, and its reason is stated on the card it names

**Status:** Accepted\
**Date:** 2026-08-13\
**Surface:** backend, frontend\
**Supersedes:** ADR-0039\
**Superseded by:** —\
**Source:** Two independent reviews of `product-work-august` found the shipped per-card placement
contradicting what ADR-0039 and ADR-0044 both state; recording the placement rather than reverting
it, my instruction, 2026-08-13.

## Context

[ADR-0039](0039-a-bracket-fault-is-derived-on-demand.md) settled how a derived bracket fault reaches
an admin, and decided where its reason is rendered:

> **The reasons are rendered above the card grid, not on each card.** A card is a `role="listitem"`
> of the panel's `role="list"`, and a wrapper holding a note and a card would sit between the two and
> sever that relationship. Every sentence opens with the match number the card leads with.

[ADR-0044](0044-a-triage-list-is-ordered-by-what-blocks-play.md) carried that placement forward and
added a clause of its own — the triage page "adds no variant, no slot and no wrapper" to the card.

On 2026-08-08 the reason moved onto the card and stayed there.
`fl_frontend/src/features/spiele/components/collections/SpielCardsList.tsx` builds a per-fixture
wrapper for a faulted fixture, and `fl_frontend/src/features/spiele/components/ui/SpielCard.tsx`
gained an `asListitem` boolean so the card can give its `role="listitem"` to that wrapper. Nothing
recorded the reversal, and two further copies of the old position did not survive it either:
`ACTION_REQUIRED_LABELS`'s description for the category tells the admin in German that
`"Der Grund steht auf der Karte"`, and `fl_frontend/src/features/spiele/utils.ts ::
describeBracketFaultOnCard` exists for no other purpose than wording a note that sits beside a
fixture.

**The panel had a cost the argument did not weigh.** Its sentences came from `formatBracketFault`,
which opens each with "Spiel N" because the same wording serves the save's toast, where no fixture is
in sight. On a grid that number is the card's own leading line, so an admin read a block of sentences
and then matched match numbers back to cards by eye — the work a card exists to save.

**The structural premise was stricter than the specification it appealed to.** WAI-ARIA defines an
owned element as "any DOM descendant of the element, any element specified as a child via
`aria-owns`, or any DOM descendant of the owned child", so an element standing between a `list` and
its `listitem`s does not by itself sever the two. What severs them is a note rendered as a bare
non-`listitem` child of the list, or a second `listitem` nested inside the first — and both are
avoidable by moving the role rather than adding one.

PRE-1's ladder puts the code above the record, so this records the placement rather than reverting
it.

## Decision

**Everything ADR-0039 decided stands except where a reason is rendered.** Restated here, because this
record replaces it:

**A bracket fault is derived on read and stored nowhere.** `fl_backend/app/api/spiele/crud.py ::
find_bracket_faults` runs the resolution over every season and keeps only what it reported. Both it
and the write path go through `_resolve_one_saison`, so the list an admin re-asks for and the list a
save reports are the same list computed the same way.

**Every fault is reported, through one model.** `FLBracketFault` is a union tagged on `reason`, each
variant carrying exactly the fields its own fault needs, and `spiel_id` on all of them because a
fault joins to its match by id while `spiel_nr` repeats across seasons. A flat model would express a
cycle carrying a `platz`, which nothing could refuse.

**`same_team` is reported whether or not the pass would move an occupant.** The containment guard in
`_resolve_sides` fires only where an occupant changes; a fixture hand-edited to already hold the club
its own source resolves to is at rest and never reaches it. Reporting is scoped to a fixture at least
one of whose sides a source maintains — two hand-set sides holding one club state no wiring fault.

**They surface as an action-required category, "Fehlerhafte Verweise",** which is **not** exclusive
with `is_canceled`, unlike every other one: calling a match off does not unwire it, and the bracket
below still reads that wiring.

**Reporting a fault never resolves it,** and **nothing is reported that waiting fixes** — a placing
merely undecided stays invisible ([ADR-0035](0035-a-group-placing-is-ranked-by-one-chain-and-seeded-only-when-final.md),
invariant I24c), because a notice on every group-seeded slot for the length of the group phase trains
an admin to ignore the list that also carries the real faults.

What changes is the placement:

**A fault's reason is stated on the card it names.** A faulted fixture renders as a note above its
card, joined to it by a short stem at each end so the two read as one drawn shape, and a fixture
carrying several faults carries a line for each, because each is corrected separately.

**The wrapper is the list item, and the card gives its own up.** `SpielCardsList` puts
`role="listitem"` on the wrapper holding the note and the card, and passes `asListitem={false}` to
`SpielCard` for exactly those fixtures. The grid's item count therefore still equals its fixture
count, no `listitem` nests inside another, and the reason is announced inside the item it belongs to
rather than in a block the reader has to re-associate. The two halves are set at one call site and
must stay there: a wrapper that carries the role while the card keeps its own announces every faulted
fixture twice, and neither `tsc` nor the build can see it.

**The wrapper is a real element, never `display: contents`.** `CARDS_CASCADE` staggers by
`[role="listitem"]:nth-child(n)`, which counts DOM siblings, so a wrapper generating no box would put
the card at the head of its own count instead of in the row's.

**The note reaches the `bracket_fault` section alone.** `AdminSpieleActionRequiredView` passes
`faultsBySpielId` only to that section, which is the one list already filtered by the diagnosis, and
the one category whose tab cannot state the reason: the category spans the whole of `FLBracketFault`,
so its one-word tab names a class of contradiction rather than any particular one. Every other
category's tab is its own diagnosis, and repeating it per card would be the tab's own name read
twice. Category membership is untouched — `bracket_fault` stays non-exclusive, so a faulted fixture
still appears under its missing date; only the note stops travelling with it.

**A note attached to a fixture never restates that fixture's number.** `formatBracketFault` serves
the toast and opens with "Spiel N"; `describeBracketFaultOnCard` serves the note and speaks about
"dieses Spiel", naming only what the card does not already show.

## Consequences

**ADR-0044's "no variant, no slot and no wrapper" holds for the first two and not the third.**
`SpielCard` is still the app's one full-width match card on every surface that renders one, and the
triage page adds no slot to it; what it adds is one boolean and a wrapper that lives in
`SpielCardsList` rather than in the card. Everything else ADR-0044 decided — the urgency ordering,
the eight permanent tabs, `?section=` as the only home of the selection, invariant I24 — is
untouched, which is why that record is not superseded here.

**The reason is announced before the fixture it names.** A screen reader reaching a faulted item
hears the note's nested list first and the card's date and match number after, and the note
deliberately carries no match number. The association is still unambiguous, because both sit inside
one `listitem`, but the diagnosis arrives before its subject rather than after it. Putting the note
below the card would reverse that and break the drawn shape the stems exist to make.

**Each faulted fixture costs one extra nested list in the accessibility tree.** The note is a `ul` of
sentences, so it announces as a list within a list item. That is the honest price of stating several
faults separately, and it is what "a fixture carrying several faults carries a line for each" buys.

**A future collection that renders `SpielCardsList` with a fault map inherits the wrapper.** The role
handover lives in `SpielCardsList`, not in the triage page, so any list passed `faultsBySpielId`
behaves the same way. A caller that wants the note without the wrapper does not exist and would need
the announcement question answered again before it did.

**What was verified and what was not.** The structure above is read off the source and checked against
WAI-ARIA's `list` and `listitem` role definitions and its "owned element" definition; CSS Display 3
states that `display` has no effect on an element's semantics, which is what makes the
`display: contents` fragment `SpielCardsList` renders around all of its children irrelevant to the
relationship. None of it was exercised against a screen reader — no announcement here rests on
observed NVDA, JAWS or VoiceOver output.

## Alternatives considered

**Keep the panel above the grid, as ADR-0039 decided.** It loses on the ground its own argument
stood on. The premise was that a per-card note forces a severing wrapper, and it does not: the role
moves onto the wrapper and the list keeps one item per fixture. With that gone, what remains is a
block of sentences whose only join to the grid is a match number the reader carries across, on the
one category the tab cannot name.

**Render the note as a bare sibling inside the grid.** The obvious shape and the one that genuinely
breaks the list: a non-`listitem` child of a `role="list"` is exactly what neither the role's required
owned elements nor the cascade's `:nth-child` stagger tolerate, and the note would land in its own
grid cell beside an unrelated card.

**Put the note inside `SpielCard`.** No wrapper, no role handover, nothing to keep in step — and it
makes a match card look different on one page, which is what ADR-0005 and ADR-0044 both refuse. The
card is the same object on the public spielplan and in the admin triage list, and a red rule that
appears only in one of them is a second card in all but name.

**Send `faultsBySpielId` to every section.** The fault check is not exclusive, so a faulted fixture
appears under its missing date too, and the reason it blocks the bracket is arguably worth reading
there. Rejected: the wrapper travels with the note, so a section that never asked about references
gets its layout changed by a diagnosis it does not present, and the tab an admin opened to fix a
referee answers a different question instead.

**A category per reason, so the tab states the diagnosis and no card needs a note.** It follows the
pattern where a category name is the reason, and it grows the strip by one tab per union member,
nearly all of them permanently empty at any moment — while the set is open, so the strip grows again
with the next fault anyone finds worth reporting. One category with the reason spelled out per card
costs one tab and keeps the strip a strip.

**Record the placement as a carve-out in the frontend spec, leaving ADR-0039 `Accepted`.** The
lighter mechanism, and the right one where an ADR's scope is merely being read more precisely.
Rejected: a reader arriving at ADR-0039's Consequences would find the per-card placement refused in
the present tense, on a structural ground the code disproves, with nothing on the page to say
otherwise — the failure DEC-6 exists to prevent.
