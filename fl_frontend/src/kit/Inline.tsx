import { tv } from "tailwind-variants/lite";

import type { ReactNode } from "react";
import type { Gap } from "./Stack";

const inline = tv({
  base: "flex min-w-0 flex-wrap",
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
      baseline: "items-baseline",
    },
  },
});

/** Blocks side by side, wrapping onto the next line where the row runs out; `align` places each in its line. */
export function Inline({ gap, align, children }: { gap: Gap; align: "start" | "center" | "end" | "baseline"; children: ReactNode }) {
  return <div className={inline({ gap, align })}>{children}</div>;
}
