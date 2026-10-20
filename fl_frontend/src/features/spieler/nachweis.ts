import { formatSpielDatum } from "@/shared/utils/format";

import type { FLEinwilligungBeleg, FLEinwilligungNachweis } from "./schemas";

// Europe/Berlin, as every other date in this app is rendered: the evidence stores an instant in UTC,
// and an administrator reading "22:30" for an act at 00:30 would put it on the day before.
const BELEG_ZEITPUNKT = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** One act's instant and label, the stored value kept where the instant cannot be read rather than failing the panel. */
function beleg({ am, text_version }: FLEinwilligungBeleg): string {
  const instant = new Date(am);
  const wann = Number.isNaN(instant.getTime()) ? am : `${BELEG_ZEITPUNKT.format(instant)} Uhr`;

  return `${wann}, Fassung ${text_version}`;
}

/** A record's confirmation, its day and label, or `null` where its person has not confirmed it. */
export type Bestaetigung = { am: string; textVersion: string } | null;

/** The confirmation a consent record holds, as `beschreibeNachweis` reads it beside a choice's own evidence. */
export function bestaetigungOf({ bestaetigt_am, text_version }: { bestaetigt_am: string | null; text_version: string }): Bestaetigung {
  return bestaetigt_am === null ? null : { am: bestaetigt_am, textVersion: text_version };
}

/**
 * The act one consent choice stands on, for an administrator's readout: its own evidence, else the confirmation,
 * which is the whole proof of a contact seat confirmed before choices carried evidence and kept since.
 */
export function beschreibeNachweis(nachweis: FLEinwilligungNachweis | null, bestaetigung: Bestaetigung): string {
  if (nachweis !== null) {
    const zuvor = nachweis.erteilt_zuvor === null ? "" : ` (zuvor erteilt am ${beleg(nachweis.erteilt_zuvor)})`;
    return `seit ${beleg(nachweis)}${zuvor}`;
  }

  if (bestaetigung === null) return "Nicht bestätigt";

  return `seit der Bestätigung am ${formatSpielDatum(bestaetigung.am)}, Fassung ${bestaetigung.textVersion}`;
}
