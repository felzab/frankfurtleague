import { logger } from "./logging";
import { readTraceparent, TRACEPARENT_HEADER } from "./trace";

import type { Instrumentation } from "next";

/** An error and the fields this line reads where it carries them: a call error's trace and status, Next's digest. */
type Thrown = Error & { traceId?: unknown; statusCode?: unknown; digest?: unknown };

const stringOf = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

// Whatever the server threw arrives here, `undefined` included, so it is narrowed before any field is read: a throw of
// this hook's own reaches Next's plain-text report, and the line joining the crash to its request is lost.
export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  const failed: Thrown | undefined = err instanceof Error ? err : undefined;

  // Two different jobs: `trace_id` names the page request that failed, `fetch_trace_id` the
  // outbound call -- distinct whenever the fetch ran as a cache fill.
  const raw = request.headers[TRACEPARENT_HEADER];
  const requestId = readTraceparent(Array.isArray(raw) ? raw[0] : raw);
  const fetchId = stringOf(failed?.traceId);

  // The name and the join keys, never the stack: Next prints the error itself beside this hook.
  logger.error("system.request_crashed", undefined, {
    name: failed?.name ?? "unknown",
    trace_id: requestId,
    fetch_trace_id: fetchId !== requestId ? fetchId : undefined,
    // Set on the error, never on the context: the key joining this line to the error Next prints beside it.
    digest: stringOf(failed?.digest),
    route: context.routePath,
    // The failing call's own status, and none where it carries none: Next hands this hook no response
    // status, so a default here would be a figure nothing answered.
    status: typeof failed?.statusCode === "number" ? failed.statusCode : undefined,
  });
};
