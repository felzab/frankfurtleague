import { APIBadStatusError, APIMalformedDataError, APINetworkError, mayHaveWritten, RolledBackError } from "@/core/errors";
import { requestOutcomeUnknown, requestWriteSent } from "@/core/requestScope";

import { outcomeUnknown, toActionErrorResult } from "./actionError";

import type { ActionFailure } from "@/shared/types/types";
import type { Wording } from "./actionError";

/**
 * After a sent write only that write's own answer says whether it landed, so any other throw of a spine's body is of
 * unknown outcome; with none sent, the error answers for itself, in the press's `wording`.
 */
export function answerThrow(error: unknown, wording?: Wording): ActionFailure {
  const typed = error instanceof APIBadStatusError || error instanceof APINetworkError || error instanceof APIMalformedDataError;
  const writesOwn = error instanceof RolledBackError || (typed && mayHaveWritten(error));

  return requestWriteSent() && !writesOwn ? outcomeUnknown(wording) : toActionErrorResult(error, undefined, wording);
}

/**
 * Whether a sent write may stand behind the body's own answer: the deadline cut a call, or a send that may have gone
 * was settled among its refusals (`docs/frontend/spec.md :: I366`).
 */
export function writeOutcomeUnknown(): boolean {
  return requestWriteSent() && requestOutcomeUnknown();
}
