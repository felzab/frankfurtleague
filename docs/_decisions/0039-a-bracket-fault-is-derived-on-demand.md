# ADR-0039 — A bracket fault is derived on demand, and all five reach the list an admin already reads

**Status:** Superseded by ADR-0073\
**Date:** 2026-08-05\
**Surface:** backend, frontend\
**Supersedes:** —\
**Superseded by:** ADR-0073\
**Source:** Open item FB-13, plus a re-reading of `resolve_bracket` on 2026-08-05 that found a third
unreported fault where the item recorded two.

## Context

`resolve_bracket` walks a season's wiring on every match write and contains what it cannot honour: a
slot is left alone or emptied, never guessed at, because erasing a team over a typo destroys more
than it reports (ADR-0034). Containment is the right behaviour and is not in question here.

**What it said about the contradictions it walked past was the gap.** Two of them — a `platz` a group
will never produce, and a placing the tiebreak chain cannot separate in a group that has finished
(ADR-0035) — were reported in the response to the write that computed them and stored nowhere, so
they existed in one toast. The save that surfaces a fault is frequently an edit to an unrelated
match, since the whole season resolves on every write, and an admin who missed the toast had no way
to ask again.

Three more were contained in silence:

- a `quelle` naming a `spiel_nr` the season has no match for,
- a chain of references that closes on itself, and every fixture downstream of one,
- a fixture whose two references resolve to the same club.

The first two are unreachable through the write path since ADR-0038 and are therefore hand edits. The
third is not: `find_wiring_refusal` keys a source by its identity, so two **different** sources that
happen to name one club pass every rule — a manual side holding a club, against a side fed by a match
that club then wins, is legal wiring and an unplayable fixture.

Every one of the five is durable, needs a person, and is a contradiction **between** documents rather
than a property of one — so no Mongo filter selects one and no `$jsonSchema` validator refuses one
(ADR-0020).

ADR-0038 had already answered the "where" question for the sibling fault: an unwired knockout slot is
a category of `GET /spiele/action_required`, because that list exists and is where an admin already
looks.

## Decision

**A bracket fault is derived on read and stored nowhere.** `fl_backend/app/api/spiele/crud.py ::
find_bracket_faults` runs the resolution over every season and keeps only what it reported. Both it
and the write path go through `_resolve_one_saison`, so the list an admin re-asks for and the list a
save reports are the same list computed the same way.

**All five faults are reported, through one model.** `FLBracketFault` is a union tagged on `reason`,
with three variants carrying exactly the fields their own fault needs: a group reference
(`gruppe_too_small`, `tie_unresolved`) carries `gruppe` and `platz`, a match reference
(`spiel_missing`, `reference_cycle`) carries the number it names, and a fixture-level contradiction
(`same_team`) carries neither. `spiel_id` is on all three, because a fault joins to its match by id
and `spiel_nr` repeats across seasons.

**`same_team` is reported whether or not the pass would move an occupant.** The containment guard in
`_resolve_sides` fires only where an occupant changes; a fixture hand-edited to already hold the club
its own source resolves to is at rest and never reaches it. Reporting is scoped to a fixture at least
one of whose sides a source maintains — two hand-set sides holding one club state no wiring fault.

**They surface as an eighth action-required category, "Fehlerhafte Verweise",** and the reasons are
written in German by `fl_frontend/src/features/spiele/utils.ts :: formatBracketFault`, which serves
the save's toast and the list alike. The category is **not** exclusive with `is_canceled`, unlike
every other one: calling a match off does not unwire it, and the bracket below still reads that
wiring.

**Reporting a fault never resolves it.** Containment and reporting are separate properties of the
same walk, and every case in `fl_backend/tests/api/test_bracket.py :: TestReportingAFault` asserts both.

## Consequences

**`GET /spiele/action_required` stops being a filter.** It now costs one read of `spiele`, one of
`saisons`, and one teams aggregation per season whose bracket seeds from a group — on an uncached
admin route. At about thirty fixtures and seventeen teams a season this is small, and the certainty
walk is trivial for a finished group, which is the only kind that reports anything. The per-season
aggregation is what grows as seasons accumulate.

**The `spiele` read on that route spans every season.** Its 1024-document cap bounds the whole
archive rather than one season — about thirty seasons at today's size. An unread fixture would make
every reference to it read as dangling, so the boundary is named at the read.

**`unresolvable_slots` is gone from the patch response, replaced by `bracket_faults`.** The old name
described two group states and would have been wrong for a cycle. Both mirrors and
`fl_backend/openapi.json` move with it (ADR-0033).

**A cycle reports once per fixture it reaches, not once per cycle.** Three fixtures round a loop
produce three faults. Naming only the loop would leave an admin correcting two fixtures and wondering
why a third stayed empty.

**The reasons are rendered above the card grid, not on each card.** A card is a `role="listitem"` of
the panel's `role="list"`, and a wrapper holding a note and a card would sit between the two and
sever that relationship. Every sentence opens with the match number the card leads with.

**Nothing is reported that waiting fixes.** A placing merely undecided stays invisible
(ADR-0035, invariant I24c) — surfacing it would raise a notice on every group-seeded slot for
the length of the group phase and train an admin to ignore the list that also carries the five real
faults.

## Alternatives considered

**Store the fault list on the season.** Cheap to read, and wrong for the caller it exists for: it
would be written on the write path, and three of the five faults are reachable only by a hand edit
that never touches that path. A stored list would be stale for exactly the case that motivated it,
and it is a second copy of something the resolution recomputes from scratch on every write —
precisely what ADR-0019 exists to avoid.

**Report only the two group faults and give them a durable home.** The smallest change, and it leaves
three contradictions that need a person telling nobody, one of which is still creatable through the
admin form. The surface is the same either way; the fault set was the part worth widening.

**A category per reason.** It follows the existing pattern where a category name is the reason, and it
grows the accordion from seven sections to eleven or twelve, nearly all of them permanently empty. One
category with the reason spelled out costs one list and keeps the page readable.

**A second admin route for the faults.** Keeps `FLSpieleListResponse` untouched, at the price of a
second uncached admin fetch re-reading the same seasons on the same page load. One admin read stays
one admin read.

**Derive only the three structural faults**, which need the season's fixtures and no standings, and
leave the two group faults in the toast. Cheapest, and it splits one fault set across two surfaces —
which is the shape FB-13 opened against.

**Refuse the `same_team` shape at the write path instead**, by resolving the payload before accepting
it. That would make the refusal depend on results rather than on wiring: the same draw is legal in
the morning and refused in the afternoon, because a match was played in between. ADR-0038's rules are
contradictions a season cannot hold at any moment, and this one is not.
