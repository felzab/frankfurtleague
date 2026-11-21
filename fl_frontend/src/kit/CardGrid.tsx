import { BlockBox } from "./BlockBox";
import { tv } from "./tv";

import type { ReactNode } from "react";

const grid = tv({
  base: "grid gap-6",
  variants: {
    across: {
      2: "@2xl:grid-cols-2",
      3: "@2xl:grid-cols-3",
    },
  },
});

/**
 * Cards side by side: one column in a box narrower than 42 rem, `across` from it. The box decides, not the screen,
 * since the rail resizes it under one viewport.
 */
export function CardGrid({
  across = 2,
  children,
}: {
  across?: 2 | 3;
  /** The kit's `Card`s, in their order of reading. */
  children: ReactNode;
}) {
  return (
    <BlockBox>
      <div className={grid({ across })}>{children}</div>
    </BlockBox>
  );
}
