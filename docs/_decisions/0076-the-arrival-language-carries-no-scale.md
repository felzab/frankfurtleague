# ADR-0076 — The app's arrival language carries no scale, vendored overlays included

**Status:** Accepted\
**Date:** 2026-08-19\
**Surface:** frontend\
**Supersedes:** —\
**Superseded by:** —\
**Source:** Roadmap item FE-15, and my decision of 2026-08-19 on the question that item left open —
whether the app's motion language reaches vendored components at all.

## Context

**The app's own arrival language is a fade, with at most a lift.** Every animation
`fl_frontend/src/shared/components/ui/motion.ts` exports — the page rise, the tier-2 sequences and
the panel reveal — composes `fade-in` with a small `slide-in-from-*`, and nothing under
`fl_frontend/src` spells a `zoom-in-*` or `zoom-out-*` class. Scale is not a gesture this product
makes anywhere a component of its own is what arrives.

**The vendored overlays scale, and they do not agree with each other on how much.** At
`@heroui/styles` 3.2.4, on the entering state:

| Vendored stylesheet or selector                                                           | Entering |
| ----------------------------------------------------------------------------------------- | -------- |
| `popover`, `tooltip`, `dropdown`                                                          | 90%      |
| `autocomplete`, `color-picker`, `combo-box`, `date-picker`, `date-range-picker`, `select` | 95%      |
| `modal__container--full`                                                                  | 100%     |
| `modal__container`, `alert-dialog__container`                                             | 105%     |

Every one of those files exits at `zoom-out-95`, and `modal__container--full` at `zoom-out-100`. So
the vendored set spans a tenth under, a twentieth under, exactly at, and a twentieth over full size,
and the two ends of that span — the popover's 90 and the modal's 105 — are the two an ordinary
visit meets most. Nothing app-side overrode any of it, so every popover, tooltip, menu, picker and dialog
on the site arrived with a gesture none of the app's own components make.

**One custom property is the whole mechanism.** `tw-animate-css` builds its `enter` and `exit`
keyframes out of custom properties — `scale3d(var(--tw-enter-scale,1), …)` and its exit twin — and
`zoom-in-90` is nothing but a declaration of `--tw-enter-scale: 90%`. The reduced-motion block in
`fl_frontend/src/app/globals.css` already pulls that same lever for the reader who asked for less
motion, which is what makes an app-wide answer one rule rather than a sweep.

**Two properties of that mechanism decide where the rule can be written**, and each is invisible
until the rule silently does nothing:

- **`@property … { inherits: false }`.** `tw-animate-css` declares both scale properties that way,
  so a declaration on `:root` or on any other ancestor reaches nothing. It has to land on the
  element carrying `animate-in` / `animate-out` itself, which is why the reduced-motion block is
  written on `*, *::before, *::after` and why this one has to be.
- **A universal selector cannot win inside HeroUI's own layer.** The rule has to be written on `*`,
  which is specificity `(0,0,0)`, while `.popover[data-entering="true"]` and its siblings are
  `(0,2,0)`. Inside one layer specificity settles it, so a `@layer components` rule would lose to
  `popover`, `tooltip`, `dropdown`, `modal` and `select` — all imported by `globals.css` itself —
  on the public routes, whatever the source order. Source order compounds it rather than causing it:
  `fl_frontend/src/app/admin/admin.css` is the only importer of `autocomplete.css` and
  `date-picker.css` and loads _after_ `globals.css`, so a layered rule written here would sit
  earlier in the merged layer and lose to those two even at equal specificity.

## Decision

**Both scale properties are pinned to `1` for the whole document, unlayered, in `globals.css`:**

```css
*,
*::before,
*::after {
  --tw-enter-scale: 1;
  --tw-exit-scale: 1;
}
```

**Entrances and exits alike.** An exit that shrinks is the entrance's gesture played backwards, and
a rule closing one direction leaves the product arriving in its own language and leaving in the
vendor's.

**Unlayered is the placement, not a preference.** An unlayered declaration outranks every `@layer`,
so it beats HeroUI's components layer wherever that layer is assembled from and whatever order the
two stylesheets load in.

**Nothing else about the vendored motion moves.** The fades, the slides, the durations and the
curves HeroUI ships are left exactly as they are; this decision removes one property from them.

## Consequences

**Every overlay in the product now arrives and leaves as a pure fade, on the vendor's own timing.**
That is the point: a popover opening over a page that has just risen is one gesture, not two.

**Every vendored stylesheet imported from here on inherits this silently, and that is the cost as
well as the benefit.** Adding a HeroUI component under [ADR-0013](0013-per-component-heroui-css.md)
brings none of its zoom with it, and nobody has to notice; the flip side is that the vendor's own
tuning for a component this app has not rendered yet is discarded sight unseen, and the only signal
that it happened is this record.

**The modal loses a deliberate gesture, not an accident.** `zoom-in-105` enters from _above_ full
size, which is HeroUI's emphasis for a surface that blocks the page. It reads as a pop, it is the one
vendored scale that is arguably saying something, and it goes. `alert-dialog.css` carries the same
105 and is imported by neither stylesheet, so nothing changes there today — the table above describes
the vendored package, not this app's surface.

**A component that genuinely wants a scale entrance has to declare the property on itself, next to
this rule.** Two things it cannot do: put the declaration on an ancestor, which `inherits: false`
makes inert, or write it inside a `@layer`, which this rule outranks. In practice that means a
second unlayered rule in `globals.css`, and its being awkward is proportionate to how rare the case
should be.

**Writing a plain `zoom-in-*` class at a call site now does nothing.** Tailwind emits it into the
`utilities` layer, which this rule outranks, so the class compiles, lints, builds and has no effect
— the failure mode `motion.ts` exists to keep call sites away from in the first place. The important
modifier is the one spelling that still lands: `zoom-in-90!` emits `!important`, which beats a normal
declaration from any layer or none.

**The reduced-motion block keeps a `--tw-enter-scale: 1` this rule makes redundant while it stands,
and gains the exit twin it was missing.** The duplication is deliberate: reversing this decision must
not quietly hand a zoom back to a reader who asked for less motion, and a belt covering one direction
would have left exactly that hole. Closing it also ends a standing breach of that block's own
"remove movement, keep fades" policy — every vendored `zoom-out-95` ran under
`prefers-reduced-motion: reduce`, because the block zeroed only the `--tw-enter-*` properties. No
exit translate needs the same treatment: no vendored stylesheet and nothing under `fl_frontend/src`
spells a `slide-out-*`.

## Alternatives considered

**Align the three outliers to the vendor's own `zoom-in-95`.** The cheapest coherent answer — one
rule on three selectors, and the vendored set stops disagreeing with itself. Rejected because
internal consistency inside the vendored half is not the consistency that matters. A visitor sees
one product, and a 95% entrance is still a scale gesture the app's own components never make; this
would have bought agreement inside the vendored half at the price of leaving the product speaking
two motion languages rather than one.

**Leave the vendor alone.** Zero maintenance, no risk of fighting an upgrade, and it preserves
whatever HeroUI tuned each component for. Rejected because the mismatch is at its most visible
exactly where it is most common: a dropdown opening over a page that faded in, a select popping to
90% on a form whose panel revealed itself flat. The vendor tuned those entrances for a design system
this product does not otherwise use.

**Write the override on the entering and exiting selectors themselves, as the roadmap entry
sketched.** It is the surgical version and it works. Rejected because it is a list that goes stale
with no signal: each newly imported vendored stylesheet is another selector to add, ADR-0013's
per-component import already carries one procedural checklist with no automated net, and a second
one hanging off it would be missed the first time somebody adds a component in a hurry. The
universal rule needs no maintenance because it names no component.

**Pin the entrance and leave the exit at the vendor's `zoom-out-95`.** Tempting on the grounds that
an exit is short, half-seen and rarely the thing anybody complains about. Rejected as an
inconsistency with nothing behind it: the same overlay would arrive flat and leave shrinking, which
is harder to defend than either whole answer and produces a rule whose reason nobody could restate
later.
