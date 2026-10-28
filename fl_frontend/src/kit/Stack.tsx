import { tv } from "tailwind-variants/lite";

import type { ReactNode } from "react";

/** A step of the one 4-px spacing scale, in pixels: no other gap exists. */
export type Gap = 4 | 8 | 12 | 16 | 24 | 32 | 48 | 64;

const stack = tv({
  base: "flex min-w-0 flex-col",
  variants: {
    gap: {
      4: "gap-1",
      8: "gap-2",
      12: "gap-3",
      16: "gap-4",
      24: "gap-6",
      32: "gap-8",
      48: "gap-12",
      64: "gap-16",
    },
    align: {
      start: "items-start",
      center: "items-center",
      end: "items-end",
      stretch: "items-stretch",
    },
  },
});

/** Blocks one under another; `align` places each across the column. */
export function Stack({ gap, align, children }: { gap: Gap; align: "start" | "center" | "end" | "stretch"; children: ReactNode }) {
  return <div className={stack({ gap, align })}>{children}</div>;
}
