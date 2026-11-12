"use client";

import { assertedAddress } from "@/core/auth/assertionAnswer";
import { loadAuthClient, usePreloadedAuthClient } from "@/core/auth/browserClient";
import { COPY } from "@/core/copy";
import { asSignInIdentifier } from "@/core/emailAddress";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";

/**
 * The passkey touch's browser half, the last step of an act on its fixed list: the person presses the act, answers any
 * dialog, presses the final button, and that press asks the touch and then runs the act. So every input is typed before
 * the touch, whose session the action's lane admits for `PASSKEY_TOUCH_SECONDS` alone
 * (the lane's `passkey` slot), and the prompt comes from the press itself, the user
 * activation Safari asks of WebAuthn, which an effect has not.
 *
 * Mounted with the page rather than with a dialog, so the client's chunk is here before the press. `held` is whether the
 * person holds a passkey, which the page read; a person holding none is asked nothing, as the lane admits them. It
 * answers the wrapper an act's own press runs: the wrapped act answers as the act does, or, where the passkey did not
 * answer, with the refusal, the act never having run, so the caller's form or dialog stands with what the person typed
 * and shows the line as any refusal. The caller's pending state holds through the browser's prompt, the act's button
 * busy. `holder` is the address the page was drawn for: a page whose own session ended asks a prompt naming nobody, which
 * any account's passkey answers, so a touch signing another account in is refused as the page's sign-in having ended. The
 * prompt itself cannot be narrowed to the holder's passkeys there: the library lists a session's own alone, and none
 * stands.
 */
export function usePasskeyTouch(held: boolean, holder: string | undefined) {
  usePreloadedAuthClient(held);

  const touch = async (): Promise<Copy | null> => {
    try {
      const authClient = await loadAuthClient();
      const { data, error } = await authClient.signIn.passkey();
      // A cancelled prompt and a refused passkey alike: the act did not run, and the passkey did not answer for it.
      if (error !== null) return COPY.signIn.refusal.unverified;
      if (holder === undefined) return null;
      // Off the league's own answer: the plugin's typed `data.user` is the body the server replaces.
      const signedIn = assertedAddress(data);
      // Signed in, but as nobody the answer names: the act cannot be shown to run for the holder.
      if (signedIn === null) return COPY.shared.failure.unexpected;
      return asSignInIdentifier(signedIn) === asSignInIdentifier(holder) ? null : COPY.shared.failure.signInExpired;
    } catch {
      return COPY.shared.failure.unexpected;
    }
  };

  return <Payload, Value>(act: (payload: Payload) => Promise<ActionAnswer<Value>>) => {
    if (!held) return act;
    return async (payload: Payload): Promise<ActionAnswer<Value>> => {
      const refused = await touch();
      return refused === null ? act(payload) : { ok: false, reason: refused };
    };
  };
}
