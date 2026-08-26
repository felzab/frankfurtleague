import type { FLAddress } from "../schemas";

/**
 * One placeholder per category, so an absent value looks the same everywhere it appears. Spelled at the call site
 * instead, the same absence reads two ways on one screen.
 */
export const PLACEHOLDER = {
  datum: "TBD",
  uhrzeit: "--:--",
  ergebnis: "-:-",
  /**
   * A related entity nobody assigned, a venue or a referee. Named in words, `docs/frontend/spec.md` §1.12 ruling out a
   * lone glyph, and generic rather than `Ohne Ort`: both call sites stand under a heading already naming the entity.
   */
  entity: "Keine Angabe",
  /** A fixture side with no occupant and no provenance label. A bracket slot that knows where its team comes from shows that. */
  slot: "Noch offen",
} as const;

const EUR = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

/** The formatter is module-level, so the admin tables do not build a fresh `Intl.NumberFormat` per row. */
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

/** Takes a string rather than a domain object: the call sites feed genuinely different queries, and only the shell is shared. */
export function buildMapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

// `timeZone` is what carries this: without one the runtime's zone decides, so a server in UTC and a
// browser west of it disagree about the day a fixture falls on.
const SPIEL_DATE_FORMATTER = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** Formats a `YYYY-MM-DD` fixture date as a German calendar date, stable across server and client. */
export function formatSpielDatum(datum: string | null, fallback: string = PLACEHOLDER.datum): string {
  if (!datum) return fallback;
  // Midday UTC holds the same calendar date from UTC-11 to UTC+11, so the instant alone cannot shift the day.
  return SPIEL_DATE_FORMATTER.format(new Date(`${datum}T12:00:00Z`));
}
