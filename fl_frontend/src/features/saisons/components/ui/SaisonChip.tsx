import { laufendDot } from "@/features/saisons/components/ui/laufendDot";
import { PILL_TINT_CLASSES } from "@/shared/components/ui/badges";

import type { ReactNode } from "react";

/**
 * The public surface's box for a season heading a page: a header element rather than a row label, so it
 * keeps the chip rung the corner ladder gives it (`docs/frontend/spec.md` §1.18) and not a pill's.
 */
export function SaisonChip({
  isLaufend,
  children,
}: {
  /**
   * Required, not optional: the dot claims the season is running, and a caller that cannot say so must
   * pass `false` rather than inherit the claim.
   */
  isLaufend: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`${PILL_TINT_CLASSES.brand} border-brand/30 fluid-xs inline-flex w-fit items-center gap-2 rounded-full border px-4 py-1.5 font-bold shadow-xs`}>
      {isLaufend && <span className={laufendDot("xs")} />}
      {children}
    </div>
  );
}
