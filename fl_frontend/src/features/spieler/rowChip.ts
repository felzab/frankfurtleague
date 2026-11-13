import { ACTIVE_CHIP, NOMINEE_CHIP } from "@/kit/stateChips";

import { COPY } from "@/core/copy";

import type { ChipProps } from "@/kit/Chip";

const WORDS = COPY.admin.spieler;

type Row = { inactive_since: string | null; is_nachnominiert: boolean; nummer_double?: boolean };

/**
 * The one chip after a player's name where the row is out of the ordinary: „Ausgetragen“ once the row left the squad,
 * else „Nachnominiert“, which holds for the season; „Nummer doppelt“ asks for a look and stands only where neither does.
 * A regular row has none: the pupil's own tile names no default.
 */
export function rowChip(row: Row): ChipProps | undefined {
  if (row.inactive_since !== null) return { tone: "neutral", label: WORDS.deregistered };
  if (row.is_nachnominiert) return NOMINEE_CHIP;
  return row.nummer_double === true ? { tone: "warn", label: WORDS.nummerDouble } : undefined;
}

/** The row's state, a list's „Stand“ column's and the editor's head alike: its one chip, „Aktiv“ for a regular row. */
export function rowState(row: Row): ChipProps {
  return rowChip(row) ?? ACTIVE_CHIP;
}
