import { NAME_WRAP_CLASSES } from "./nameWrap";

import type { ReactNode } from "react";

/**
 * One label-and-value row of an armed control's readout. **A `<dl>` is its only valid parent**: the
 * pair is what makes the value a fact about the label rather than two strings sharing a line.
 */
export function ConfirmReadoutRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-row items-baseline justify-between gap-x-3">
      {/* Either side may hold a name somebody typed („Austritt von {Team}“ labels one), so each may
          shrink below its longest word and break it rather than push the row past the reveal. */}
      <dt className={`min-w-0 fluid-xxs font-bold text-foreground-muted ${NAME_WRAP_CLASSES}`}>{label}</dt>
      <dd className={`min-w-0 text-right fluid-xs font-semibold text-foreground ${NAME_WRAP_CLASSES}`}>{value}</dd>
    </div>
  );
}
