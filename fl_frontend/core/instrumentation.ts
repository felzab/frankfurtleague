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
