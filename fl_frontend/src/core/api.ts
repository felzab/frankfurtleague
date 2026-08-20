import "server-only";

import z from "zod";

import { frontend_config } from "./config";
import { ACTOR_HEADER, CORRELATION_HEADER, mintCorrelationId } from "./correlation";
import { APIBadStatusError, APIMalformedDataError, APINetworkError } from "./errors";
import { getRequestActor, getRequestCorrelationId } from "./requestScope";

const BASE_FETCH_AUTH_TYPE = "base";
const BASE_FETCH_TIMEOUT_MS = 15000;
const BASE_FETCH_URL = `${frontend_config.API_URL}/api/v${frontend_config.API_VERSION}`;

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
    correlationId: correlationId,
  });
};

export const apiClient = async <T>(endpoint: string, schema: z.ZodType<T>, options: FetchOptions = {}): Promise<T> => {
  // Unseeded means a `"use cache"` fill, where Next refuses request APIs. Minting there is safe:
  // the id reaches the header and the errors, never the returned value.
  const correlationId = getRequestCorrelationId() ?? mintCorrelationId();

  const { authType = BASE_FETCH_AUTH_TYPE, timeoutMs = BASE_FETCH_TIMEOUT_MS, params, ...customOptions } = options;

  // Headers, never a spread: `RequestInit` admits a `Headers` or a `string[][]`, and spreading
  // either loses it silently -- `{...new Headers({a: "1"})}` is `{}`.
  const headers = new Headers(getFetchHeaders(authType));
  headers.set(CORRELATION_HEADER, correlationId);
  // Admin tier alone: a base or system call is the app acting as itself, and an actor on one would
  // attribute a machine read to a person. Omitted rather than sent empty, so an unattributed call
  // reads as one everywhere it is inspected.
  const actor = authType === "admin" ? getRequestActor() : undefined;
  if (actor) headers.set(ACTOR_HEADER, actor);
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

  const asNetworkError = (error: unknown) =>
    new APINetworkError({
      message: "Network request failed. Please check your connection.",
      isTimeout: error instanceof Error && error.name === "AbortError",
      url: urlObj.toString(),
      correlationId: correlationId,
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
      rawData = await handleFetchResponse({ res: res, correlationId: correlationId, endpoint: endpoint });
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
        correlationId: correlationId,
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
      correlationId: correlationId,
      zodIssues: z.treeifyError(validated.error),
    });
  }

  return validated.data;
};
