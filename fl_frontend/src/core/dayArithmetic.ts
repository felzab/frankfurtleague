import { parseDate } from "@internationalized/date";

import type { CalendarDay } from "./format";

// Arithmetic on calendar days, which only the pages counting days load: `format.ts`, which the catalogue imports and
// so every route loads, holds none of it.

/**
 * The day `years` after `day`, on the Gregorian calendar of `@internationalized/date`: the same month and day, or the
 * month's last day where that year holds no such day, so 29 February moves to 28 February.
 */
export const yearsLater = (day: CalendarDay, years: number): CalendarDay => parseDate(day).add({ years }).toString() as CalendarDay;

/**
 * The latest birthdate `years` old on `today`: the same day that many years back, the month's last day where that year
 * holds none. A person born on 29 February is a year older from 1 March where the year holds no 29th, as the backend
 * counts whole years (`fl_backend/app/shared/age.py :: whole_years_between`).
 */
export const bornBy = (today: CalendarDay, years: number): CalendarDay => yearsLater(today, -years);

/** The day before `day`. */
export const dayBefore = (day: CalendarDay): CalendarDay => parseDate(day).subtract({ days: 1 }).toString() as CalendarDay;

/** The day after `day`. */
export const dayAfter = (day: CalendarDay): CalendarDay => parseDate(day).add({ days: 1 }).toString() as CalendarDay;

/** The earliest birthdate at most `years` old on `today`: the day after the latest that is a year older. */
export const bornAfter = (today: CalendarDay, years: number): CalendarDay =>
  parseDate(bornBy(today, years + 1))
    .add({ days: 1 })
    .toString() as CalendarDay;
