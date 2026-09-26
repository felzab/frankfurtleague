import { USER_VERIFICATION_REFUSED } from "@/core/passkeyRefusal";

/** The way out alone: the toast's title has already said which step did not happen. */
export const VERSUCHE_ES_ERNEUT = "Versuche es noch einmal.";

/**
 * The one refusal a reader can act on: the assertion ASKS for verification rather than demanding
 * it, so a passkey with no PIN and no biometric is offered by the browser and refused here.
 */
const OHNE_BESTAETIGUNG =
  "Dieser Passkey hat nicht bestätigt, dass Du es bist. Nimm einen Passkey mit PIN, Fingerabdruck oder Gesichtserkennung.";

/** Read off the answer rather than off its type: the client declares no `code`, and the body has one. */
export const refusalCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;

/** The same, for the answer's HTTP status. */
export const refusalStatus = (error: unknown): number | undefined =>
  typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : undefined;

/**
 * A cancelled prompt and a refused one are one answer; the unverified passkey is the exception,
 * because retrying the same one repeats the refusal.
 */
export function describeCeremonyRefusal(error: unknown): string {
  return refusalCode(error) === USER_VERIFICATION_REFUSED ? OHNE_BESTAETIGUNG : VERSUCHE_ES_ERNEUT;
}

/** Another ceremony took this one's place, which is no failure a reader made. */
export const CEREMONY_ABORTED = "ERROR_CEREMONY_ABORTED";
