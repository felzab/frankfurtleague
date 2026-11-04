import { z } from "zod";

/**
 * Apart from `fl_frontend/src/core/emailAddress.ts`, whose rules client modules import: a schema built at module level
 * there ships Zod to every page that folds an address.
 */

/**
 * The sign-in library's own primitive rather than a copy of its pattern: `better-auth` checks a
 * code's address with `z.email()`.
 */
const SIGN_IN_LIBRARY_EMAIL = z.email();

/** Asked of the FOLDED address: `fl_frontend/src/features/auth/actions.ts :: handleSignIn` hands the library that form and no other. */
export function isSignInLibraryAddress(value: string): boolean {
  return SIGN_IN_LIBRARY_EMAIL.safeParse(value).success;
}
