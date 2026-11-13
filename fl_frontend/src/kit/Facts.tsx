import { textOf } from "@/core/copy";

import { AddressWords, addressWords, isAddress } from "./AddressWords";
import { cardSurface, stacked } from "./cardStyles";
import { Icon } from "./Icon";
import { Link } from "./Link";
import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";
import type { Route } from "next";
import type { AddressText } from "./AddressWords";
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
      /** An address its page marks as one wraps after its „@“, as a row's name does (`AddressWords`). */
      value: Words | AddressText;
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
        // first-column pair beside another draws the one hairline between the columns. An odd last pair, a lone one
        // included, takes the row's whole width, so no empty cell stands beside it.
        row: `${stacked()} px-3 py-2 @lg:odd:not-last:border-e @lg:odd:last:col-span-2 @lg:nth-2:border-t-0`,
      },
      // No box and no hairlines, two pairs a row at every width: facts inside a card or a pop-up, which draws no box
      // inside its own. A lone pair
      // takes the row's whole width, so its value never wraps in half a phone's column beside nothing.
      free: {
        list: "grid grid-cols-2 gap-x-4 gap-y-3",
        row: "min-w-0 only:col-span-2",
      },
    },
    figures: {
      true: { detail: "font-numeric" },
    },
    address: {
      true: { detail: addressWords() },
    },
  },
});

/**
 * A record's data, read rather than edited: stacked pairs, each a 12-px muted label over its value, in a
 * hairline box with hairlines between the rows and two pairs a row where the box is wide, one hairline between the
 * columns, the rows' rules running the whole width and an odd last pair across both columns; or free of the box inside
 * a card or a pop-up. The one block that pairs a label with a value.
 */
export function Facts({ facts: rows, look = "boxed" }: { facts: ReadonlyArray<Fact>; look?: "boxed" | "free" }) {
  const { list } = facts({ look });
  // A row's key is its label and how many rows above it hold that label: keys are unique among siblings, and a caller
  // may list two records under one label, so the label alone would collide.
  const above = new Map<Copy, number>();
  return (
    // `w-full`: a Section's or an AccountBox's grid starts its children, which would shrink the block to its content.
    <div className="@container grid w-full text-sm">
      <dl className={list()}>
        {rows.map((fact) => {
          const address = fact.value !== undefined && isAddress(fact.value);
          const { row, term, detail } = facts({ look, figures: fact.figures === true, address });
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
                {fact.value !== undefined ? (
                  isAddress(fact.value) ? (
                    <AddressWords address={textOf(fact.value)} />
                  ) : (
                    textOf(fact.value)
                  )
                ) : (
                  to !== undefined && (
                    <Link
                      href={to.href}
                      placement="standalone"
                      label={to.label}
                    />
                  )
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
