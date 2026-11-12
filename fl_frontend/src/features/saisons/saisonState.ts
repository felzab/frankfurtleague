import "server-only";

import { SAISON_CHIP } from "@/kit/saisonChip";

import type { FLSaisonAdmin } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";

/**
 * Where a season stands, in the landing's one vocabulary, so a season reads alike on the public card and in the
 * administration, read off the season's own facts as the landing reads them: planned before its start, running from
 * it, decided once its last places are. Which season the site shows is a fact of its own, never a state word.
 */
export function saisonChipOf(saison: Pick<FLSaisonAdmin, "begun" | "decided">): ChipProps {
  if (saison.decided) return SAISON_CHIP.decided;
  return saison.begun ? SAISON_CHIP.running : SAISON_CHIP.planned;
}
