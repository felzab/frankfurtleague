# ADR-0056 — A triage list is ordered by what blocks play, and its section lives in the URL

**Status:** Accepted
**Date:** 2026-08-07
**Surface:** frontend
**Supersedes:** —
**Superseded by:** —
**Source:** Open item FE-12, the owner's instruction to rethink `/admin/action_required` from the ground
up — good UX, and sound from a development perspective — and six rounds of review on the result.

## Context

The action-required page was an eight-section accordion over one uncached fetch, and three properties of
it were the complaint.

**Every section was rendered, always, and each was a panel.** Eight collapsible headers on one screen,
each with a count chip. In a season where four categories are clear, more than half the page is
reassurance an admin scrolls past to reach the one thing that needs work.

**The order was the data model's, not the competition's.** Sections rendered in the declaration order of
`ACTION_REQUIRED_LABELS`, which put "Ergebnis ausstehend" first and the two categories that stop a later
fixture resolving at all fourth and eighth. Nothing about that order was chosen; it was the order the
categories happened to be written in.

**Nothing survived leaving the page.** Which section was open was React state, so an admin who opened a
fixture, edited it and came back landed on the first section with everything collapsed. The App Router
keeps an admin tree alive between navigations, so the state that _did_ survive was the state from
before — worse than none.

The surface this page sends an admin to now exists: the match editor is a page at
`/admin/spiele/[spiel_id]` ([ADR-0050](0050-a-form-that-outgrows-a-dialog-becomes-a-page.md)), addressed
by fixture id alone.

## Decision

**Categories are ordered by what each one blocks, and the label table is the single declaration of that
order.** `fl_frontend/src/features/admin/utils.ts :: ACTION_REQUIRED_LABELS` carries an `urgency` beside
each name, and `buildActionRequiredSections` walks that table rather than the categorised record, so
render order cannot drift from the table. Three working grades and one that is not work:

| Grade      | Categories                                                                  | Means                                                       |
| ---------- | --------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `blocking` | `bracket_fault`, `besetzung_missing`                                        | A later fixture cannot resolve at all until somebody acts   |
| `results`  | `ergebnis_pending`                                                          | Every standing and every group-seeded slot below is waiting |
| `details`  | `datum_missing`, `uhrzeit_missing`, `ort_missing`, `schiedsrichter_missing` | Administrative tidying; nothing downstream is held up       |
| `none`     | `is_canceled`                                                               | Not a problem. A list to look things up in, never a queue   |

**The accordion becomes the tab strip the app already has**, character for character `SpielplanView`'s:
the same sticky toolbar over the same three-breakpoint card grid, the same `TAB_TRACK` / `TAB_ITEM` /
`TAB_INDICATOR`, the same paddings. Two surfaces that are one control doing one job read as one control.

**All eight tabs render at all times, whatever the counts are** (owner). A strip that gains and loses
tabs as fixtures are completed is a control that moves under the hand using it. What carries the state
is the count badge, and **green is reserved for zero**: a cleared category is the one thing that needs
no attention, and every other count takes its own urgency's accent, so the colour says what the number
costs rather than merely that it is not zero.

**The section is a search parameter and no component holds it in state.** `?section=`, validated against
the rendered sections before use. It is written with `window.history.replaceState` rather than
`router.replace`: Next documents the native History API as integrating with its router, so
`useSearchParams` re-renders and history stays coherent, while a router navigation would re-read the
whole archive from FastAPI to change which already-loaded section is on screen — this route's query is
deliberately uncached ([ADR-0013](0013-admin-scoped-reads-are-never-cached.md)). `replaceState` and not
`pushState`, because Back on a triage list should leave the list rather than walk an admin back through
the sections they looked at.

**The card is `SpielCard`, unaltered** (owner, twice). A match card looks the same on every surface that
renders one, so the triage page adds no variant, no slot and no wrapper. What the page adds instead is
what the card cannot carry: the tab names the problem once, an `InfoHint` beside the strip says what
that one word covers, and the bracket faults keep the panel above the grid that
[ADR-0047](0047-a-bracket-fault-is-derived-on-demand.md) gave them.

That placement is also the established shape rather than a compromise. An operator's queue does not
repeat the diagnosis on every row of a list already filtered by it — the group names the problem, the
row is the affected object, and the detail is one click deeper. Seven of the eight categories therefore
need nothing per card. `bracket_fault` is the exception because one category holds **five** reasons, so
the tab cannot state it, and ADR-0047 already refused splitting it into five mostly-empty sections.

**The edit control gets the brand fill, and only the fill.** Same box, same radius, same position, so no
layout moves; as a second grey square beside the info button it read as its twin, on the pages where
editing is the reason the admin is there at all.

**A tab strip wider than its rail shows its own scroll affordance, and both strips in the app do.**
`Tabs.ListContainer` ships it — a `ScrollShadow` plus chevron buttons a `:has()` rule reveals only while
the shadow reports the strip can scroll. It detects overflow by letting the list grow, so a list carrying
`overflow-x-auto scrollbar-hide` hides the overflow from the detector and the chevrons never appear.
Neither strip carries those classes any more.

## Consequences

**The preserved-tree hazard cannot reach this page, and that is why the URL was chosen over state.** The
App Router hides a route's tree with `<Activity>` rather than unmounting it, so a selection in `useState`
— or inside an uncontrolled `Tabs` — comes back describing the page as it was. That is the failure class
`docs/frontend/spec.md` §12 records against the match editor's draft, and the reason that editor needs
both a content key and an explicit reset. Next's own guidance names a search param as the fix. **A future
control on this page that reaches for `useState` reintroduces the hazard**; the invariant is I24.

**Switching section costs nothing and shows nothing new.** The page holds every category's matches from
one fetch, so a section change is a render. The other half of that trade is that the list is as old as
the last full load of the route. There is one admin, so this is a stated property rather than a defect.

**`ACTION_REQUIRED_LABELS` gained two fields and its order now means something.** `short` is what the tab
shows — eight full names do not fit one row at any width, and the one-word form does at desktop width.
`urgency` carries both rank and colour. Reordering the table reorders the page, which is the intent, and
`categorizeActionRequired`'s accumulator is keyed in the same order so `Object.keys` on either agrees,
which one test asserts.

**`SpielCard` changed for every surface, twice, and both were deliberate.** The admin edit link takes the
brand fill wherever `adminEditHref` is passed — the two admin routes, never a public one — and both icon
buttons gained an `IconTooltip`, because an icon-only control should say what it does. The finished
fixture's `opacity-90` is gone (owner): a played match is not a lesser one.

**The two badge recipes moved to `fl_frontend/src/shared/components/ui/badges.ts`.** They were the match
editor's; a second surface needs the same two shapes, and a copy is how one page's count pill and
another's stop matching.

**This page still has no mutation, and adding one is not free.** Next's E592 fires when a server action is
dispatched from one route while `/admin/spiele/[spiel_id]` sits in the router tree, which is exactly what
a "fix it from the list" control here would be
([ADR-0062](0062-every-page-owned-editors-undo-is-a-route-handler.md)). Every action on this page is a
navigation to the editor, and a future inline mutation reads that ADR first.

**FE-12 asked for URL state for a section _and_ an item, and only the section shipped.** Restoring the
fixture an admin last opened needs an anchor on its card, and the card is not this page's to change. The
section survives a round trip to the editor; the scroll position within it does not.

## Alternatives considered

**Keep the accordion, reorder it and hide the empty sections.** The smallest change, and it keeps eight
headers on screen at once — the density this rewrite exists to remove — while giving the URL nothing to
name: "which sections are open" is a set, not a selection.

**One flat queue, one row per fixture, categories as filters.** Genuinely attractive: a fixture missing
four fields would appear once rather than four times. Rejected because it dissolves the seven-plus-one
category set that ADR-0046 and ADR-0047 build on and that the match editor reads through
`categorizeActionRequired` — the entry an admin sees would no longer correspond to anything the rest of
the system names.

**A purpose-built triage card carrying the reason, the overdue count and the fixture's other open
categories.** Built and rejected by the owner on sight: a match card that looks different on one page is
an inconsistency, and the information it added is either the tab's own name repeated per row or
available one click deeper. The card's own date and status chip are the timestamp the pattern asks for.

**`router.replace` for the URL write, as Next's own preserved-state example shows.** Correct in general
and wrong here: that example's page is cached and this one's read is not, so every section press would
cost a FastAPI round trip over the whole archive to re-render data the browser already holds.

**A hand-rolled scroll button on the tab strip.** Considered when the strip's overflow proved
undiscoverable. Unnecessary: the component ships the documented affordance and the app was suppressing
it.

## See also

- [ADR-0047](0047-a-bracket-fault-is-derived-on-demand.md) — the derivation this renders, and the fault
  panel's placement, both unchanged
- [ADR-0050](0050-a-form-that-outgrows-a-dialog-becomes-a-page.md) — the page every card links into
- [ADR-0013](0013-admin-scoped-reads-are-never-cached.md) — why the read is uncached, which decides the transport
- [ADR-0007](0007-three-spiel-cards-stay-separate.md) — why this page renders an existing card rather
  than a fourth
- `docs/frontend/spec.md`, invariant I24 and section 12 — the URL-state rule and the sibling hazard
