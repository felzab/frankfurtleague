import { formatNumber } from "@/core/format";

import { cardSurface } from "./cardStyles";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";

/** One figure: the count, and what it counts. */
type Figure = { value: number; label: Copy };

const figures = tv({
  slots: {
    // Four in a row from `lg`, two by two below it.
    root: "grid grid-cols-2 gap-4 lg:grid-cols-4",
    card: `grid gap-0.5 ${cardSurface()} p-6`,
    // What it counts comes first, as a list of terms is read, and stands under its figure on screen.
    value: "row-start-1 font-heading text-3xl tracking-display",
    label: "row-start-2 text-sm text-fg-muted",
  },
});

/** The season in four counts, each its figure in Anton over what it counts. */
export function Figures({ items }: { items: readonly [Figure, Figure, Figure, Figure] }) {
  const slots = figures();
  return (
    <dl className={slots.root()}>
      {items.map((item) => (
        <div
          key={item.label}
          className={slots.card()}>
          <dt className={slots.label()}>{item.label}</dt>
          <dd className={slots.value()}>{formatNumber(item.value)}</dd>
        </div>
      ))}
    </dl>
  );
}
