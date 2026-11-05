import { TIME_ZONE } from "@/core/format";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLEinwilligungEvidence, FLEinwilligungReceipt } from "@/core/generated/client/types";

// Europe/Berlin, as every other date in this app is rendered: the evidence stores an instant in UTC,
// and an administrator reading "22:30" for an act at 00:30 would put it on the day before.
const BELEG_ZEITPUNKT = new Intl.DateTimeFormat("de-DE", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** One act's instant and label, the stored value kept where the instant cannot be read rather than failing the panel. */
function beleg({ at, text_version }: FLEinwilligungReceipt): string {
  const instant = new Date(at);
  const wann = Number.isNaN(instant.getTime()) ? at : `${BELEG_ZEITPUNKT.format(instant)} Uhr`;

  return `${wann}, Fassung ${text_version}`;
}

/** A record's confirmation day, or `null` where its person has not confirmed it. */
export type Bestaetigung = { at: string } | null;

/** The confirmation a consent record holds: every confirmation asks both choices under their one wording each. */
export function bestaetigungOf({ confirmed_at }: { confirmed_at: string | null }): Bestaetigung {
  return confirmed_at === null ? null : { at: confirmed_at };
}

/**
 * The act one consent choice stands on, for an administrator's readout: its own evidence, else the confirmation, the
 * whole proof of a contact seat confirmed before choices carried evidence.
 */
export function beschreibeNachweis(evidence: FLEinwilligungEvidence | null, bestaetigung: Bestaetigung): string {
  if (evidence !== null) {
    const zuvor = evidence.given_before === null ? "" : ` (zuvor erteilt am ${beleg(evidence.given_before)})`;
    return `seit ${beleg(evidence)}${zuvor}`;
  }

  if (bestaetigung === null) return "Nicht bestätigt";

  return `seit der Bestätigung am ${formatSpielDatum(bestaetigung.at)}`;
}
