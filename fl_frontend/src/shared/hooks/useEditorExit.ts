"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * The one way out of a page-owned editor: the transition, the discard latch and both handlers move
 * together, a caller taking only some of them half-wiring the exit.
 */
export function useEditorExit({
  fallbackHref,
  isDirty,
  resetDraftToStored,
}: {
  /**
   * Wrapped by the caller, never here: `fl_frontend/src/shared/utils/saisonHref.test.ts` reads each
   * `/admin…` literal at its carrier call, so a route passed in bare is a link no sweep can check
   * for the season.
   */
  fallbackHref: string;
  isDirty: boolean;
  resetDraftToStored: () => void;
}) {
  const router = useRouter();
  const [isLeaving, startLeaving] = useTransition();
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);
  const [hasLeftViaDiscard, setHasLeftViaDiscard] = useState(false);

  const leavePage = () => {
    // Correctness, not tidiness: react-aria clears `data-focused` on blur, so leaving with a field
    // focused strands it set on a tree the router keeps.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    // Hover next: the disabled flag is what ends it (`docs/frontend/spec.md :: I68`).
    startLeaving(() => {
      // `router.back()` on a cold deep link is a silent no-op, and `history.length` is the only
      // signal the platform offers — a fresh tab reads 1, so the push is what keeps the exit alive.
      if (window.history.length > 1) router.back();
      else router.push(fallbackHref);
    });
  };

  const requestLeave = () => {
    if (isDirty) {
      setHasLeftViaDiscard(false);
      setIsConfirmingDiscard(true);
      return;
    }
    leavePage();
  };

  const discardAndLeave = () => {
    resetDraftToStored();
    setIsConfirmingDiscard(false);
    setHasLeftViaDiscard(true);
    leavePage();
  };

  const closeDiscard = () => setIsConfirmingDiscard(false);

  return { isLeaving, leavePage, isConfirmingDiscard, closeDiscard, hasLeftViaDiscard, requestLeave, discardAndLeave };
}
