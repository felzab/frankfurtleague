"use client";

import { useContext, useRef, useState } from "react";

import { STEP_UP_RUNNING, StepUpContext } from "@/shared/components/ui/stepUp";

import type { StepUp, StepUpDemand } from "@/shared/components/ui/stepUp";

// Both ways in are called from the press itself, whose user activation the prompt needs, and never
// inside a transition, which would hold back what the control says while the prompt is open.
/**
 * The step-up a press runs before a write the server refuses from a session past the window
 * (`docs/frontend/spec.md :: I431`): every such control, one press or two, asks through this.
 */
export interface StepUpGate {
  /** Whether a press now would open the prompt; `due` is the window the server holds this press's write to, if any. */
  isDue: (due: StepUpDemand) => boolean;
  /** The prompt where due, answering whether the write may go: for a press awaiting its write outside a transition. */
  confirm: (due: StepUpDemand) => Promise<boolean>;
  /**
   * Starts `go`, the write's own transition, once `confirm` has; synchronously where no prompt is due.
   * `onRefused` is for a control that reports its outcomes in toasts rather than beside itself.
   */
  confirmThen: (due: StepUpDemand, go: () => void, onRefused?: () => void) => void;
  /** A prompt this control opened is open, and nothing has been sent. */
  isPrompting: boolean;
  /** What the pending control says: the prompt's words while it is open, the write's own after. */
  running: (write: string) => string;
  /** The last prompt this control opened was refused, so nothing was sent. */
  refused: boolean;
  /** The page's own, for a press that runs outside this tree: the undo offer's. */
  page: StepUp | undefined;
}

export function useStepUp(): StepUpGate {
  const page = useContext(StepUpContext);
  const [isPrompting, setPrompting] = useState(false);
  const [refused, setRefused] = useState(false);
  // Set in the handler, so a press landing before the render that reports `isPrompting` opens no second prompt.
  const promptingRef = useRef(false);

  // Asked at the press rather than at render: the window closes while a control stands. No page, no
  // figure: the server's refusal is then the whole of the step-up.
  const isDue = (due: StepUpDemand): boolean => due !== false && page !== undefined && page.isStale(Date.now(), due);

  const confirm = async (due: StepUpDemand): Promise<boolean> => {
    // A second press while the prompt is open sends nothing: the first press's write is on its way.
    if (promptingRef.current) return false;

    setRefused(false);
    if (page === undefined || !isDue(due)) return true;

    promptingRef.current = true;
    setPrompting(true);
    const confirmed = await page.confirm();
    promptingRef.current = false;
    setPrompting(false);
    setRefused(!confirmed);
    return confirmed;
  };

  const confirmThen = (due: StepUpDemand, go: () => void, onRefused?: () => void): void => {
    if (promptingRef.current) return;

    // Synchronous where no prompt is due, so the write's pending state lands in the press's own render.
    if (!isDue(due)) {
      setRefused(false);
      go();
      return;
    }

    void confirm(due).then((confirmed) => (confirmed ? go() : onRefused?.()));
  };

  return { isDue, confirm, confirmThen, isPrompting, running: (write) => (isPrompting ? STEP_UP_RUNNING : write), refused, page };
}
