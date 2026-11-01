import { card } from "./cardStyles";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";

/**
 * One tile: what it counts over its value and a line under it where one is due. The value is a figure set
 * large, such as a place, a score or a date, or `words`, a short text such as a venue, set smaller.
 */
export type StatTile = { label: Copy; value: string; line?: string; words?: true };

/**
 * The grids a page may lay its tiles in, each fixing how many it holds, so a page cannot hand a layout the
 * wrong count: `four` for a club's standing, two a row on a phone and all four in one row from `lg`.
 */
type Layout = { layout: "four"; items: readonly [StatTile, StatTile, StatTile, StatTile] };

const tiles = tv({
  slots: {
    root: "grid gap-3",
    // On the card's own surface, read from its recipe, so a ruling on the card's fill moves the tiles with it.
    tile: "content-start gap-0.5 px-4 py-3",
    label: "text-xs font-medium tracking-caps text-fg-muted uppercase",
    // A figure too long for its tile breaks anywhere rather than widening the grid.
    value: "font-numeric text-2xl font-semibold [overflow-wrap:anywhere]",
    line: "text-xs text-fg-muted",
  },
  variants: {
    layout: {
      four: { root: "grid-cols-2 lg:grid-cols-4" },
    },
    words: {
      true: { value: "text-base" },
    },
  },
});

/**
 * A record's figures at a glance, each in its own tile with its name over it: a club's standing, a match's
 * facts. A page states each fact once, in a tile or elsewhere, never both. A definition list, each tile a
 * term and its values, so a reader hears the label with its value.
 */
export function StatTiles({ layout, items }: Layout) {
  const slots = tiles({ layout });
  return (
    <dl className={slots.root()}>
      {items.map((item) => (
        <div
          key={item.label}
          className={slots.tile({ class: card().root() })}>
          <dt className={slots.label()}>{item.label}</dt>
          <dd className={slots.value({ words: item.words })}>{item.value}</dd>
          {item.line !== undefined && <dd className={slots.line()}>{item.line}</dd>}
        </div>
      ))}
    </dl>
  );
}
