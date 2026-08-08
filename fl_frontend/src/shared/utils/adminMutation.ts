/**
 * SHARED · admin mutation runner
 *
 * Wraps every admin mutation body, doing the two things each of them would otherwise have to repeat:
 *
 *   1. **Seed the request scope.** A mutation runs in a dynamic context, which is where the
 *      edge-minted correlation id is readable (`headers()` is allowed here, unlike inside
 *      `"use cache"`), so the wrapper is what puts the id where `apiClient` and the logger pick it
 *      up (`core/requestScope.ts`).
 *   2. **Convert a thrown API error into the result the caller renders.** `apiClient` throws on any
 *      non-2xx; without this boundary the throw crosses the server-action boundary, Next redacts it
 *      to a digest, and the admin's toast is replaced by the whole error page — for a 409 that is an
 *      ordinary, expected outcome (ADR-0032). The failure is logged HERE, with its codes and id,
 *      because a handled error never reaches `onRequestError`.
 *
 * **Named for the mutation rather than the transport**, because it now wraps both: nine server
 * actions and one route handler. That handler is the match edit's undo, which is a route handler for
 * a reason recorded in [ADR-0055](../../../../docs/_decisions/0055-the-undo-is-a-route-handler-until-e592-is-fixed.md)
 * — everything in this wrapper applies to it unchanged, which is part of why that shape was chosen.
 */

import { unstable_rethrow } from "next/navigation";

import { APIBadStatusError, APIMalformedDataError, APINetworkError } from "@/core/errors";
import { logger } from "@/core/logging";

import { toActionErrorResult } from "./actionError";
import { runWithIncomingCorrelationId } from "./correlationScope";

import type { FormState } from "@/shared/types/types";

// Generic over the success shape: the create action resolves with `created_id`, the edit actions
// with `updated_document`, and the failure branch narrows to the plain `FormState` both extend.
/**
 * The generic form banner for a payload the schema refused, declared ONCE (owner, 2026-08-08).
 *
 * Every slice's actions rendered its own copy of this sentence, which is how one of them came to end in
 * an exclamation mark while the rest of the corpus ends in a period. The message format is the one every
 * refusal follows: Du-form imperative, no "Bitte", one period — and the reader is the capitalised Du,
 * per the copy section of docs/frontend/overview.md. The field messages beside it carry the specifics;
 * this is only the banner saying the form as a whole did not go through.
 */
export const VALIDATION_FAILED = "Überprüfe Deine Eingaben.";

export async function runAdminMutation<T extends { success: boolean }>(
  mutationName: string,
  fn: () => Promise<T>,
): Promise<T | NonNullable<FormState>> {
  return runWithIncomingCorrelationId(async () => {
    try {
      return await fn();
    } catch (error) {
      // A framework control-flow throw (redirect(), notFound()) is a navigation, not a failure.
      unstable_rethrow(error);

      const typed = error instanceof APIBadStatusError || error instanceof APINetworkError || error instanceof APIMalformedDataError;
      logger.error(`Admin mutation failed: ${mutationName}`, error, {
        error_code: typed ? error.code : "FE-ACT-001",
        server_error_code: error instanceof APIBadStatusError ? error.serverErrorCode : undefined,
        status: error instanceof APIBadStatusError || error instanceof APIMalformedDataError ? error.statusCode : undefined,
      });

      return toActionErrorResult(error);
    }
  });
}
