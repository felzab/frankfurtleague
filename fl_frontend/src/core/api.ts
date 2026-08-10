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
  params?: Record<string, string | number | boolean | undefined | null>;
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

  // The backend's failure body is `{error_code, correlation_id}` (docs/logging/error-codes.md). The
  // code lets a caller react to the class of failure without parsing prose. Read defensively: an
  // unparseable body must not compound a bad status.
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
  // The request's id where a scope exists, a fresh one otherwise. The unseeded case
  // is the `"use cache"` fill, where Next refuses request APIs. Minting there is safe:
  // the id reaches the header and the errors, never the returned value.
  const correlationId = getRequestCorrelationId() ?? mintCorrelationId();

  const { authType = BASE_FETCH_AUTH_TYPE, timeoutMs = BASE_FETCH_TIMEOUT_MS, params, ...customOptions } = options;

  // Built through Headers rather than spread. `FetchOptions extends RequestInit`, so a caller may
  // pass a `Headers` or a `string[][]`, and spreading either loses the data silently:
  // `{...new Headers({a: "1"})}` is `{}`. The type is what invites it.
  const headers = new Headers(getFetchHeaders(authType));
  headers.set(CORRELATION_HEADER, correlationId);
  // Caller wins: a per-call header overrides the defaults above.
  new Headers(customOptions.headers).forEach((value, key) => headers.set(key, value));

  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const urlObj = new URL(`${BASE_FETCH_URL}${cleanEndpoint}`);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
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

  // Cleared in `finally` so it bounds the body read as well: `fetch` resolves when response
  // *headers* arrive, so clearing it there leaves `res.json()` unbounded and a backend that stalls
  // after its headers hangs the render past the budget.
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

      // Anything else means the response arrived and its body would not parse: malformed data, not a
      // connection problem. Reporting it as one points the reader at the wrong system.
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
    // No console.log of the tree here: it would fire unconditionally in production and put a raw
    // object into a stream `logging.ts` keeps to one JSON document per line. The same tree travels
    // on the error below, to the logger.
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
