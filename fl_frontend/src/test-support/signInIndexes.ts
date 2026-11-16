import { DB_TIER } from "@/test-support/dbTier.mts";
import { settledWithin } from "@/test-support/replicaSet";
import { beforeAll, expect } from "vitest";

import type { LoggedLine } from "@/test-support/stdoutCapture";

/**
 * How long a db file waits for the sign-in store's indexes, inside the hook that builds them. The build asks again for
 * any index the store answers past the client's socket bound, for as long as a boot's run allows, which outlasts the
 * hook: a store that slow fails here, naming the build, before Vitest's bound names only the hook.
 */
const BUILT_WITHIN_MS = 20_000;

if (BUILT_WITHIN_MS >= DB_TIER.hookTimeout) {
  throw new Error("the wait for the sign-in store's indexes must end inside the hook that builds them");
}

/**
 * Production's indexes under every case of the file, so the library is driven over what it meets there: built once
 * for the file, as a boot builds them once, by `build`, the file's `buildAuthIndexes` imported after its doubles. A
 * build that leaves an index unbuilt fails the file, by the line `log` read.
 */
export function signInIndexesForTheFile(build: () => Promise<void>, log: { lines(): readonly LoggedLine[] }): void {
  beforeAll(async () => {
    const from = log.lines().length;
    await settledWithin(
      build(),
      BUILT_WITHIN_MS,
      `the sign-in store's indexes did not settle within ${String(BUILT_WITHIN_MS / 1000)} s: the store answered a build past the client's socket bound and was asked again`,
    );
    const unbuilt = log
      .lines()
      .slice(from)
      .flatMap(({ level, message, fields }) => (level === "ERROR" ? [{ message, fields }] : []));
    expect(unbuilt, "an index of the sign-in store was left unbuilt").toStrictEqual([]);
  });
}
