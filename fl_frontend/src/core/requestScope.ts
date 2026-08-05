/**
 * CORE · request scope
 *
 * An `AsyncLocalStorage` carrying the current request's correlation id, so `apiClient` and the
 * logger can read it without threading a parameter through every call site.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • Seeded only where a request context exists: the server-action wrapper
 *     (`shared/utils/serverAction.ts`) and route handlers. Never inside a `"use cache"` scope —
 *     cached executions are shared across requests by construction, and Next refuses request APIs
 *     there for exactly that reason. Code running unseeded mints its own id instead
 *     (`core/api.ts`, docs/logging.md).
 *   • This module imports nothing from `core/config.ts` or `core/logging.ts`, so both can import it.
 */

import { AsyncLocalStorage } from "node:async_hooks";

interface RequestScope {
  correlationId: string;
}

const storage = new AsyncLocalStorage<RequestScope>();

export function runWithRequestScope<T>(scope: RequestScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn);
}

/** The current request's correlation id, or `undefined` outside any seeded scope. */
export function getRequestCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
