import "server-only";

import { dispatchRequest, sentRequestOf } from "./apiDispatch";
import { isPathAsSpelled } from "./apiPath";
import { frontend_config, internalApiKeyAdmin, internalApiKeyBase, internalApiKeySystem } from "./config";
import { APIBadStatusError, APINetworkError, UnattributedAdminCallError } from "./errors";
import { boundCall, getRequestActor, getRequestTraceId } from "./requestScope";
import { ACTOR_HEADER, AUTH_FACTOR_HEADER, AUTH_TIME_HEADER, formatTraceparent, mintTraceId, TRACEPARENT_HEADER } from "./trace";

import type { ZodType } from "zod";
import type { SentRequest } from "./errors";
import type { FLRefusedField } from "./generated/client/types";

const BASE_FETCH_AUTH_TYPE = "base";

/**
 * Past the backend's own deadline on a request (`fl_backend/app/core/middlewares.py :: REQUEST_DEADLINE_S`), which
 * bounds every database call it makes: an answer the backend gives at its deadline still arrives.
 */
const FETCH_TIMEOUT_MS = 15000;

/** The path every endpoint is spelled under, as `fl_backend/openapi.json` writes it into each of its paths. */
export const BASE_FETCH_PATH = "/api/v0";

export interface FetchOptions extends RequestInit {
  authType?: "base" | "system" | "admin" | "none";
  params?: Record<string, string | number | boolean | undefined | null>;
  /**
   * A call changing nothing whatever its method says, such as a POST keeping a token out of the URL or
   * a dry run: its timeout is a read that failed, never a write of unknown outcome.
   */
  readOnly?: true;
}

const getFetchHeaders = (type: "base" | "system" | "admin" | "none" = "base"): Record<string, string> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  switch (type) {
    case "none":
      break;
    case "system":
      headers["Authorization"] = `Bearer ${internalApiKeySystem()}`;
      break;
    case "admin":
      headers["Authorization"] = `Bearer ${internalApiKeyAdmin()}`;
      break;
    case "base":
    default:
      headers["Authorization"] = `Bearer ${internalApiKeyBase()}`;
      break;
  }

  return headers;
};

/** Thrown for every status but a success: the code and the refused fields of the backend's own failure body. */
const refusalOf = async ({ res, traceId, endpoint, sent }: { res: Response; traceId: string; endpoint: string; sent: SentRequest }) => {
  // An edge's own page, never the backend's body: nginx's and Cloudflare's answers are HTML.
  if (!res.headers.get("content-type")?.includes("application/json")) {
    return new APIBadStatusError({
      message: "Infrastructure routing failure.",
      url: res.url,
      statusCode: res.status,
      endpoint,
      ...sent,
      traceId,
    });
  }

  // Read defensively: an unreadable failure body must not compound a bad status.
  const body: unknown = await res.json().catch(() => undefined);
  const failure = body !== null && typeof body === "object" ? (body as { error_code?: unknown; fields?: unknown }) : {};

  return new APIBadStatusError({
    message: "API returned a bad status.",
    url: res.url,
    statusCode: res.status,
    serverErrorCode: failure.error_code === undefined ? undefined : String(failure.error_code),
    // The backend's `FLRefusedPayloadBody` lists them; any other body marks no field.
    refusedFields: Array.isArray(failure.fields) ? (failure.fields as FLRefusedField[]) : [],
    endpoint,
    ...sent,
    traceId,
  });
};

/** A query as the backend reads it: an absent or null value is left out, so its parameter takes its default. */
export function queryOf(params: FetchOptions["params"]): URLSearchParams {
  const query = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined) query.append(key, String(value));
  });
  return query;
}

/**
 * One call to the backend, answering its success body as the type the caller names: typed, never parsed, as the
 * generated types describe the backend's own answer. `fl_frontend/src/core/transport.ts` sends every generated call
 * through here.
 */
export async function sendToBackend<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  // Unseeded means a `"use cache"` fill, where Next refuses request APIs. Minting there is safe:
  // the ids reach the header and the errors, never the returned value.
  const traceId = getRequestTraceId() ?? mintTraceId();

  const { authType = BASE_FETCH_AUTH_TYPE, params, readOnly, ...customOptions } = options;

  // Headers, never a spread: `RequestInit` admits a `Headers` or a `string[][]`, and spreading
  // either loses it silently -- `{...new Headers({a: "1"})}` is `{}`.
  const headers = new Headers(getFetchHeaders(authType));
  // Before the two set below and never after: a caller's own `traceparent` would file this hop's
  // work under a trace the edge never issued, and a caller's actor would name a person who did not
  // make the call.
  new Headers(customOptions.headers).forEach((value, key) => headers.set(key, value));

  // The edge's trace, which the backend reads off it and writes on its own lines.
  headers.set(TRACEPARENT_HEADER, formatTraceparent(traceId));
  // Admin tier alone: a base or system call is the app acting as itself, and an actor on one would
  // attribute a machine read to a person. Omitted rather than sent empty, so an unattributed call
  // reads as one everywhere it is inspected.
  const actor = authType === "admin" ? getRequestActor() : undefined;
  // Refused before it leaves: an admin-tier call opens under `runAdminRead` or an admin action's guard,
  // which record the actor first.
  if (authType === "admin" && !actor) throw new UnattributedAdminCallError(endpoint);
  // The session as the guard read it, set after the caller's own headers so none of them names
  // the actor. The backend believes these behind the admin key alone
  // (`fl_backend/app/core/security.py :: get_session_actor`).
  if (actor) {
    // Percent-encoded: a field value is a ByteString, which `Headers` refuses above U+00FF and sends as Latin-1 below it.
    // The backend refuses any other spelling (`fl_backend/app/core/security.py :: actor_header_value`).
    headers.set(ACTOR_HEADER, encodeURIComponent(actor.email));
    headers.set(AUTH_TIME_HEADER, String(actor.authTime));
    headers.set(AUTH_FACTOR_HEADER, actor.factor);
  } else {
    headers.delete(ACTOR_HEADER);
    headers.delete(AUTH_TIME_HEADER);
    headers.delete(AUTH_FACTOR_HEADER);
  }

  // Parsed per REQUEST, never at module scope: the image build imports this with no `API_URL`, and a
  // top-level parse throws while `next build` collects page data.
  const baseUrl = `${frontend_config.API_URL}${BASE_FETCH_PATH}`;
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const urlObj = new URL(`${baseUrl}${cleanEndpoint}`);

  // `new URL` resolves `..` before any check sees it, and a generated URL interpolates its path ids as given, so an id
  // could aim an authenticated call at another resource. A caller's bug, so it throws rather than answering.
  if (!isPathAsSpelled(cleanEndpoint, urlObj.pathname, new URL(baseUrl).pathname)) {
    throw new Error(`Endpoint does not address the path it spells: ${endpoint}`);
  }

  queryOf(params).forEach((value, key) => urlObj.searchParams.append(key, value));

  const sent = sentRequestOf(customOptions.method, readOnly);
  const bound = boundCall(FETCH_TIMEOUT_MS);

  const asNetworkError = (error: unknown) =>
    new APINetworkError({
      message: "Network request failed. Please check your connection.",
      isTimeout: error instanceof Error && error.name === "AbortError",
      url: urlObj.toString(),
      ...sent,
      traceId: traceId,
      originalError: error,
    });

  // Cleared in `finally` so it bounds the body read too: `fetch` resolves on headers, so clearing
  // it there leaves `res.json()` unbounded and a stalled backend hangs the render.
  try {
    // Thrown here rather than left to `fetch`, which refuses an aborted signal unsent too but names no
    // deadline in what it throws.
    if (bound.signal.aborted) {
      throw new APINetworkError({
        message: "The request's deadline had passed before this call was sent.",
        isTimeout: true,
        url: urlObj.toString(),
        ...sent,
        traceId: traceId,
      });
    }

    let res: Response;
    try {
      res = await dispatchRequest(sent, () => fetch(urlObj, { ...customOptions, headers, signal: bound.signal }));
    } catch (error) {
      throw asNetworkError(error);
    }

    if (!res.ok) throw await refusalOf({ res, traceId, endpoint, sent });
    if (res.status === 204 || res.headers.get("content-length") === "0") return null as T;

    try {
      return (await res.json()) as T;
    } catch (error) {
      // A body cut or stalled on its way: the call may have landed, as any answer lost in transit.
      throw asNetworkError(error);
    }
  } finally {
    bound.clear();
  }
}

/**
 * Redesign: goes with its last importer. A slice's hand-written call, which names its answer by a schema of its own;
 * the schema types the answer and parses nothing.
 */
export const apiClient = <T>(endpoint: string, _answer: ZodType<T>, options?: FetchOptions): Promise<T> => sendToBackend<T>(endpoint, options);
