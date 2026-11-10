import { tv } from "./tv";

import type { ReactNode } from "react";

const grid = tv({
  base: "grid gap-6",
  variants: {
    across: {
      2: "lg:grid-cols-2",
      3: "lg:grid-cols-3",
    },
  },
});

/**
 * Cards side by side, as the administrator's Übersicht sets its four kinds of open work: one column on a phone,
 * `across` from `lg`, two by default and three for the role chooser's short cards, 24 px apart as a page's sections
 * are. Two cards sharing a row stand as tall as each other, each packing its rows at its top
 * (`cardStyles.ts :: card`), the spare height left empty under them.
 */
export function CardGrid({
  across = 2,
  children,
}: {
  across?: 2 | 3;
  /** The kit's `Card`s, in their order of reading. */
  children: ReactNode;
}) {
  return <div className={grid({ across })}>{children}</div>;
}
