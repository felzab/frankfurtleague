"use client";

import { useCallback, useMemo, useState } from "react";

import { ENROLMENT_WINDOW_MS, STEP_UP_WINDOW_MS } from "@/core/sessionLifetimes";

import type { StepUpDemand } from "@/shared/components/ui/stepUp";

/** Until when a page's session counts as confirmed, in epoch milliseconds on the server's clock; `null` where it does not. */
export interface ConfirmedUntil {
  readonly freshUntil: number | null;
  /** The enrolment's narrower window, inside the step-up's (`docs/frontend/spec.md :: I411`). */
  readonly enrolmentUntil: number | null;
}

/** A confirmation's two windows as a page knows them, whichever surface it is (`docs/frontend/spec.md :: I494`). */
export interface ConfirmationWindows {
  readonly until: ConfirmedUntil;
  /** Whether a write sent at `now` would be refused for want of a confirmation as recent as `demand` asks. */
  readonly isStale: (now: number, demand?: Exclude<StepUpDemand, false>) => boolean;
  /** A confirmation made on the page: its assertion minted a new session, which both windows are measured from. */
  readonly confirmed: () => void;
  /** The page learned `demand`'s window closed; the step-up's closing closes the enrolment's inside it too. */
  readonly close: (demand?: Exclude<StepUpDemand, false>) => void;
}

/**
 * `served` is a server render's own object: a new one replaces whatever the page confirmed itself, even
 * carrying the same figures, since a refused write's refresh is such a render (`docs/frontend/spec.md :: I433`).
 */
export function useConfirmationWindows(served: ConfirmedUntil): ConfirmationWindows {
  const [seen, setSeen] = useState(served);
  const [until, setUntil] = useState<ConfirmedUntil>({ freshUntil: served.freshUntil, enrolmentUntil: served.enrolmentUntil });
  if (served !== seen) {
    setSeen(served);
    setUntil({ freshUntil: served.freshUntil, enrolmentUntil: served.enrolmentUntil });
  }

  // Memoised by hand, the React Compiler being off: the administrator's provider hands this to every
  // armed control through its context value, and the account page's lapse timer depends on `close`.
  const confirmed = useCallback(() => {
    const now = Date.now();
    setUntil({ freshUntil: now + STEP_UP_WINDOW_MS, enrolmentUntil: now + ENROLMENT_WINDOW_MS });
  }, []);
  const close = useCallback((demand: Exclude<StepUpDemand, false> = true) => {
    setUntil((open) => (demand === "enrolment" ? { ...open, enrolmentUntil: null } : { freshUntil: null, enrolmentUntil: null }));
  }, []);

  return useMemo<ConfirmationWindows>(
    () => ({
      until,
      // Half-open at its end, as the server's own check is: the closing millisecond is the first refused.
      isStale: (now, demand = true) => {
        const closesAt = demand === "enrolment" ? until.enrolmentUntil : until.freshUntil;
        return closesAt === null || now >= closesAt;
      },
      confirmed,
      close,
    }),
    [until, confirmed, close],
  );
}
