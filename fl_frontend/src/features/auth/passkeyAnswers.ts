import { COPY } from "@/core/copy";
import { SIGN_IN_REFUSED, USER_VERIFICATION_REFUSED } from "@/core/passkeyRefusal";

import type { Copy } from "@/core/copy";

/**
 * The one refusal a reader can act on: the assertion ASKS for verification rather than demanding
 * it, so a passkey with no PIN and no biometric is offered by the browser and refused here.
 */
const WITHOUT_CONFIRMATION = COPY.signIn.refusal.unverified;

/** An address holding no record of its own in the league, or a barred one, which a retry would not change. */
const WITHOUT_ENTRY = COPY.signIn.refusal.noRecord;

/** Read off the answer rather than off its type: the client declares no `code`, and the body has one. */
export const refusalCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;

/** The same, for the answer's HTTP status. */
export const refusalStatus = (error: unknown): number | undefined =>
  typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : undefined;

/** Every refusal a retry of the same press would meet again, by its code. */
const WORDED: ReadonlyMap<string, Copy> = new Map([
  [USER_VERIFICATION_REFUSED, WITHOUT_CONFIRMATION],
  [SIGN_IN_REFUSED, WITHOUT_ENTRY],
]);

/**
 * A cancelled prompt, a refused one and a backend that did not answer are one answer, the shared failure
 * line; the refusals above are the exceptions, because retrying repeats them.
 */
export function describeCeremonyRefusal(error: unknown): Copy {
  return WORDED.get(refusalCode(error) ?? "") ?? COPY.shared.failure.unexpected;
}

/** Another ceremony took this one's place, which is no failure a reader made. */
export const CEREMONY_ABORTED = "ERROR_CEREMONY_ABORTED";

/** The library's refusal of an enrolment from a session older than its `freshAge`. */
export const SESSION_NOT_FRESH = "SESSION_NOT_FRESH";

/**
 * The browser's refusal to set up a passkey on an authenticator already holding one of the person's, which the
 * plugin's client answers by this code (`@better-auth/passkey/client :: registerPasskey`): the options name the
 * person's passkeys as `excludeCredentials`.
 */
const PREVIOUSLY_REGISTERED = "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED";

/** Every refusal of a further passkey's set-up a retry would meet again, by the plugin's own code. */
const SET_UP_WORDED: ReadonlyMap<string, Copy> = new Map([
  [SESSION_NOT_FRESH, COPY.account.passkeys.signInTooOld],
  [PREVIOUSLY_REGISTERED, COPY.account.passkeys.alreadyOnDevice],
]);

/** Why Sicherheit's set-up did not happen: the refusals above by their code, and any other as the shared failure line. */
export function describeSetUpRefusal(error: unknown): Copy {
  return SET_UP_WORDED.get(refusalCode(error) ?? "") ?? COPY.shared.failure.unexpected;
}
