/**
 * Mirrored from `fl_backend/app/shared/schemas/bounds.py`: how long an address change's link stays open,
 * so a page and a mail state the instant the backend refuses at.
 */
export const ADRESSWECHSEL_GUELTIG_STUNDEN = 24;

/**
 * Mirrored from `fl_backend/app/shared/schemas/bounds.py`: the days a change an administrator started
 * with a reason waits after its confirmation, so the address on file can still stop it. Exported for
 * `fl_backend/tests/shared/test_frontend_mirrors.py`, which reads it by its `export const` line; the privacy notice's
 * render test holds its words to it.
 * @internal
 */
export const ADRESSWECHSEL_WARTEZEIT_TAGE = 7;

/**
 * Mirrored from `fl_backend/app/shared/schemas/bounds.py`: the days an ended change's record, holding no address,
 * stays so either link can still say how it ended; the privacy notice states it.
 */
export const ADRESSWECHSEL_NACHLAUF_TAGE = 30;

/**
 * Mirrored from `fl_backend/app/shared/schemas/bounds.py`: the days after its start a change moving a grant waits for
 * another administrator's approval before it lapses. Exported for the mirror test, as the waiting time is.
 * @internal
 */
export const ADRESSWECHSEL_GENEHMIGUNG_TAGE = 7;

// Indexed by the constant, so a waiting time this map has no words for fails the type check rather
// than printing a numeral beside every other duration the pages spell out.
export const ADRESSWECHSEL_WARTEZEIT_DAUER = ({ 7: "eine Woche" } as const)[ADRESSWECHSEL_WARTEZEIT_TAGE];
export const ADRESSWECHSEL_GENEHMIGUNG_DAUER = ({ 7: "eine Woche" } as const)[ADRESSWECHSEL_GENEHMIGUNG_TAGE];

/**
 * How a change reaches its effect, as the backend stores it: the one spelling the slice's mirror, the mails
 * and the link reports read, `core` being the layer all three may import.
 */
export const ADRESSWECHSEL_WEGE = ["konto", "freigabe", "wartezeit"] as const;
export type AdresswechselWeg = (typeof ADRESSWECHSEL_WEGE)[number];

// The zone named rather than taken from the server's clock: the image runs UTC, and a deadline a
// reader checks against their own evening is stated in the zone they live in.
const ZEITPUNKT = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "long", timeStyle: "short" });

/** An instant of a change as every page and mail states it, to the minute: a link open 24 hours lapses mid-day. */
export function adresswechselZeitpunkt(instant: string | Date): string {
  const datum = typeof instant === "string" ? new Date(instant) : instant;
  // `Intl.format` throws on an unreadable instant, which would take a whole page or mail with it.
  return Number.isNaN(datum.getTime()) ? String(instant) : ZEITPUNKT.format(datum);
}
