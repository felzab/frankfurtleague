import { APINetworkError } from "./errors";
import { MailBarredError, MailWithheldError } from "./mail";

// A module of its own beside `mail.ts`, which a suite doubling the mailer replaces whole: imported
// from here, the reader sorts the double's error classes as it sorts the real ones.
/**
 * How one unsent message ended, `ungewiss` having broken off unanswered so the provider may have taken
 * it. The one reading of a send's failure for every sender, so none drifts from the others.
 */
export type VersandAusfall = "gesperrt" | "zurueckgehalten" | "ungewiss" | "fehlgeschlagen";

export function versandAusfallOf(reason: unknown): VersandAusfall {
  if (reason instanceof MailBarredError) return "gesperrt";
  if (reason instanceof MailWithheldError) return "zurueckgehalten";

  return reason instanceof APINetworkError ? "ungewiss" : "fehlgeschlagen";
}
