import { BlockBox } from "./BlockBox";
import { cardSurface, smallCaps } from "./cardStyles";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";

type Info = { title: Copy; text: Copy };

const cards = tv({
  slots: {
    root: "grid gap-4 @2xl:grid-cols-3",
    card: `grid content-start gap-1 ${cardSurface()} p-4`,
    title: smallCaps(),
    text: "text-sm",
  },
});

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
