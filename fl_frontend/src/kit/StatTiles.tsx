import { textOf } from "@/core/copy";

import { cardSurface } from "./cardStyles";
import { Link } from "./Link";
import { RecordFigures } from "./Table";
import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";
import type { Counts } from "./Table";

/**
 * One tile: what it counts over its value and a line under it where one is due. The value is a figure, such
 * as a place, a score or a date, or `words`, a short text such as a venue, set smaller; a value standing on
 * another site, such as a venue on a map, is a link to it.
 */
export type StatTile = {
  label: Copy;
  value: Words;
  /** The line under the value: its own words, or a club's won, drawn and lost counts as the Tabelle draws them. */
  line?: Words | { counts: Counts };
  words?: true;
  href?: `https://${string}`;
};

/**
 * The grids a page may lay its tiles in, each fixing how many it holds, so a page cannot hand a layout the
 * wrong count: `four` for a club's standing or a season's counts, two a row on a phone and all four in one row
 * from `lg`; `five` for a match's facts, two a row on a phone with the fifth, such as the venue, wide across both,
 * and from `lg` five equal tiles filling the row. Every tile is a rectangle as tall as its label, value and line,
 * at every width: one shape for every set of figures on the site.
 */
type Layout =
  | { layout: "four"; items: readonly [StatTile, StatTile, StatTile, StatTile] }
  | { layout: "five"; items: readonly [StatTile, StatTile, StatTile, StatTile, StatTile] };

const tiles = tv({
  slots: {
    root: "grid gap-3",
    // Each tile takes three of the list's rows as its own, the label's, the value's and the line's, so the tiles
    // standing side by side share those rows and set their values on one baseline, a figure's and a venue's
    // words alike, and stand one height.
    tile: "row-span-3 grid grid-rows-subgrid items-baseline gap-y-0.5 px-4 py-3",
    // One line inside its tile, set without the capitals' tracking so „Schiedsrichter“, the longest label,
    // fits a tile; past that it is cut with „…“ rather than running over the tile's edge.
    label: "min-w-0 truncate text-xs font-medium text-fg-muted uppercase",
    // A figure never breaks inside itself, set at a size the narrowest tile holds a date or a time at, and is never
    // cut either, so no figure shows short of a digit.
    value: "font-numeric text-xl font-semibold whitespace-nowrap",
    line: "text-xs text-fg-muted",
  },
  variants: {
    layout: {
      four: { root: "grid-cols-2 lg:grid-cols-4" },
      five: { root: "grid-cols-2 lg:grid-cols-5" },
    },
    // Words wrap between themselves, a word longer than its tile at a hyphenation point, and only past that
    // anywhere, so a venue's name never runs over a narrow tile's edge.
    words: {
      true: { value: "text-base break-words hyphens-auto whitespace-normal" },
    },
    // The five's fifth tile runs across both columns on a phone, and from `lg` takes its one place in the row.
    wide: {
      true: { tile: "col-span-2 lg:col-span-1" },
    },
  },
});

/**
 * A record's figures at a glance, each in its own tile with its name over it: a club's standing, a match's
 * facts. A page states each fact once, in a tile or elsewhere, never both. A definition list, each tile a
 * term and its values, so a reader hears the label with its value.
 */
export function StatTiles({ layout, items }: Layout) {
  return (
    <dl className={tiles({ layout }).root()}>
      {items.map((item, index) => {
        const slots = tiles({ layout, words: item.words, wide: layout === "five" && index === 4 });
        return (
          <div
            key={item.label}
            // On the card's own surface, read from its recipe, so a ruling on the card's fill moves the tiles with it.
            className={slots.tile({ class: cardSurface() })}>
            <dt className={slots.label()}>{item.label}</dt>
            <dd className={slots.value()}>
              {item.href === undefined ? (
                textOf(item.value)
              ) : (
                <Link
                  href={item.href}
                  placement="standalone"
                  label={item.value}
                />
              )}
            </dd>
            {item.line !== undefined && (
              <dd className={slots.line()}>
                {typeof item.line === "object" && "counts" in item.line ? <RecordFigures counts={item.line.counts} /> : textOf(item.line)}
              </dd>
            )}
          </div>
        );
      })}
    </dl>
  );
}
