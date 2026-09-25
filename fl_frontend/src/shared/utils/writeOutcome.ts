import { APIBadStatusError, APIMalformedDataError, APINetworkError, mayHaveWritten, RolledBackError } from "@/core/errors";
import { requestOutcomeUnknown, requestWriteSent } from "@/core/requestScope";

import { toActionErrorResult, unansweredAction } from "./actionError";

import type { ActionFailure } from "@/shared/types/types";

/**
 * After a sent write only that write's own answer says whether it landed, so any other throw of a spine's body is of
 * unknown outcome; with none sent, the error answers for itself.
 */
export function answerThrow(error: unknown): ActionFailure {
  const typed = error instanceof APIBadStatusError || error instanceof APINetworkError || error instanceof APIMalformedDataError;
  const writesOwn = error instanceof RolledBackError || (typed && mayHaveWritten(error));

  return requestWriteSent() && !writesOwn ? unansweredAction() : toActionErrorResult(error);
}

/**
 * Whether a sent write may stand behind the body's own answer: the deadline cut a call, or a send that may have gone
 * was settled among its refusals (`docs/frontend/spec.md :: I366`).
 */
export function writeOutcomeUnknown(): boolean {
  return requestWriteSent() && requestOutcomeUnknown();
}
