/**
 * Thrown by `fl_frontend/src/core/auth/library.ts` and worded where a ceremony starts. A module of its own
 * because neither end may import the other: the guard loading the browser client would construct it
 * where no page origin exists.
 */
export const USER_VERIFICATION_REFUSED = "USER_VERIFICATION_REQUIRED";

/**
 * A sign-in the gate turned away as the session was minted, a barred address and one holding no record of its own
 * alike: one code on the wire, so no answer the browser reads tells who stands on the ban list.
 */
export const SIGN_IN_REFUSED = "SIGN_IN_REFUSED";
