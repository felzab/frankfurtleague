/** A calendar day as the API stores it, `YYYY-MM-DD`. */
export type Kalendertag = `${number}-${number}-${number}`;

/** A time of day as the API stores it, `HH:MM` or `HH:MM:SS`. */
export type Uhrzeit = `${number}:${number}` | `${number}:${number}:${number}`;

/** One side's figure each, as a fixture and its shoot-out store them. */
export type Paar = { readonly team1: number; readonly team2: number };

// Every instant is shown on the league's clock: without a zone the runtime's decides, so a server in
// UTC and a browser elsewhere disagree about the day and the hour. The frontend's one spelling of it.
export const ZEITZONE = "Europe/Berlin";

const DATUM = new Intl.DateTimeFormat("de-DE", { timeZone: ZEITZONE, day: "2-digit", month: "2-digit", year: "numeric" });
const DATUM_WOCHENTAG = new Intl.DateTimeFormat("de-DE", { timeZone: ZEITZONE, weekday: "short", day: "2-digit", month: "2-digit" });
const DATUM_LANG = new Intl.DateTimeFormat("de-DE", { timeZone: ZEITZONE, day: "numeric", month: "long", year: "numeric" });
const ZEITPUNKT = new Intl.DateTimeFormat("de-DE", { timeZone: ZEITZONE, dateStyle: "long", timeStyle: "short" });
const UHRZEIT = new Intl.DateTimeFormat("de-DE", { timeZone: ZEITZONE, hour: "2-digit", minute: "2-digit" });
// A stored time of day names no instant, so it is read in UTC, where no clock change can move it.
const UHRZEIT_GESPEICHERT = new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" });
const ZAHL = new Intl.NumberFormat("de-DE");
const EURO = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const AUFZAEHLUNG = new Intl.ListFormat("de-DE", { type: "conjunction" });

function alsInstant(tag: Kalendertag | Date): Date {
  if (tag instanceof Date) return tag;
  const [jahr = 0, monat = 1, tagImMonat = 1] = tag.split("-").map(Number);
  // Midday UTC is the same calendar day in Berlin in summer and in winter, so the zone cannot shift it.
  return new Date(Date.UTC(jahr, monat - 1, tagImMonat, 12));
}

/** „24.10.2026“: a date in a list, a table or a field message. */
export const formatDatum = (tag: Kalendertag | Date): string => DATUM.format(alsInstant(tag));

/** „So., 14.03.“: a match's day in its row, whose season already names the year. */
export const formatDatumMitWochentag = (tag: Kalendertag | Date): string => DATUM_WOCHENTAG.format(alsInstant(tag));

/** „24. Oktober 2026“: a date inside a sentence or a mail. */
export const formatDatumLang = (tag: Kalendertag | Date): string => DATUM_LANG.format(alsInstant(tag));

/** „15:30“. */
export function formatUhrzeit(zeit: Uhrzeit | Date): string {
  if (zeit instanceof Date) return UHRZEIT.format(zeit);
  const [stunde = 0, minute = 0] = zeit.split(":").map(Number);
  return UHRZEIT_GESPEICHERT.format(Date.UTC(1970, 0, 1, stunde, minute));
}

/**
 * „24. Oktober 2026 um 15:30“: an instant a reader checks against their own day, in a page or a mail, to the
 * minute, since a link open 24 hours lapses mid-day. An unreadable stored instant is printed as it was
 * stored: `Intl`'s `format` throws on it, which would take a whole page or mail with it.
 */
export function formatZeitpunkt(zeitpunkt: string | Date): string {
  const datum = typeof zeitpunkt === "string" ? new Date(zeitpunkt) : zeitpunkt;
  return Number.isNaN(datum.getTime()) ? String(zeitpunkt) : ZEITPUNKT.format(datum);
}

/**
 * „01.09.2025 – 30.06.2026“, the one place a dash renders; the locale drops what both ends share. The
 * runtime's ICU data decides the spaces around the dash (`format.test.ts` holds Node's thin spaces), and a
 * browser's may write others, so a span is formatted on the server and handed to a client component as a
 * string: formatted during a client component's server render, it hydrates against different text.
 */
export const formatZeitraum = (von: Kalendertag | Date, bis: Kalendertag | Date): string => DATUM.formatRange(alsInstant(von), alsInstant(bis));

/** „1.234,5“. */
export const formatZahl = (zahl: number): string => ZAHL.format(zahl);

/** „25,00 €“. */
export const formatEuro = (betrag: number): string => EURO.format(betrag);

/** „A, B und C“, with no comma before the last item; one item as itself, none as nothing. */
export const formatAufzaehlung = (eintraege: readonly string[]): string => AUFZAEHLUNG.format(eintraege);

/** The mark between a score's two figures, for a score drawn as two parts as much as one string. */
export const ERGEBNIS_TRENNER = ":";

/** „3:1“; after a shoot-out, each side's goals and shoot-out goals added, „n. E.“ placed beside it. */
export function formatErgebnis(tore: Paar, elfmeterschiessen?: Paar | null): string {
  const team1 = tore.team1 + (elfmeterschiessen?.team1 ?? 0);
  const team2 = tore.team2 + (elfmeterschiessen?.team2 ?? 0);
  return `${team1}${ERGEBNIS_TRENNER}${team2}`;
}
