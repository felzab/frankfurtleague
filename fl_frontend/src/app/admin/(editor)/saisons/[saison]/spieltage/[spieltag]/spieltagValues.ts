import { dayOf } from "@/core/format";

import type { CalendarDay } from "@/core/format";
import type { FLSpieltag } from "@/core/generated/client/types";

/** What the matchday editor's fields hold: the matchday's first and last day, each `null` while it is undated. */
export type SpieltagValues = { start: CalendarDay | null; end: CalendarDay | null };

export const valuesOf = (spieltag: Pick<FLSpieltag, "start" | "end">): SpieltagValues => ({
  start: dayOf(spieltag.start),
  end: dayOf(spieltag.end),
});
