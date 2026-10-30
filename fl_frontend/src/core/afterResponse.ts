import { after } from "next/server";

import { requestOf } from "./errors";
import { logger } from "./logging";
import { drainPostausgang } from "./mail";
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

/**
 * The Postausgang drained once behind the response, for a write that owed a mail: the mail leaves at once rather than
 * at the next hourly pass, which retries whatever this drain could not send.
 */
export function drainSoon(): void {
  afterTheResponse(async () => {
    try {
      await drainPostausgang();
    } catch (error) {
      // The name and the call's facts, never a mail: the hourly pass drains what this one left.
      logger.error("postausgang.drain_failed", undefined, { name: error instanceof Error ? error.name : undefined, ...requestOf(error) });
    }
  });
}
