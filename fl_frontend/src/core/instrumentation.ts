/**
 * CORE · request error reporting
 *
 * Next's `onRequestError` hook. Every unhandled server error passes through here on its way to the
 * log, which is how a thrown `APIMalformedDataError` reaches the structured logger with its zod issue
 * tree intact rather than being printed raw.
 *
 * The presence of the built `instrumentation.js` in the Docker image is checked by `verify.sh`: it is
 * emitted separately from the rest of the bundle and has gone missing from a standalone build before,
 * which silently disables all server error logging.
 */

import { CORRELATION_HEADER, isWellFormedCorrelationId } from "./correlation";
import { logger } from "./logging";

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
  correlationId?: string;
  code?: string;
  cause?: {
    correlationId?: string;
    statusCode?: number;
    [key: string]: unknown;
  };
}

/** The edge-minted id off the failed request's own headers, whichever headers shape Next passes. */
function correlationIdOf(request: NextRequestInfo): string | undefined {
  const headers = request.headers;
  if (!headers) return undefined;

  const raw = headers instanceof Headers ? headers.get(CORRELATION_HEADER) : headers[CORRELATION_HEADER.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : (raw ?? undefined);
  return isWellFormedCorrelationId(value) ? value : undefined;
}

export async function onRequestError(err: Error, request: unknown, context: NextRequestContext) {
  const webErr = err as WebError;
  const cause = webErr.cause || {};

  // Two ids, doing different jobs: `correlation_id` names the page request that failed (nginx's
  // edge line carries the same one), `fetch_correlation_id` names the outbound API call whose error
  // this is -- distinct whenever the fetch ran as a cache fill (docs/logging.md).
  const requestId = correlationIdOf((request ?? {}) as NextRequestInfo);
  const fetchId = cause.correlationId || webErr.correlationId;

  logger.error("Next.js Server Component Crash", err, {
    error_code: "FE-RSC-001",
    correlation_id: requestId,
    fetch_correlation_id: fetchId !== requestId ? fetchId : undefined,
    digest: context.digest,
    route: context.routePath,
    status: cause.statusCode || 500,
  });
}
