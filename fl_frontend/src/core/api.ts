/**
 * CORE · API client
 *
 * The single door to FastAPI. Every slice's `queries.ts` and `mutations.ts` goes through
 * `apiClient`; nothing calls `fetch` directly.
 *
 * Invariants:
 * - Server-only — the bearer keys must never reach a client bundle.
 * - Every response is Zod-validated before it is returned.
 * - The timeout bounds the request and the body read — a stall after headers once hung the render.
 * - Failures are typed: network, bad status, malformed data — each points at a different system.
 *
 * See:
 * - docs/frontend/overview.md — how this fits the read path
 */

import "server-only";

import z from "zod";

import { frontend_config } from "./config";
import { CORRELATION_HEADER, mintCorrelationId } from "./correlation";
import { APIBadStatusError, APIMalformedDataError, APINetworkError } from "./errors";
import { getRequestCorrelationId } from "./requestScope";

const BASE_FETCH_AUTH_TYPE = "base";
const BASE_FETCH_TIMEOUT_MS = 15000;
const BASE_FETCH_URL = `${frontend_config.API_URL}/api/v${frontend_config.API_VERSION}`;

// BaseAPIResponseSchema deliberately lives in ./schemas, not here. Import it from "@/core/schemas".
// Re-exporting it from this module would defeat the point: the importer would pull in this file,
// and with it "server-only".

export interface FetchOptions extends RequestInit {
  authType?: "base" | "system" | "admin" | "none";
  timeoutMs?: number;
  params?: Record<string, string | number | boolean | undefined | null>; // Allow these types
}

const getFetchHeaders = (type: "base" | "system" | "admin" | "none" = "base"): Record<string, string> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  switch (type) {
    case "none":
      break;
    case "system":
      headers["Authorization"] = `Bearer ${frontend_config.INTERNAL_API_KEY_SYSTEM}`;
      break;
    case "admin":
      headers["Authorization"] = `Bearer ${frontend_config.INTERNAL_API_KEY_ADMIN}`;
      break;
    case "base":
    default:
      headers["Authorization"] = `Bearer ${frontend_config.INTERNAL_API_KEY_BASE}`;
      break;
  }

  return headers;
};

/** Boilerplate function which handles fetch responses */
const handleFetchResponse = async ({
  res,
  correlationId,
  endpoint,
}: {
  res: Response;
  correlationId: string;
  endpoint: string;
}): Promise<unknown> => {
  if (res.ok) {
    if (res.status === 204 || res.headers.get("content-length") === "0") return null;
    return res.json();
  }

  const isJson = res.headers.get("content-type")?.includes("application/json");

  if (!isJson) {
    throw new APIBadStatusError({
      message: "Infrastructure routing failure.",
      url: res.url,
      statusCode: res.status,
      endpoint: endpoint,
      correlationId: correlationId,
    });
  }

  // The backend's failure body is `{error_code, correlation_id}` (docs/logging.md). The code is
  // what lets a caller react to the CLASS of failure -- a 409 from a unique index reads
  // DB-COMMON-002 -- without parsing prose. Read defensively: an unparseable body must not turn a
  // bad status into a second, misleading error.
  const serverErrorCode = await res
    .clone()
    .json()
    .then((body: unknown) => (body && typeof body === "object" && "error_code" in body ? String(body.error_code) : undefined))
    .catch(() => undefined);

  throw new APIBadStatusError({
    message: "API returned a bad status.",
    url: res.url,
    statusCode: res.status,
    serverErrorCode: serverErrorCode,
    endpoint: endpoint,
    correlationId: correlationId,
  });
};

export const apiClient = async <T>(endpoint: string, schema: z.ZodType<T>, options: FetchOptions = {}): Promise<T> => {
  // The current request's id where a scope exists (server actions and route handlers seed one,
  // shared/utils/adminMutation.ts), a freshly minted id otherwise. The unseeded case is the
  // `"use cache"` fill: a cached execution is shared across requests by construction, so Next
  // refuses request APIs there and no page-request id can exist -- the fill's outbound request gets
  // an id of its own instead (docs/logging.md). Minting inside cached functions is deliberately
  // safe: the id reaches only the X-Correlation-ID header and the error constructors, never the
  // returned value, so a cache entry is fully determined by the response.
  const correlationId = getRequestCorrelationId() ?? mintCorrelationId();

  const { authType = BASE_FETCH_AUTH_TYPE, timeoutMs = BASE_FETCH_TIMEOUT_MS, params, ...customOptions } = options;

  // Built through Headers rather than spread. `FetchOptions extends RequestInit`, so a caller may
  // legitimately pass a `Headers` instance or a `string[][]` -- and spreading either loses the data
  // silently: `{...new Headers({a: "1"})}` is `{}`, and `{...[["a","1"]]}` is `{0: [...]}`, a
  // garbage header name. No caller passes `headers` today; the type is what invites it.
  const headers = new Headers(getFetchHeaders(authType));
  headers.set(CORRELATION_HEADER, correlationId);
  // Caller wins: a per-call header overrides the defaults above.
  new Headers(customOptions.headers).forEach((value, key) => headers.set(key, value));

  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const urlObj = new URL(`${BASE_FETCH_URL}${cleanEndpoint}`);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      // Skip null or undefined parameters
      if (value !== null && value !== undefined) {
        urlObj.searchParams.append(key, String(value));
      }
    });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // One shape for both failure points below. `isTimeout` is derived rather than passed because the
  // abort signal covers the request and the body read alike.
  const asNetworkError = (error: unknown) =>
    new APINetworkError({
      message: "Network request failed. Please check your connection.",
      isTimeout: error instanceof Error && error.name === "AbortError",
      url: urlObj.toString(),
      correlationId: correlationId,
      originalError: error,
    });

  // The timer is cleared in `finally` so it bounds the body read as well. Clearing it the moment
  // `fetch` resolved -- which is when response *headers* arrive -- left `res.json()` unbounded, so a
  // backend that sent headers and then stalled hung the render well past the 15 s budget.
  let res: Response;
  let rawData: unknown;
  try {
    try {
      res = await fetch(urlObj, { ...customOptions, headers, signal: controller.signal });
    } catch (error) {
      throw asNetworkError(error);
    }

    try {
      rawData = await handleFetchResponse({ res: res, correlationId: correlationId, endpoint: endpoint });
    } catch (error) {
      // Already the right error, and re-wrapping it would lose the status code.
      if (error instanceof APIBadStatusError) throw error;
      // A stalled body aborts here rather than inside `fetch`.
      if (error instanceof Error && error.name === "AbortError") throw asNetworkError(error);

      // Anything else means the response arrived and its body would not parse. That is malformed
      // data, not a connection problem -- reporting it as one points the reader at the wrong system,
      // which is the same mistake `handleFetchResponse` already avoids for non-JSON error responses.
      throw new APIMalformedDataError({
        message: "API returned a body that could not be parsed as JSON.",
        url: res.url,
        statusCode: res.status,
        endpoint: endpoint,
        correlationId: correlationId,
      });
    }
  } finally {
    clearTimeout(timeoutId);
  }

  const validated = schema.safeParse(rawData);
  if (!validated.success) {
    // No console.log of the tree here: it fired unconditionally in production, emitted a raw object
    // into a stream logging.ts otherwise keeps to one JSON document per line, and was redundant --
    // the same tree travels on the error below and reaches the logger via instrumentation.ts.
    throw new APIMalformedDataError({
      message: "API returned malformed data.",
      url: res.url,
      statusCode: res.status,
      endpoint: endpoint,
      correlationId: correlationId,
      zodIssues: z.treeifyError(validated.error),
    });
  }

  return validated.data;
};
