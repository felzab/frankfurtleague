/**
 * CORE · correlation id
 *
 * The one id that follows a request across nginx, this service and the backend. nginx mints it at
 * the edge (`$request_id`, 32 lowercase hex) and sends it upstream as `X-Correlation-ID`; everything
 * here either propagates that value or mints a compatible one for work no edge request owns (a cache
 * fill). The full design is `docs/logging.md`.
 *
 * Pure by design: no config, no environment, no `server-only` — so the unit tests can import it.
 */

export const CORRELATION_HEADER = "X-Correlation-ID";

// What nginx and `mintCorrelationId` produce is exactly 32 hex; the wider bounds accept other
// well-formed hex ids without admitting arbitrary strings into log lines. Mirrors the backend's
// `fl_backend/app/core/middlewares.py :: WELL_FORMED_ID`.
const WELL_FORMED_ID = /^[a-f0-9]{8,64}$/;

export function isWellFormedCorrelationId(value: unknown): value is string {
  return typeof value === "string" && WELL_FORMED_ID.test(value);
}

/** A fresh 32-hex id, format-identical to nginx's `$request_id`. */
export function mintCorrelationId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}
