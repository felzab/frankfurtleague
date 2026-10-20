/**
 * Mirrored from `fl_backend/app/shared/schemas/bounds.py`: how long an address change's link stays open,
 * so a page and a mail state the instant the backend refuses at. One figure for both lanes: a change
 * belongs to an address.
 */
export const ADRESSWECHSEL_GUELTIG_STUNDEN = 24;

/**
 * Mirrored from `fl_backend/app/shared/schemas/bounds.py`: the days a change an administrator started
 * with a reason waits after its confirmation, so the address on file can still stop it.
 */
export const ADRESSWECHSEL_WARTEZEIT_TAGE = 7;

// Indexed by the constant, so a waiting time this map has no words for fails the type check rather
// than printing a numeral beside every other duration the pages spell out.
export const ADRESSWECHSEL_WARTEZEIT_DAUER = ({ 7: "eine Woche" } as const)[ADRESSWECHSEL_WARTEZEIT_TAGE];

/** How a change reaches its effect, as the backend stores it. */
export type AdresswechselWeg = "konto" | "freigabe" | "wartezeit";

/** Which lane's collection carries a change, and so which page its links open. */
export type AdresswechselArt = "spieler" | "schiedsrichter";

// The zone named rather than taken from the server's clock: the image runs UTC, and a deadline a
// reader checks against their own evening is stated in the zone they live in.
const ZEITPUNKT = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "long", timeStyle: "short" });

/** An instant of a change as every page and mail states it, to the minute: a link open 24 hours lapses mid-day. */
export function adresswechselZeitpunkt(instant: string | Date): string {
  const datum = typeof instant === "string" ? new Date(instant) : instant;
  // `Intl.format` throws on an unreadable instant, which would take a whole page or mail with it.
  return Number.isNaN(datum.getTime()) ? String(instant) : ZEITPUNKT.format(datum);
}
