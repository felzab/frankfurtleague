import { formatSpielDatum } from "@/shared/utils/format";

import type { FLEinwilligungBeleg, FLEinwilligungNachweis } from "@/core/generated/client/types";

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
 * A record's confirmation, its day and label, or `null` where its person has not confirmed it. `gefragt` is whether
 * the label's page asked the choice read beside it, `null` where nobody could check.
 */
export type Bestaetigung = { am: string; textVersion: string; gefragt: boolean | null } | null;

type BestaetigterDatensatz = { bestaetigt_am: string | null; text_version: string };

/** The confirmation a consent record holds, for a choice every page confirming such a record asks. */
export function bestaetigungOf({ bestaetigt_am, text_version }: BestaetigterDatensatz): Bestaetigung {
  return bestaetigt_am === null ? null : { am: bestaetigt_am, textVersion: text_version, gefragt: true };
}

/** Per confirmation label, whether its contact page asked the media choice; a label nobody could read is absent. */
export type MedienFragen = Readonly<Record<string, boolean>>;

/**
 * A contact seat's confirmation for its media choice, which the contact pages asked from one label on: a seat confirmed
 * before then and kept holds the choice the server wrote for it, which its person never made.
 */
export function medienBestaetigungOf(datensatz: BestaetigterDatensatz, medienFragen: MedienFragen): Bestaetigung {
  const bestaetigung = bestaetigungOf(datensatz);
  if (bestaetigung === null) return null;

  const gefragt = Object.hasOwn(medienFragen, bestaetigung.textVersion) ? medienFragen[bestaetigung.textVersion] : undefined;
  return { ...bestaetigung, gefragt: gefragt ?? null };
}

/**
 * The act one consent choice stands on, for an administrator's readout: its own evidence, else the confirmation, the
 * whole proof of a contact seat confirmed before choices carried evidence, where its page asked the choice at all.
 */
export function beschreibeNachweis(nachweis: FLEinwilligungNachweis | null, bestaetigung: Bestaetigung): string {
  if (nachweis !== null) {
    const zuvor = nachweis.erteilt_zuvor === null ? "" : ` (zuvor erteilt am ${beleg(nachweis.erteilt_zuvor)})`;
    return `seit ${beleg(nachweis)}${zuvor}`;
  }

  if (bestaetigung === null) return "Nicht bestätigt";

  const am = formatSpielDatum(bestaetigung.am);
  if (bestaetigung.gefragt === false) return `Bei der Bestätigung am ${am} nicht gefragt (Fassung ${bestaetigung.textVersion})`;
  // Never the confirmation as the act where nobody could check that its page asked: that is the claim this guards.
  if (bestaetigung.gefragt === null) return `Bestätigt am ${am} (Fassung ${bestaetigung.textVersion}), nicht geprüft, ob dabei gefragt`;

  return `seit der Bestätigung am ${am}, Fassung ${bestaetigung.textVersion}`;
}
