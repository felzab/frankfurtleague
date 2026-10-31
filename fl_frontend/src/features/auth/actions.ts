"use server";

import { headers } from "next/headers";

import { action } from "@/core/action";
import { afterTheResponse } from "@/core/afterResponse";
import { sendSignInCode } from "@/core/auth";
import { COPY } from "@/core/copy";
import { asSignInIdentifier } from "@/core/emailAddress";
import { logger } from "@/core/logging";
import { SignInPayloadSchema } from "@/features/auth/schemas";

/**
 * Mails a sign-in code, answering every admitted address alike with the address the send was addressed to: this
 * action is public, so a distinguishable "not authorized" would be a membership oracle. The bot check answers
 * before the address is read; a malformed address is the box's, which a format check may say safely.
 *
 * Public by necessity. `nginx/shared/site.conf :: location = /signin` bounds that PATH, not this action: an action
 * resolves from a process-wide module map, so a POST to any page reaches it, metered there by the server-action
 * zone pair alone.
 */
export const handleSignIn = action({
  lane: "public",
  botCheck: true,
  name: "handleSignIn",
  input: SignInPayloadSchema,
  examples: { email: COPY.shared.feld.beispielAdresse },
  run: async ({ email: typed }) => {
    // Read once and closed over: the callback below runs after this action has answered.
    const requestHeaders = await headers();

    // Folded HERE, which is the boundary: below this line the code row, the mailed recipient, the gate and the
    // stored `user` row all carry one string. The library folds CASE alone and refuses a Unicode domain, so the
    // punycode the fold converts one to is the only spelling in which that person signs in at all.
    const email = asSignInIdentifier(typed);

    // The whole call, behind the response: the mail cap, the code write, the gate and the send all sit in the
    // branch-dependent half, so no branch does any of it before the caller is answered.
    afterTheResponse(async () => {
      try {
        // No `request`, so the endpoint's own form-CSRF check never runs: what stands in its place is Next's
        // server-action origin check, which refuses an `Origin` other than the page's host.
        await sendSignInCode(email, requestHeaders);
      } catch (failed) {
        // Name only: an error on this path routinely carries the submitted address.
        logger.error("auth.sign_in_failed", undefined, { name: failed instanceof Error ? failed.name : "unknown" });
      }
    });

    // The one exit every admitted address takes. A second `return` above it is how two become distinguishable.
    return { ok: true, value: email };
  },
});
