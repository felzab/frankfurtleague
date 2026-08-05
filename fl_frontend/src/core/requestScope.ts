/**
 * CORE · request scope
 *
 * An `AsyncLocalStorage` carrying the current request's correlation id, so `apiClient` and the
 * logger can read it without threading a parameter through every call site.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • Seeded only where a request context exists, and seeding is
 *     `shared/utils/correlationScope.ts`'s job: the server-action wrapper, route handlers, and an
 *     uncached read inside a page render. Never inside a `"use cache"` scope — cached executions
 *     are shared across requests by construction, and Next refuses request APIs there for exactly
 *     that reason. Code running unseeded mints its own id instead (`core/api.ts`, docs/logging.md).
 *   • This module imports nothing from `core/config.ts` or `core/logging.ts`, so both can import it,
 *     and **nothing from `next/headers`**: `core/logging.ts` reaches the Edge middleware bundle
 *     through `core/auth.ts`, so a request-only API imported here would be bundled for a runtime
 *     that cannot serve it. That is why the seeding half lives in `shared/` instead.
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
