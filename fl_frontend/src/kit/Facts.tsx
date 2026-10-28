import { tv } from "tailwind-variants/lite";

import { Chip } from "./Chip";
import { Icon } from "./Icon";
import { Link } from "./Link";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ChipProps } from "./Chip";
import type { IconName } from "./Icon";

/**
 * One fact: its label, and its value as a record's data, a link to it on the site, or a link to it on
 * another site, such as a venue on a map. An absent value is left out.
 */
export type Fact = {
  label: Copy;
  /** A small muted glyph before the label, as the match pop-up leads each of its facts (Notion's property pattern). */
  glyph?: IconName;
} & (
  | { value: string; /** Figures, set in Inter with columns that line up. */ figures?: boolean; link?: never; elsewhere?: never }
  | { link: { href: Route; text: string }; value?: never; figures?: never; elsewhere?: never }
  /** Opens in a new tab, leaving the site's page in place. */
  | { elsewhere: { href: `https://${string}`; text: string }; value?: never; figures?: never; link?: never }
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
        list: "overflow-hidden rounded-lg border border-border @lg:grid @lg:grid-cols-2",
        // In the wide box the second pair shares the first one's row, so it draws no hairline above it either.
        row: "border-t border-border px-3 py-2 first:border-t-0 @lg:nth-2:border-t-0",
      },
      // No box and no hairlines, two pairs a row at every width: the old pop-up's facts under its teams.
      free: {
        list: "grid grid-cols-2 gap-x-4 gap-y-3",
        row: "min-w-0",
      },
    },
    figures: {
      true: { detail: "font-numeric tabular-nums" },
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
  subject?: { name: string; chip?: ChipProps };
  facts: ReadonlyArray<Fact>;
  look?: "boxed" | "free";
}) {
  const { list } = facts({ look });
  return (
    <div className="@container grid gap-2 text-sm">
      {subject !== undefined && (
        <p className="flex min-w-0 items-center gap-2 text-base font-semibold">
          <span className="min-w-0 truncate">{subject.name}</span>
          {subject.chip !== undefined && (
            <Chip
              tone={subject.chip.tone}
              label={subject.chip.label}
            />
          )}
        </p>
      )}
      <dl className={list()}>
        {rows.map((fact) => {
          const { row, term, detail } = facts({ look, figures: fact.figures === true });
          return (
            <div
              key={fact.label}
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
                {fact.link !== undefined ? (
                  <Link
                    href={fact.link.href}
                    placement="standalone"
                    text={fact.link.text}
                  />
                ) : fact.elsewhere !== undefined ? (
                  <Link
                    href={fact.elsewhere.href}
                    placement="standalone"
                    newTab
                    text={fact.elsewhere.text}
                  />
                ) : (
                  fact.value
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
