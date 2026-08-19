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

  // Two different jobs: `correlation_id` names the page request that failed, `fetch_correlation_id`
  // the outbound call -- distinct whenever the fetch ran as a cache fill (docs/logging/spec.md).
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
