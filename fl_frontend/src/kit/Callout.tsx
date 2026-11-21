import { textOf } from "@/core/copy";

import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";

const box = tv({
  slots: {
    // `w-full`: a dialog's or a section's start-aligned grid would hold the box at its words' width, short of the frame.
    root: "grid w-full gap-1 rounded-lg px-4 py-3 text-sm text-fg",
    heading: "text-base font-semibold",
  },
  variants: {
    // The chip's opaque tint, so the box paints the same on the page, a card or a dialog, and its title and its
    // sentence are pairs the contrast rule measures.
    tone: {
      success: { root: "bg-success-tint", heading: "text-success" },
      info: { root: "bg-info-tint", heading: "text-info" },
      warn: { root: "bg-warn-tint", heading: "text-warn" },
      danger: { root: "bg-danger-tint", heading: "text-danger" },
    },
    // A box inside running text says its sentence at the text's own size, as GOV.UK's inset text and Primer's flash do;
    // beside fields and rows it keeps the smaller size of the words around it.
    size: {
      small: {},
      text: { root: "text-base" },
    },
  },
  defaultVariants: { size: "small" },
});

export type CalloutProps = {
  tone: "success" | "info" | "warn" | "danger";
  /** A short head in the hue, where the sentence needs one. */
  title?: Copy;
  /** A sentence of the catalogue's, or a record's own text, shown as it was stored. */
  text: Words;
  size?: "small" | "text";
};

/** A consequence or a state, said in one visible box tinted in its status hue. */
export function Callout({ tone, title, text, size }: CalloutProps) {
  const { root, heading } = box({ tone, size });
  return (
    <div className={root()}>
      {title !== undefined && <p className={heading()}>{title}</p>}
      <p>{textOf(text)}</p>
    </div>
  );
}
