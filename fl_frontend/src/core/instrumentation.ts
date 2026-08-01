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

import { logger } from "./logging";

interface NextRequestContext {
  routePath: string;
  digest?: string;
  [key: string]: unknown;
}

interface WebError extends Error {
  traceId?: string;
  cause?: {
    traceId?: string;
    statusCode?: number;
    [key: string]: unknown;
  };
}

export async function onRequestError(err: Error, request: unknown, context: NextRequestContext) {
  const nextjsDigest = context.digest;
  const webErr = err as WebError;

  const cause = webErr.cause || {};
  const backendTraceId = cause.traceId || webErr.traceId || "NO_TRACE_ID";
  const statusCode = cause.statusCode || 500;

  logger.error("Next.js Server Component Crash", err, {
    digest: nextjsDigest,
    traceId: backendTraceId,
    route: context.routePath,
    status: statusCode,
  });
}
