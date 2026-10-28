import { tv } from "./tv";

import type { Copy } from "@/core/copy";

const box = tv({
  // The tint is 12 % of the hue over the surface, as a chip's; the title takes the hue, the text the
  // text colour.
  slots: {
    root: "grid gap-1 rounded-lg px-4 py-3 text-sm text-fg",
    heading: "text-base font-semibold",
  },
  variants: {
    tone: {
      success: { root: "bg-success/12", heading: "text-success" },
      info: { root: "bg-info/12", heading: "text-info" },
      warn: { root: "bg-warn/12", heading: "text-warn" },
      danger: { root: "bg-danger/12", heading: "text-danger" },
    },
  },
});

export type CalloutProps = {
  tone: "success" | "info" | "warn" | "danger";
  /** A short head in the hue, where the sentence needs one. */
  title?: Copy;
  text: Copy;
};

/** A consequence or a state, said in one visible box tinted in its status hue. */
export function Callout({ tone, title, text }: CalloutProps) {
  const { root, heading } = box({ tone });
  return (
    <div className={root()}>
      {title !== undefined && <p className={heading()}>{title}</p>}
      <p>{text}</p>
    </div>
  );
}
