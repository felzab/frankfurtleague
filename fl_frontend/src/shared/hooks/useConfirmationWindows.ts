"use client";

import { useCallback, useMemo, useState } from "react";

import { ENROLMENT_WINDOW_MS, STEP_UP_WINDOW_MS } from "@/core/sessionLifetimes";

import type { StepUpDemand } from "@/shared/components/ui/stepUp";

/** Until when a page's session counts as confirmed, as a server render reads it: `null` where it does not. */
export interface ConfirmedUntil {
  /** Epoch milliseconds on the server's clock, as `enrolmentUntil` is. */
  readonly freshUntil: number | null;
  /** The enrolment's narrower window, inside the step-up's (`docs/frontend/spec.md :: I411`). */
  readonly enrolmentUntil: number | null;
  /** The server's clock as it read both, so a page measures what is left of each rather than comparing two clocks. */
  readonly servedAt: number;
}

/** Both windows as a page holds them, in epoch milliseconds on the browser's clock. */
type OpenUntil = Omit<ConfirmedUntil, "servedAt">;

/** A confirmation's two windows as a page knows them, whichever surface it is (`docs/frontend/spec.md :: I494`). */
export interface ConfirmationWindows {
  readonly until: OpenUntil;
  /** Whether a write sent at `now` would be refused for want of a confirmation as recent as `demand` asks. */
  readonly isStale: (now: number, demand?: Exclude<StepUpDemand, false>) => boolean;
  /** A confirmation made on the page: its assertion minted a new session, which both windows are measured from. */
  readonly confirmed: () => void;
  /** The page learned `demand`'s window closed; the step-up's closing closes the enrolment's inside it too. */
  readonly close: (demand?: Exclude<StepUpDemand, false>) => void;
}

/**
 * The server's figures on the browser's clock, `skew` ahead of it: a browser minutes fast would otherwise
 * close the enrolment's five minutes before they open.
 */
function onThisClock(served: ConfirmedUntil, skew: number): OpenUntil {
  const here = (until: number | null): number | null => (until === null ? null : until + skew);
  return { freshUntil: here(served.freshUntil), enrolmentUntil: here(served.enrolmentUntil) };
}

/** When this page first held each served object, on the browser's clock. */
const ARRIVED = new WeakMap<ConfirmedUntil, number>();

/**
 * The skew between the two clocks as `served` arrived. Its own for each object, never one kept from an
 * earlier object, which a step of either clock leaves wrong for as long as the page stays open.
 */
function skewOf(served: ConfirmedUntil): number {
  // Read once per object, so every render of one reads the same figure however often React runs it.
  const arrived = ARRIVED.get(served) ?? Date.now();
  ARRIVED.set(served, arrived);
  // The transit counts as time left, which the server refuses a press inside as any other.
  return arrived - served.servedAt;
}

/**
 * `served` is a server render's own object: a new one replaces whatever the page confirmed itself, even
 * carrying the same figures, since a refused write's refresh is such a render (`docs/frontend/spec.md :: I433`).
 */
export function useConfirmationWindows(served: ConfirmedUntil): ConfirmationWindows {
  const [seen, setSeen] = useState(served);
  const [until, setUntil] = useState<OpenUntil>(() => onThisClock(served, skewOf(served)));
  if (served !== seen) {
    setSeen(served);
    setUntil(onThisClock(served, skewOf(served)));
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
