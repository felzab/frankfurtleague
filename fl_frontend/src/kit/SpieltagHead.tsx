import { COPY } from "@/core/copy";

import { buttonPlaceholder } from "./buttonStyles";
import { PlaceholderLine } from "./Skeleton";

import type { Copy } from "@/core/copy";
import type { ReactElement } from "react";

const LINE_CLASSES = "flex items-center justify-between gap-3";

/**
 * The line over one matchday's matches in the administrator's „Spiele“ list: its dates in the muted 14-px text at
 * the start, and at the end its one act, „Bearbeiten“, a link in the button's look leading to the matchday's editor
 * page. The tab above it already names the matchday, so the line is no heading.
 */
export function SpieltagHead({ dates, act }: { /** The matchday's span, „14.–16.03.2027“. */ dates: Copy; act: ReactElement }) {
  return (
    <div className={LINE_CLASSES}>
      <p className="text-sm text-fg-muted">{dates}</p>
      {act}
    </div>
  );
}

/** The line while its matchday is read: the dates' line and the act's button as bars, in the line's own row. */
export function SpieltagHeadPlaceholder() {
  return (
    <div className={LINE_CLASSES}>
      <PlaceholderLine
        textClass="text-sm"
        widthClass="w-32"
      />
      <span className={buttonPlaceholder()}>{COPY.shared.verb.edit}</span>
    </div>
  );
}
