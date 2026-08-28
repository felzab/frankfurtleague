export const CORRELATION_HEADER = "X-Correlation-ID";

// Blanked at the edge on everything nginx proxies (`nginx/prod.conf`), so the actor a write is
// attributed to can only be the one the session set (`docs/backend/spec.md :: I41`).
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
