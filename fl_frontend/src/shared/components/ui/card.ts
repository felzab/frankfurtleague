import { tv } from "tailwind-variants";

/**
 * The one card appearance (ledger NEW-V1). Surveyed across all 8 `<Card>` mounts and the 4
 * card-shaped `<div>`s, the family agreed on nothing: the three `SpielCard` siblings, which render
 * on the same screens, split `rounded-2xl`/`rounded-xl`, `shadow-xs`/`shadow-sm`, and had three
 * different hover answers — one shadow-only, one none at all, one scale-plus-border. One gesture had
 * three magnitudes across the app.
 *
 * Owner decisions (2026-07-30): radius is `rounded-2xl`, matching the panels cards sit in (modals,
 * tables and empty states are all `rounded-2xl`); the clickable gesture is `hover:border-brand`
 * plus `hover:scale-hover`.
 *
 * `interactive` is for cards that actually respond to a click. A card that is not a link or a button
 * must use `static`, or it advertises an affordance it does not have.
 *
 * Named transition properties rather than `transition-all`: the reduced-motion escape lives once in
 * `globals.css`, not per card.
 */
export const card = tv({
  base: "bg-surface border-border text-foreground rounded-2xl border shadow-sm",
  variants: {
    interactive: {
      true: "hover:border-brand hover:scale-hover transition-[transform,border-color,box-shadow] duration-200",
      false: "",
    },
  },
  defaultVariants: { interactive: false },
});
