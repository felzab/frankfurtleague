import { yearsLater } from "@/core/dayArithmetic";
import { dayOf } from "@/core/format";

import type { CalendarDay } from "@/core/format";

/** What a new season's create dialog starts from: its two days. */
export type NextSaison = { start: CalendarDay | null; end: CalendarDay | null };

/**
 * The likeliest next season's days: the newest one's a year on. With no season yet, no days, which nothing in the
 * league suggests.
 */
export function nextSaisonOf(newest: { start_date: string; end_date: string } | undefined): NextSaison {
  if (newest === undefined) return { start: null, end: null };
  return { start: yearsLater(dayOf(newest.start_date), 1), end: yearsLater(dayOf(newest.end_date), 1) };
}
