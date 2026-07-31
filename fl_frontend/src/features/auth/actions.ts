"use server";

import { unstable_rethrow } from "next/navigation";

import { AuthError } from "next-auth";
import { z } from "zod";

import { signIn, signOut } from "@/core/auth";
import { toFieldErrors } from "@/shared/utils/validation";

import type { FormState } from "@/shared/types/types";

const SignInPayloadSchema = z.object({
  email: z.email("Bitte gebe eine valide Email ein."),
});

// Deliberately identical whether or not the address is on the admin allowlist. This action is
// public and unauthenticated, so a distinguishable "not authorized" response is a membership oracle
// for ALLOWED_ADMIN_EMAILS -- and the address is the only thing an attacker needs to enumerate.
const NEUTRAL_RESULT: FormState = {
  success: true,
  message: "Falls diese Adresse freigegeben ist, wurde ein Anmeldelink verschickt.",
};

// Floor, not a delay: the allowlisted path does real work (Resend round-trip) while the rejected
// path returns almost immediately, and that difference alone re-opens the oracle.
const MIN_RESPONSE_MS = 700;

async function settleAfterFloor<T>(startedAt: number, result: T): Promise<T> {
  const remaining = MIN_RESPONSE_MS - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  return result;
}

export async function handleSignIn(prevState: FormState | undefined, formData: FormData): Promise<FormState> {
  const startedAt = Date.now();

  // formData.get() returns string | File | null; the previous `as string` cast asserted past all
  // three. This is the only server action reachable without a session.
  const validated = SignInPayloadSchema.safeParse({ email: formData.get("email") });
  if (!validated.success) {
    // Reported as a field error, not just a toast, so this form behaves like the other six. Safe to
    // be specific here: it is a format check on what the user typed, so it leaks no membership.
    return settleAfterFloor(startedAt, {
      success: false,
      error: "Bitte gebe eine valide Email ein.",
      fieldErrors: toFieldErrors(validated.error),
    });
  }

  try {
    // `redirect: false` is the other half of NEUTRAL_RESULT, and without it the neutral response was
    // decorative. With the default, an allowlisted address ends in `redirect()` to
    // /api/auth/verify-request while a rejected one falls into the AccessDenied branch below and
    // stays put -- so the browser NAVIGATING was itself the membership oracle this action exists to
    // close, readable by anyone watching the address bar. `redirect: false` makes `signIn` return
    // the URL as a string instead (next-auth `lib/actions.js`), which is discarded here: both paths
    // now end on /signin with the same message, and the caller renders the confirmation itself.
    // The verification email is still sent -- that happens inside `Auth()`, before this returns.
    await signIn("resend", { email: validated.data.email, redirect: false });

    return settleAfterFloor(startedAt, NEUTRAL_RESULT);
  } catch (error) {
    // Kept even though nothing here should redirect any more: `unstable_rethrow` is what stops a
    // future `redirect()`/`notFound()` from being swallowed by the AuthError branch below.
    unstable_rethrow(error);

    // AccessDenied from the allowlist check lands here, and must not be distinguishable from
    // success. See NEUTRAL_RESULT above.
    if (error instanceof AuthError) {
      return settleAfterFloor(startedAt, NEUTRAL_RESULT);
    }

    throw error;
  }
}

/**
 * Ends the admin's own session (ledger NEW-S1).
 *
 * `core/auth.ts` has exported `signOut` since Auth.js was wired up and nothing has ever called it,
 * so the only way to revoke a session was to delete the row from the `authjs` collection by hand —
 * which needs database access. Wave 3 cut the lifetime from 30 days to 8 hours (R3b-S5.2), bounding
 * the exposure without closing it.
 *
 * `redirect: false` is load-bearing. The default path calls `redirect()` (next-auth `lib/actions.js`
 * — `if (options?.redirect ?? true) return redirect(res.redirect)`), which throws `NEXT_REDIRECT`;
 * Next performs the navigation, but the client-side promise still settles as a rejection, so a
 * caller with a `try/catch` reports a failure for a sign-out that actually succeeded. That is
 * exactly what shipped: the user was signed out, landed on the home page, and was told
 * "Abmeldung fehlgeschlagen". Returning normally lets the caller navigate and keeps `catch`
 * meaning what it says.
 */
export async function signOutAction(): Promise<FormState> {
  try {
    await signOut({ redirect: false });

    return { success: true, message: "Erfolgreich abgemeldet." };
  } catch (error) {
    // Same guard as `handleSignIn`, for the same reason: keep a framework redirect from being
    // reported as a failed sign-out. Nothing on this path redirects today -- `redirect: false` --
    // but the pairing is what makes the two actions read the same way.
    unstable_rethrow(error);

    if (error instanceof AuthError) {
      return { success: false, error: "Abmelden fehlgeschlagen. Bitte versuche es erneut." };
    }

    throw error;
  }
}
