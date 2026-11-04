"use client";

import { useState } from "react";

import { loadAuthClient, usePreloadedAuthClient } from "@/core/auth/browserClient";
import { COPY } from "@/core/copy";
import { asSignInIdentifier } from "@/core/emailAddress";

import type { Copy } from "@/core/copy";

/**
 * The passkey touch's browser half, which an act on its fixed list runs before anything else, a question included: a
 * passkey sign-in, whose fresh session the action's lane admits (`fl_frontend/src/core/action.ts`, the lane's `passkey`
 * slot). `held` is whether the person holds a passkey, which the page read; a person holding none is asked nothing, as
 * the lane admits them. `run` asks the touch and then runs the act; where the passkey did not answer, the act never
 * runs and `refusal` holds the line the act's status line shows, cleared by the next run. The act's button stays busy
 * while the browser's prompt stands. `holder` is the address the page was drawn for: a page whose own session ended
 * asks a prompt naming nobody, which any account's passkey answers, so a touch signing another account in is refused
 * as the page's sign-in having ended, and the act never runs. The prompt itself cannot be narrowed to the holder's
 * passkeys there: the library lists a session's own alone, and none stands.
 */
export function usePasskeyTouch(held: boolean, holder: string | undefined) {
  const [isTouching, setTouching] = useState(false);
  // The touch's own refusal: the act never ran, so no answer of its says it.
  const [refusal, setRefusal] = useState<Copy | null>(null);
  usePreloadedAuthClient(held);

  const touch = async (): Promise<Copy | null> => {
    if (!held) return null;
    setTouching(true);
    try {
      const authClient = await loadAuthClient();
      const { data, error } = await authClient.signIn.passkey();
      // A cancelled prompt and a refused passkey alike: the act did not run, and the passkey did not answer for it.
      if (error !== null) return COPY.signIn.refusal.unverified;
      const signedIn = asSignInIdentifier(data.user.email);
      return holder === undefined || signedIn === asSignInIdentifier(holder) ? null : COPY.shared.failure.signInExpired;
    } catch {
      return COPY.shared.failure.unexpected;
    } finally {
      setTouching(false);
    }
  };

  /** The touch, then the act; the refusal where the act did not run, which `refusal` holds too. */
  const run = async (act: () => void): Promise<Copy | null> => {
    setRefusal(null);
    const refused = await touch();
    if (refused === null) act();
    else setRefusal(refused);
    return refused;
  };

  return { run, refusal, isTouching };
}
