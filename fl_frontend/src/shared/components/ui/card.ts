/**
 * SHARED · card recipe
 *
 * The single source of the card appearance. Every card-shaped surface in the app resolves through this
 * recipe rather than spelling out its own radius, border and hover — the reasoning, and what the
 * variants mean, is on the export.
 */

import { tv } from "tailwind-variants";

/**
 * The one card appearance. Surveyed across all 8 `<Card>` mounts and the 4
 * card-shaped `<div>`s, the family agreed on nothing: the three `SpielCard` siblings, which render
 * on the same screens, split `rounded-2xl`/`rounded-xl`, `shadow-xs`/`shadow-sm`, and had three
 * different hover answers — one shadow-only, one none at all, one scale-plus-border. One gesture had
 * three magnitudes across the app.
 *
 * Decided 2026-07-30: radius is `rounded-2xl`, matching the panels cards sit in (modals,
 * tables and empty states are all `rounded-2xl`); the clickable gesture is `hover:border-brand`.
 *
 * `interactive` is for cards that actually respond to a click. A card that is not a link or a button
 * must use `static`, or it advertises an affordance it does not have.
 *
 * **A card is a surface, not a control, which is why its hover is a border and not a fill.** Every
 * control in the app gains `--bg-hover` when you point at it; a card is the thing those controls sit
 * on, and washing a whole panel in a new colour is a far louder gesture than the one being asked
 * for. The outline says "this one is clickable" and stops there.
 *
 * Named transition properties rather than `transition-all`, and the list names exactly what moves:
 * the border colour, and nothing else. A property in the list that no state changes is decoration,
 * and one that is missing snaps — neither is visible to the gate. The naming rule this depends on,
 * that Tailwind v4 emits `scale-*` and `translate-*` as standalone properties so a list saying
 * `transform` interpolates nothing, is stated in full at `formButtons.ts`'s header.
 */
export const card = tv({
  base: "bg-surface border-border text-foreground rounded-2xl border shadow-sm",
  variants: {
    interactive: {
      true: "hover:border-brand transition-[border-color] duration-(--motion-base)",
      false: "",
    },
  },
  defaultVariants: { interactive: false },
});
