import { frontend_config } from "./config";
import { APIBadStatusError, APINetworkError } from "./errors";

export interface BaseApiReturn {
  acknowledged: 0 | 1;
  errors?: string[];
  specific_error?: string;
}

export interface APIExceptionReturn {
  status_code: number;
  error_code?: string;
  error_message?: string;
  detail?: string;
}

export interface FetchOptions extends RequestInit {
  authType?: "base" | "system" | "admin";
  params?: Record<string, string | number | boolean | undefined | null>; // Allow these types
}

export const BASE_FETCH_URL = `${frontend_config.API_URL}/api/v${frontend_config.API_VERSION}`;

export const getFetchHeaders = (type: "base" | "system" | "admin" = "base"): Record<string, string> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  switch (type) {
    case "system":
      // Pull strictly from validated environment configurations
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

/** Standardizes runtime exception parsing safely across standard structures */
export const getErrorDetails = (error: unknown): { message: string; cause: unknown } => {
  if (error instanceof Error) {
    return { message: error.message, cause: error.cause };
  }
  return {
    message: "An unrecognized error occurred.",
    cause: error,
  };
};

/** Boilerplate function which handles fetch responses */
export const handleFetchResponse = async <T>(res: Response): Promise<T> => {
  if (res.ok) {
    if (res.status === 204 || res.headers.get("content-length") === "0") return {} as T;
    return res.json() as Promise<T>;
  }

  const isJson = res.headers.get("content-type")?.includes("application/json");

  if (!isJson) {
    throw new APIBadStatusError({
      message: "Infrastructure routing failure.",
      url: res.url,
      statusCode: res.status,
      errorMessage: await res.text(),
    });
  }

  let errorPayload: Partial<APIExceptionReturn> = {};
  try {
    errorPayload = await res.json();
  } catch {
    errorPayload = { error_message: "Failed to parse API error response." };
  }

  throw new APIBadStatusError({
    message: "API returned a bad status.",
    url: res.url,
    statusCode: res.status,
    errorCode: errorPayload.error_code || "UNKNOWN_ERROR",
    errorMessage: errorPayload.error_message || "UNKNOWN_MESSAGE",
  });
};

export const apiClient = async <T>(endpoint: string, options: FetchOptions = {}): Promise<T> => {
  const { authType = "base", params, ...customOptions } = options;
  const headers = { ...getFetchHeaders(authType), ...customOptions.headers };

  const urlObj = new URL(`${BASE_FETCH_URL}${endpoint}`);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      // Skip null or undefined parameters
      if (value !== null && value !== undefined) {
        urlObj.searchParams.append(key, String(value));
      }
    });
  }

  let res: Response;
  try {
    res = await fetch(urlObj, { ...customOptions, headers });
  } catch (error) {
    throw new APINetworkError({
      message: "Network request failed. Please check your connection.",
      url: urlObj.toString(),
      errorDetails: getErrorDetails(error),
    });
  }

  return handleFetchResponse<T>(res);
};
