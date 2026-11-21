import { COPY } from "@/core/copy/shared";

import type { FLAufstellungPhase, FLAufstellungStartersMax } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";

/** How many of a line-up start at the most, which is also how many regular players leave no place for a nominee. */
export const STARTERS_MAX = 11 satisfies FLAufstellungStartersMax;

/**
 * A missing line-up's phase as its chip: none while it is open, „Überfällig“ from its due mark, and „Gesperrt“ from the
 * lock, after which only the league enters it.
 */
export const AUFSTELLUNG_CHIP = {
  open: undefined,
  overdue: { tone: "danger", label: COPY.aufstellung.overdue },
  locked: { tone: "neutral", label: COPY.aufstellung.locked },
} as const satisfies Record<FLAufstellungPhase, ChipProps | undefined>;
