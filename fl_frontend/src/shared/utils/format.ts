/**
 * SHARED · display formatting
 *
 * Everything that turns a stored value into something a German-speaking reader sees: currency, dates,
 * times, addresses, and the placeholders that stand in for absent data.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • One placeholder per category, taken from `PLACEHOLDER`. A component inventing its own is how the
 *     same missing result came to read three different ways on one screen.
 *   • Dates are formatted from the `YYYY-MM-DD` string with an explicit Europe/Berlin instant, never
 *     from a bare `new Date(...)` — the viewer's zone would otherwise shift the day.
 */

import type { FLAddress } from "../schemas";

/**
 * The app's missing-data placeholders, one per category (owner decision, 2026-07-30).
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
   * yet. A bracket slot that knows where its team comes from shows that instead (ADR-0041).
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

  return `${address.strasse} ${address.hausnummer}, ${address.plz} ${address.stadt} (${address.stadtteil})`;
}

export function formatAddressFull(address: FLAddress): string {
  return `${address.strasse} ${address.hausnummer}, ${address.plz} ${address.stadtteil ?? ""} ${address.stadt}, Deutschland`;
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

// Module-level, constructed once (same pattern as date.ts:12). The timeZone is the load-bearing
// part: without it the runtime's zone decides, so a server in UTC and a browser west of it
// disagree about which day a fixture falls on.
const SPIEL_DATE_FORMATTER = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** Formats a `YYYY-MM-DD` fixture date as a German calendar date, stable across server and client. */
export function formatSpielDatum(datum: string | null, fallback: string = PLACEHOLDER.datum): string {
  if (!datum) return fallback;
  // Midday UTC lands on the same calendar date from UTC-11 to UTC+11, so a consumer that reuses
  // this instant without a timeZone still cannot shift the day anywhere the app is realistically
  // read. (12:00Z + 12h is already the next day, so UTC+12 and beyond are not covered -- which is
  // moot here, because the formatter above pins the zone.)
  return SPIEL_DATE_FORMATTER.format(new Date(`${datum}T12:00:00Z`));
}
