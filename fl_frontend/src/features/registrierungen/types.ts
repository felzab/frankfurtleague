import type { GekeyteFassung, SpielerAbsatzSchluessel, SpielerWiederkehrendAbsatzSchluessel } from "@/core/einwilligungSeiten";
import type { FLSpielerPosition, FLSpielerStufe } from "@/features/spieler/schemas";
import type { FLEinladungAnsichtResponse, FLEinwilligungUmfang, FLRegistrierungBestaetigungAnsichtResponse } from "./schemas";

/**
 * What the registration page opens on. The token rides only with an invite a submission can still
 * spend: a shut window and a dead link are both read-only states, and a link handed onward from
 * either buys nothing.
 */
export type RegistrierungStart =
  | { zustand: "gueltig"; ansicht: FLEinladungAnsichtResponse; token: string }
  | { zustand: "geschlossen"; ansicht: FLEinladungAnsichtResponse }
  // One member per tag rather than one carrying both: a union-valued discriminant narrows on the
  // positive branch alone, so the two-in-one shape leaves `ansicht` unreachable after the guard.
  | { zustand: "ungueltig" }
  | { zustand: "unlesbar" };

/**
 * The registration form mid-entry. Every field is typed and a widened `null` is a control nobody has
 * answered: the schema is what turns an unanswered one into a field error rather than a type error.
 */
export type RegistrierungFormDraft = {
  vorname: string;
  nachname: string;
  email: string;
  // A STRING mid-entry where the payload's is `string | null`: `""` is a box nobody filled in, and
  // `registrierungPayload` is the one place that turns it into null.
  nummer: string;
  position: FLSpielerPosition | null;
  stufe: FLSpielerStufe | null;
};

/**
 * What a link is once the backend has looked it up. `abgelaufen` and `ungueltig` render one wording:
 * telling them apart would tell a guessed link that a record once existed.
 */
export type SpielerLinkZustand = "bestaetigt" | "abgelaufen" | "ungueltig" | "gesperrt";

/** A link still open, and so a registration that still holds the person the page is about to name. */
export type SpielerBestaetigungGeoeffnet = FLRegistrierungBestaetigungAnsichtResponse & { vorname: string };

export type SpielerBestaetigungAnsicht = { zustand: "gueltig"; ansicht: SpielerBestaetigungGeoeffnet } | { zustand: SpielerLinkZustand };

/** What the confirmation page opens on, the token riding only with a link a press can still spend. */
export type SpielerBestaetigungStart =
  { zustand: "gueltig"; ansicht: SpielerBestaetigungGeoeffnet; token: string } | { zustand: SpielerLinkZustand | "unlesbar" };

/**
 * What a confirmed pupil's answer panel states: the date they sent, and the two choices that stand —
 * the ones they gave on the new pupil's page, or the stored ones the returning pupil's page showed.
 */
export type SpielerBestaetigungGespeichert = {
  geburtsdatum: string;
  umfang: FLEinwilligungUmfang | null;
  medien: boolean | null;
};

/**
 * The stamped words this page renders, handed in by the page rather than imported by the view: the
 * label freezes what a reader saw, and a component reaching for the current one would render words
 * no record cites.
 */
// TOTAL over the enum, so a scope the label has no words for fails at the page that reads it rather
// than rendering as a chip with no text and a readout with an empty row.
export type SpielerFassung = GekeyteFassung<SpielerAbsatzSchluessel, FLEinwilligungUmfang> & { readonly seite: "bestaetigung_spieler" };

export type SpielerWiederkehrendFassung = GekeyteFassung<SpielerWiederkehrendAbsatzSchluessel, FLEinwilligungUmfang> & {
  readonly seite: "bestaetigung_spieler_wiederkehrend";
};

export type SpielerSeitenFassung = SpielerFassung | SpielerWiederkehrendFassung;
