"use server";

import { cookies, headers } from "next/headers";

import { action } from "@/core/action";
import { afterTheResponse } from "@/core/afterResponse";
import { codeAskedCookie, codeMailCapped, sendSignInCode } from "@/core/auth/library";
import { COPY } from "@/core/copy/shared";
import { asSignInIdentifier } from "@/core/emailAddress";
import { logger } from "@/core/logging";

import { SignInPayloadSchema } from "./schemas";

/**
 * Mails a sign-in code, answering every address alike, member or stranger: the address the send was addressed to, or
 * past the address's five mails of the hour the limit's line. This action is public, so a distinguishable "not
 * authorized" would be a membership oracle. The bot check answers before the address is read; a malformed address is
 * the box's, which a format check may say safely.
 *
 * Public by necessity, and reached from every page: an action resolves from a process-wide module map, so a POST to
 * any page runs it. What bounds it is its own: the bot check, and the per-address cap on code mails.
 */
export const handleSignIn = action({
  lane: "public",
  botCheck: true,
  name: "handleSignIn",
  input: SignInPayloadSchema,
  examples: { email: COPY.shared.field.exampleAddress },
  run: async ({ email: typed }) => {
    // Read once and closed over: the callback below runs after this action has answered.
    const requestHeaders = await headers();

    // Folded here, at the boundary: below this line the code row, the mailed recipient, the gate and the
    // stored `user` row all carry one string. The library folds case alone and never trims, so the fold's trimmed
    // spelling is the one every sign-in of that person carries.
    const email = asSignInIdentifier(typed);

    // In this response, never behind it, and on every press alike, capped or not: the code check takes a code only
    // from the browser that asked for its address, so a stranger's guesses spend an address's day only after asking
    // for its code, which mails the person.
    const asked = await codeAskedCookie(email);
    (await cookies()).set(asked.name, asked.value, asked.options);

    // Counted ahead of the answer and of the gate, so a member and a stranger spend one hour alike and the refusal
    // past it tells a prober only that the address was asked for five times. A capped press schedules no send: the
    // plugin writes a new code before its callback, which would void the code already mailed. A store that cannot
    // count is thrown on, to the shared failure line rather than a code reading as mailed.
    if (await codeMailCapped(email)) return { ok: false, reason: COPY.shared.failure.tooManyAttempts };

    // The rest of the call, behind the response: the code write, the gate and the send all sit in the
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

    // The one exit every address under its hour's cap takes, member or stranger. A `return` above it that a gate's
    // answer could reach is how two become distinguishable.
    return { ok: true, value: email };
  },
});
