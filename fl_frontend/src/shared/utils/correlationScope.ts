// The seeding half lives here rather than in `fl_frontend/src/core/requestScope.ts`, which owns the
// storage and is reachable from the Edge bundle: `next/headers` is request-only and cannot be
// bundled for it.
import { headers } from "next/headers";

import { CORRELATION_HEADER, isWellFormedCorrelationId, mintCorrelationId } from "@/core/correlation";
import { runWithRequestScope } from "@/core/requestScope";

/**
 * Runs `fn` under the id nginx minted for this request. **`headers()` is allowed to throw here**, naming a
 * `"use cache"` misuse at the line that made it, where minting instead would hide it.
 */
export async function runWithIncomingCorrelationId<T>(fn: () => Promise<T>): Promise<T> {
  const incoming = (await headers()).get(CORRELATION_HEADER);
  const correlationId = isWellFormedCorrelationId(incoming) ? incoming : mintCorrelationId();

  return runWithRequestScope({ correlationId }, fn);
}
