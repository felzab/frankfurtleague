"use client";

import { startTransition, useCallback, useMemo, useState } from "react";

import { ENROLMENT_WINDOW_MS, STEP_UP_WINDOW_MS } from "@/core/sessionLifetimes";
import { StepUpContext } from "@/shared/components/ui/stepUp";
import { usePasskeyStepUp } from "@/shared/hooks/usePasskeyStepUp";

import { pruefeAdministratorAction } from "../../actions";

import type { StepUp } from "@/shared/components/ui/stepUp";
import type { ReactNode } from "react";

/**
 * The step-up every step-up write of the administrator's shell asks through. A client module of its
 * own, so the passkey client never reaches a public page that renders the shared controls.
 */
export function AdminStepUpProvider({
  served,
  children,
}: {
  /**
   * Epoch milliseconds, on the server's clock, the session stays confirmed until for either window;
   * `null` where it is not. Wrapped so each server render hands over a new object, even carrying the
   * same figures.
   */
  served: { readonly confirmedUntil: number | null; readonly enrolmentUntil: number | null; readonly inhaberId: string };
  children: ReactNode;
}) {
  // A confirmation made here stands until the next server render, whose figure then wins even where it
  // is the same: a refused write's refresh is such a render (`docs/frontend/spec.md :: I433`).
  const [seen, setSeen] = useState(served);
  const [until, setUntil] = useState({ standing: served.confirmedUntil, enrolment: served.enrolmentUntil });
  if (served !== seen) {
    setSeen(served);
    setUntil({ standing: served.confirmedUntil, enrolment: served.enrolmentUntil });
  }

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
      isStale: (now, demand = true) => {
        const confirmedUntil = demand === "enrolment" ? until.enrolment : until.standing;
        return confirmedUntil === null || now >= confirmedUntil;
      },
      confirm: async () => {
        if (!(await prompt())) return false;

        // Wrapped: the press awaits this inside its transition, and React leaves an update after an
        // `await` outside it.
        // Both windows from this moment: the assertion minted a new session, which is what each is measured from.
        startTransition(() => {
          const now = Date.now();
          setUntil({ standing: now + STEP_UP_WINDOW_MS, enrolment: now + ENROLMENT_WINDOW_MS });
        });
        return true;
      },
    }),
    [until, prompt],
  );

  return <StepUpContext.Provider value={stepUp}>{children}</StepUpContext.Provider>;
}
