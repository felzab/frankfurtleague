"use server";

import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";

import { APIError } from "better-auth/api";

import { afterTheResponse } from "@/core/afterResponse";
import { readServedSession, sendSignInCode, signOutHere } from "@/core/auth";
import { asSignInIdentifier } from "@/core/emailAddress";
import { logger } from "@/core/logging";
import { MENSCH_BESTAETIGEN, passesTurnstile } from "@/core/turnstile";
import { TURNSTILE_FIELD } from "@/core/turnstileToken";
import { SignInPayloadSchema } from "@/features/auth/schemas";
import { VERSUCHE_ES_ERNEUT_SATZ } from "@/shared/utils/refusal";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";
import { toFieldErrors } from "@/shared/utils/validation";

import type { FormState } from "@/shared/types/types";

// Deliberately identical whether or not the send gate admits the address: this action is public, so a
// distinguishable "not authorized" is a membership oracle.

// `submittedEmail` reaches the panel that names where the code went, and the code step posts it back,
// so it is the folded address a send was really addressed to rather than the keystrokes -- which the
// refusal above echoes instead.
const neutralResult = (submittedEmail: string): FormState => ({
  success: true,
  message: "Falls zu dieser Adresse ein Konto gehört, ist ein Anmeldecode unterwegs.",
  submittedEmail,
});

/**
 * Whether this request may ask for a code: past the bot check, or from a session already holding `email`,
 * which the account page's confirmation asks with no widget on its page (`docs/frontend/spec.md :: I823`).
 */
async function admitsCodeRequest(formData: FormData, requestHeaders: Headers, email: string): Promise<"weiter" | "mensch" | "erneut"> {
  const token = formData.get(TURNSTILE_FIELD);
  if (typeof token === "string" && token !== "") return (await passesTurnstile(token)) ? "weiter" : "mensch";

  let served;
  try {
    served = await readServedSession(requestHeaders);
  } catch (failed) {
    // The NAME alone, for the send's own reason below.
    logger.error("auth.signed_in_unread", undefined, { error_code: "FE-AUTH-002", name: failed instanceof Error ? failed.name : "unknown" });
    return "erneut";
  }

  return served !== null && asSignInIdentifier(served.user.email) === email ? "weiter" : "mensch";
}

/**
 * Public by necessity. `nginx/shared/site.conf :: location = /signin` bounds that PATH, not this action:
 * an action resolves from a process-wide module map, so a POST to any page reaches it, metered there
 * by the server-action zone pair alone.
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

    // Folded HERE, which is the boundary: below this line the code row, the mailed recipient, the
    // gate and the stored `user` row all carry one string (`docs/frontend/spec.md :: I446`).

    // The library folds CASE alone and refuses a Unicode domain, so the punycode the fold converts
    // one to is the only spelling in which that person signs in at all.
    const email = asSignInIdentifier(validated.data.email);

    // Before the response and safe there: nothing it reads depends on whether the address holds an account.
    const admitted = await admitsCodeRequest(formData, requestHeaders, email);
    if (admitted !== "weiter") {
      return { success: false, error: admitted === "mensch" ? MENSCH_BESTAETIGEN : VERSUCHE_ES_ERNEUT_SATZ, submittedEmail };
    }

    // The whole call, behind the response: the mail cap, the code write, the gate and the send all
    // sit in the branch-dependent half, so no branch does any of it before the caller is answered.
    afterTheResponse(async () => {
      try {
        // No `request`, so the endpoint's own form-CSRF check never runs: what stands in its place
        // is Next's server-action origin check, which refuses a mismatched `Origin` and lets a
        // request carrying none through with a warning.
        await sendSignInCode(email, requestHeaders);
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
      await signOutHere(await headers());

      return { success: true, message: "Abgemeldet" };
    } catch (error) {
      // Keeps a framework redirect from being reported as a failed sign-out.
      unstable_rethrow(error);

      // Narrowed rather than caught whole: anything the library did not raise is a defect here,
      // and answering it with a retry sentence is how one goes unseen.
      if (error instanceof APIError) {
        return { success: false, error: VERSUCHE_ES_ERNEUT_SATZ };
      }

      throw error;
    }
  });
}
