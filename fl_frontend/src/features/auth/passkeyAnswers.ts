import { COPY } from "@/core/copy";
import { SIGN_IN_BARRED, SIGN_IN_HOLDS_NOTHING, USER_VERIFICATION_REFUSED } from "@/core/passkeyRefusal";

import type { Copy } from "@/core/copy";

/**
 * The one refusal a reader can act on: the assertion ASKS for verification rather than demanding
 * it, so a passkey with no PIN and no biometric is offered by the browser and refused here.
 */
const OHNE_BESTAETIGUNG = COPY.anmeldung.abgelehnt.ohneBestaetigung;

/**
 * An address holding no record of its own in the league, or a barred one, which a retry would not change.
 * One sentence for both, so no answer here tells who stands on the ban list.
 */
export const OHNE_EINTRAG = COPY.anmeldung.abgelehnt.ohneEintrag;

/** Read off the answer rather than off its type: the client declares no `code`, and the body has one. */
export const refusalCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;

/** The same, for the answer's HTTP status. */
export const refusalStatus = (error: unknown): number | undefined =>
  typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : undefined;

/** Every refusal a retry of the same press would meet again, by its code. */
const WORDED: ReadonlyMap<string, Copy> = new Map([
  [USER_VERIFICATION_REFUSED, OHNE_BESTAETIGUNG],
  [SIGN_IN_BARRED, OHNE_EINTRAG],
  [SIGN_IN_HOLDS_NOTHING, OHNE_EINTRAG],
]);

/**
 * A cancelled prompt, a refused one and a backend that did not answer are one answer, the shared failure
 * line; the refusals above are the exceptions, because retrying repeats them.
 */
export function describeCeremonyRefusal(error: unknown): Copy {
  return WORDED.get(refusalCode(error) ?? "") ?? COPY.shared.fehler.unerwartet;
}

/** Another ceremony took this one's place, which is no failure a reader made. */
export const CEREMONY_ABORTED = "ERROR_CEREMONY_ABORTED";
