/**
 * The code check's refusal of an address that has spent its tries, whatever code the request carried: the hook in
 * `fl_frontend/src/core/auth.ts` raises it and the sign-in page words it, so it sits where a browser module may read it.
 */
export const ADDRESS_ATTEMPTS_EXHAUSTED = "ADDRESS_ATTEMPTS_EXHAUSTED";
