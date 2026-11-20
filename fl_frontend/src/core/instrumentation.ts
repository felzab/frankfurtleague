import { logger } from "./logging";
import { readTraceparent, TRACEPARENT_HEADER } from "./trace";

import type { Instrumentation } from "next";

/** An error and the fields this line reads where it carries them: a call error's trace and status, Next's digest. */
type Thrown = Error & { traceId?: unknown; statusCode?: unknown; digest?: unknown };

const stringOf = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** How many failures `written` remembers: one failure's captures arrive within its request, and far fewer fail at once. */
const WRITTEN_BOUND = 256;

/**
 * The failures already written in this process, by request trace and digest, oldest first: Next captures one failure
 * at several stages and calls the hook for each, so a count of lines is a count of failures only where the later
 * captures write nothing. A `Set` keeps its insertion order, so the first key is the oldest one.
 */
const written = new Set<string>();

/** Whether this failure's line is still to write, which it then records as written. */
function firstCapture(requestId: string | undefined, digest: string | undefined): boolean {
  // The same error on two requests is two failures, and one with no trace or no digest names nothing to match on.
  if (requestId === undefined || digest === undefined) return true;

  const key = `${requestId} ${digest}`;
  if (written.has(key)) return false;
  if (written.size >= WRITTEN_BOUND) {
    const oldest = written.values().next().value;
    if (oldest !== undefined) written.delete(oldest);
  }
  written.add(key);
  return true;
}

// Whatever the server threw arrives here, `undefined` included, so it is narrowed before any field is read: a throw of
// this hook's own reaches Next's plain-text report, and the line joining the crash to its request is lost.
export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  const failed: Thrown | undefined = err instanceof Error ? err : undefined;

  // Two different jobs: `trace_id` names the page request that failed, `fetch_trace_id` the
  // outbound call -- distinct whenever the fetch ran as a cache fill.
  const raw = request.headers[TRACEPARENT_HEADER];
  const requestId = readTraceparent(Array.isArray(raw) ? raw[0] : raw);
  const fetchId = stringOf(failed?.traceId);
  // Set on the error, never on the context: the key joining this line to the error Next prints beside it.
  const digest = stringOf(failed?.digest);

  if (!firstCapture(requestId, digest)) return;

  // The name and the join keys, never the stack: Next prints the error itself beside this hook.
  logger.error("system.request_crashed", undefined, {
    name: failed?.name ?? "unknown",
    trace_id: requestId,
    fetch_trace_id: fetchId !== requestId ? fetchId : undefined,
    digest,
    route: context.routePath,
    // Which stage captured it, the one written being the failure's first: a render, a route handler, an action or the
    // proxy; the Server Components render, its payload or the HTML render; and a revalidation's reason, none on a plain
    // request.
    route_type: context.routeType,
    render_source: context.renderSource,
    revalidate_reason: context.revalidateReason,
    // The failing call's own status, and none where it carries none: Next hands this hook no response
    // status, so a default here would be a figure nothing answered.
    status: typeof failed?.statusCode === "number" ? failed.statusCode : undefined,
  });
};
