import { tv } from "./tv";

import type { Copy } from "@/core/copy";

const chip = tv({
  base: "inline-flex h-5 shrink-0 items-center rounded-md px-2 text-xs font-medium whitespace-nowrap",
  variants: {
    // Each hue on its own opaque tint, a pair the contrast rule measures, so the ground beneath the chip never reaches
    // its word.
    tone: {
      success: "bg-success-tint text-success",
      info: "bg-info-tint text-info",
      warn: "bg-warn-tint text-warn",
      danger: "bg-danger-tint text-danger",
      neutral: "bg-fg-muted-tint text-fg-muted",
    },
  },
});

/**
 * What a block carrying a name takes in its typed `chip` prop, one per name unless the block says otherwise. `spoken` is
 * the word a screen reader hears in place of a `label` written as letters, „Disqualifiziert“ for „DQ“.
 */
export type ChipProps = { tone: "success" | "info" | "warn" | "danger" | "neutral"; label: Copy; spoken?: Copy };

/**
 * A status said in one word, which belongs to a name: set directly after it on its line, as every row holds it
 * (`nameWithChips`), or in the status column of a list that is a table. A page never places one: the
 * blocks that carry a name render it from their `chip` prop.
 */
export function Chip({ tone, label, spoken }: ChipProps) {
  if (spoken === undefined) {
    return <span className={chip({ tone })}>{label}</span>;
  }

  return (
    <span className={chip({ tone })}>
      <span aria-hidden>{label}</span>
      <span className="sr-only">{spoken}</span>
    </span>
  );
}
