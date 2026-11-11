/** A calendar day as the API stores it, `YYYY-MM-DD`. */
export type CalendarDay = `${number}-${number}-${number}`;

/** A time of day as the API stores it, `HH:MM` or `HH:MM:SS`. */
export type TimeOfDay = `${number}:${number}` | `${number}:${number}:${number}`;

// A served day or time in the type the formats take: the backend's schema holds each to its stored format, which the
// generated client types as a plain string, so the one narrowing stands here and nowhere else.
export function dayOf(date: string): CalendarDay;
export function dayOf(date: string | null): CalendarDay | null;
export function dayOf(date: string | null): CalendarDay | null {
  return date as CalendarDay | null;
}

export function timeOf(time: string): TimeOfDay;
export function timeOf(time: string | null): TimeOfDay | null;
export function timeOf(time: string | null): TimeOfDay | null {
  return time as TimeOfDay | null;
}

/** One side's figure each, as a fixture and its shoot-out store them. */
export type Pair = { readonly team1: number; readonly team2: number };

// Every instant is shown on the league's clock: without a zone the runtime's decides, so a server in
// UTC and a browser elsewhere disagree about the day and the hour. The frontend's one spelling of it.
const TIME_ZONE = "Europe/Berlin";

const DATE = new Intl.DateTimeFormat("de-DE", { timeZone: TIME_ZONE, day: "2-digit", month: "2-digit", year: "numeric" });
const DATE_WITH_WEEKDAY = new Intl.DateTimeFormat("de-DE", { timeZone: TIME_ZONE, weekday: "short", day: "2-digit", month: "2-digit" });
const DATE_WITH_WEEKDAY_AND_YEAR = new Intl.DateTimeFormat("de-DE", {
  timeZone: TIME_ZONE,
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const DATE_LONG = new Intl.DateTimeFormat("de-DE", { timeZone: TIME_ZONE, day: "numeric", month: "long", year: "numeric" });
const INSTANT = new Intl.DateTimeFormat("de-DE", { timeZone: TIME_ZONE, dateStyle: "long", timeStyle: "short" });
const INSTANT_SHORT = new Intl.DateTimeFormat("de-DE", { timeZone: TIME_ZONE, dateStyle: "medium", timeStyle: "short" });
const TIME = new Intl.DateTimeFormat("de-DE", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" });
// A stored time of day names no instant, so it is read in UTC, where no clock change can move it.
const TIME_SAVED = new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" });
// A stored day and time together, read in UTC as the time alone is, in the instant's own form.
const DAY_AND_TIME_SAVED = new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", dateStyle: "long", timeStyle: "short" });
const NUMBER = new Intl.NumberFormat("de-DE");
const SIGNED = new Intl.NumberFormat("de-DE", { signDisplay: "exceptZero" });
const EURO = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const LIST = new Intl.ListFormat("de-DE", { type: "conjunction" });

// The ISO day's parts, which the Canadian English locale writes in that order.
const ISO_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** The league's calendar day an instant falls on, as a stored `YYYY-MM-DD` day: the day the backend judges an age on. */
export const dayIn = (instant: Date): CalendarDay => ISO_DAY.format(instant) as CalendarDay;

function asInstant(day: CalendarDay | Date): Date {
  if (day instanceof Date) return day;
  const [year = 0, month = 1, dayOfMonth = 1] = day.split("-").map(Number);
  // Midday UTC is the same calendar day in Berlin in summer and in winter, so the zone cannot shift it.
  return new Date(Date.UTC(year, month - 1, dayOfMonth, 12));
}

/** „24.10.2026“: a date in a list, a table or a field message. */
export const formatDate = (day: CalendarDay | Date): string => DATE.format(asInstant(day));

/** „So., 14.03.“: a match's day in its row, whose season already names the year. */
export const formatDateWithWeekday = (day: CalendarDay | Date): string => DATE_WITH_WEEKDAY.format(asInstant(day));

/** „Fr., 06.11.2026“: one match's day on its own, in its pop-up and on its page, where no season names the year. */
export const formatDateWithWeekdayAndYear = (day: CalendarDay | Date): string => DATE_WITH_WEEKDAY_AND_YEAR.format(asInstant(day));

/** „24. Oktober 2026“: a date inside a sentence or a mail. */
export const formatDateLong = (day: CalendarDay | Date): string => DATE_LONG.format(asInstant(day));

/** „15:30“. */
export function formatTime(time: TimeOfDay | Date): string {
  if (time instanceof Date) return TIME.format(time);
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  return TIME_SAVED.format(Date.UTC(1970, 0, 1, hour, minute));
}

/**
 * „24. Oktober 2026 um 15:30“: an instant a reader checks against their own day, in a page or a mail, to the
 * minute, since a link open 24 hours lapses mid-day. An unreadable stored instant is printed as it was
 * stored: `Intl`'s `format` throws on it, which would take a whole page or mail with it.
 */
export function formatInstant(instant: string | Date): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  return Number.isNaN(date.getTime()) ? String(instant) : INSTANT.format(date);
}

/**
 * „07.11.2026, 18:04“: an instant in a list's narrow cell, where `formatInstant`'s words would not fit. An unreadable
 * stored instant is printed as stored, as `formatInstant` prints it.
 */
export function formatInstantShort(instant: string | Date): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  return Number.isNaN(date.getTime()) ? String(instant) : INSTANT_SHORT.format(date);
}

/**
 * „14. März 2027 um 15:30“: a fixture's stored day and time inside a sentence or a mail, worded as `formatInstant`
 * words an instant. The pair is the league's wall clock and names no instant, so no zone may move it.
 */
export function formatDayAndTime(day: CalendarDay, time: TimeOfDay): string {
  const [year = 0, month = 1, dayOfMonth = 1] = day.split("-").map(Number);
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  return DAY_AND_TIME_SAVED.format(Date.UTC(year, month - 1, dayOfMonth, hour, minute));
}

/**
 * „01.09.2025 – 30.06.2026“, the one place a dash renders; the locale drops what both ends share. The
 * runtime's ICU data decides the spaces around the dash, and a browser's may write others, so a span is formatted on
 * the server and handed to a client component as a string: formatted during a client component's server render, it
 * hydrates against different text.
 */
export const formatPeriod = (from: CalendarDay | Date, to: CalendarDay | Date): string => DATE.formatRange(asInstant(from), asInstant(to));

/** „1.234,5“. */
export const formatNumber = (number: number): string => NUMBER.format(number);

/** „+3“, „0“, „-3“: a difference, its sign written wherever it is not level. */
export const formatSigned = (number: number): string => SIGNED.format(number);

/** „3.“: a place or a position, a German ordinal being its figure and a full stop. */
export const formatOrdinal = (number: number): string => `${NUMBER.format(number)}.`;

/** „25,00 €“. */
export const formatEuro = (amount: number): string => EURO.format(amount);

/** „A, B und C“, with no comma before the last item; one item as itself, none as nothing. */
export const formatList = (entries: readonly string[]): string => LIST.format(entries);

/** The mark between a score's two figures, for a score drawn as two parts as much as one string. */
export const ERGEBNIS_SEPARATOR = ":";

/** „3:1“; after a shoot-out, each side's goals and shoot-out goals added, „n. E.“ placed beside it. */
export function formatErgebnis(tore: Pair, elfmeterschiessen?: Pair | null): string {
  const team1 = tore.team1 + (elfmeterschiessen?.team1 ?? 0);
  const team2 = tore.team2 + (elfmeterschiessen?.team2 ?? 0);
  return `${team1}${ERGEBNIS_SEPARATOR}${team2}`;
}
