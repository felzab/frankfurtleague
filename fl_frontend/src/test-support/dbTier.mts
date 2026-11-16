/** MongoDB's default `transactionLifetimeLimitSeconds`: the server aborts a transaction open longer than this. */
const TRANSACTION_LIFETIME_MS = 60_000;

/**
 * The db tier's Vitest bounds, which `fl_frontend/vitest.config.mts` hands its `db` project. A case here waits on a
 * replica set in a container and on bounds of its own past Vitest's five seconds. Each bound, a hook's included, stays
 * under half of MongoDB's transaction lifetime: a write or an index build behind a transaction still open waits until
 * it ends (https://www.mongodb.com/docs/manual/core/transactions-production-consideration/), so a step waiting on one
 * in its own case fails on Vitest's bound, under its own name, before the server's expiry frees it. Half, since Vitest
 * times a hook and the case after it apart: a transaction a `beforeEach` opens at its start may be waited on until the
 * case's own bound, two bounds after it opened. A transaction a case leaves open fails that case from
 * `startReplicaSet`'s `afterEach`, which ends it, so no later case waits behind one. The replica set's start is bounded
 * apart: each file awaits it at module level, where neither bound reaches.
 */
export const DB_TIER = { testTimeout: 30_000, hookTimeout: 30_000 };

for (const [bound, ms] of Object.entries(DB_TIER)) {
  if (ms > TRANSACTION_LIFETIME_MS / 2) {
    throw new Error(
      `the db tier's ${bound} of ${String(ms)} ms passes half of MongoDB's ${String(TRANSACTION_LIFETIME_MS)} ms transaction lifetime: a step waiting on another's transaction would be freed by the server's expiry before it failed`,
    );
  }
}
