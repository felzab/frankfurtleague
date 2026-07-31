"use server";

import { unstable_rethrow } from "next/navigation";

import { AuthError } from "next-auth";
import { z } from "zod";

import { signIn, signOut } from "@/core/auth";

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
    return settleAfterFloor(startedAt, { success: false, error: "Bitte gebe eine valide Email ein." });
  }

  try {
    // Attempt sign in with Auth.js
    await signIn("resend", { email: validated.data.email, redirectTo: "/admin" });

    return settleAfterFloor(startedAt, NEUTRAL_RESULT);
  } catch (error) {
    // 1. Rethrow Next.js redirects IMMEDIATELY
    unstable_rethrow(error);

    // 2. Handle Auth.js errors -- including AccessDenied from the allowlist check, which must not
    //    be distinguishable from success. See NEUTRAL_RESULT above.
    if (error instanceof AuthError) {
      return settleAfterFloor(startedAt, NEUTRAL_RESULT);
    }

    // 3. Fallback for unexpected errors
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
 * Deleting the session row is `signOut`'s own job; this wrapper exists because a client component
 * cannot import from `core/auth` and because `redirectTo` belongs on the server side of the call.
 */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
