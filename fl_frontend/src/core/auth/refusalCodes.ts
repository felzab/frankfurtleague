/**
 * The sign-in's refusal codes: those its server modules raise and its browser modules word, the passkey ceremony's
 * for a sheet the reader closed, and the edge's status for its limit on requests. This module imports nothing, so a
 * browser module may read it without the library's instance or the store.
 */

/** The code check's refusal of an address that has spent its tries, whatever code the request carried. */
export const ADDRESS_ATTEMPTS_EXHAUSTED = "ADDRESS_ATTEMPTS_EXHAUSTED";

/** The code check's refusal of a code this browser did not ask for that address, raised before any try is counted. */
export const CODE_NOT_ASKED_HERE = "CODE_NOT_ASKED_HERE";

/**
 * A sign-in the gate turned away as the session was minted, by a code or a passkey, a barred address and one holding
 * no record of its own alike: one code on the wire, so no answer the browser reads tells who stands on the ban list.
 */
export const SIGN_IN_REFUSED = "SIGN_IN_REFUSED";

/** Another ceremony took this one's place, which is no failure a reader made. */
const CEREMONY_ABORTED = "ERROR_CEREMONY_ABORTED";

/**
 * The browser's `NotAllowedError`, passed through by `@simplewebauthn/browser` under this code: a sheet the reader
 * closed, which is no failure either, and with it a browser's timeout and an authenticator refusing to verify, which
 * the library cannot tell apart from it.
 */
const PASSED_THROUGH = "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY";

/**
 * Whether a passkey ceremony's refusal is one the reader, or the browser on their behalf, ended: nothing to word. Its
 * code is read rather than typed, since the auth client declares one on the ceremony's arms alone.
 */
export function isClosedCeremony(refusal: object): boolean {
  const code = "code" in refusal ? refusal.code : undefined;
  return code === CEREMONY_ABORTED || code === PASSED_THROUGH;
}

/** The edge's own rate refusal, whose plain-text body carries none of the library's codes. */
const TOO_MANY_REQUESTS = 429;

/**
 * Whether an auth client's refusal is the edge's limit on requests, which checked nothing: to the reader a limit on
 * tries like any other. Read by its status alone, which the client keeps on a body it cannot parse.
 */
export function isRateRefusal(refusal: object): boolean {
  return "status" in refusal && refusal.status === TOO_MANY_REQUESTS;
}
