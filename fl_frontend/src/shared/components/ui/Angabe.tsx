import type { ReactNode } from "react";

/** What a stored fact reads where the record holds none, on every page that shows one. */
export const NICHT_HINTERLEGT = "Nicht hinterlegt";

/** One stored fact. A `<dl>` is its only valid parent: the pair is what makes the value a fact about the label. */
export function Angabe({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-y-0.5">
      <dt className="fluid-xxs font-bold text-foreground-muted">{label}</dt>
      <dd className="min-w-0 fluid-sm font-medium break-words text-foreground">{children}</dd>
    </div>
  );
}
