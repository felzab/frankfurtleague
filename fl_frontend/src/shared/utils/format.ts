/**
 * SHARED · display formatting
 *
 * Everything that turns a stored value into something a German-speaking reader sees: currency,
 * dates, times, addresses, and the placeholders that stand in for absent data.
 *
 * Invariants:
 * - One placeholder per category, from `PLACEHOLDER` — inventions read three ways on one screen.
 * - Dates format with an explicit Europe/Berlin instant — a bare `new Date(...)` shifts the day.
 */

import type { FLAddress } from "../schemas";

/**
 * The app's missing-data placeholders, one per category (decided 2026-07-30).
 *
 * The rule is that a category looks the same everywhere it appears. Spelled at the call site
 * instead, the same absent value reads differently per component — a result as `"- : -"` on the main
 * match card and `"-:-"` on the compact ones, both on screen at once in some flows.
 */
export const PLACEHOLDER = {
  datum: "TBD",
  uhrzeit: "--:--",
  ergebnis: "-:-",
  /** Names of absent related entities — a venue or referee that was never assigned. */
  entity: "/",
  /**
   * A fixture side with no occupant and no provenance label either — an opponent nobody has entered
   * yet. A bracket slot that knows where its team comes from shows that instead.
   */
  slot: "Noch offen",
} as const;

const EUR = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

/**
 * Formats a euro amount for display. The formatter is module-level and constructed once, so the
 * admin tables do not build a fresh `Intl.NumberFormat` per row.
 */
export const formatEuro = (value: number): string => EUR.format(value);

/** Normalises a stored `HH:MM[:SS]` time to `HH:MM`, or returns the placeholder. */
export function formatUhrzeit(uhrzeit: string | null | undefined, fallback: string = PLACEHOLDER.uhrzeit): string {
  if (!uhrzeit) return fallback;
  return uhrzeit.slice(0, 5);
}

export function formatAddress(address?: FLAddress): string {
  if (!address) return "Keine Adresse hinterlegt";

  // Stadtteil is optional; an empty one renders nothing rather than an empty "()" tail.
  const stadtteil = address.stadtteil.trim() === "" ? "" : ` (${address.stadtteil})`;
  return `${address.strasse} ${address.hausnummer}, ${address.plz} ${address.stadt}${stadtteil}`;
}

export function formatAddressFull(address: FLAddress): string {
  // Joined and filtered rather than templated, so an empty optional part cannot leave a double
  // space in the middle of the line.
  const ort = [address.plz, address.stadtteil, address.stadt].filter((part) => part.trim() !== "").join(" ");
  return `${address.strasse} ${address.hausnummer}, ${ort}, Deutschland`;
}

/**
 * Wraps an already-composed search string in a Google Maps search URL.
 *
 * Takes a string, not a domain object: the three call sites feed it genuinely different queries --
 * a Spielort's name plus full address, a team's short address, and a Spiel's pre-stored `maps_link`
 * -- and those differences are intended. Only the URL shell and the encoding are shared.
 */
export function buildMapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

// Module-level, as `fl_frontend/src/shared/utils/date.ts :: formatter` is. `timeZone` is what
// carries it: without one the runtime's zone decides, so a server in UTC and a browser west of it
// disagree about the day a fixture falls on.
const SPIEL_DATE_FORMATTER = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** Formats a `YYYY-MM-DD` fixture date as a German calendar date, stable across server and client. */
export function formatSpielDatum(datum: string | null, fallback: string = PLACEHOLDER.datum): string {
  if (!datum) return fallback;
  // Midday UTC holds the same calendar date from UTC-11 to UTC+11, so reusing this
  // instant without a timeZone cannot shift the day anywhere the app is read. The
  // formatter above pins the zone regardless.
  return SPIEL_DATE_FORMATTER.format(new Date(`${datum}T12:00:00Z`));
}
