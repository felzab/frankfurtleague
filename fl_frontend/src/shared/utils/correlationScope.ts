/**
 * SHARED · seeding the correlation scope
 *
 * The one seam every DYNAMIC caller shares — a server action, a route handler, or an uncached read
 * inside a page render. It reads the id nginx minted for this request off the incoming headers and
 * runs the caller under it, so the caller's outbound requests carry the same id as the edge's own
 * access line instead of minting one each (`docs/logging/spec.md`).
 *
 * **Separate from `core/requestScope.ts`, which owns the storage, and it has to be.**
 * `core/logging.ts` imports that module and is itself reachable from the Edge middleware bundle
 * through `core/auth.ts` and `src/proxy.ts`. `next/headers` is a request-only API, so importing it
 * there would bundle it for a runtime that cannot serve it. Keeping the seeding half here means the
 * import graph reaches `next/headers` only from callers that genuinely run in a request.
 */

import { headers } from "next/headers";

import { CORRELATION_HEADER, isWellFormedCorrelationId, mintCorrelationId } from "@/core/correlation";
import { runWithRequestScope } from "@/core/requestScope";

/**
 * Run `fn` under this request's correlation id.
 *
 * **`headers()` is allowed to throw here, and must be.** Calling this from inside a `"use cache"`
 * scope raises `next-request-in-use-cache`, which names the mistake at the line that made it.
 * Catching it and minting instead would hand a shared cache entry a per-request id and hide the
 * error — the opposite of what the convention exists for.
 */
export async function runWithIncomingCorrelationId<T>(fn: () => Promise<T>): Promise<T> {
  const incoming = (await headers()).get(CORRELATION_HEADER);
  const correlationId = isWellFormedCorrelationId(incoming) ? incoming : mintCorrelationId();

  return runWithRequestScope({ correlationId }, fn);
}
