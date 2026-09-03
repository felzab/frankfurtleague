import { formatSpielDatum } from "@/shared/utils/format";

import { LABEL_BADGE } from "./badges";

/**
 * The day an ENTITY was retired, across the whole league. A squad row taken out of one season is
 * „ausgetragen“ instead and never wears this word (`docs/glossary.md :: inactive_since`).
 */
export function RetiredBadge({ since }: { since: string | null }) {
  return <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Stillgelegt seit {formatSpielDatum(since)}</span>;
}
