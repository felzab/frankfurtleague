import { tv } from "tailwind-variants";

/** One row of a refusable list. `refusal` is why it cannot be taken, and `meta` what the row says otherwise. */
export type RefusableOption = { id: string; name: string; meta: string | null; refusal: string | null };

/**
 * The id a key names, and `null` unless the list offers that row. **The refusal is re-read rather
 * than left to the disabled row**: a pick past a closed one is one every caller's endpoint answers
 * 409, and no form may offer what the write path refuses.
 */
export function pickIfOffered(options: readonly RefusableOption[], key: string | null): string | null {
  const picked = options.find((option) => option.id === key);

  // `=== null` and never a truthiness test: `refusal` carries the reason, and any reason closes the row.
  return picked !== undefined && picked.refusal === null ? picked.id : null;
}

/**
 * One row for every picker's list. **The variant is the row's own content**: a row parting a label
 * from a note owes the space between them, and one that is only a label must not reserve it.
 */
export const listboxRow = tv({
  slots: {
    // The duration off the motion scale rather than the literal it resolves to, and the dimming in the
    // BASE: a row that gains a closed state later dims by the amount every other row dims by.
    row: "text-foreground-muted data-hovered:bg-hover data-hovered:text-brand fluid-sm flex flex-row items-center rounded-lg px-3 py-2.5 font-bold transition-colors duration-(--motion-base) data-disabled:cursor-not-allowed data-disabled:opacity-40",
    /** What a closed row says, and on an open one whatever fact would close it. */
    note: "fluid-xs text-foreground-muted shrink-0 font-semibold",
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
