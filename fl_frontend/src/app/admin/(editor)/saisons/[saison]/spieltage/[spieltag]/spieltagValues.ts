import { dayOf } from "@/core/format";

import type { CalendarDay } from "@/core/format";
import type { FLSpieltag } from "@/core/generated/client/types";

/** What the matchday editor's fields hold: the matchday's first and last day, each `null` while it is undated. */
export type SpieltagValues = { beginn: CalendarDay | null; ende: CalendarDay | null };

/** The editor's values as a stored matchday gives them. */
export const valuesOf = (spieltag: Pick<FLSpieltag, "beginn" | "ende">): SpieltagValues => ({
  beginn: dayOf(spieltag.beginn),
  ende: dayOf(spieltag.ende),
});
