import "server-only";

import { loggedByBackend, requestOf } from "@/core/errors";
import { logger } from "@/core/logging";

/**
 * Logged by name alone: an action's callee may throw with a submitted value in its message or stack. A failure the
 * backend answered is its own line's, so it is written once.
 */
export function logActionFailure(message: string, error: unknown): void {
  if (loggedByBackend(error)) return;

  // A `"use cache"` fill's throw carries Next's digest, which joins this line to the one a production build writes of it.
  const digest: unknown = error instanceof Error ? Reflect.get(error, "digest") : undefined;
  logger.error(message, undefined, {
    name: error instanceof Error ? error.name : "unknown",
    // The failed call's own trace, which the backend's line carries; the logger falls back to the request's scope.
    ...requestOf(error),
    digest: typeof digest === "string" ? digest : undefined,
  });
}
