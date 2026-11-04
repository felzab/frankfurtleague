import type {
  FLEinwilligungUmfang,
  FLInvitationViewResponse,
  FLRegistrierungConfirmationViewResponse,
  FLSpielerPosition,
  FLSpielerStufe,
} from "@/core/generated/client/types";

/**
 * One pending registration on the administrator's list: what its card shows, and nothing else of the
 * row, so the address and the birthdate never reach the browser.
 */
export type AdminRegistrierungRow = {
  id: string;
  vorname: string;
  nachname: string;
  // The day the read orders by, so a cut-short list's end can be told from its card.
  submitted_at: string;
  team_id: string;
  // Null where the club read knows no team of this id: the card says so rather than showing the id.
  teamName: string | null;
  saison_id: string;
  stufe: FLSpielerStufe | null;
  confirmed: boolean;
};

/**
 * What the registration page opens on. The token rides only with an invite a submission can still
 * spend: a shut window and a dead link are both read-only states, and a link handed onward from
 * either buys nothing.
 */
export type RegistrierungStart =
  | { zustand: "valid"; ansicht: FLInvitationViewResponse; token: string }
  | { zustand: "closed"; ansicht: FLInvitationViewResponse }
  // One member per tag rather than one carrying both: a union-valued discriminant narrows on the
  // positive branch alone, so the two-in-one shape leaves `ansicht` unreachable after the guard.
  | { zustand: "invalid" }
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
export type SpielerLinkZustand = "confirmed" | "expired" | "invalid" | "barred";

export type SpielerBestaetigungAnsicht =
  { zustand: "valid"; ansicht: FLRegistrierungConfirmationViewResponse } | { zustand: SpielerLinkZustand };

/** What the confirmation page opens on, the token riding only with a link a press can still spend. */
export type SpielerBestaetigungStart =
  { zustand: "valid"; ansicht: FLRegistrierungConfirmationViewResponse; token: string } | { zustand: SpielerLinkZustand | "unlesbar" };

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
 * Which of the two pages a link opens, handed in by the page: the new pupil's asks the two consents of
 * `fl_frontend/src/core/consentWordings.ts :: SPIELER_WORDINGS`, the returning pupil's none.
 */
export type SpielerSeitenFassung = { readonly seite: "bestaetigung_spieler" } | { readonly seite: "bestaetigung_spieler_wiederkehrend" };
