import { NICHT_HINTERLEGT } from "@/shared/utils/format";

import type { ReactNode } from "react";

/** Exported for a control that cannot hold `Leer`, such as a read-only input's value. */
export const LEER_CLASSES = "text-foreground-muted not-italic";

/**
 * Every word standing where a value would, an empty fact or a state such as „Nicht bestätigt“ alike, on
 * every page. Colour and slant alone: size and weight stay the slot's, so the hierarchy holds.
 */
export function Leer({ children = NICHT_HINTERLEGT }: { children?: string }) {
  return <span className={LEER_CLASSES}>{children}</span>;
}

/** One stored fact. A `<dl>` is its only valid parent: the pair is what makes the value a fact about the label. */
export function Angabe({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-y-0.5">
      <dt className="fluid-xxs font-bold text-foreground-muted">{label}</dt>
      <dd className="min-w-0 fluid-sm font-medium break-words text-foreground">{children}</dd>
    </div>
  );
}
