// The seeding half lives here rather than in `fl_frontend/src/core/requestScope.ts`, which owns the
// storage and is reachable from the Edge bundle: `next/headers` is request-only and cannot be
// bundled for it.
import { headers } from "next/headers";

import { runWithRequestScope } from "@/core/requestScope";
import { mintTraceId, readTraceparent, TRACEPARENT_HEADER } from "@/core/trace";

/**
 * Runs `fn` under the trace the edge opened for this request. **`headers()` is allowed to throw here**, naming a
 * `"use cache"` misuse at the line that made it, where minting instead would hide it.
 */
export async function runWithIncomingTrace<T>(fn: () => Promise<T>): Promise<T> {
  const incoming = readTraceparent((await headers()).get(TRACEPARENT_HEADER));

  return runWithRequestScope({ traceId: incoming ?? mintTraceId() }, fn);
}
