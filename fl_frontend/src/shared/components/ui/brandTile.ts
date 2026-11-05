// Redesign: goes with its last importer; `kit/TeamPlaque` replaces it.

/**
 * The brand box a glyph, an initial or a number sits in. A tile is not a block, so a page carries as
 * many as it has cards without spending its one `bg-brand-solid` block.
 */
export const BRAND_TILE_CLASSES =
  "flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-solid text-brand-solid-foreground shadow-sm";

/**
 * A short identifier's chip, everything but its WIDTH: a caller declares that, two widths on one
 * element being resolved by the stylesheet's emit order with no `twMerge` in the path.
 */
export const SHORTHAND_CHIP_CLASSES =
  "inline-flex shrink-0 items-center justify-center rounded-md bg-brand-solid py-1 fluid-xs font-extrabold tracking-wide text-brand-solid-foreground";
