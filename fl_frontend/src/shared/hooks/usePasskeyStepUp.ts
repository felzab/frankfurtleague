"use client";

import { useCallback, useState } from "react";

import { authClient } from "@/core/authClient";

/** Whether the prompt is running, and whether the last one failed to confirm the page's holder. */
export interface PasskeyStepUp {
  readonly stepUp: () => Promise<boolean>;
  readonly isPending: boolean;
  readonly refused: boolean;
}

/**
 * A confirmation is a fresh sign-in (`docs/frontend/spec.md :: I422`), and the browser offers every
 * account's passkey: `istInhaber` asks whose session the assertion minted (`docs/frontend/spec.md :: I428`).
 */
export function usePasskeyStepUp(istInhaber: () => Promise<boolean>): PasskeyStepUp {
  const [isPending, setIsPending] = useState(false);
  const [refused, setRefused] = useState(false);

  // Memoised by hand, the React Compiler being off: the administrator's provider hands it to every
  // armed control through its context value, which a new function each render would renew.
  const stepUp = useCallback(async (): Promise<boolean> => {
    setIsPending(true);
    setRefused(false);
    try {
      const { error } = await authClient.signIn.passkey();
      const confirmed = error === null && (await istInhaber());
      setRefused(!confirmed);
      return confirmed;
    } catch {
      // Thrown by the options request ahead of the ceremony, and by a holder check that never came back.
      setRefused(true);
      return false;
    } finally {
      setIsPending(false);
    }
  }, [istInhaber]);

  return { stepUp, isPending, refused };
}
