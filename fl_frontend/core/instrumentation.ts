import { logger } from "./logging";

export async function onRequestError(err: Error, request: any, context: any) {
  // 1. Next.js provides the generated digest right here!
  const nextjsDigest = context.digest;

  const cause = (err as any).cause || {};
  const backendTraceId = cause.traceId || (err as any).traceId || "NO_TRACE_ID";
  const statusCode = cause.statusCode || 500;

  // 4. CREATE THE HARD LINK IN THE LOGS
  logger.error("Next.js Server Component Crash", err, {
    digest: nextjsDigest,
    traceId: backendTraceId,
    route: context.routePath,
    status: statusCode,
  });
}
