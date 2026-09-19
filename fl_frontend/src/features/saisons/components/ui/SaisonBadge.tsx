import { laufendDot } from "@/features/saisons/components/ui/laufendDot";
import { labelBadge } from "@/shared/components/ui/badges";

import type { FLSaisonStatus } from "@/features/saisons/schemas";
import type { PillTone } from "@/shared/components/ui/badges";

// A record rather than a chain: `FLSaisonStatus` is a closed enum, so a fourth state fails to
// compile here rather than taking a live state's tone.
const TINT: Record<FLSaisonStatus, PillTone> = {
  // The running season wears the brand, as `fl_frontend/src/features/saisons/components/ui/SaisonChip.tsx`
  // already does for that same season on the public pages. Never `success`, which `past` holds.
  active: "brand",
  future: "info",
  // Done, as a played fixture is
  // (`fl_frontend/src/features/spiele/components/ui/SpielStatusChip.tsx :: STATUS_TINT`).
  past: "success",
};

const WORT: Record<FLSaisonStatus, string> = { active: "Laufend", future: "Geplant", past: "Abgeschlossen" };

/** The app's one wording and one palette for a season's state. */
export function SaisonBadge({ status, className = "" }: { status: FLSaisonStatus; className?: string }) {
  return (
    <span className={`${labelBadge(TINT[status])} gap-1 ${className}`}>
      {/* In the light theme the brand tint and `past`'s success tint are one colour, so `active`
          cannot ride on hue alone. */}
      {status === "active" && <span className={laufendDot("xxs")} />}
      {WORT[status]}
    </span>
  );
}
