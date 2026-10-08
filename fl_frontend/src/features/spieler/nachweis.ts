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

/**
 * The act one consent choice stands on, for an administrator's readout. A choice with no evidence of its
 * own was never moved after the confirmation, so the confirmation's day and label are its act; an
 * unconfirmed record has none.
 */
export function beschreibeNachweis(nachweis: FLEinwilligungNachweis | null, bestaetigtAm: string | null, textVersion: string | null): string {
  if (nachweis !== null) {
    const zuvor = nachweis.erteilt_zuvor === null ? "" : `; zuvor erteilt am ${beleg(nachweis.erteilt_zuvor)}`;
    return `seit ${beleg(nachweis)}${zuvor}`;
  }

  if (bestaetigtAm === null) return "Nicht bestätigt";

  return `seit der Bestätigung am ${formatSpielDatum(bestaetigtAm)}${textVersion === null ? "" : `, Fassung ${textVersion}`}`;
}
