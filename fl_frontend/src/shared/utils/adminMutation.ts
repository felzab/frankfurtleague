import { unstable_rethrow } from "next/navigation";

import { APIBadStatusError, APIMalformedDataError, APINetworkError } from "@/core/errors";
import { logger } from "@/core/logging";

import { toActionErrorResult } from "./actionError";
import { runWithIncomingCorrelationId } from "./correlationScope";

import type { FormState } from "@/shared/types/types";

/**
 * The generic banner for a payload the schema refused, declared once, in the refusal format §1.12 of
 * `docs/frontend/spec.md` sets. The field messages beside it carry the specifics.
 */
export const VALIDATION_FAILED = "Überprüfe Deine Eingaben.";

/**
 * What every admin write answers when the session carries no admin role. It becomes `FormState.error` and reaches a
 * toast, so it names the admin's only remedy rather than the role that is absent.
 */
export const ADMIN_FORBIDDEN = "Deine Sitzung hat keine Administratorrechte. Melde Dich neu an.";

/**
 * Seeds the request scope with the edge-minted correlation id, and converts a thrown API error into the caller's result
 * — without which Next redacts the throw to a digest and an ordinary 409 replaces the admin's toast with the error page.
 */
export async function runAdminMutation<T extends { success: boolean }>(
  mutationName: string,
  fn: () => Promise<T>,
): Promise<T | NonNullable<FormState>> {
  return runWithIncomingCorrelationId(async () => {
    try {
      return await fn();
    } catch (error) {
      // A framework control-flow throw (redirect(), notFound()) is a navigation rather than a failure.
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
