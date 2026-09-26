/**
 * The brand box a glyph, an initial or a number sits in. A tile is not a block, so a page carries as
 * many as it has cards without spending its one `bg-brand-solid` block (`docs/frontend/spec.md` §1.17).
 */
export const BRAND_TILE_CLASSES =
  "flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-solid text-brand-solid-foreground shadow-sm";

/**
 * The same square as a link — one step smaller, standing in a row of controls rather than beside a
 * heading. `hover:` rather than `data-hovered:`: a `next/link` writes no react-aria attribute
 * (`fl_frontend/src/shared/components/ui/formButtons.ts :: ctaButton`).
 */
export const BRAND_ICON_BUTTON_CLASSES =
  "flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-solid text-brand-solid-foreground shadow-sm transition-colors duration-(--motion-base) hover:bg-brand-solid-hover";

/**
 * A short identifier's chip, everything but its WIDTH: a caller declares that, two widths on one
 * element being resolved by the stylesheet's emit order with no `twMerge` in the path.
 */
export const SHORTHAND_CHIP_CLASSES =
  "inline-flex shrink-0 items-center justify-center rounded-md bg-brand-solid py-1 fluid-xs font-extrabold tracking-wide text-brand-solid-foreground";
