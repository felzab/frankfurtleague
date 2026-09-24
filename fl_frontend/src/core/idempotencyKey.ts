// A module of its own so the routes and the mutations behind them read the header without importing the
// browser's submit helper, `fl_frontend/src/shared/utils/publicSubmit.ts`, which sets it.

/** The header a submission's replay key travels in, on both hops (`docs/backend/spec.md :: I346`). */
export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
