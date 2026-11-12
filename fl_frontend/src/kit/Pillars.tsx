import { cardSurface } from "./cardStyles";
import { Icon } from "./Icon";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { IconName } from "./Icon";

/** One pillar: its glyph, its title and its one paragraph. */
type Pillar = { glyph: IconName; title: Copy; text: Copy };

const pillars = tv({
  slots: {
    root: "grid gap-4 @2xl:grid-cols-3",
    card: `grid content-start gap-2 ${cardSurface()} p-6`,
    // The glyph's box, 40 px on the muted fill.
    mark: "mb-1 flex size-10 items-center justify-center rounded-lg bg-bg-muted text-fg",
    title: "text-base font-semibold",
    text: "text-base text-fg-muted",
  },
});

/**
 * What the league is for, in three cards side by side from 42 rem of the block's own width and one under another
 * below it.
 */
export function Pillars({ items }: { items: readonly [Pillar, Pillar, Pillar] }) {
  const slots = pillars();
  return (
    // The container the cards' columns read, since a query reads an ancestor; `w-full`, since a container's width
    // counts none of its content.
    <div className="@container w-full">
      <div className={slots.root()}>
        {items.map((item) => (
          <div
            key={item.title}
            className={slots.card()}>
            <span className={slots.mark()}>
              <Icon
                glyph={item.glyph}
                size={16}
              />
            </span>
            <h3 className={slots.title()}>{item.title}</h3>
            <p className={slots.text()}>{item.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
