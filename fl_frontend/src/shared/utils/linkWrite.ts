import { LINK_ERNEUT_OHNE_ANTWORT, rejectedWrite } from "./actionError";
import { DRAFT_DISCARDED, guardAgainstDraft } from "./draftGuard";

import type { StepUpGate } from "@/shared/hooks/useStepUp";
import type { ActionFailure } from "@/shared/types/types";

/**
 * One press of a control beside an editor's draft that mints or voids a bearer link, so it steps up
 * (`docs/frontend/spec.md :: I432`). `null` where the press stopped before the write: an unsaved draft,
 * or a refused prompt. `pending` brackets the prompt and the write alike.
 */
export async function pressLinkWrite<T extends { success: boolean }>({
  isDirty,
  stepUp,
  router,
  pending,
  write,
}: {
  isDirty: boolean;
  stepUp: Pick<StepUpGate, "confirm">;
  router: { refresh: () => void };
  pending: (running: boolean) => void;
  write: () => Promise<T>;
}): Promise<T | ActionFailure | null> {
  if (!guardAgainstDraft(isDirty, DRAFT_DISCARDED)) return null;

  pending(true);
  if (!(await stepUp.confirm(true))) {
    pending(false);
    return null;
  }

  // Awaited outside a transition, so a rejected action reaches no error boundary: uncaught, it leaves
  // the control pending for good and reports nothing.
  const answer = await write().catch(rejectedWrite(router, LINK_ERNEUT_OHNE_ANTWORT));
  pending(false);

  return answer;
}
