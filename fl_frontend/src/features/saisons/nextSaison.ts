import { parseDate } from "@internationalized/date";

import type { CalendarDay } from "@/core/format";

/** What a new season's create dialog starts from: its two days. */
export type NextSaison = { start: CalendarDay | null; end: CalendarDay | null };

// A 29 February one year on is the 28th, as the calendar's own arithmetic constrains it.
const oneYearOn = (day: string): CalendarDay => parseDate(day).add({ years: 1 }).toString() as CalendarDay;

/**
 * The likeliest next season's days: the newest one's a year on. With no season yet, no days, which nothing in the
 * league suggests.
 */
export function nextSaisonOf(newest: { start_date: string; end_date: string } | undefined): NextSaison {
  if (newest === undefined) return { start: null, end: null };
  return { start: oneYearOn(newest.start_date), end: oneYearOn(newest.end_date) };
}
