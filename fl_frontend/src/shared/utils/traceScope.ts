// The seeding half lives here rather than in `fl_frontend/src/core/requestScope.ts`, which owns the
// storage and is reachable from the Edge bundle: `next/headers` is request-only and cannot be
// bundled for it.
import { headers } from "next/headers";

import { runWithRequestScope } from "@/core/requestScope";
import { mintSpanId, mintTraceId, readTraceparent, TRACEPARENT_HEADER } from "@/core/trace";

/**
 * Runs `fn` under the trace the edge opened for this request. **`headers()` is allowed to throw here**, naming a
 * `"use cache"` misuse at the line that made it, where minting instead would hide it.
 */
export async function runWithIncomingTrace<T>(fn: () => Promise<T>): Promise<T> {
  const incoming = readTraceparent((await headers()).get(TRACEPARENT_HEADER));

  // The incoming span is the edge's and is never adopted: a span names one hop's work, so reusing
  // it would make two hops' lines indistinguishable.
  return runWithRequestScope({ traceId: incoming?.traceId ?? mintTraceId(), spanId: mintSpanId() }, fn);
}
