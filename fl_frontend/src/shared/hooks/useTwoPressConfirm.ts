"use client";

import { useRef, useState, useTransition } from "react";

// Windows ships 500 ms as its double-click threshold and browsers pair a dblclick at about the
// same distance, so anything under it is one motor action rather than two read decisions.
export const DOUBLE_PRESS_MS = 500;

/**
 * The confirm-then-write control, in one place: the first press arms, the second writes — unless it
 * lands within `DOUBLE_PRESS_MS` of the arming press — and a `guard` returning false does neither.
 * Eight irreversible operations run through it, so no two can drift apart.
 */
export function useTwoPressConfirm(guard?: () => boolean): {
  isConfirming: boolean;
  isPending: boolean;
  press: (write: () => Promise<void>) => void;
  cancel: () => void;
} {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isPending, startWriting] = useTransition();
  // A ref, not state: the timestamp decides inside the handler and renders nothing.
  const armedAt = useRef(0);

  const press = (write: () => Promise<void>) => {
    // Run on BOTH presses, not just the arming one: an editor's fields stay live between arming and
    // confirming, so a draft typed in that window would go with the revalidation the write ends on.
    if (guard !== undefined && !guard()) {
      // Disarmed as well as stopped, or the alert stands claiming a write is one press away that the
      // next press refuses again.
      setIsConfirming(false);
      return;
    }

    if (!isConfirming) {
      armedAt.current = Date.now();
      setIsConfirming(true);
      return;
    }

    // A double-click reaches here armed: React re-renders between the two clicks, so the second one
    // reads `isConfirming` as true before the alert was readable. Ignored rather than disarmed, so
    // the alert stands and a press taken after reading it still confirms.
    if (Date.now() - armedAt.current < DOUBLE_PRESS_MS) return;

    startWriting(async () => {
      await write();
      // After the response and never before it: the open alert, the destructive fill and the closed
      // cancel are what say a press is in flight, and clearing early drops all three at once.
      setIsConfirming(false);
    });
  };

  return { isConfirming, isPending, press, cancel: () => setIsConfirming(false) };
}
