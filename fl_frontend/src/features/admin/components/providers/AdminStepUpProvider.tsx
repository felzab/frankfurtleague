"use client";

import { startTransition, useCallback, useMemo } from "react";

import { StepUpContext } from "@/shared/components/ui/stepUp";
import { useConfirmationWindows } from "@/shared/hooks/useConfirmationWindows";
import { usePasskeyStepUp } from "@/shared/hooks/usePasskeyStepUp";

import { pruefeAdministratorAction } from "../../actions";

import type { StepUp } from "@/shared/components/ui/stepUp";
import type { ConfirmedUntil } from "@/shared/hooks/useConfirmationWindows";
import type { ReactNode } from "react";

/**
 * The step-up every step-up write of the administrator's shell asks through. A client module of its
 * own, so the passkey client never reaches a public page that renders the shared controls.
 */
export function AdminStepUpProvider({
  served,
  children,
}: {
  /** Wrapped so each server render hands over a new object, even carrying the same figures. */
  served: ConfirmedUntil & { readonly inhaberId: string };
  children: ReactNode;
}) {
  const windows = useConfirmationWindows(served);

  // The account page's holder check over the administrator's own spine: an assertion signing another
  // account in leaves the waiting write unrun (`docs/frontend/spec.md :: I428`).
  const { inhaberId } = served;
  const istInhaber = useCallback(async () => {
    const holder = await pruefeAdministratorAction(inhaberId);
    return holder.success && holder.gleich;
  }, [inhaberId]);
  const { stepUp: prompt } = usePasskeyStepUp(istInhaber);

  // Memoised by hand: the React Compiler is deliberately off, and every armed control reads this.
  const stepUp = useMemo<StepUp>(
    () => ({
      isStale: windows.isStale,
      confirm: async () => {
        if (!(await prompt())) return false;

        // Wrapped: the press awaits this inside its transition, and React leaves an update after an
        // `await` outside it.
        startTransition(windows.confirmed);
        return true;
      },
    }),
    [windows, prompt],
  );

  return <StepUpContext.Provider value={stepUp}>{children}</StepUpContext.Provider>;
}
