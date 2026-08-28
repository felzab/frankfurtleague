export const CORRELATION_HEADER = "X-Correlation-ID";

// No proxied path reaches a backend write, so the actor is always the one the session set
// (`docs/backend/spec.md :: I41`). The edge blanks a visitor's header too (`nginx/prod.conf`),
// which is depth rather than the guarantee.
export const ACTOR_HEADER = "X-FL-Actor";

// Wider than the 32 hex nginx mints, so other well-formed ids pass without admitting arbitrary
// strings into log lines. Mirrors `fl_backend/app/core/middlewares.py :: WELL_FORMED_ID`.
const WELL_FORMED_ID = /^[a-f0-9]{8,64}$/;

export function isWellFormedCorrelationId(value: unknown): value is string {
  return typeof value === "string" && WELL_FORMED_ID.test(value);
}

export function mintCorrelationId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}
