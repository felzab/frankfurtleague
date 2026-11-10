import { textOf } from "@/core/copy";

import { cardSurface, stacked } from "./cardStyles";
import { Chip } from "./Chip";
import { CutText } from "./CutText";
import { Icon } from "./Icon";
import { Link } from "./Link";
import { PlaceholderLine, PlaceholderSentence } from "./Skeleton";
import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";
import type { Route } from "next";
import type { ChipProps } from "./Chip";
import type { IconName } from "./Icon";

/**
 * One fact: its label, and its value as a record's data, a link to it on the site, or a link to it on
 * another site, such as a venue on a map. A value the record does not hold is `COPY.shared.noValue`, the row
 * staying, so a record's block keeps one shape.
 */
export type Fact = {
  label: Copy;
  /** A small muted glyph before the label, as the match pop-up leads each of its facts (Notion's property pattern). */
  glyph?: IconName;
} & (
  | {
      value: Words;
      /** Figures, set in Inter with columns that line up. */ figures?: boolean;
      link?: never;
      elsewhere?: never;
    }
  | { link: { href: Route; label: Words }; value?: never; figures?: never; elsewhere?: never }
  /** Another site's address, which `Link` opens in a new tab, leaving the site's page in place. */
  | { elsewhere: { href: `https://${string}`; label: Words }; value?: never; figures?: never; link?: never }
);

const facts = tv({
  slots: {
    list: "",
    row: "grid gap-0.5",
    // The glyph, 16 px, on the label's own 16-px line, 6 px before it.
    term: "flex items-center gap-1.5 text-xs text-fg-muted",
    detail: "font-medium wrap-anywhere",
  },
  variants: {
    look: {
      // Two pairs a row from 32 rem of the block's own width (`@container` on the block), not of the screen's:
      // 32 rem is the content width of the kit's form dialog (35 rem less its padding), the narrowest box a pair
      // row was drawn in, so a read page's or a mailed page's column splits its pairs and a phone's, or a box
      // narrower than a dialog on any screen, stacks them.
      boxed: {
        list: `overflow-hidden ${cardSurface()} @lg:grid @lg:grid-cols-2`,
        // In the wide box the second pair shares the first one's row, so it draws no hairline above it either, and a
        // first-column pair draws the one hairline between the columns; a lone pair has no column to part from.
        row: `${stacked()} px-3 py-2 @lg:odd:not-only:border-e @lg:nth-2:border-t-0`,
      },
      // No box and no hairlines, two pairs a row at every width: the old pop-up's facts under its teams.
      free: {
        list: "grid grid-cols-2 gap-x-4 gap-y-3",
        row: "min-w-0",
      },
    },
    figures: {
      true: { detail: "font-numeric" },
    },
    oddCount: {
      true: {},
    },
  },
  compoundVariants: [
    // The empty cell beside an odd last pair is the list's own pseudo-element, a grid item that a `dl`'s content model,
    // which refuses an empty child, never sees: its top edge carries the row's rule across the box's whole width.
    { look: "boxed", oddCount: true, class: { list: "@lg:after:border-t @lg:after:border-border" } },
  ],
});

/** Whether the last pair stands beside an empty cell. A lone pair has no row above it to part from. */
const endsOdd = (count: number): boolean => count > 1 && count % 2 === 1;

/**
 * A venue's name while the match is read, set unseen for a placeholder's size alone: it wraps in a narrow box as a
 * real venue does and stands on one line in a wide one. Never shown.
 */
export const SPIELORT_WORDS = "Sportanlage am Riederwald";

/**
 * A person's e-mail address while it is read, set unseen as a venue's name is: most addresses wrap in a phone's column
 * and stand on one line in a wide one. Never shown.
 */
export const EMAIL_WORDS = "vorname.nachname@example.com";

/**
 * The facts while the record is read: the block's own list in `look`, with `pairs` of its pairs, each a label's line
 * over a value's, two a row where `Facts` sets them so. `wraps` is the place of a pair whose value wraps in a narrow
 * column, and words as long as such a value is, set unseen, so the value stands as many lines as it will at every width.
 */
export function FactsPlaceholder({
  pairs,
  look = "boxed",
  wraps,
}: {
  pairs: number;
  look?: "boxed" | "free";
  wraps?: { pair: number; words: string };
}) {
  const { list, row, term, detail } = facts({ look, oddCount: endsOdd(pairs) });
  return (
    <div className="@container grid w-full gap-2 text-sm">
      <div className={list()}>
        {Array.from({ length: pairs }, (_, index) => (
          <div
            key={index}
            className={row()}>
            <PlaceholderLine
              textClass={term()}
              widthClass="w-1/4"
            />
            {index === wraps?.pair ? (
              <PlaceholderSentence
                textClass={detail()}
                words={wraps.words}
                lines={2}
              />
            ) : (
              <PlaceholderLine
                textClass={detail()}
                widthClass="w-1/2"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A record's data, read rather than edited: stacked pairs, each a 12-px muted label over its value, in a
 * hairline box with hairlines between the rows and two pairs a row where the box is wide, one hairline between the
 * columns, the rows' rules running the whole width and an odd last pair in the first column; or free of the box as the
 * match pop-up sets them under the pairing. The one block that pairs a label with a value. A subject line above it
 * names the record, with its chip.
 */
export function Facts({
  subject,
  facts: rows,
  look = "boxed",
}: {
  subject?: { name: Words; chip?: ChipProps };
  facts: ReadonlyArray<Fact>;
  look?: "boxed" | "free";
}) {
  const { list } = facts({ look, oddCount: endsOdd(rows.length) });
  // A row's key is its label and how many rows above it hold that label: keys are unique among siblings, and a caller
  // may list two records under one label, so the label alone would collide.
  const above = new Map<Copy, number>();
  return (
    // `w-full`: a Section's or an AccountBox's grid starts its children, which would shrink the block to its content.
    <div className="@container grid w-full gap-2 text-sm">
      {subject !== undefined && (
        <p className="flex min-w-0 items-center gap-2 text-base font-semibold">
          <CutText
            text={textOf(subject.name)}
            className="min-w-0 truncate"
          />
          {subject.chip !== undefined && <Chip {...subject.chip} />}
        </p>
      )}
      <dl className={list()}>
        {rows.map((fact) => {
          const { row, term, detail } = facts({ look, figures: fact.figures === true });
          const to = fact.link ?? fact.elsewhere;
          const nth = above.get(fact.label) ?? 0;
          above.set(fact.label, nth + 1);
          return (
            <div
              key={`${nth}:${fact.label}`}
              className={row()}>
              <dt className={term()}>
                {fact.glyph !== undefined && (
                  <Icon
                    glyph={fact.glyph}
                    size={16}
                  />
                )}
                {fact.label}
              </dt>
              <dd className={detail()}>
                {fact.value !== undefined
                  ? textOf(fact.value)
                  : to !== undefined && (
                      <Link
                        href={to.href}
                        placement="standalone"
                        label={to.label}
                      />
                    )}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
