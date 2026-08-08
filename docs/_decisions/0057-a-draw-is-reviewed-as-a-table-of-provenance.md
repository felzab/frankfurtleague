# ADR-0057 — A draw is reviewed as a table of provenance, on a page that writes nothing

**Status:** Accepted
**Date:** 2026-08-07
**Surface:** frontend
**Supersedes:** —
**Superseded by:** —
**Source:** Open item FB-11, whose evaluation had already narrowed it to the read half, plus my
instruction to research what such a surface normally is before building one, and seven rounds
of review on the result.

## Context

`teamN_quelle` is the only record of the bracket's edges
([ADR-0042](0042-a-result-entry-resolves-the-whole-bracket.md)) and **no surface showed it**. Two
surfaces come close and neither answers the question:

- **The public bracket shows the topology and not the provenance.** `PlayoffsView` orders its rounds
  by the wiring itself, so the connecting lines follow the draw — but a slot's source is written out
  only while that slot is unresolved, as the derived label standing in for a team
  (`fl_frontend/src/features/spiele/components/ui/SpielTeamSlot.tsx`). A played-out bracket therefore
  shows teams and lines and no wiring at all.
- **The triage list reports faults, and a wrong draw is not a fault.** All five stored bracket faults
  are re-derived on every admin read of `/spiele/action_required`
  ([ADR-0047](0047-a-bracket-fault-is-derived-on-demand.md)), and the write path refuses wiring the
  season cannot hold ([ADR-0046](0046-the-write-path-refuses-wiring-the-season-cannot-hold.md)). What
  survives both is the _plausible_ mistake: a legal feeder picked on the wrong side, or a draw whose
  shape is legal and wrong. Neither is a contradiction, so nothing reports either.

So checking a draw meant opening every knockout fixture's editor one at a time and reading two
controls in each — and the only moment reviewing a draw is worth anything is before it is played.

**What established competition software does**, and it is consistent across the field: an organiser
reviews a stage as **one whole-stage surface** that states, per slot, where its entrant comes from.
Toornament's placement screen is a list of slots beside a live bracket preview; start.gg reviews
progressions between phases as a destination list; and the published convention in football is the
one FIFA and UEFA print — a knockout slot reads `Winner Group A` or `2nd Group B` until a team is
known, and the placeholder stays visible because it explains the structure without inventing a team.
Every one of them shows the slot's source as a first-class column rather than as a fallback for a
missing name.

Three constraints were already in force before any of that could be applied here:

- **`SpielCard` is the match card on every surface, admin routes included**
  ([ADR-0056](0056-a-triage-list-is-ordered-by-what-blocks-play.md), and I rejected a
  purpose-built card twice). A surface needing to say something the card cannot carry says it beside
  the grid, not inside a new variant.
- **A fixture is edited in one place**, `/admin/spiele/[spiel_id]`
  ([ADR-0050](0050-a-form-that-outgrows-a-dialog-becomes-a-page.md)).
- **A multi-fixture save does not exist.** `PATCH /spiele/{spiel_id}` takes one fixture, so an editor
  over a whole draw would need a transaction the API does not offer — which FB-11's evaluation
  recorded as the editor's first problem rather than its last.

## Decision

**The season's wiring is a read-only page at `/admin/finalrunden`, and it is a table rather than a
bracket or a grid of cards.**

**It is named and iconed for the public bracket's own entry.** Both are the same rounds seen for a
different purpose, so a second word and a second glyph for one stage are two more things to learn for
nothing — `ADMIN_SIDEMENU_STRUCTURE` reuses `Finalrunden` and the `Medal` icon
`DASHBOARD_SIDEMENU_STRUCTURE` already carries.

**One panel per knockout round, one row per fixture, and one cell holding both sides.**
`fl_frontend/src/features/admin/components/views/AdminBracketWiringView.tsx` is the whole surface.
Each side states its **source over its occupant** — the source as a chip, the club beneath it in the
row's largest text. That order is the difference between this page and a match card: a card answers
"who is playing" and drops the provenance the moment a winner arrives, and here both are present
always, because the fact under review is the edge.

**A table, and therefore not a card.** The subject is the wiring, not the fixture, so nothing here is
a match card and ADR-0056's rule is not engaged rather than worked around. It also puts the surface in
the app's existing shape for read-only season data broken into panels — `SaisontabelleView`, whose
panel, table variant and row treatment this page reuses.

**Four chip colours, read as one cool-to-warm scale.** A group-seeded source takes `SaisonPhaseChip`'s
Gruppenphase token, because the slot comes from exactly the phase that colour already names everywhere
else; a match-fed source takes `info`; a manual slot takes `warning`; an unmaintained one takes
`danger`. The two cool chips are the two ways a slot fills itself and are meant to read as a family,
so the colour answers "does this need me?" first and "which kind of source?" second. **The two kinds of
source are worth separating** because a bracket is group-seeded in its first knockout round and
match-fed after it, so a group chip standing in a semi-final is visible as wrong from across the room.
**`brand` is not in the set**: it is `#82181a`, a deep red, and a brand chip beside a danger chip would
be two reds claiming to be opposite answers.

**The German is the derivation that already exists**, and it gained one form. `fl_frontend/src/features/spiele/utils.ts ::
formatQuelle` names a source, and **every group placing now reads as an ordinal, first included** —
`1. der Gruppe A`, not `Gruppensieger A` (my call). One form for the whole set is what lets two slots
compare at a glance here, and the ordinal already says the team won the group. The placing picker in
`FormTeamPicker` had spelled that rule a second time; it now calls `formatQuelle`, so the placing an
admin picks and the placing every card derives are one string.

**Which of the three states a slot is in has exactly one declaration**, `fl_frontend/src/features/spiele/utils.ts ::
deriveSlotHerkunft`: a source means the resolution maintains the slot, no source with a team means the
admin holds it, and neither means nobody fills it. `fl_frontend/src/features/admin/utils.ts ::
categorizeActionRequired` reads the same function for its `besetzung_missing` arm, so the chip on this
page and the triage category cannot describe one slot differently.

**The page writes nothing, and every row links into the match editor** with the same brand-filled
control `SpielCard` uses wherever `adminEditHref` is passed. One save path, so there is no second
write surface to keep in step with the endpoint's four refusal rules (ADR-0046), and Next's E592 stays
out of reach ([ADR-0062](0062-every-page-owned-editors-undo-is-a-route-handler.md)).

**It reads the app's cached public queries, not the admin route.** A season's fixtures are public —
`/dashboard/playoffs` renders the same two reads and the same join — so nothing here is
admin-authorized and [ADR-0013](0013-admin-scoped-reads-are-never-cached.md)'s no-cache rule does not reach
it. What makes the page admin-only is the layout's session guard, which every route under `/admin`
inherits.

## Consequences

**The layout is `table-fixed`, and that is a correctness fix rather than a preference.** Auto table
layout sizes a column from its own content, so the two sides of one fixture came out 113px against
119px at a phone width — and the identical `Manuell gesetzt` chip then wrapped to two lines on one side
and stayed on one line on the other, in the same row. A declared `w-1/2` on each does not fix it,
because auto layout treats a percentage as a preference and content minima override it exactly where
the room is tightest. Fixed layout gives the two narrow columns their declared widths and divides
everything left **equally** between the columns declaring none. Comparing two sides is the entire act
this page exists for, so a layout that renders them differently defeats it.

**The pair is one cell, not two columns, and that is what makes the page work on a phone.** As two
columns they were 93px each at 375, where every group chip wrapped to two lines and one club name
wrapped to four. One cell holding a grid that is single-track below `sm` gives each side ~209px there
and splits it in two from `sm` up; the column headings sit in the same grid, so they still label their
own tracks wherever there is room for two. Measured at 375, 768, 1280 and 1440, with and without the
admin sidemenu: every chip and every club on one line, the two sides identical to the pixel, and no
page-level horizontal scroll.

**The Gruppenphase is absent, by construction rather than by a filter.** A group fixture's sides come
from the schedule and the write path refuses wiring on one (ADR-0046, rule 1), so there is nothing
about it this page could show. A reader looking for the group schedule is on the wrong page, and
`/admin/spielsuche` is the right one.

**It does not report bracket faults, and that is a deliberate hole.** A reference naming a match the
season does not have renders here as an ordinary source chip. The five faults are derived per request
over whole seasons by the admin route and already have a durable home in the triage list (ADR-0047),
and re-deriving a subset of them client-side over one season's fixtures would put a second, weaker
answer in front of the same admin.

**The list is as old as the last load, and it is cached for a day.** `getSpiele` and `getSpieltage`
carry base tags that a match write invalidates, so a save through the editor is reflected; a season
hand-edited in Compass is not, until the cache expires
([ADR-0035](0035-reference-data-staleness-is-bounded-by-cache-lifetime.md)).

**`formatQuelle`'s new wording reaches every surface that renders a bracket slot**, which is the point
of it living in one place — the three match cards, the details modal, the edit form's preview and
change list, the Spielsuche's search keys, and this page. `docs/glossary.md`'s `Quelle` table states
the new form.

**The editing half of FB-11 stays unbuilt and this page does not prejudge it.** Nothing here stores a
selection, so adding an editor later is adding state to a page that has none rather than unpicking
one. Whatever that editor becomes, it needs a multi-fixture transaction first.

**A fourth admin route now exists and it is not a CRUD resource.** It mounts neither `AdminCrudShell`
nor `AdminCrudView`, so a reader looking for the pattern the other admin pages share will not find it
here — the page frame is copied from that shell and the panel is `SaisontabelleView`'s.

## Alternatives considered

**Render the bracket as a tree, like `PlayoffsView`, with the provenance inside each node.** The most
faithful to "one whole-stage surface", and the closest to a preview in the reference platforms.
Rejected because the node is `SpielCardUltraCompact` — adding provenance to it changes the public
bracket, and building a second node component is the purpose-built card I have already rejected
twice (ADR-0056). The topology is also the half that is already correct and already visible; what was
missing is the provenance, which a tree renders worst because each node is at its narrowest exactly
where two labels have to fit.

**Put a wiring summary beside the existing card grid**, in the shape ADR-0056 prescribes for anything
a card cannot carry. Rejected because provenance is per fixture and per side: a list of every fixture's
sources beside a grid of every fixture's cards replaces "open every fixture" with "cross-reference two
lists by match number", which is the same cost wearing a different hat.

**Add the section to the triage list as a ninth tab.** Tempting — the strip is built, the URL state is
solved, and an admin already goes there. Rejected because every tab of that page is a queue of
fixtures needing an action, ordered by what each one blocks, and a whole-season draw is neither a queue
nor ordered by urgency. It would also inherit that route's uncached whole-archive read for data the
cached season queries already serve.

**Drop the chips and state the source as plain text, colouring only the broken case.** Built and
rejected by me on sight: it made the page grey, and it threw away the one signal that separates
a group-seeded slot from a match-fed one. Colour carrying four meanings is worth more here than colour
carrying one.

**The admin tables' own `RowActionLink` for the edit control**, on the argument that this is a table
row and the brand-filled square belongs to the card. Rejected by me: the control an admin
presses looks the same on every admin surface, and which container it sits in is not a reason to
change it.

**Show a date column, so the reviewer knows how long they have.** Genuinely useful and deliberately
out. It is the fixture's property rather than the edge's, the pair needs the width, and
`/admin/spielsuche` already answers it.

**Derive and chip the resolvable faults here** — a `spiel_nr` this season has no match for is a local
lookup over data the page already holds. Rejected because it is one of five faults, so the page would
report a subset while the triage list reports all of them, and an admin comparing the two would
reasonably conclude one of them is wrong.
