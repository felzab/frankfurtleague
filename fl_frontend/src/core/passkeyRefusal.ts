/**
 * Thrown by `fl_frontend/src/core/auth.ts` and worded where a ceremony starts. A module of its own
 * because neither end may import the other: the guard loading the browser client would construct it
 * where no page origin exists.
 */
export const USER_VERIFICATION_REFUSED = "USER_VERIFICATION_REQUIRED";

/** A sign-in the gate turned away as the session was minted: the address is barred (`docs/frontend/spec.md :: I403`). */
export const SIGN_IN_BARRED = "SIGN_IN_BARRED";

/** The same, for an address holding no record of its own in the league. */
export const SIGN_IN_HOLDS_NOTHING = "SIGN_IN_HOLDS_NOTHING";
