/**
 * CORE · API client
 *
 * The single door to FastAPI. Every slice's `queries.ts` and `mutations.ts` goes through `apiClient`;
 * nothing calls `fetch` directly.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • Server-only. The bearer keys are read from the server environment and must never reach a client
 *     bundle.
 *   • Every response is Zod-validated before it is returned. Nothing reaches a component unvalidated.
 *   • The timeout bounds the request AND the body read. Clearing the timer when `fetch` resolves left
 *     `res.json()` unbounded, so a backend that sent headers then stalled hung the render.
 *   • Failures are typed: network, bad status, malformed data. Reporting a parse failure as a network
 *     problem points the reader at the wrong system.
 *
 *  SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   docs/frontend/overview.md — how this fits the read path
 */

import "server-only";

import z from "zod";

import { frontend_config } from "./config";
import { APIBadStatusError, APIMalformedDataError, APINetworkError } from "./errors";

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
const handleFetchResponse = async ({ res, traceId, endpoint }: { res: Response; traceId: string; endpoint: string }): Promise<unknown> => {
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
      traceId: traceId,
    });
  }

  throw new APIBadStatusError({
    message: "API returned a bad status.",
    url: res.url,
    statusCode: res.status,
    endpoint: endpoint,
    traceId: traceId,
  });
};

export const apiClient = async <T>(endpoint: string, schema: z.ZodType<T>, options: FetchOptions = {}): Promise<T> => {
  // Non-deterministic, and generated inside all 11 `"use cache"` functions — deliberately safe, and
  // left alone on purpose (R3a §A2.4). It reaches only the X-Correlation-ID header and the error
  // constructors, never the returned value, so a cache entry is fully determined by the response.
  // The two consequences are both wanted: a cache hit issues no request and so has no id to
  // correlate, and thrown API errors are not persisted as cache entries.
  const traceId = `req_${crypto.randomUUID().substring(0, 8)}`; // Id for this fetch call

  const { authType = BASE_FETCH_AUTH_TYPE, timeoutMs = BASE_FETCH_TIMEOUT_MS, params, ...customOptions } = options;

  // Built through Headers rather than spread. `FetchOptions extends RequestInit`, so a caller may
  // legitimately pass a `Headers` instance or a `string[][]` -- and spreading either loses the data
  // silently: `{...new Headers({a: "1"})}` is `{}`, and `{...[["a","1"]]}` is `{0: [...]}`, a
  // garbage header name. No caller passes `headers` today; the type is what invites it.
  const headers = new Headers(getFetchHeaders(authType));
  headers.set("X-Correlation-ID", traceId);
  // Caller wins, matching the old spread order.
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
      traceId: traceId,
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
      rawData = await handleFetchResponse({ res: res, traceId: traceId, endpoint: endpoint });
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
        traceId: traceId,
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
      traceId: traceId,
      zodIssues: z.treeifyError(validated.error),
    });
  }

  return validated.data;
};
