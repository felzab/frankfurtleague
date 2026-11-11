import { textOf } from "@/core/copy";

import { cardHover, cardSurface, stacked } from "./cardStyles";
import { CutHost, CutRow, CutText } from "./CutText";
import { Icon } from "./Icon";
import { Link } from "./Link";
import { RowEnd } from "./RowEnd";

import type { Copy, Words } from "@/core/copy";
import type { Route } from "next";
import type { IconName } from "./Icon";

/** One way to reach the league: its glyph where it has one, its name, what it reaches, and the link itself. */
type LinkRow = { glyph?: IconName; label: Copy; value: Words; href: Route };

/**
 * The ways to reach the league, one row each in one box, each row one link through its name, the address or
 * the profile it reaches and the chevron at its end, as a card's rows stand: Kontakt's page. The box is the container
 * its rows read, at a card's rows' width (`cardStyles.ts :: nameWithChips`): from 32 rem what a way reaches stands at
 * the right of its name's line, and in a narrower box, a phone's, on the line under the name, where the league's own
 * address stands whole at 360 px.
 */
export function LinkRows({ rows }: { rows: readonly LinkRow[] }) {
  return (
    <div className={cardSurface({ class: "@container overflow-hidden" })}>
      {rows.map((row) => (
        <div
          key={row.href}
          className={cardHover({
            class: `relative flex min-h-14 items-center gap-3 ${stacked()} px-4 py-2 text-base lg:min-h-13 lg:text-sm`,
          })}>
          {/* The link stretches over the row, so the address's whole, while it is cut, is the tooltip the link's
              holder carries under the pointer (`CutRow`). */}
          <CutRow>
            {row.glyph !== undefined && (
              <Icon
                glyph={row.glyph}
                size={16}
              />
            )}
            <span className="flex min-w-0 flex-1 flex-col @lg:flex-row @lg:items-center @lg:gap-3">
              {/* The way's own short name keeps its line and its width; the address takes the rest of its own
                  line and is cut with „…“ where it is longer. */}
              <CutHost className="shrink-0 font-medium whitespace-nowrap">
                <Link
                  href={row.href}
                  placement="row"
                  label={row.label}
                />
              </CutHost>
              <CutText
                text={textOf(row.value)}
                className="min-w-0 truncate text-fg-muted @lg:flex-1 @lg:text-end"
              />
            </span>
            <RowEnd />
          </CutRow>
        </div>
      ))}
    </div>
  );
}
