/**
 * The db tier's Vitest bounds, which `fl_frontend/vitest.config.mts` hands its `db` project. A case here waits on a
 * replica set in a container and on bounds of its own past Vitest's five seconds. A step waiting behind a transaction
 * another left open fails on these, under its own name: `startReplicaSet` sets the server's transaction lifetime far
 * past them, and fails the case that left the transaction open, ending it. The replica set's start is bounded apart:
 * each file awaits it at module level, where neither bound reaches. The tier's usual run is inside the whole gate,
 * beside every other scope, where its containers wait for processors many times longer than they do alone; the bounds
 * are sized for that run, so a case slow only from the gate's load passes and one that hangs still fails by name.
 */
export const DB_TIER = { testTimeout: 60_000, hookTimeout: 60_000 };
