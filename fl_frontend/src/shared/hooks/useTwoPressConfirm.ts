"use client";

import { useState, useTransition } from "react";

/**
 * The confirm-then-write control, in one place: the first press arms, the second writes, and a
 * `guard` returning false does neither. Eight irreversible operations run through it, so no two
 * can drift apart.
 */
export function useTwoPressConfirm(guard?: () => boolean): {
  isConfirming: boolean;
  isPending: boolean;
  press: (write: () => Promise<void>) => void;
  cancel: () => void;
} {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isPending, startWriting] = useTransition();

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
      setIsConfirming(true);
      return;
    }

    startWriting(async () => {
      await write();
      // After the response and never before it: the open alert, the destructive fill and the closed
      // cancel are what say a press is in flight, and clearing early drops all three at once.
      setIsConfirming(false);
    });
  };

  return { isConfirming, isPending, press, cancel: () => setIsConfirming(false) };
}
