/**
 * SHARED · server action runner
 *
 * Wraps every admin server action body, doing the two things each of them would otherwise have to
 * repeat:
 *
 *   1. **Seed the request scope.** Server actions are the dynamic context where the edge-minted
 *      correlation id is readable (`headers()` is allowed here, unlike inside `"use cache"`), so
 *      the wrapper is what puts the id where `apiClient` and the logger pick it up
 *      (`core/requestScope.ts`).
 *   2. **Convert a thrown API error into the result the form renders.** `apiClient` throws on any
 *      non-2xx; without this boundary the throw crosses the server-action boundary, Next redacts it
 *      to a digest, and the admin's toast is replaced by the whole error page — for a 409 that is an
 *      ordinary, expected outcome (ADR-0032). The failure is logged HERE, with its codes and id,
 *      because a handled error never reaches `onRequestError`.
 */

import { unstable_rethrow } from "next/navigation";

import { APIBadStatusError, APIMalformedDataError, APINetworkError } from "@/core/errors";
import { logger } from "@/core/logging";

import { toActionErrorResult } from "./actionError";
import { runWithIncomingCorrelationId } from "./correlationScope";

import type { FormState } from "@/shared/types/types";

// Generic over the success shape: the create action resolves with `created_id`, the edit actions
// with `updated_document`, and the failure branch narrows to the plain `FormState` both extend.
export async function runAdminAction<T extends { success: boolean }>(
  actionName: string,
  fn: () => Promise<T>,
): Promise<T | NonNullable<FormState>> {
  return runWithIncomingCorrelationId(async () => {
    try {
      return await fn();
    } catch (error) {
      // A framework control-flow throw (redirect(), notFound()) is a navigation, not a failure.
      unstable_rethrow(error);

      const typed = error instanceof APIBadStatusError || error instanceof APINetworkError || error instanceof APIMalformedDataError;
      logger.error(`Server action failed: ${actionName}`, error, {
        error_code: typed ? error.code : "FE-ACT-001",
        server_error_code: error instanceof APIBadStatusError ? error.serverErrorCode : undefined,
        status: error instanceof APIBadStatusError || error instanceof APIMalformedDataError ? error.statusCode : undefined,
      });

      return toActionErrorResult(error);
    }
  });
}
