import type {
  FLEinwilligungScope,
  FLInvitationViewResponse,
  FLRegistrierungConfirmationViewResponse,
  FLSpielerPosition,
  FLSpielerStufe,
} from "@/core/generated/client/types";

/**
 * What the registration page opens on. The token rides only with an invite a submission can still
 * spend: a shut window and a dead link are both read-only states, and a link handed onward from
 * either buys nothing.
 */
export type RegistrierungStart =
  | { state: "valid"; ansicht: FLInvitationViewResponse; token: string }
  | { state: "closed"; ansicht: FLInvitationViewResponse }
  // One member per tag rather than one carrying both: a union-valued discriminant narrows on the
  // positive branch alone, so the two-in-one shape leaves `ansicht` unreachable after the guard.
  | { state: "invalid" }
  | { state: "unlesbar" };

/**
 * The registration form mid-entry. Every field is typed and a widened `null` is a control nobody has
 * answered: the schema is what turns an unanswered one into a field error rather than a type error.
 */
export type RegistrierungFormDraft = {
  first_name: string;
  last_name: string;
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
export type SpielerLinkZustand = "confirmed" | "expired" | "invalid";

export type SpielerBestaetigungAnsicht = { state: "valid"; ansicht: FLRegistrierungConfirmationViewResponse } | { state: SpielerLinkZustand };

/** What the confirmation page opens on, the token riding only with a link a press can still spend. */
export type SpielerBestaetigungStart =
  { state: "valid"; ansicht: FLRegistrierungConfirmationViewResponse; token: string } | { state: SpielerLinkZustand | "unlesbar" };

/**
 * What a confirmed pupil's answer panel states: what this page asked and they sent, so nothing at all on the
 * returning pupil's page, which asks neither a choice nor a date.
 */
export type SpielerBestaetigungGespeichert = {
  birth_date: string | null;
  umfang: FLEinwilligungScope | null;
  media: boolean | null;
};

/**
 * Which of the two pages a link opens, handed in by the page: the new pupil's asks the two consents of
 * `fl_frontend/src/core/consentWordings.ts :: SPIELER_WORDINGS`, the returning pupil's none.
 */
export type SpielerSeitenFassung = { readonly page: "confirmation_spieler" } | { readonly page: "confirmation_spieler_returning" };
