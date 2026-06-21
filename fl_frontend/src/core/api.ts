import z from "zod";

import { frontend_config } from "./config";
import { APIBadStatusError, APIMalformedDataError, APINetworkError } from "./errors";

const BASE_FETCH_AUTH_TYPE = "base";
const BASE_FETCH_TIMEOUT_MS = 15000;
export const BASE_FETCH_URL = `${frontend_config.API_URL}/api/v${frontend_config.API_VERSION}`;

export const BaseAPIResponseSchema = z.object({ acknowledged: z.union([z.literal(0), z.literal(1)]), trace_id: z.string().optional() });
export type BaseAPIResponse = z.infer<typeof BaseAPIResponseSchema>;

export interface FetchOptions extends RequestInit {
  authType?: "base" | "system" | "admin" | "none";
  timeoutMs?: number;
  params?: Record<string, string | number | boolean | undefined | null>; // Allow these types
}

export const getFetchHeaders = (type: "base" | "system" | "admin" | "none" = "base"): Record<string, string> => {
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
export const handleFetchResponse = async ({
  res,
  traceId,
  endpoint,
}: {
  res: Response;
  traceId: string;
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
  const traceId = `req_${crypto.randomUUID().substring(0, 8)}`; // Id for this fetch call

  const { authType = BASE_FETCH_AUTH_TYPE, timeoutMs = BASE_FETCH_TIMEOUT_MS, params, ...customOptions } = options;
  const headers = { "X-Correlation-ID": traceId, ...getFetchHeaders(authType), ...customOptions.headers };

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

  let res: Response;
  try {
    res = await fetch(urlObj, { ...customOptions, headers, signal: controller.signal });
    clearTimeout(timeoutId);
  } catch (error) {
    clearTimeout(timeoutId);

    const isTimeout = error instanceof Error && error.name === "AbortError";
    throw new APINetworkError({
      message: "Network request failed. Please check your connection.",
      isTimeout: isTimeout,
      url: urlObj.toString(),
      traceId: traceId,
      originalError: error,
    });
  }

  const rawData = await handleFetchResponse({ res: res, traceId: traceId, endpoint: endpoint });

  const validated = schema.safeParse(rawData);
  if (!validated.success) {
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
