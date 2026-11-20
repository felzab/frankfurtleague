/**
 * The sign-in's own refusal codes, which its server modules raise and the sign-in page's browser modules word. This
 * module imports nothing, so a browser module may read it without the library's instance or the store.
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
