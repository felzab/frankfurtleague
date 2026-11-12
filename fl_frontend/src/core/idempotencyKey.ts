// A module of its own so the server actions sending a key read the header without importing the one-shot form,
// which makes the key.

export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
