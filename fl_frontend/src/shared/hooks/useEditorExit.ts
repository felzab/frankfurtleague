"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { goBackOrPush } from "@/core/goBackOrPush";

export type PageExitOptions = {
  fallbackHref: string;
};

/** The one way off a page a control can leave: the guarded destination and the pending flag together. */
export function usePageExit({ fallbackHref }: PageExitOptions) {
  const router = useRouter();
  const [isLeaving, startLeaving] = useTransition();

  const leavePage = () => {
    // Blur before the transition, never inside it: react-aria clears `data-focused` on blur, so
    // leaving with a field focused strands it set on a tree the router keeps.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    // A transition and not a bare call: `isLeaving` is what disables a control while it leaves.
    startLeaving(() => {
      goBackOrPush(router, fallbackHref);
    });
  };

  return { isLeaving, leavePage };
}

/**
 * The one way out of a page-owned editor: the discard latch and both handlers move together with
 * `usePageExit`'s transition, a caller taking only some of them half-wiring the exit.
 */
export function useEditorExit({
  fallbackHref,
  isDirty,
  resetDraftToStored,
}: PageExitOptions & {
  isDirty: boolean;
  resetDraftToStored: () => void;
}) {
  const { isLeaving, leavePage } = usePageExit({ fallbackHref: fallbackHref });
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);
  const [hasLeftViaDiscard, setHasLeftViaDiscard] = useState(false);

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
