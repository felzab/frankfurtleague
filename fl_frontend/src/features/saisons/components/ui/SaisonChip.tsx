import { laufendDot } from "@/features/saisons/components/ui/laufendDot";
import { PILL_TINT } from "@/shared/components/ui/badges";

import type { ReactNode } from "react";

/**
 * The public surface's box for the running season: a header element rather than a row label, so it
 * keeps the chip rung the corner ladder gives it (`docs/frontend/spec.md` §1.18) and not a pill's.
 */
export function SaisonChip({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${PILL_TINT.brand} border-brand/30 fluid-xs inline-flex w-fit items-center gap-2 rounded-full border px-4 py-1.5 font-bold shadow-xs`}>
      <span className={laufendDot("xs")} />
      {children}
    </div>
  );
}
