import { unstable_rethrow } from "next/navigation";

import { APIBadStatusError, APIMalformedDataError, APINetworkError } from "@/core/errors";
import { logger } from "@/core/logging";
import { requestOutcomeUnknown } from "@/core/requestScope";

import { toActionErrorResult, unansweredAction } from "./actionError";
import { runWithIncomingTrace } from "./traceScope";
import { VALIDATION_FAILED } from "./validation";

import type { SentRequest } from "@/core/errors";
import type { ActionFailure } from "@/shared/types/types";
import type { FieldErrors } from "./validation";

/**
 * What every admin write answers when the session carries no admin role. It becomes `FormState.error` and reaches a
 * toast, so it names the admin's only remedy rather than the role that is absent.
 */
export const ADMIN_FORBIDDEN = "Deine Sitzung hat keine Administratorrechte. Melde Dich neu an.";

/**
 * A slice's mapped refusal as the failure an action returns.
 *
 * The fallback is here rather than at each return: a mapper answering a field message and no
 * sentence renders a toast with an empty body wherever one is left out.
 */
export function refusalResult(refusal: { error?: string; fieldErrors?: FieldErrors }): ActionFailure {
  return { success: false, error: refusal.error ?? VALIDATION_FAILED, fieldErrors: refusal.fieldErrors };
}

/**
 * Seeds the request scope with the edge-minted trace id, and converts a thrown API error into the caller's result
 * — without which Next redacts the throw to a digest and an ordinary 409 replaces the admin's toast with the error page.
 */
export async function runAdminMutation<T extends { success: boolean }>(
  mutationName: string,
  // Required at every call: a throw after a write may leave its row standing, a read's changed nothing,
  // and a default would answer one of them wrongly.
  { readOnly }: Pick<SentRequest, "readOnly">,
  fn: () => Promise<T>,
): Promise<T | ActionFailure> {
  return runWithIncomingTrace(async () => {
    let answer: T | ActionFailure;
    try {
      answer = await fn();
    } catch (error) {
      // A framework control-flow throw (redirect(), notFound()) is a navigation rather than a failure.
      unstable_rethrow(error);

      const typed = error instanceof APIBadStatusError || error instanceof APINetworkError || error instanceof APIMalformedDataError;
      logger.error(`Admin mutation failed: ${mutationName}`, error, {
        error_code: typed ? error.code : "FE-ACT-001",
        server_error_code: error instanceof APIBadStatusError ? error.serverErrorCode : undefined,
        status: error instanceof APIBadStatusError || error instanceof APIMalformedDataError ? error.statusCode : undefined,
      });

      // A server action is a POST whatever it does, so its declaration is what tells the two apart.
      answer = toActionErrorResult(error, { method: "POST", readOnly: readOnly });
    }

    // Whatever the action made of a deadline's cut or of a mail that may have gone, a fan-out settling
    // either among its refusals: part of the write may stand (`docs/frontend/spec.md :: I366`).
    if (!readOnly && requestOutcomeUnknown()) {
      logger.error(`Admin mutation of unknown outcome: ${mutationName}`, undefined, { error_code: "FE-NET-001" });

      return unansweredAction();
    }

    return answer;
  });
}
