import { cardSurface } from "./cardStyles";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";

/** One practical fact: what it is about, and its one sentence. */
type Info = { title: Copy; text: Copy };

const cards = tv({
  slots: {
    // Three side by side from `lg`, one under another below it.
    root: "grid gap-4 lg:grid-cols-3",
    card: `grid content-start gap-1 ${cardSurface()} p-4`,
    // Board: the label in the footer headings' small capitals over its sentence.
    title: "text-xs font-medium tracking-caps text-fg-muted uppercase",
    text: "text-sm",
  },
});

/** Small cards of practical facts, each a label over one sentence: on the landing, under the season's line. */
export function InfoCards({ items }: { items: readonly [Info, Info, Info] }) {
  const slots = cards();
  return (
    <ul className={slots.root()}>
      {items.map((item) => (
        <li
          key={item.title}
          className={slots.card()}>
          <h3 className={slots.title()}>{item.title}</h3>
          <p className={slots.text()}>{item.text}</p>
        </li>
      ))}
    </ul>
  );
}
