// Redesign: goes with its last importer; the kit's fields replace it.

import { tv } from "tailwind-variants";

/**
 * One row for every picker's list. **The variant is the row's own content**: a row parting a label
 * from a note owes the space between them, and one that is only a label must not reserve it.
 */
export const listboxRow = tv({
  slots: {
    // The duration off the motion scale rather than the literal it resolves to, and the dimming in the
    // BASE: a row that gains a closed state later dims by the amount every other row dims by.
    row: "flex flex-row items-center rounded-lg px-3 py-2.5 fluid-sm font-bold text-foreground-muted transition-colors duration-(--motion-base) data-disabled:cursor-not-allowed data-disabled:opacity-40 data-hovered:bg-hover data-hovered:text-brand",
    /** What a closed row says, and on an open one whatever fact would close it. */
    note: "shrink-0 fluid-xs font-semibold text-foreground-muted",
  },
  variants: {
    layout: {
      /** A label alone. */
      plain: {},
      /** Something in front of the label — a swatch, a marker. */
      adorned: { row: "gap-x-3" },
      /** A label and its note, parted so the note stands at the row's end. */
      noted: { row: "justify-between gap-x-3" },
    },
  },
  defaultVariants: { layout: "noted" },
});
