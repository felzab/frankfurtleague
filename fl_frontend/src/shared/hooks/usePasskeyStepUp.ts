"use client";

import { useState } from "react";

import { authClient } from "@/core/authClient";

/** The control that runs the passkey prompt as a confirmation, wherever a page asks for one. */
export const STEP_UP_LABEL = "Mit Passkey bestätigen";

/** A refused or cancelled prompt, an unknown authenticator and an unverified one read alike to the person at the prompt. */
export const STEP_UP_REFUSED = "Wir konnten Dich nicht mit einem Passkey bestätigen.";

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

  const stepUp = async (): Promise<boolean> => {
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
  };

  return { stepUp, isPending, refused };
}
