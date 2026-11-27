import "server-only";

import { drainSoon } from "./afterResponse";
import { frontend_config, internalApiKeyAdmin, internalApiKeyBase, internalApiKeySystem } from "./config";
import { APIBadStatusError, APINetworkError, asRefusal, mayHaveWritten } from "./errors";
import { Code } from "./generated/client/types";
import { ownKeyOf } from "./ownKeyOf";
import { boundCall, getRequestActor, getRequestTraceId, inBackground, recordWriteSent } from "./requestScope";
import { formatTraceparent, mintTraceId, TRACEPARENT_HEADER } from "./trace";

import type { SentRequest, ServedField } from "./errors";

// No proxied path reaches a backend write, so the actor is always the one the session set.
const ACTOR_HEADER = "X-FL-Actor";

// The actor's session beside its address, which the backend's window checks read.
const AUTH_TIME_HEADER = "X-FL-Auth-Time";
const AUTH_FACTOR_HEADER = "X-FL-Auth-Factor";

/**
 * Past the backend's own deadline on a request, its `REQUEST_DEADLINE_S`, which bounds every database call it makes:
 * an answer the backend gives at its deadline still arrives.
 */
export const FETCH_TIMEOUT_MS = 15000;

/**
 * Past the backend's deadline on an hourly pass, its `PASS_DEADLINE_S`, by the same margin: the scheduler's calls to the
 * operations the contract marks `x-pass`, each taking its rows for up to a minute.
 */
export const PASS_FETCH_TIMEOUT_MS = 65000;

/** The path every endpoint is spelled under, as the contract writes it into each of its paths. */
export const BASE_FETCH_PATH = "/api";

/** Whether the URL parser left an endpoint's path as the call site spelled it. */
function isPathAsSpelled(endpoint: string, builtPathname: string, basePathname: string): boolean {
  // Dropped rather than compared: the query is the URL's own, and a call site may spell an inline `?a=b`.
  const spelled = endpoint.split(/[?#]/)[0] ?? "";

  // Catches renavigation — `..`, `.`, an empty segment — and nothing else: an id carrying a plain `/`
  // survives parsing untouched and reads exactly like a nested endpoint, which is why every generated path builder
  // percent-encodes its parameters.
  return builtPathname === `${basePathname}${spelled}`;
}

export interface FetchOptions extends RequestInit {
  /** The key the call sends, which the operation's `security` names. */
  authType: "base" | "system" | "admin";
  /**
   * A call changing nothing whatever its method says, such as a POST keeping a token out of the URL or
   * a dry run: its timeout is a read that failed, never a write of unknown outcome. Set by the operation's
   * transport from what the contract states, never by a call site.
   */
  readOnly?: true;
  /** A call to an hourly pass, bounded by `PASS_FETCH_TIMEOUT_MS`. Set by the operation's transport from the contract's `x-pass`. */
  pass?: true;
}

const getFetchHeaders = (type: FetchOptions["authType"]): Record<string, string> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  switch (type) {
    case "system":
      headers["Authorization"] = `Bearer ${internalApiKeySystem()}`;
      break;
    case "admin":
      headers["Authorization"] = `Bearer ${internalApiKeyAdmin()}`;
      break;
    case "base":
      headers["Authorization"] = `Bearer ${internalApiKeyBase()}`;
      break;
  }

  return headers;
};

/**
 * Whether a failure body's code is one the contract publishes. Judged here once, so every reader compares a `Code`, and
 * a comparison with a code the backend no longer answers fails the type check.
 */
const isCode = (value: unknown) => typeof value === "string" && ownKeyOf(Code, value);

/** Thrown for every status but a success: the code and the refused fields of the backend's own failure body. */
const refusalOf = async ({ res, traceId }: { res: Response; traceId: string }) => {
  // An edge's own page, never the backend's body: nginx's and Cloudflare's answers are HTML.
  if (!res.headers.get("content-type")?.includes("application/json")) {
    return new APIBadStatusError({
      message: "Infrastructure routing failure.",
      statusCode: res.status,
      traceId,
    });
  }

  // Read defensively: an unreadable failure body must not compound a bad status.
  const body: unknown = await res.json().catch(() => undefined);
  const failure = body !== null && typeof body === "object" ? (body as { error_code?: unknown; fields?: unknown }) : {};

  return new APIBadStatusError({
    message: "API returned a bad status.",
    statusCode: res.status,
    // A code the contract does not name is none: the backend's own line still records it under the trace.
    serverErrorCode: isCode(failure.error_code) ? failure.error_code : undefined,
    // The backend's `FLFailureBody` lists them on every status; a body from anywhere else marks no field.
    refusedFields: Array.isArray(failure.fields) ? (failure.fields as ServedField[]) : [],
    traceId,
  });
};

/**
 * A call as the write test reads it: `fetch`'s own default method, upper-cased so the safe-method test
 * reads any spelling alike, since `fetch` sends `patch` exactly as typed.
 */
const sentRequestOf = (method: string | undefined, readOnly: boolean | undefined): SentRequest => ({
  method: (method ?? "GET").toUpperCase(),
  readOnly: readOnly === true,
});

/**
 * Sends one call, a write recorded as standing before `send` runs, since one whose answer never comes may still have
 * landed, and taken back where `send` throws the backend's refusal of it.
 */
async function dispatchRequest<T>(sent: SentRequest, send: () => Promise<T>): Promise<T> {
  if (!mayHaveWritten(sent)) return send();

  const withdraw = recordWriteSent();
  try {
    return await send();
  } catch (error) {
    // Taken back only where the answer says the write did not stand. The backend's promise: a 4xx refuses the
    // request. A 5xx promises nothing, since the server may fail after a commit, and a write that may stand answers
    // `unknown_outcome` with a 500; neither does an answer naming no code, an edge's own page or an unreadable body.
    if (asRefusal(error)?.serverErrorCode !== undefined) withdraw();
    throw error;
  }
}

/**
 * One call to the backend, answering its success body as the type the caller names: typed, never parsed, as the
 * generated types describe the backend's own answer.
 */
export async function sendToBackend<T>(endpoint: string, options: FetchOptions): Promise<T> {
  // Unseeded means a call no request scope encloses: a `"use cache"` fill, where Next refuses request APIs, or a
  // hook of the sign-in library's own route handler. Minting there is safe: the ids reach the header and the
  // errors, never the returned value.
  const traceId = getRequestTraceId() ?? mintTraceId();

  const { authType, readOnly, pass, ...customOptions } = options;

  // Headers, never a spread: `RequestInit` admits a `Headers` or a `string[][]`, and spreading
  // either loses it silently -- `{...new Headers({a: "1"})}` is `{}`.
  const headers = new Headers(getFetchHeaders(authType));
  // Before the trace and the actor are set below and never after: a caller's own `traceparent` would file this hop's
  // work under a trace the edge never issued, and a caller's actor would name a person who did not
  // make the call.
  new Headers(customOptions.headers).forEach((value, key) => headers.set(key, value));

  // The edge's trace, which the backend reads off it and writes on its own lines.
  headers.set(TRACEPARENT_HEADER, formatTraceparent(traceId));
  // Admin tier alone: a base or system call is the app acting as itself, and an actor on one would
  // attribute a machine read to a person. Omitted rather than sent empty, so an unattributed call
  // reads as one everywhere it is inspected, and the backend refuses it as `missing_actor`.
  const actor = authType === "admin" ? getRequestActor() : undefined;
  // The session as the guard read it, set after the caller's own headers so none of them names
  // the actor. The backend believes these behind the admin key alone.
  if (actor) {
    // As written: every sign-in address passed the ASCII rule of `./emailAddress.ts`, and the backend refuses any other.
    headers.set(ACTOR_HEADER, actor.email);
    headers.set(AUTH_TIME_HEADER, String(actor.authTime));
    headers.set(AUTH_FACTOR_HEADER, actor.factor);
  } else {
    headers.delete(ACTOR_HEADER);
    headers.delete(AUTH_TIME_HEADER);
    headers.delete(AUTH_FACTOR_HEADER);
  }

  // Parsed per request, never at module scope: the image build imports this with no `API_URL`, and a
  // top-level parse throws while `next build` collects page data.
  const baseUrl = `${frontend_config.API_URL}${BASE_FETCH_PATH}`;
  const urlObj = new URL(`${baseUrl}${endpoint}`);

  // `new URL` resolves `..` before any check sees it, and a generated URL's percent-encoding leaves an id of `.` or `..`
  // as it is, so an id could aim an authenticated call at another resource. A caller's bug, so it throws rather than
  // answering.
  if (!isPathAsSpelled(endpoint, urlObj.pathname, new URL(baseUrl).pathname)) {
    throw new Error(`Endpoint does not address the path it spells: ${endpoint}`);
  }

  const sent = sentRequestOf(customOptions.method, readOnly);
  // Bounds the body read too: `fetch` resolves on headers, and a stalled backend would otherwise hang the render on
  // `res.json()`.
  const signal = boundCall(pass ? PASS_FETCH_TIMEOUT_MS : FETCH_TIMEOUT_MS);

  const asNetworkError = (error: unknown) =>
    new APINetworkError({
      message: "The backend call failed before its answer was read.",
      traceId,
      originalError: error,
    });

  // Thrown here rather than left to `fetch`, which refuses an aborted signal unsent too but names no
  // deadline in what it throws.
  if (signal.aborted) {
    throw new APINetworkError({
      message: "The request's deadline had passed before this call was sent.",
      traceId,
    });
  }

  const res = await dispatchRequest(sent, async () => {
    let answered: Response;
    try {
      answered = await fetch(urlObj, { ...customOptions, headers, signal });
    } catch (error) {
      throw asNetworkError(error);
    }
    // Thrown inside the dispatch, which takes a write the backend refused back from those that may stand.
    if (!answered.ok) throw await refusalOf({ res: answered, traceId });
    return answered;
  });

  // Every write that landed may have owed a mail in its own transaction, so the Postausgang drains behind the response
  // after each, whichever slice sent it; the drain finds nothing where none was owed. A background pass's writes are
  // drained by the pass.
  if (mayHaveWritten(sent) && !inBackground()) drainSoon();
  if (res.status === 204 || res.headers.get("content-length") === "0") return null as T;

  try {
    // Typed, not parsed: the backend's response model validated this body on its way out, and `T` is generated
    // from the same OpenAPI document, as orval's own custom client returns `response.json()` as its `T`; a check
    // at run time would be orval's separate zod output, parsed by the caller.
    return (await res.json()) as T;
  } catch (error) {
    // A body cut or stalled on its way: the call may have landed, as any answer lost in transit.
    throw asNetworkError(error);
  }
}
