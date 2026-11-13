import { BlockBox } from "./BlockBox";
import { cardSurface, smallCaps } from "./cardStyles";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";

/** One practical fact: what it is about, and its one sentence. */
type Info = { title: Copy; text: Copy };

const cards = tv({
  slots: {
    root: "grid gap-4 @2xl:grid-cols-3",
    card: `grid content-start gap-1 ${cardSurface()} p-4`,
    title: smallCaps(),
    text: "text-sm",
  },
});

/**
 * Small cards of practical facts, each a label over one sentence: on the landing, under the season's line. Three side
 * by side from 42 rem of the block's own width, one under another below it.
 */
export function InfoCards({ items }: { items: readonly [Info, Info, Info] }) {
  const slots = cards();
  return (
    <BlockBox>
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
    </BlockBox>
  );
}
