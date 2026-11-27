"use client";

import { flushSync } from "react-dom";

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
 * dialog, presses the final button, and that press runs the act's dry run where it is given one, asks the touch once
 * the dry run passed, and then runs the act. So every input is typed, and every fault the server can name stands on
 * its field with the input kept, before the touch, whose session the action's lane admits for `PASSKEY_TOUCH_SECONDS`
 * alone (the lane's `passkey` slot). The prompt comes from the press, never an effect, which would ask a prompt nobody
 * pressed for. WebKit before iOS and iPadOS 17.4 and macOS 14.4 asked WebAuthn for the press's user activation, which
 * a dry run's round trip may spend; the owner supports none of those versions.
 *
 * Mounted with the page rather than with a dialog, so the client's chunk is here before the press. `asked` is whether
 * the page is an administrator's, which the page read; a person is asked nothing, as the lane admits them, and their
 * act runs once, with no dry run. It answers the wrapper an act's own press runs, given `{ dryRunFirst: true }` for an
 * act whose lane declares its dry run (`core/action.ts :: DryRunAction`): a refused dry run answers its refusal, the
 * touch never asked; the wrapped act answers as the act does, or, where the passkey did not answer, with the refusal,
 * the act never having run, which the caller shows on its line as any refusal, with what the person typed; a sheet the
 * person closed answers `closed`, which says nothing. The caller's pending state holds through the browser's prompt,
 * the act's button busy. `holder` is the address the page was drawn for: a page whose own session ended asks a prompt
 * naming nobody, which any account's passkey answers, so a touch signing another account in is refused as the page's
 * sign-in having ended. The prompt itself cannot be narrowed to the holder's passkeys there: the library lists a
 * session's own alone, and none stands.
 *
 * `stepAside` is a dialog's, whose React Aria modal makes every element outside it inert, a password manager's prompt
 * drawn in the page while it stands included, which would take no press and no Escape: it is told `true` before the
 * prompt opens, committed at once so the page stands free of the modal before the browser asks, and `false` once the
 * prompt has answered, the dialog standing again with its input for the act's answer.
 */
export function usePasskeyTouch(asked: boolean, holder: string | undefined, stepAside?: (aside: boolean) => void) {
  usePreloadedAuthClient(asked);

  const prompt = async (authClient: Awaited<ReturnType<typeof loadAuthClient>>) => {
    if (stepAside === undefined) return authClient.signIn.passkey();
    // Past the first `await`, so outside the press's transition, whose updates would wait for the whole act; and
    // flushed, as React's guide does for a browser API reading the page, so the modal's cleanup has run before it asks.
    flushSync(() => stepAside(true));
    try {
      return await authClient.signIn.passkey();
    } finally {
      stepAside(false);
    }
  };

  const touch = async (): Promise<ActionAnswer<never> | null> => {
    try {
      const authClient = await loadAuthClient();
      const { data, error } = await prompt(authClient);
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

  return <Payload, Value>(act: (payload: Payload, dryRun?: boolean) => Promise<ActionAnswer<Value>>, order?: DryRunFirst) => {
    if (!asked) return (payload: Payload) => act(payload);
    return async (payload: Payload): Promise<ActionAnswer<Value>> => {
      if (order !== undefined) {
        const judged = await act(payload, true);
        if (!judged.ok) return judged;
      }
      return (await touch()) ?? act(payload);
    };
  };
}

/** The order of an act whose lane declares its dry run: the dry run, then the touch, then the act. */
type DryRunFirst = { readonly dryRunFirst: true };
