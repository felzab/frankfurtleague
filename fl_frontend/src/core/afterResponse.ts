import { after } from "next/server";

import { frontend_config } from "./config";
import { requestOf } from "./errors";
import { logger } from "./logging";
// A cycle, the drain sending through the client whose writes call `drainSoon`: each module reads the other's exports
// only when called, never as it loads.
import { drainOutbox } from "./mail";
import { getRequestTraceId, runBehindTheResponse, runInBackground } from "./requestScope";
import { mintTraceId } from "./trace";

/**
 * Next's `after`, the one way a request's own work is scheduled behind its response: a stopping server waits on every
 * pending callback, so each runs under the one deadline the container's stop grace is measured against.
 */
export function afterTheResponse(work: () => Promise<void>): void {
  const traceId = getRequestTraceId() ?? mintTraceId();

  after(() => runBehindTheResponse(traceId, work));
}

/**
 * The Postausgang drained behind the response, which `fl_frontend/src/core/api.ts :: sendToBackend` asks for after
 * every write: a mail the write owed leaves at once rather than at the next hourly pass, which retries whatever this
 * drain could not send. A background pass rather than the request's half, so no 30-second cut ends a page of sends:
 * each send and report is bounded by its own bound, and a drain a stop cuts leaves its rows to the next once their
 * lease lapses. Concurrent calls coalesce in the drain itself (`fl_frontend/src/core/mail.ts :: drainOutbox`). A
 * restore's hold sends nothing, the owed mail waiting in the Postausgang for the first drain after it
 * (`docs/ops/runbooks.md` §13).
 */
export function drainSoon(): void {
  if (frontend_config.RESTORE_HOLD === "on") return;

  const traceId = getRequestTraceId() ?? mintTraceId();
  after(() => runInBackground(traceId, drain));
}

async function drain(): Promise<void> {
  try {
    await drainOutbox();
  } catch (error) {
    // The name and the call's facts, never a mail: the hourly pass drains what this one left.
    logger.error("postausgang.drain_failed", undefined, { name: error instanceof Error ? error.name : undefined, ...requestOf(error) });
  }
}
