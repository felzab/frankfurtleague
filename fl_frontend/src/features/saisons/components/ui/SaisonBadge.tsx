import { labelBadge } from "@/shared/components/ui/badges";

import type { FLSaisonStatus } from "@/features/saisons/schemas";
import type { PillTone } from "@/shared/components/ui/badges";

// A record rather than a chain: `FLSaisonStatus` is a closed enum, so a fourth state fails to
// compile here rather than falling through to `past`'s tone.
const TINT: Record<FLSaisonStatus, PillTone> = {
  active: "success",
  future: "info",
  // Done, as a played fixture is
  // (`fl_frontend/src/features/spiele/components/ui/SpielStatusChip.tsx :: STATUS_TINT`).
  past: "success",
};

const WORT: Record<FLSaisonStatus, string> = { active: "Laufend", future: "Geplant", past: "Abgeschlossen" };

/** The app's one wording and one palette for a season's state. */
export function SaisonBadge({ status, className = "" }: { status: FLSaisonStatus; className?: string }) {
  return <span className={`${labelBadge(TINT[status])} ${className}`}>{WORT[status]}</span>;
}
