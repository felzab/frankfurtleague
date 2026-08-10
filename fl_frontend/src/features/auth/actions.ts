"use server";

/**
 * AUTH · sign-in and sign-out actions
 *
 * The `"use server"` directive stays the first line, above this block.
 *
 * Invariants:
 * - Sign-in is public by necessity and its id ships in a client chunk, so nginx rate-limits
 *   POSTs to /signin — the only thing between this and an open email relay.
 * - Auth.js errors are caught and reported as `FormState` — raw ones carry the submitted address.
 * - `unstable_rethrow` wraps redirect handling: Next signals redirects by throwing.
 *
 * See:
 * - docs/ops/spec.md — invariant I4, the sign-in rate limit
 */
import { unstable_rethrow } from "next/navigation";

import { AuthError } from "next-auth";
import { z } from "zod";

import { signIn, signOut } from "@/core/auth";
import { toFieldErrors } from "@/shared/utils/validation";

import type { FormState } from "@/shared/types/types";

const SignInPayloadSchema = z.object({
  email: z.email("Gib eine gültige E-Mail-Adresse ein."),
});

// Deliberately identical whether or not the address is on the admin allowlist: this action is
// public, so a distinguishable "not authorized" response is a membership oracle for
// ALLOWED_ADMIN_EMAILS. `submittedEmail` is the caller's own input, echoed.
const neutralResult = (submittedEmail: string): FormState => ({
  success: true,
  message: "Falls diese Adresse freigegeben ist, ist ein Anmeldelink unterwegs.",
  submittedEmail,
});

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
      error: "Gib eine gültige E-Mail-Adresse ein.",
      fieldErrors: toFieldErrors(validated.error),
    });
  }

  try {
    // `redirect: false` is the other half of `neutralResult`: by default an allowlisted
    // address navigates and a rejected one does not, so navigating IS the oracle.
    // `redirectTo` is separate -- where the magic link lands after verification.
    await signIn("resend", { email: validated.data.email, redirectTo: "/admin", redirect: false });

    return settleAfterFloor(startedAt, neutralResult(validated.data.email));
  } catch (error) {
    // Kept even though nothing here should redirect any more: `unstable_rethrow` is what stops a
    // future `redirect()`/`notFound()` from being swallowed by the AuthError branch below.
    unstable_rethrow(error);

    // AccessDenied from the allowlist check lands here, and must not be distinguishable from
    // success. See NEUTRAL_RESULT above.
    if (error instanceof AuthError) {
      return settleAfterFloor(startedAt, neutralResult(validated.data.email));
    }

    throw error;
  }
}

/**
 * Ends the admin's own session.
 *
 * `core/auth.ts` has exported `signOut` since Auth.js was wired up and nothing has ever called it,
 * so the only way to revoke a session was to delete the row from the `authjs` collection by hand —
 * which needs database access. The session lifetime was cut from 30 days to 8 hours, bounding the
 * exposure without closing it.
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
      return { success: false, error: "Abmelden fehlgeschlagen. Versuche es erneut." };
    }

    throw error;
  }
}
