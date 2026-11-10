import { COPY, textOf } from "@/core/copy";
import { formatDateWithWeekdayAndYear, formatOrdinal, formatTime } from "@/core/format";

import { cardSurface } from "./cardStyles";
import { Chip } from "./Chip";
import { SPIELORT_WORDS } from "./Facts";
import { Link } from "./Link";
import { PlaceholderLine, PlaceholderSentence } from "./Skeleton";
import { RecordFigures } from "./Table";
import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";
import type { Route } from "next";
import type { ChipProps } from "./Chip";
import type { Counts } from "./Table";

/**
 * One tile: what it counts over its value and a line under it where one is due. The value is a figure, such
 * as a place, a score or a date, or `words`, a short text such as a venue, set smaller; a value standing on
 * another site, such as a venue on a map, or on a page of this one, such as a club's, is a link to it.
 */
export type StatTile = {
  label: Copy;
  value: Words;
  /** The line under the value: its own words, or a club's won, drawn and lost counts as the Tabelle draws them. */
  line?: Words | { counts: Counts };
  words?: true;
  href?: `https://${string}` | Route;
  /** The value's status, directly after it, as a squad row's „Nachnominiert“ after the club a pupil plays for. */
  chip?: ChipProps;
};

/**
 * The grids a page may lay its tiles in, each fixing how many it holds, so a page cannot hand a layout the
 * wrong count: `four` for a club's standing or a season's counts, two a row on a phone and all four in one row
 * from `lg`; `five` for a match's facts, two a row on a phone with the fifth, such as the venue, wide across both,
 * and from `lg` all five in one row. `five`'s columns are as wide as their tiles' contents, the spare room shared, so
 * at every width a tile is never narrower than its figure, a date being the widest. Every tile is a rectangle as tall
 * as its label, value and line, at every width: one shape for every set of figures on the site.
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
    // One line inside its tile, set without the capitals' tracking so „Schiedsrichter“, the longest label, takes the
    // least room; never cut, since a label is what its value is read by: its whole width counts towards its column's
    // least width, as a figure's does.
    label: "text-xs font-medium whitespace-nowrap text-fg-muted uppercase",
    // A figure never breaks inside itself and is never cut, so no figure shows short of a digit.
    value: "font-numeric text-xl font-semibold whitespace-nowrap",
    line: "text-xs text-fg-muted",
    chipped: "flex flex-wrap items-center gap-x-2 gap-y-1",
  },
  variants: {
    layout: {
      four: { root: "grid-cols-2 lg:grid-cols-4" },
      five: { root: "grid-cols-[repeat(2,auto)] lg:grid-cols-[repeat(5,auto)]" },
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

const { fact } = COPY.spielplan;

/**
 * A match's five tiles while it is read, at typical words set unseen. `five`'s columns take their widths from their
 * words, so bars of a guessed share would stand in five equal columns and jump sideways on landing; the words also
 * give the value's row its baselines and let the venue wrap where a real one does.
 */
const MATCH_WAIT = [
  { label: fact.spieltag, value: formatOrdinal(2), line: COPY.shared.phase.gruppenphase },
  { label: fact.date, value: formatDateWithWeekdayAndYear("2027-03-06") },
  { label: fact.time, value: formatTime("14:00") },
  { label: fact.schiedsrichter, value: COPY.shared.noValue, words: true },
  { label: fact.spielort, value: SPIELORT_WORDS, words: true },
] as const satisfies ReadonlyArray<{ label: string; value: string; line?: string; words?: true }>;

/** A match's tiles while it is read, `five`'s own grid at `MATCH_WAIT`'s words. */
function MatchTilesPlaceholder() {
  return (
    <div className={tiles({ layout: "five" }).root()}>
      {MATCH_WAIT.map((item, index) => {
        const words = "words" in item;
        const slots = tiles({ layout: "five", words, wide: index === 4 });
        return (
          <div
            key={item.label}
            className={slots.tile({ class: cardSurface() })}>
            <PlaceholderLine
              textClass={slots.label()}
              words={item.label}
            />
            <PlaceholderSentence
              textClass={slots.value()}
              words={item.value}
              lines={words ? 2 : 1}
            />
            {"line" in item && (
              <PlaceholderLine
                textClass={slots.line()}
                words={item.line}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The tiles while the record is read: the layout's own grid with its count of tiles, each its label's line, its
 * value's and, unless `line` says these tiles carry none, the line under it as bars, at a tile's size.
 */
export function StatTilesPlaceholder({ layout, line = true }: { layout: Layout["layout"]; line?: boolean }) {
  if (layout === "five") return <MatchTilesPlaceholder />;
  return (
    <div className={tiles({ layout }).root()}>
      {Array.from({ length: 4 }, (_, index) => {
        const slots = tiles({ layout });
        return (
          <div
            key={index}
            className={slots.tile({ class: cardSurface() })}>
            <PlaceholderLine
              textClass={slots.label()}
              widthClass="w-2/3"
            />
            <PlaceholderLine
              textClass={slots.value()}
              widthClass="w-1/2"
            />
            {line && (
              <PlaceholderLine
                textClass={slots.line()}
                widthClass="w-1/3"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A tile's value: its words, or the link to where it stands, another site's or a page of this one. */
function TileValue({ item }: { item: StatTile }) {
  if (item.href === undefined) return textOf(item.value);
  return (
    <Link
      href={item.href}
      placement="standalone"
      label={item.value}
    />
  );
}

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
              {item.chip === undefined ? (
                <TileValue item={item} />
              ) : (
                // The chip on the value's line where both fit, else on the next, as a row's chip after a name: the
                // value is never cut for it.
                <span className={slots.chipped()}>
                  <TileValue item={item} />
                  <Chip {...item.chip} />
                </span>
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
