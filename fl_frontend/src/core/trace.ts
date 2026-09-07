export const TRACEPARENT_HEADER = "traceparent";

// No proxied path reaches a backend write, so the actor is always the one the session set
// (`docs/backend/spec.md :: I41`). The edge blanks a visitor's header too (`nginx/prod.conf`),
// which is depth rather than the guarantee.
export const ACTOR_HEADER = "X-FL-Actor";

export interface TraceIds {
  traceId: string;
  spanId: string;
}

// Version `00` alone, and the whole header anchored: the edge mints this value, so anything else
// arriving here was written by a caller and is replaced rather than read
// (`docs/logging/spec.md :: L7`).
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

// W3C reserves both as "no trace" and "no span", so honouring one would file every request that
// sent it under a single id.
const NO_TRACE = "0".repeat(32);
const NO_SPAN = "0".repeat(16);

/** The two ids a well-formed `traceparent` carries, or `undefined` where the caller must mint. */
export function readTraceparent(value: unknown): TraceIds | undefined {
  if (typeof value !== "string") return undefined;

  const matched = TRACEPARENT.exec(value);
  if (matched === null) return undefined;

  // `noUncheckedIndexedAccess` types a matched group as possibly absent; the pattern cannot match
  // without both, so each fallback is unreachable rather than a default.
  const traceId = matched[1] ?? NO_TRACE;
  const spanId = matched[2] ?? NO_SPAN;

  return traceId === NO_TRACE || spanId === NO_SPAN ? undefined : { traceId: traceId, spanId: spanId };
}

export function mintTraceId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

// Web Crypto rather than `node:crypto`: this module is reachable from the Edge bundle, where the
// node builtin does not resolve.
export function mintSpanId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// The sampled flag, always: every request is logged here, so an unsampled one would tell a future
// collector to drop the trace a reader is following.
export function formatTraceparent({ traceId, spanId }: TraceIds): string {
  return `00-${traceId}-${spanId}-01`;
}
