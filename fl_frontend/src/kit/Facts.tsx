import { textOf } from "@/core/copy";

import { cardSurface, stacked } from "./cardStyles";
import { Chip } from "./Chip";
import { Icon } from "./Icon";
import { Link } from "./Link";
import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";
import type { Route } from "next";
import type { ChipProps } from "./Chip";
import type { IconName } from "./Icon";

/**
 * One fact: its label, and its value as a record's data, a link to it on the site, a link to it on
 * another site, such as a venue on a map, or a way to reach a person. An absent value is left out.
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
      contact?: never;
    }
  | { link: { href: Route; label: Words }; value?: never; figures?: never; elsewhere?: never; contact?: never }
  /** Another site's address, which `Link` opens in a new tab, leaving the site's page in place. */
  | { elsewhere: { href: `https://${string}`; label: Words }; value?: never; figures?: never; link?: never; contact?: never }
  /**
   * A mail address as a mail link, or a phone number as a call link, the address or number its words: contact data
   * is reached, not copied, so no copy button stands beside it.
   */
  | { contact: { href: `mailto:${string}` | `tel:${string}`; label: Words }; value?: never; figures?: never; link?: never; elsewhere?: never }
);

const facts = tv({
  slots: {
    list: "",
    row: "grid gap-0.5",
    // The glyph, 16 px, on the label's own 16-px line, 6 px before it.
    term: "flex items-center gap-1.5 text-xs text-fg-muted",
    detail: "font-medium [overflow-wrap:anywhere]",
  },
  variants: {
    look: {
      // Two pairs a row from 32 rem of the block's own width (`@container` on the block), not of the screen's:
      // 32 rem is the content width of the kit's form dialog (35 rem less its padding), the narrowest box a pair
      // row was drawn in, so a read page's or a mailed page's column splits its pairs and a phone's, or a box
      // narrower than a dialog on any screen, stacks them.
      boxed: {
        list: `overflow-hidden ${cardSurface()} @lg:grid @lg:grid-cols-2`,
        // In the wide box the second pair shares the first one's row, so it draws no hairline above it either.
        row: `${stacked()} px-3 py-2 @lg:nth-2:border-t-0`,
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
  },
});

/**
 * A record's data, read rather than edited: stacked pairs, each a 12-px muted label over its value, in a
 * hairline box with hairlines between the rows and two pairs a row where the box is wide, or free of the
 * box as the match pop-up sets them under the pairing. The one block that pairs a label with a value. A subject line
 * above it names the record, with its chip.
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
  const { list } = facts({ look });
  // A row's key is its label and how many rows above it hold that label: keys are unique among siblings, and a caller
  // may list two records under one label, so the label alone would collide.
  const above = new Map<Copy, number>();
  return (
    // `w-full`: a Section's or an AccountBox's grid starts its children, which would shrink the block to its content.
    <div className="@container grid w-full gap-2 text-sm">
      {subject !== undefined && (
        <p className="flex min-w-0 items-center gap-2 text-base font-semibold">
          <span
            className="min-w-0 truncate"
            title={textOf(subject.name)}>
            {textOf(subject.name)}
          </span>
          {subject.chip !== undefined && <Chip {...subject.chip} />}
        </p>
      )}
      <dl className={list()}>
        {rows.map((fact) => {
          const { row, term, detail } = facts({ look, figures: fact.figures === true });
          const to = fact.link ?? fact.elsewhere ?? fact.contact;
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
