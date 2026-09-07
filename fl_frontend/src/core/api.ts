import "server-only";

import z from "zod";

import { isPathAsSpelled } from "./apiPath";
import { frontend_config } from "./config";
import { APIBadStatusError, APIMalformedDataError, APINetworkError } from "./errors";
import { logger } from "./logging";
import { getRequestActor, getRequestSpanId, getRequestTraceId } from "./requestScope";
import { ACTOR_HEADER, formatTraceparent, mintSpanId, mintTraceId, TRACEPARENT_HEADER } from "./trace";

const BASE_FETCH_AUTH_TYPE = "base";
const BASE_FETCH_TIMEOUT_MS = 15000;
const BASE_FETCH_URL = `${frontend_config.API_URL}/api/v${frontend_config.API_VERSION}`;

export interface FetchOptions extends RequestInit {
  authType?: "base" | "system" | "admin" | "none";
  timeoutMs?: number;
  params?: Record<string, string | number | boolean | undefined | null>;
  /**
   * Read on the minting branch alone: a fill has no page request to join to, so this is the only
   * record of which function asked for it.
   */
  cacheFill?: { name: string; args: unknown };
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

  // Read defensively: an unparseable failure body must not compound a bad status.
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
    traceId: traceId,
  });
};

export const apiClient = async <T>(endpoint: string, schema: z.ZodType<T>, options: FetchOptions = {}): Promise<T> => {
  // Unseeded means a `"use cache"` fill, where Next refuses request APIs. Minting there is safe:
  // the ids reach the header and the errors, never the returned value.
  const scopedTraceId = getRequestTraceId();
  const traceId = scopedTraceId ?? mintTraceId();
  const spanId = getRequestSpanId() ?? mintSpanId();

  const { authType = BASE_FETCH_AUTH_TYPE, timeoutMs = BASE_FETCH_TIMEOUT_MS, params, cacheFill, ...customOptions } = options;

  // INFO rather than DEBUG: a fill is rare beside requests, and the default `LOG_LEVEL` must show
  // the join between a fill and what asked for it. The arguments are cache-key filters, never a
  // submitted value (`docs/logging/spec.md :: L9`).
  if (cacheFill && scopedTraceId === undefined) {
    logger.info("cache fill", {
      cache_fill: { name: cacheFill.name, args: JSON.stringify(cacheFill.args) },
      trace_id: traceId,
      span_id: spanId,
    });
  }

  // Headers, never a spread: `RequestInit` admits a `Headers` or a `string[][]`, and spreading
  // either loses it silently -- `{...new Headers({a: "1"})}` is `{}`.
  const headers = new Headers(getFetchHeaders(authType));
  // Before the two minted below and never after: a caller passing `traceparent` or the actor header
  // would otherwise file this hop's work under a trace the edge never issued.
  new Headers(customOptions.headers).forEach((value, key) => headers.set(key, value));

  // This hop's own span, the edge's trace: the backend reads the trace id off it and mints a span
  // of its own (`docs/logging/spec.md :: L12`).
  headers.set(TRACEPARENT_HEADER, formatTraceparent({ traceId: traceId, spanId: spanId }));
  // Admin tier alone: a base or system call is the app acting as itself, and an actor on one would
  // attribute a machine read to a person. Omitted rather than sent empty, so an unattributed call
  // reads as one everywhere it is inspected.
  const actor = authType === "admin" ? getRequestActor() : undefined;
  if (actor) headers.set(ACTOR_HEADER, actor);
  else headers.delete(ACTOR_HEADER);

  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const urlObj = new URL(`${BASE_FETCH_URL}${cleanEndpoint}`);

  // Parsed per REQUEST, never at module scope: the image build imports this with no `API_URL`, and a
  // top-level parse throws while `next build` collects page data.
  const basePath = new URL(BASE_FETCH_URL).pathname;

  // `new URL` resolves `..` before any check sees it, so an interpolated id could aim an authenticated
  // call at another resource. A caller's bug, so it throws rather than answering.
  if (!isPathAsSpelled(cleanEndpoint, urlObj.pathname, basePath)) {
    throw new Error(`Endpoint does not address the path it spells: ${endpoint}`);
  }

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        urlObj.searchParams.append(key, String(value));
      }
    });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const asNetworkError = (error: unknown) =>
    new APINetworkError({
      message: "Network request failed. Please check your connection.",
      isTimeout: error instanceof Error && error.name === "AbortError",
      url: urlObj.toString(),
      traceId: traceId,
      originalError: error,
    });

  // Cleared in `finally` so it bounds the body read too: `fetch` resolves on headers, so clearing
  // it there leaves `res.json()` unbounded and a stalled backend hangs the render.
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
    // No console.log of the tree: it would break `logging.ts`'s one-JSON-document-per-line stream,
    // and the tree already travels on the error below.
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
