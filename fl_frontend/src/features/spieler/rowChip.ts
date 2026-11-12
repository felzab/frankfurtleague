import { COPY } from "@/core/copy";

import type { ChipProps } from "@/kit/Chip";

const WORDS = COPY.admin.spieler;

/**
 * The one chip after a player's name: „Ausgetragen“ once the row left the squad, else „Nachnominiert“, which holds for
 * the season; „Nummer doppelt“ asks for a look and stands only where neither does.
 */
export function rowChip(row: { inactive_since: string | null; is_nachnominiert: boolean; nummer_double?: boolean }): ChipProps | undefined {
  if (row.inactive_since !== null) return { tone: "neutral", label: WORDS.deregistered };
  if (row.is_nachnominiert) return { tone: "info", label: WORDS.nominee };
  return row.nummer_double === true ? { tone: "warn", label: WORDS.nummerDouble } : undefined;
}
