"use server";

import { unstable_rethrow } from "next/navigation";

import { AuthError } from "next-auth";
import { z } from "zod";

import { signIn, signOut } from "@/core/auth";
import { toFieldErrors } from "@/shared/utils/validation";

import type { FormState } from "@/shared/types/types";

const SignInPayloadSchema = z.object({
  email: z.email("Gib eine gültige E-Mail-Adresse ein."),
});

// Deliberately identical whether or not the address is allowlisted: this action is public, so a
// distinguishable "not authorized" is a membership oracle. `submittedEmail` is the caller's own.
const neutralResult = (submittedEmail: string): FormState => ({
  success: true,
  message: "Falls diese Adresse freigegeben ist, ist ein Anmeldelink unterwegs.",
  submittedEmail,
});

// A floor, not a delay: the allowlisted path does a Resend round-trip while the rejected path
// returns at once, and that difference alone re-opens the oracle.
const MIN_RESPONSE_MS = 700;

async function settleAfterFloor<T>(startedAt: number, result: T): Promise<T> {
  const remaining = MIN_RESPONSE_MS - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  return result;
}

/**
 * Public by necessity, so nginx rate-limits POSTs to `/signin` (ops spec I4) — the only thing
 * between this and an open email relay.
 */
export async function handleSignIn(prevState: FormState | undefined, formData: FormData): Promise<FormState> {
  const startedAt = Date.now();

  // The only server action reachable without a session, so its input is parsed and never cast.
  const validated = SignInPayloadSchema.safeParse({ email: formData.get("email") });
  if (!validated.success) {
    // Safe to be specific: a format check on what the user typed leaks no membership.
    return settleAfterFloor(startedAt, {
      success: false,
      error: "Gib eine gültige E-Mail-Adresse ein.",
      fieldErrors: toFieldErrors(validated.error),
    });
  }

  try {
    // `redirect: false` is the other half of `neutralResult`: by default an allowlisted address
    // navigates and a rejected one does not, so navigating IS the oracle. `redirectTo` is separate.
    await signIn("resend", { email: validated.data.email, redirectTo: "/admin", redirect: false });

    return settleAfterFloor(startedAt, neutralResult(validated.data.email));
  } catch (error) {
    // `unstable_rethrow` stops a future `redirect()` or `notFound()` from being swallowed by the
    // AuthError branch below.
    unstable_rethrow(error);

    // AccessDenied from the allowlist check lands here and must not be distinguishable from success.
    if (error instanceof AuthError) {
      return settleAfterFloor(startedAt, neutralResult(validated.data.email));
    }

    throw error;
  }
}

/**
 * `redirect: false` is load-bearing: next-auth's default calls `redirect()`, which throws
 * `NEXT_REDIRECT` — Next navigates, but the client promise settles as a rejection, so a caller
 * reports a failure for a sign-out that succeeded.
 */
export async function signOutAction(): Promise<FormState> {
  try {
    await signOut({ redirect: false });

    return { success: true, message: "Erfolgreich abgemeldet." };
  } catch (error) {
    // The same guard as `handleSignIn`: keep a framework redirect from being reported as a failed
    // sign-out.
    unstable_rethrow(error);

    if (error instanceof AuthError) {
      return { success: false, error: "Abmelden fehlgeschlagen. Versuche es erneut." };
    }

    throw error;
  }
}
