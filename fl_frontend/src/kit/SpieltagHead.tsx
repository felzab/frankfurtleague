import type { Copy } from "@/core/copy";
import type { ReactElement } from "react";

/**
 * The line over one matchday's matches in the administrator's „Spiele“ list: its dates in the muted 14-px text at
 * the start, and at the end its one act, „Bearbeiten“, a link in the button's look leading to the matchday's editor
 * page. The tab above it already names the matchday, so the line is no heading.
 */
export function SpieltagHead({ dates, act }: { /** The matchday's span, „14.–16.03.2027“. */ dates: Copy; act: ReactElement }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm text-fg-muted">{dates}</p>
      {act}
    </div>
  );
}
