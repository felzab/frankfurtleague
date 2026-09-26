import { KONTAKT_EMAIL } from "@/core/brand";
import { SIGN_IN_BARRED, SIGN_IN_HOLDS_NOTHING, USER_VERIFICATION_REFUSED } from "@/core/passkeyRefusal";

/** The way out alone: the toast's title has already said which step did not happen. */
export const VERSUCHE_ES_ERNEUT = "Versuche es noch einmal.";

/**
 * The one refusal a reader can act on: the assertion ASKS for verification rather than demanding
 * it, so a passkey with no PIN and no biometric is offered by the browser and refused here.
 */
const OHNE_BESTAETIGUNG =
  "Dieser Passkey hat nicht bestätigt, dass Du es bist. Nimm einen Passkey mit PIN, Fingerabdruck oder Gesichtserkennung.";

/**
 * Named plainly: only the holder of the authenticator can reach this refusal, and the ban's own mail
 * has already told them.
 */
const GESPERRT = "Diese E-Mail-Adresse ist gesperrt. Solange die Sperre gilt, ist keine Anmeldung möglich.";

/** An address that holds nothing in the league, which a retry would not change. */
const OHNE_FUNKTION = `Mit dieser Adresse ist derzeit keine Anmeldung möglich. Wenn Du das für einen Fehler hältst, schreib uns an ${KONTAKT_EMAIL}.`;

/** Read off the answer rather than off its type: the client declares no `code`, and the body has one. */
export const refusalCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;

/** The same, for the answer's HTTP status. */
export const refusalStatus = (error: unknown): number | undefined =>
  typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : undefined;

/** Every refusal a retry of the same press would meet again, by its code. */
const WORDED: ReadonlyMap<string, string> = new Map([
  [USER_VERIFICATION_REFUSED, OHNE_BESTAETIGUNG],
  [SIGN_IN_BARRED, GESPERRT],
  [SIGN_IN_HOLDS_NOTHING, OHNE_FUNKTION],
]);

/**
 * A cancelled prompt, a refused one and a backend that did not answer are one answer; the refusals
 * above are the exceptions, because retrying repeats them.
 */
export function describeCeremonyRefusal(error: unknown): string {
  return WORDED.get(refusalCode(error) ?? "") ?? VERSUCHE_ES_ERNEUT;
}

/** Another ceremony took this one's place, which is no failure a reader made. */
export const CEREMONY_ABORTED = "ERROR_CEREMONY_ABORTED";
