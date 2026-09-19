/**
 * The strip both halves of the rail reserve for a scrollbar: only the nav scrolls, and a strip it reserves alone
 * leaves the footer's rows ending a scrollbar's width past the links above.
 */
export const RAIL_GUTTER = {
  expanded: "scrollbar-gutter-stable",
  collapsed: "scrollbar-gutter-stable-both",
} as const;

// Collapsed, the two strips leave a clip box barely wider than the square, so `globals.css`'s base outline,
// drawn outside it, loses both sides. Inside the square it survives whatever width the platform's scrollbar takes.
export const RAIL_SQUARE_RING = "-outline-offset-2";

/** The same ring for HeroUI's trigger, which draws its focus as an offset shadow rather than the base outline. */
export const RAIL_SQUARE_HEROUI_RING = "ring-inset ring-offset-0";
