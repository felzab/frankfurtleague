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
 * The act one consent choice stands on, for an administrator's readout. Every confirmation evidences
 * both choices, so a choice with none is one its person has not answered.
 */
export function beschreibeNachweis(nachweis: FLEinwilligungNachweis | null): string {
  if (nachweis === null) return "Nicht bestätigt";

  const zuvor = nachweis.erteilt_zuvor === null ? "" : ` (zuvor erteilt am ${beleg(nachweis.erteilt_zuvor)})`;
  return `seit ${beleg(nachweis)}${zuvor}`;
}
