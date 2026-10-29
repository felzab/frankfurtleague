export const TRACEPARENT_HEADER = "traceparent";

// No proxied path reaches a backend write, so the actor is always the one the session set.
// The edge blanks a visitor's header too (`nginx/shared/site.conf`),
// which is depth rather than the guarantee.
export const ACTOR_HEADER = "X-FL-Actor";

// The actor's session beside its address, which the backend's step-up and window checks read
// (`fl_backend/app/core/security.py :: get_session_actor`).
export const AUTH_TIME_HEADER = "X-FL-Auth-Time";
export const AUTH_FACTOR_HEADER = "X-FL-Auth-Factor";

// Version `00` alone, and the whole header anchored: the edge mints this value, so anything else
// arriving here was written by a caller and is replaced rather than read.
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

// W3C reserves both as "no trace" and "no parent", so honouring one would file every request that
// sent it under a single id.
const NO_TRACE = "0".repeat(32);
const NO_PARENT = "0".repeat(16);

/** The trace id a well-formed `traceparent` carries, or `undefined` where the caller must mint. */
export function readTraceparent(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const [, traceId, parentId] = TRACEPARENT.exec(value) ?? [];
  return traceId === undefined || traceId === NO_TRACE || parentId === NO_PARENT ? undefined : traceId;
}

export function mintTraceId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

/**
 * The header for one outbound call. The parent field is random, since W3C requires one and no line names it: the
 * trace id alone joins the hops. The sampled flag always, so a collector never drops a trace a reader follows.
 */
export function formatTraceparent(traceId: string): string {
  // Web Crypto rather than `node:crypto`: this module is reachable from the Edge bundle.
  const parentId = Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `00-${traceId}-${parentId}-01`;
}
