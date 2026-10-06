import { rejectedWrite } from "./actionError";
import { DRAFT_DISCARDED, guardAgainstDraft } from "./draftGuard";

import type { StepUpGate } from "@/shared/hooks/useStepUp";
import type { ActionFailure } from "@/shared/types/types";

/**
 * A press minting or voiding a bearer link beside an editor's draft, so stepped up
 * (`docs/frontend/spec.md :: I432`); `null` where it stopped before the write. `repair` is the
 * caller's: a re-send and a discard owe different next steps.
 */
export async function pressLinkWrite<T extends { success: boolean }>({
  isDirty,
  stepUp,
  router,
  pending,
  write,
  repair,
}: {
  isDirty: boolean;
  stepUp: Pick<StepUpGate, "confirm">;
  router: { refresh: () => void };
  pending: (running: boolean) => void;
  write: () => Promise<T>;
  repair: string;
}): Promise<T | ActionFailure | null> {
  if (!guardAgainstDraft(isDirty, DRAFT_DISCARDED)) return null;

  pending(true);
  if (!(await stepUp.confirm(true))) {
    pending(false);
    return null;
  }

  // Awaited outside a transition, so a rejected action reaches no error boundary: uncaught, it leaves
  // the control pending for good and reports nothing.
  const answer = await write().catch(rejectedWrite(router, repair));
  pending(false);

  return answer;
}
