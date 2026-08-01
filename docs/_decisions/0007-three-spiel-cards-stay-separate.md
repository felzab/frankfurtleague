# ADR-0007 — Three Spiel cards stay three components

**Status:** Accepted
**Date:** 2026-07-29
**Surface:** frontend
**Supersedes:** —
**Superseded by:** —
**Source:** CLAUDE.md §9 A5

## Context

`SpielCard`, `SpielCardCompact` and `SpielCardUltraCompact` render the same entity and read as
copy-paste. An audit pass flagged them as the kind of duplication that should collapse into one
component with a `variant` prop.

## Decision

**Keep all three.** Extract only their shared derivation.

## Consequences

Three files to touch when the match card's _data_ shape changes. That is the honest cost, and it is
real.

Their genuinely shared code is extracted: `formatSpielDisplay` in `spiele/utils.ts` returns the three
presentation values all of them need. **That extraction was itself a bug fix** — an unplayed match
rendered `"- : -"` in the main card and `"-:-"` in the other two, on the same screen, because the three
copies had drifted.

So the rule is: shared _derivation_ goes in `utils.ts`; presentation stays in the three components.

**Someone will propose merging them again.** The citation in each component is what stops that costing
an afternoon of rediscovery.

## Alternatives considered

**One component with a `variant` prop.** Rejected after looking at what actually differs. The three
vary in:

- chip count — two, one, none
- team naming — full names versus two-letter shorthands
- the container driving them — a responsive grid, a vertical timeline, a horizontal playoff bracket

Those are not three sizes of one thing; they are three layouts with different information density,
chosen by three unrelated parents. A `variant` prop collapsing them produces a component with three
internal modes, where every future change has to be reasoned about three times _inside one file_ —
harder to read and riskier to change than three single-mode components.

**Two components, merging the two compact variants.** Rejected for the same reason at smaller scale:
the compact card shows one chip and the ultra-compact none, and the bracket that drives the latter has
width constraints the timeline does not.
