import "server-only";

import { APIBadStatusError, APIMalformedDataError, APINetworkError, ApiUnsentError, requestOf } from "@/core/errors";
import { logger } from "@/core/logging";

/**
 * Logged by name and code alone: an action's callee may throw with the submitted address in its message or stack
 * (`docs/logging/spec.md :: L9`), and a typed API error's code and trace join this line to the backend's.
 */
export function logActionFailure(message: string, error: unknown): void {
  const typed =
    error instanceof APIBadStatusError ||
    error instanceof APINetworkError ||
    error instanceof APIMalformedDataError ||
    error instanceof ApiUnsentError;
  // A `"use cache"` fill's throw carries Next's digest, which joins this line to the one a production build writes of it.
  const digest: unknown = error instanceof Error ? Reflect.get(error, "digest") : undefined;
  logger.error(message, undefined, {
    error_code: typed ? error.code : "FE-ACT-001",
    name: error instanceof Error ? error.name : "unknown",
    // The failed call's own trace, which the backend's line carries; the logger falls back to the request's scope.
    ...requestOf(error),
    digest: typeof digest === "string" ? digest : undefined,
  });
}
