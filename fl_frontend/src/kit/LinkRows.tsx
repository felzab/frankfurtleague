import { Icon } from "./Icon";
import { Link } from "./Link";
import { RowEnd } from "./RowEnd";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { IconName } from "./Icon";

/** One way to reach the league: its glyph where it has one, its name, what it reaches, and the link itself. */
type LinkRow = { glyph?: IconName; label: Copy; value: string; href: Route };

/**
 * The ways to reach the league, one row each in one box, each row one link through its name, the address or
 * the profile it reaches at the right and the chevron at its end, as a card's rows stand: Kontakt's page.
 */
export function LinkRows({ rows }: { rows: readonly LinkRow[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg">
      {rows.map((row) => (
        <div
          key={row.href}
          className="relative flex min-h-14 items-center gap-3 border-t border-border px-4 py-2 text-base transition-colors duration-(--motion-state) first:border-t-0 hover:bg-bg-surface lg:min-h-13 lg:text-sm">
          {row.glyph !== undefined && (
            <Icon
              glyph={row.glyph}
              size={16}
            />
          )}
          <span className="min-w-0 flex-1 font-medium">
            <Link
              href={row.href}
              placement="row"
              // A profile on another site opens in a new tab, as the kit's other links there do; the mail
              // address and the site's own pages open in place.
              newTab={row.href.startsWith("https://")}
              label={row.label}
            />
          </span>
          <span className="min-w-0 truncate text-fg-muted">{row.value}</span>
          <RowEnd />
        </div>
      ))}
    </div>
  );
}
