import { DB_TIER } from "@/test-support/dbTier.mts";
import { settledWithin } from "@/test-support/replicaSet";
import { beforeAll, expect } from "vitest";

import type { LoggedLine } from "@/test-support/stdoutCapture";

/**
 * How long a db file waits for the sign-in store's indexes, inside the hook or the case that builds them. The build
 * asks again for any index the store answers past the client's socket bound, for as long as a boot's run allows, which
 * outlasts either: a store that slow fails here, naming the build, before Vitest's bound names only the hook or the
 * case.
 */
const BUILT_WITHIN_MS = 20_000;

/**
 * How long an overdue build takes to stop once its client is closed: the close fails the operation in flight and every
 * later one fails before it is sent.
 */
const STOPPED_WITHIN_MS = 5_000;

/** The longest a build may be waited on, its stop after an overrun included, inside the hook or the case awaiting it. */
const WAITED_WITHIN_MS = Math.min(DB_TIER.hookTimeout, DB_TIER.testTimeout) - STOPPED_WITHIN_MS;

if (BUILT_WITHIN_MS >= WAITED_WITHIN_MS) {
  throw new Error("the wait for the sign-in store's indexes, and its stop, must end inside the hook or the case that builds them");
}

/**
 * `build`'s run of the sign-in store's indexes, failing under the build's own name once `withinMs` passes. Production
 * never closes its client, so past the bound this closes it, `closeStore`, and waits for the run to stop: the run's
 * lines then land in the hook or the case that awaited it, and nothing of it outlives the file. The file's later cases
 * meet that closed client too, and fail after the first failure, which names the build.
 */
export async function signInIndexesBuilt(
  build: () => Promise<void>,
  closeStore: () => Promise<unknown>,
  withinMs: number = BUILT_WITHIN_MS,
): Promise<void> {
  if (withinMs >= WAITED_WITHIN_MS) {
    throw new Error(`a wait of ${String(withinMs)} ms for the sign-in store's indexes outlasts its hook or case`);
  }
  // The build never rejects, so a failure here is the bound's.
  const run = build();
  try {
    await settledWithin(
      run,
      withinMs,
      `the sign-in store's indexes did not settle within ${String(withinMs / 1000)} s: the store answered a build past the client's socket bound and was asked again`,
    );
  } catch (overdue) {
    await closeStore();
    // A heartbeat answered while the close was under way can have queued a rebuild behind the overdue run, and a closed
    // client answers no heartbeat after it. So the wait is for one more run, queued behind both, whose every index
    // fails at once on lines of its own.
    await settledWithin(
      build(),
      STOPPED_WITHIN_MS,
      `the sign-in store's build did not stop within ${String(STOPPED_WITHIN_MS / 1000)} s of its client's close`,
    );
    throw overdue;
  }
}

/**
 * Production's indexes under every case of the file, so the library is driven over what it meets there: built once
 * for the file, as a boot builds them once, by `build`, the file's `buildAuthIndexes` imported after its doubles, on
 * the client `closeStore` closes. A build that leaves an index unbuilt fails the file, by the line `log` read.
 */
export function signInIndexesForTheFile(
  build: () => Promise<void>,
  closeStore: () => Promise<unknown>,
  log: { lines(): readonly LoggedLine[]; clear(): void },
): void {
  beforeAll(async () => {
    log.clear();
    let written: readonly LoggedLine[] = [];
    try {
      await signInIndexesBuilt(build, closeStore);
    } finally {
      // Read whether the build settled or overran, so this hook judges its build's lines rather than the next case.
      written = log.lines();
    }
    const unbuilt = written.flatMap(({ level, message, fields }) => (level === "ERROR" ? [{ message, fields }] : []));
    expect(unbuilt, "an index of the sign-in store was left unbuilt").toStrictEqual([]);
  });
}
