/**
 * CORE · request scope
 *
 * An `AsyncLocalStorage` carrying the current request's correlation id, so `apiClient` and the
 * logger can read it without threading a parameter through every call site.
 *
 * Invariants:
 * - Seeded only by `shared/utils/correlationScope.ts`, never inside a `"use cache"` scope —
 *   cached executions are shared across requests; unseeded code mints its own id (`core/api.ts`).
 * - Imports nothing from `core/config.ts`, `core/logging.ts` or `next/headers` — the logger
 *   reaches the Edge bundle through `core/auth.ts`, and a request-only API here would break it.
 */

import { AsyncLocalStorage } from "node:async_hooks";

interface RequestScope {
  correlationId: string;
}

const storage = new AsyncLocalStorage<RequestScope>();

export function runWithRequestScope<T>(scope: RequestScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn);
}

export function getRequestCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
