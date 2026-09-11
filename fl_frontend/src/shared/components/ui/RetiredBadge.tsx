import { formatSpielDatum } from "@/shared/utils/format";

import { labelBadge } from "./badges";

/**
 * The day an ENTITY was retired, across the whole league. A squad row taken out of one season is
 * „ausgetragen“ instead and never wears this word (`docs/glossary.md :: inactive_since`).
 */
export function RetiredBadge({ since }: { since: string | null }) {
  return (
    // `danger` and not the squad row's `warning`: the verb pair orders the two, and this is the graver.
    <span className={labelBadge("danger")}>
      {/* This text may grow only to what the Spieler list seats, the narrowest column it reaches
          (`fl_frontend/src/shared/components/ui/adminCrudEmpty.test.ts`). */}
      Stillgelegt&nbsp;<span className="font-numeric tabular-nums">{formatSpielDatum(since)}</span>
    </span>
  );
}
