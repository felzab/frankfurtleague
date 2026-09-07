import { logger } from "./logging";
import { readTraceparent, TRACEPARENT_HEADER } from "./trace";

interface NextRequestContext {
  routePath: string;
  digest?: string;
  [key: string]: unknown;
}

interface NextRequestInfo {
  path?: string;
  method?: string;
  headers?: Record<string, string | string[] | undefined> | Headers;
  [key: string]: unknown;
}

interface WebError extends Error {
  traceId?: string;
  code?: string;
  cause?: {
    traceId?: string;
    statusCode?: number;
    [key: string]: unknown;
  };
}

function traceIdOf(request: NextRequestInfo): string | undefined {
  const headers = request.headers;
  if (!headers) return undefined;

  const raw = headers instanceof Headers ? headers.get(TRACEPARENT_HEADER) : headers[TRACEPARENT_HEADER];
  const value = Array.isArray(raw) ? raw[0] : (raw ?? undefined);
  return readTraceparent(value)?.traceId;
}

export async function onRequestError(err: Error, request: unknown, context: NextRequestContext) {
  const webErr = err as WebError;
  const cause = webErr.cause || {};

  // Two different jobs: `trace_id` names the page request that failed, `fetch_trace_id` the
  // outbound call -- distinct whenever the fetch ran as a cache fill (docs/logging/spec.md).
  const requestId = traceIdOf((request ?? {}) as NextRequestInfo);
  const fetchId = cause.traceId || webErr.traceId;

  logger.error("Next.js Server Component Crash", err, {
    error_code: "FE-RSC-001",
    trace_id: requestId,
    fetch_trace_id: fetchId !== requestId ? fetchId : undefined,
    digest: context.digest,
    route: context.routePath,
    status: cause.statusCode || 500,
  });
}
