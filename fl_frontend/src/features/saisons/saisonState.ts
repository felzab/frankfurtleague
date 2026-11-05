import "server-only";

import { SERVER_COPY } from "@/core/serverCopy";

import type { FLSaisonAdmin } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";

const STATE = SERVER_COPY.landing.saison.state;

/**
 * Where a season stands, in the landing's one vocabulary, so a season reads alike on the public card and in the
 * administration, read off the season's own facts as the landing reads them: planned before its start, running from
 * it, decided once its last places are. Which season the site shows is a fact of its own, never a state word.
 */
export function saisonChipOf(saison: Pick<FLSaisonAdmin, "begun" | "decided">): ChipProps {
  if (saison.decided) return { tone: "warn", label: STATE.decided };
  return saison.begun ? { tone: "success", label: STATE.running } : { tone: "info", label: STATE.planned };
}
