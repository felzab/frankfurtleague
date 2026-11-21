"use client";

import { assertedAddress } from "@/core/auth/assertionAnswer";
import { loadAuthClient, usePreloadedAuthClient } from "@/core/auth/browserClient";
import { isClosedCeremony, isRateRefusal } from "@/core/auth/refusalCodes";
import { COPY } from "@/core/copy/shared";
import { asSignInIdentifier } from "@/core/emailAddress";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";

/** The touch's answer where its passkey sheet was closed: the act never ran, and nothing is said of it. */
const CLOSED: ActionAnswer<never> = { ok: false, closed: true };

const refusedWith = (reason: Copy): ActionAnswer<never> => ({ ok: false, reason });

/**
 * The passkey touch's browser half, the last step of an act on its fixed list: the person presses the act, answers any
 * dialog, presses the final button, and that press asks the touch and then runs the act. So every input is typed before
 * the touch, whose session the action's lane admits for `PASSKEY_TOUCH_SECONDS` alone (the lane's `passkey` slot), and
 * the prompt comes from the press itself, the user activation Safari asks of WebAuthn, which an effect has not.
 *
 * Mounted with the page rather than with a dialog, so the client's chunk is here before the press. `asked` is whether
 * the page is an administrator's, which the page read; a person is asked nothing, as the lane admits them. It
 * answers the wrapper an act's own press runs: the wrapped act answers as the act does, or, where the passkey did not
 * answer, with the refusal, the act never having run, which the caller shows as any refusal: a box or a one-shot form
 * on its line, with what the person typed, and a dialog in its toast, its inputs typed anew; a sheet the person closed
 * answers `closed`, which says nothing. The caller's pending state
 * holds through the browser's prompt, the act's button busy. `holder` is the address the page was drawn for: a page
 * whose own session ended asks a prompt naming nobody, which any account's passkey answers, so a touch signing another
 * account in is refused as the page's sign-in having ended. The prompt itself cannot be narrowed to the holder's
 * passkeys there: the library lists a session's own alone, and none stands.
 *
 * A dialog asking its act closes for good before its final press asks the touch (`ConfirmDialog`, `Dialog`), as an
 * identity check is asked with no modal standing: a React Aria modal makes every element outside it inert, a password
 * manager's prompt drawn while it stands included, which then takes no press and no Escape.
 */
export function usePasskeyTouch(asked: boolean, holder: string | undefined) {
  usePreloadedAuthClient(asked);

  const touch = async (): Promise<ActionAnswer<never> | null> => {
    try {
      const authClient = await loadAuthClient();
      const { data, error } = await authClient.signIn.passkey();
      // The act did not run either way: a closed sheet says nothing, as the sign-in's does, the edge's limit on
      // requests is a limit on tries, and any other refusal is the sentence the server's half answers an act its
      // passkey did not answer for.
      if (error !== null) {
        if (isClosedCeremony(error)) return CLOSED;
        return refusedWith(isRateRefusal(error) ? COPY.shared.failure.tooManyAttempts : COPY.shared.touchMissing);
      }
      if (holder === undefined) return null;
      // Off the league's own answer: the plugin's typed `data.user` is the body the server replaces.
      const signedIn = assertedAddress(data);
      // Signed in, but as nobody the answer names: the act cannot be shown to run for the holder.
      if (signedIn === null) return refusedWith(COPY.shared.failure.unexpected);
      return asSignInIdentifier(signedIn) === asSignInIdentifier(holder) ? null : refusedWith(COPY.shared.failure.signInExpired);
    } catch {
      return refusedWith(COPY.shared.failure.unexpected);
    }
  };

  return <Payload, Value>(act: (payload: Payload) => Promise<ActionAnswer<Value>>) => {
    if (!asked) return act;
    return async (payload: Payload): Promise<ActionAnswer<Value>> => (await touch()) ?? act(payload);
  };
}
