import { tv } from "./tv";

import type { Copy } from "@/core/copy";

const chip = tv({
  // The tint is 12 % of the hue over whatever surface the row stands on.
  base: "inline-flex h-5 shrink-0 items-center rounded-md px-2 text-xs font-medium whitespace-nowrap",
  variants: {
    tone: {
      success: "bg-success/12 text-success",
      info: "bg-info/12 text-info",
      warn: "bg-warn/12 text-warn",
      danger: "bg-danger/12 text-danger",
      neutral: "bg-fg-muted/12 text-fg-muted",
    },
  },
});

/** What a block carrying a name takes in its typed `chip` prop, one per name. */
export type ChipProps = { tone: "success" | "info" | "warn" | "danger" | "neutral"; label: Copy };

/**
 * A status said in one word, set directly after the name it belongs to. A page never places one: the
 * blocks that carry a name render it from their `chip` prop.
 */
export function Chip({ tone, label }: ChipProps) {
  return <span className={chip({ tone })}>{label}</span>;
}
