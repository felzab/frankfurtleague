import { LABEL_BADGE } from "@/shared/components/ui/badges";

import type { FLSaisonStatus } from "@/features/saisons/schemas";

// A record rather than a chain: `FLSaisonStatus` is a closed enum, so a fourth state fails to
// compile here rather than falling through to `past`'s grey.
const TINT: Record<FLSaisonStatus, string> = {
  active: "bg-success/15 text-success-strong",
  future: "bg-info/15 text-info-strong",
  past: "bg-muted text-foreground-muted",
};

const WORT: Record<FLSaisonStatus, string> = { active: "Laufend", future: "Geplant", past: "Abgeschlossen" };

/** The app's one wording and one palette for a season's state. */
export function SaisonBadge({ status, className = "" }: { status: FLSaisonStatus; className?: string }) {
  return <span className={`${LABEL_BADGE} ${TINT[status]} ${className}`}>{WORT[status]}</span>;
}
