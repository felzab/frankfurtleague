import { placeholderBar } from "./Skeleton";
import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";

const box = tv({
  // The tint is 12 % of the hue over the surface, as a chip's; the title takes the hue, the text the
  // text colour.
  slots: {
    // `w-full`: a dialog's or a section's start-aligned grid would hold the box at its words' width, short of the frame.
    root: "grid w-full gap-1 rounded-lg px-4 py-3 text-sm text-fg",
    heading: "text-base font-semibold",
  },
  variants: {
    tone: {
      success: { root: "bg-success/12", heading: "text-success" },
      info: { root: "bg-info/12", heading: "text-info" },
      warn: { root: "bg-warn/12", heading: "text-warn" },
      danger: { root: "bg-danger/12", heading: "text-danger" },
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
  /** A sentence of the catalogue's, or a record's own text, shown as it was stored, as `PageTitle` takes a record's name. */
  text: Words;
  /** `text` inside running text, where the box's sentence takes the text's 16 px. */
  size?: "small" | "text";
};

/** The box while what it says is read: a bar of its size, its sentence's words set unseen so it wraps as they will. */
export function CalloutPlaceholder({ text }: { text: Copy }) {
  return <p className={placeholderBar(box().root({ class: "text-transparent" }))}>{text}</p>;
}

/** A consequence or a state, said in one visible box tinted in its status hue. */
export function Callout({ tone, title, text, size }: CalloutProps) {
  const { root, heading } = box({ tone, size });
  return (
    <div className={root()}>
      {title !== undefined && <p className={heading()}>{title}</p>}
      <p>{typeof text === "string" ? text : text.record}</p>
    </div>
  );
}
