/**
 * The code check's refusal of an address that has spent its tries, whatever code the request carried. The server's
 * hook raises it and the sign-in page words it, so it sits where a browser module may read it.
 */
export const ADDRESS_ATTEMPTS_EXHAUSTED = "ADDRESS_ATTEMPTS_EXHAUSTED";

/** The code check's refusal of a code this browser did not ask for that address, raised before any try is counted. */
export const CODE_NOT_ASKED_HERE = "CODE_NOT_ASKED_HERE";
