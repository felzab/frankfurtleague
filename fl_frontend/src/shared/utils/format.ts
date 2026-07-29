// eslint-disable-next-line no-restricted-imports -- known violation, removed by ledger row R2-2.2 (Wave 4)
import type { FLSpielort } from "@/features/spielorte/schemas";
import type { FLAddress } from "../schemas";

export function formatAddress(address?: FLAddress): string {
  if (!address) return "Keine Adresse hinterlegt";

  return `${address.strasse} ${address.hausnummer}, ${address.plz} ${address.stadt} (${address.stadtteil})`;
}

export function formatAddressFull(address: FLAddress): string {
  return `${address.strasse} ${address.hausnummer}, ${address.plz} ${address.stadtteil ?? ""} ${address.stadt}, Deutschland`;
}

export function formatMapsLink(ort: FLSpielort) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${ort.name}, ${formatAddressFull(ort.address)}`)}`;
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
export function formatSpielDatum(datum: string | null, fallback = "TBD"): string {
  if (!datum) return fallback;
  // Midday UTC lands on the same calendar date from UTC-11 to UTC+11, so a consumer that reuses
  // this instant without a timeZone still cannot shift the day anywhere the app is realistically
  // read. (12:00Z + 12h is already the next day, so UTC+12 and beyond are not covered -- which is
  // moot here, because the formatter above pins the zone.)
  return SPIEL_DATE_FORMATTER.format(new Date(`${datum}T12:00:00Z`));
}
