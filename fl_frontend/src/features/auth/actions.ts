"use server";

import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { after } from "next/server";

import { APIError } from "better-auth/api";

import { auth } from "@/core/auth";
import { asSignInIdentifier } from "@/core/emailAddress";
import { logger } from "@/core/logging";
import { SignInPayloadSchema } from "@/features/auth/schemas";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";
import { toFieldErrors } from "@/shared/utils/validation";

import type { FormState } from "@/shared/types/types";

// Deliberately identical whether or not the address is allowlisted: this action is public, so a
// distinguishable "not authorized" is a membership oracle.

// `submittedEmail` reaches the panel that names where the link went, so it is the folded address a
// send was really addressed to rather than the keystrokes -- which the refusal above echoes instead.
const neutralResult = (submittedEmail: string): FormState => ({
  success: true,
  message: "Falls zu dieser Adresse ein Zugang gehört, ist ein Anmeldelink unterwegs.",
  submittedEmail,
});

/**
 * Public by necessity. `nginx/shared/site.conf :: location = /signin` bounds that PATH rather than this
 * action: a server action resolves from a process-wide module map, so the same POST to any other
 * page reaches this and is metered by nothing.
 */
// `_prevState` is required by `useActionState`'s calling convention -- the action receives the
// previous state first -- and read by nothing: the form re-renders from the returned state alone.
export async function handleSignIn(_prevState: FormState | undefined, formData: FormData): Promise<FormState> {
  return runWithIncomingTrace(async () => {
    // The only server action reachable without a session, so its input is parsed and never cast.
    const submittedEmail = String(formData.get("email") ?? "");
    const validated = SignInPayloadSchema.safeParse({ email: submittedEmail });
    if (!validated.success) {
      // Safe to be specific: a format check on what the user typed leaks no membership.
      return {
        success: false,
        error: "Gib eine gültige E-Mail-Adresse ein.",
        fieldErrors: toFieldErrors(validated.error),
        // Echoed so the form records the refusal against the address that was SENT, rather than
        // against whatever is in the box by the time the answer lands.
        submittedEmail,
      };
    }

    // Read once and closed over: the callback below runs after this function has returned, and a
    // second read inside it would be a second trip through Next's own request store for one value.
    const requestHeaders = await headers();

    // Folded HERE, which is the boundary: below this line the verification row, the mailed
    // recipient, the allowlist gate and the stored `user` row all carry one string.

    // The library folds CASE alone and refuses a Unicode domain, so the punycode the fold converts
    // one to is the only spelling in which that administrator signs in at all.
    const email = asSignInIdentifier(validated.data.email);

    // The whole call, behind the response: the allowlist gate, the token write and the send all
    // sit in the branch-dependent half, so no branch does any of it before the caller is answered.
    after(async () => {
      try {
        // No `callbackURL`: the plugin spends it building a `url` this application discards, and a
        // destination named at the request reads as one travelling in the mailed link.

        // No `request` either, so the endpoint's own form-CSRF check never runs: what stands in its
        // place is Next's server-action origin check, which refuses a mismatched `Origin` and lets a
        // request carrying none through with a warning.
        await auth.api.signInMagicLink({ body: { email }, headers: requestHeaders });
      } catch (failed) {
        // Name only: an error on this path routinely carries the submitted address, and
        // `fl_frontend/src/core/logFormat.ts :: serializeError` writes a message and stack in full.
        logger.error("auth.sign_in_failed", undefined, {
          error_code: "FE-AUTH-002",
          name: failed instanceof Error ? failed.name : "unknown",
        });
      }
    });

    // The one exit both outcomes take. A second `return` above it is how the two become
    // distinguishable, which is the membership oracle this action exists to withhold.
    return neutralResult(email);
  });
}

export async function signOutAction(): Promise<FormState> {
  return runWithIncomingTrace(async () => {
    try {
      await auth.api.signOut({ headers: await headers() });

      return { success: true, message: "Abgemeldet" };
    } catch (error) {
      // Keeps a framework redirect from being reported as a failed sign-out.
      unstable_rethrow(error);

      // Narrowed rather than caught whole: anything the library did not raise is a defect here,
      // and answering it with a retry sentence is how one goes unseen.
      if (error instanceof APIError) {
        return { success: false, error: "Versuche es erneut." };
      }

      throw error;
    }
  });
}
