/**
 * The brand box a glyph, an initial or a number sits in. A tile is not a block, so a page carries as
 * many as it has cards without spending its one `bg-brand-solid` block (`docs/frontend/spec.md` §1.17).
 */
export const BRAND_TILE = "bg-brand-solid text-brand-solid-foreground flex size-10 shrink-0 items-center justify-center rounded-xl shadow-sm";

/**
 * The same square as a link — one step smaller, standing in a row of controls rather than beside a
 * heading. `hover:` rather than `data-hovered:`: a `next/link` writes no react-aria attribute
 * (`fl_frontend/src/shared/components/ui/formButtons.ts :: ctaButton`).
 */
export const BRAND_ICON_BUTTON =
  "bg-brand-solid text-brand-solid-foreground hover:bg-brand-solid-hover flex size-9 shrink-0 items-center justify-center rounded-xl shadow-sm transition-colors duration-(--motion-base)";

/**
 * One declaration: a club's Kürzel wears the same box on every admin list and in the squad form's team picker.
 * `bg-brand-solid` is a declared fill, never an alpha on `brand` (`fl_frontend/src/shared/components/ui/badges.ts :: COUNT_BADGE`).
 */
export const SHORTHAND_CHIP =
  "bg-brand-solid text-brand-solid-foreground fluid-xs inline-flex w-10 shrink-0 items-center justify-center rounded-md py-1 font-extrabold tracking-wide";
