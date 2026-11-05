import { parseDate } from "@internationalized/date";

import { now } from "@/core/clock";

import type { CalendarDay } from "@/core/format";

/** What a new season's create dialog starts from: its year and its two days. */
export type NextSaison = { id: string; start: CalendarDay | null; end: CalendarDay | null };

// A 29 February one year on is the 28th, as the calendar's own arithmetic constrains it.
const oneYearOn = (day: string): CalendarDay => parseDate(day).add({ years: 1 }).toString() as CalendarDay;

/**
 * The likeliest next season: the newest one a year on, its id and both its days. With no season yet, next year's id
 * and no days, which nothing in the league suggests.
 */
export function nextSaisonOf(newest: { id: string; start_date: string; end_date: string } | undefined): NextSaison {
  if (newest === undefined) return { id: String(now().getFullYear() + 1), start: null, end: null };
  return { id: String(Number(newest.id) + 1), start: oneYearOn(newest.start_date), end: oneYearOn(newest.end_date) };
}
