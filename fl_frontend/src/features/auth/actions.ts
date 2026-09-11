"use server";

import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";

import { AuthError } from "next-auth";

import { CALLBACK_URL_COOKIE, signIn, signOut } from "@/core/auth";
import { SignInPayloadSchema } from "@/features/auth/schemas";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";
import { toFieldErrors } from "@/shared/utils/validation";

import type { FormState } from "@/shared/types/types";

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

// What bounds the send is the allowlist: `@auth/core` calls the `signIn` callback before
// `sendVerificationRequest`, so a rejected address is mailed nothing.

/**
 * Public by necessity. `nginx/prod.conf :: location = /signin` bounds that PATH rather than this
 * action: a server action resolves from a process-wide module map, so the same POST to any other
 * page reaches this and is metered by nothing.
 */
// `_prevState` is required by `useActionState`'s calling convention -- the action receives the
// previous state first -- and read by nothing: the form re-renders from the returned state alone.
export async function handleSignIn(_prevState: FormState | undefined, formData: FormData): Promise<FormState> {
  return runWithIncomingTrace(async () => {
    const startedAt = Date.now();

    // The only server action reachable without a session, so its input is parsed and never cast.
    const submittedEmail = String(formData.get("email") ?? "");
    const validated = SignInPayloadSchema.safeParse({ email: submittedEmail });
    if (!validated.success) {
      // Safe to be specific: a format check on what the user typed leaks no membership.
      return settleAfterFloor(startedAt, {
        success: false,
        error: "Gib eine gültige E-Mail-Adresse ein.",
        fieldErrors: toFieldErrors(validated.error),
        // Echoed so the form records the refusal against the address that was SENT, rather than
        // against whatever is in the box by the time the answer lands.
        submittedEmail,
      });
    }

    try {
      // `redirect: false` is the other half of `neutralResult`: by default an allowlisted address
      // navigates and a rejected one does not, so navigating IS the oracle. `redirectTo` is separate.
      await signIn("resend", { email: validated.data.email, redirectTo: "/admin", redirect: false });
    } catch (error) {
      // `unstable_rethrow` stops a future `redirect()` or `notFound()` from being swallowed by the
      // AuthError branch below.
      unstable_rethrow(error);

      // AccessDenied from the allowlist check arrives as an AuthError, and rethrowing one would
      // answer the rejected address with the error page while an allowlisted one gets a sentence.
      if (!(error instanceof AuthError)) throw error;
    } finally {
      // Equalises the side effects as `neutralResult` equalises the body: only the allowlisted branch
      // reaches Auth.js's callback-url write, and that one `Set-Cookie`, the revalidation header it
      // draws and the page render that follows each name the address as allowlisted.
      (await cookies()).delete(CALLBACK_URL_COOKIE);
    }

    // The one exit both outcomes take. A second `return` above it is how the two become
    // distinguishable, which is the membership oracle this action exists to withhold.
    return settleAfterFloor(startedAt, neutralResult(validated.data.email));
  });
}

/**
 * `redirect: false` is load-bearing: next-auth's default calls `redirect()`, which throws
 * `NEXT_REDIRECT` — Next navigates, but the client promise settles as a rejection, so a caller
 * reports a failure for a sign-out that succeeded.
 */
export async function signOutAction(): Promise<FormState> {
  return runWithIncomingTrace(async () => {
    try {
      await signOut({ redirect: false });

      return { success: true, message: "Erfolgreich abgemeldet" };
    } catch (error) {
      // The same guard as `handleSignIn`: keep a framework redirect from being reported as a failed
      // sign-out.
      unstable_rethrow(error);

      if (error instanceof AuthError) {
        return { success: false, error: "Versuche es erneut." };
      }

      throw error;
    }
  });
}
