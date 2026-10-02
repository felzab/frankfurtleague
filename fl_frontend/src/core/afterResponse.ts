import { after } from "next/server";

import { getRequestTraceId, runBehindTheResponse } from "./requestScope";
import { mintTraceId } from "./trace";

/**
 * Next's `after`, the one way work is scheduled behind a response: a stopping server waits on every pending
 * callback, so each runs under the one deadline the container's stop grace is measured against.
 */
export function afterTheResponse(work: () => Promise<void>): void {
  const traceId = getRequestTraceId() ?? mintTraceId();

  after(() => runBehindTheResponse(traceId, work));
}
