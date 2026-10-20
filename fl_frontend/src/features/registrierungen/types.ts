import type { GekeyteFassung, SpielerAbsatzSchluessel, SpielerWiederkehrendAbsatzSchluessel } from "@/core/einwilligungSeiten";
import type { FLSpielerPosition, FLSpielerStufe } from "@/features/spieler/schemas";
import type { FLEinladungAnsichtResponse, FLEinwilligungUmfang, FLRegistrierungBestaetigungAnsichtResponse } from "./schemas";

/**
 * One pending registration on the administrator's list: what its card shows, and nothing else of the
 * row, so the address and the birthdate never reach the browser.
 */
export type AdminRegistrierungRow = {
  id: string;
  vorname: string;
  nachname: string;
  // The day the read orders by, so a cut-short list's end can be told from its card.
  eingereicht_am: string;
  team_id: string;
  // Null where the club read knows no team of this id: the card says so rather than showing the id.
  teamName: string | null;
  saison_id: string;
  stufe: FLSpielerStufe | null;
  bestaetigt: boolean;
};

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

/** A link still open, and so a registration the page can still be answered for. */
export type SpielerBestaetigungGeoeffnet = FLRegistrierungBestaetigungAnsichtResponse;

export type SpielerBestaetigungAnsicht = { zustand: "gueltig"; ansicht: SpielerBestaetigungGeoeffnet } | { zustand: SpielerLinkZustand };

/** What the confirmation page opens on, the token riding only with a link a press can still spend. */
export type SpielerBestaetigungStart =
  { zustand: "gueltig"; ansicht: SpielerBestaetigungGeoeffnet; token: string } | { zustand: SpielerLinkZustand | "unlesbar" };

/**
 * What a confirmed pupil's answer panel states: what this page asked and they sent, so nothing at all on the
 * returning pupil's page, which asks neither a choice nor a date.
 */
export type SpielerBestaetigungGespeichert = {
  geburtsdatum: string | null;
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

// No control keys: the page asks no choice and shows none.
export type SpielerWiederkehrendFassung = GekeyteFassung<SpielerWiederkehrendAbsatzSchluessel> & {
  readonly seite: "bestaetigung_spieler_wiederkehrend";
};

export type SpielerSeitenFassung = SpielerFassung | SpielerWiederkehrendFassung;
