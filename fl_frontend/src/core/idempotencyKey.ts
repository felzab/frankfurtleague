// A module of its own so the server actions sending a key read the header without importing the one-shot form,
// `fl_frontend/src/kit/OneShot.tsx`, which makes the key.

/** The header a submission's replay key travels in to the backend. */
export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
