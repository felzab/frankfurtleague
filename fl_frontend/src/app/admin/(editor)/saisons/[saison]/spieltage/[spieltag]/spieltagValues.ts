import { dayOf } from "@/core/format";

import type { CalendarDay } from "@/core/format";
import type { FLSpieltagAdmin } from "@/core/generated/client/types";

/** What the matchday editor's fields hold: the matchday's first and last day, each `null` while it is undated. */
export type SpieltagValues = { start: CalendarDay | null; end: CalendarDay | null };

export const valuesOf = (spieltag: Pick<FLSpieltagAdmin, "start" | "end">): SpieltagValues => ({
  start: dayOf(spieltag.start),
  end: dayOf(spieltag.end),
});

/**
 * The boxes a save needs filled that are empty, by the editor's field names, judged on the matchday's values with the
 * editor's changes over them: the write takes both dates, so a day emptied, or one the matchday never held and the
 * editor left empty, is required. The editor's draft holds the same values, so the browser's pass asks the same.
 */
export const requiredOf = ({ start, end }: Readonly<Record<keyof SpieltagValues, unknown>>): readonly (keyof SpieltagValues)[] => [
  ...(start === null ? (["start"] as const) : []),
  ...(end === null ? (["end"] as const) : []),
];
