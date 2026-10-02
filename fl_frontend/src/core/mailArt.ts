/**
 * Which message a send is, one member per builder: each builder names its own, so the kind the mailer
 * judges is the one tied to the content rather than one a caller chose.
 */
export type MailArt =
  | "anmeldecode"
  | "berechtigung"
  | "bewerbung_absage"
  | "bewerbung_bestaetigung"
  | "bewerbung_eingang_offen"
  | "bewerbung_erinnerung"
  | "bewerbung_geloescht"
  | "bewerbung_vollstaendig"
  | "bewerbung_widerspruch"
  | "bewerbung_zusage"
  | "einladung"
  | "passkey_geloescht"
  | "passkey_hinzugefuegt"
  | "registrierung_bestaetigung"
  | "registrierung_erinnerung"
  | "registrierung_saisonende"
  | "schiedsrichter_bestaetigung"
  | "sperre";

/** One composed message, as every builder hands it to a caller: its kind, then what the reader sees. */
export type ArtMail<A extends MailArt> = { art: A; subject: string; html: string; text: string };

/**
 * The kinds the mailer sends to an address the ban list holds. The ban's own notice alone: a widening
 * is a ruling, and `fl_frontend/src/core/mail.test.ts` pins the set (`docs/frontend/spec.md :: I541`).
 */
export const ERREICHT_GESPERRTE: ReadonlySet<MailArt> = new Set<MailArt>(["sperre"]);
