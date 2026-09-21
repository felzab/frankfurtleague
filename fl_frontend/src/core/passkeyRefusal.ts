/**
 * Thrown by `fl_frontend/src/core/auth.ts` and worded by the passkey card. A module of its own
 * because neither end may import the other: the guard loading the browser client would construct it
 * where no page origin exists.
 */
export const USER_VERIFICATION_REFUSED = "USER_VERIFICATION_REQUIRED";
