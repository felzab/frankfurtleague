import { beforeAll, expect, vi } from "vitest";

import type { AUTH_INDEXES } from "@/core/authIndexes";
import type { Db } from "mongodb";

/**
 * How long a file's hook waits, once its build has run, for the store to hold every index. On a loaded machine the
 * store answers a build past the client's socket bound: the build is logged unbuilt, and the server goes on with it,
 * or the store's next heartbeat asks it again. The build ahead of it ends within its calls' own bounds, three seconds a
 * stage (`fl_frontend/src/core/db.ts`), and the two together stay under the db project's hook bound in
 * `fl_frontend/vitest.config.mts`, so a store that never holds an index fails here, naming it, rather than as a
 * timed-out hook.
 */
export const HELD_WITHIN_MS = 30_000;

/** Every index `indexes` names that `store` does not hold, as `collection.name`. */
async function unheld(indexes: typeof AUTH_INDEXES, store: Db): Promise<string[]> {
  const collections = new Set((await store.listCollections({}, { nameOnly: true }).toArray()).map(({ name }) => name));
  const held = new Set<string>();
  for (const collection of collections) {
    for (const { name } of await store.collection(collection).indexes()) held.add(`${collection}.${String(name)}`);
  }
  return indexes.map(({ collection, options }) => `${collection}.${options.name}`).filter((index) => !held.has(index));
}

/**
 * Production's indexes under every case of the file, so the library is driven over what it meets there: built once
 * for the file, as a boot builds them once, by the file's `buildAuthIndexes`, imported after its doubles, and held by
 * `store` before the first case runs.
 */
export function signInIndexesForTheFile(
  { buildAuthIndexes, AUTH_INDEXES: indexes }: { buildAuthIndexes: () => Promise<void>; AUTH_INDEXES: typeof AUTH_INDEXES },
  store: () => Db,
): void {
  beforeAll(async () => {
    await buildAuthIndexes();
    // `vi.waitFor` rather than `expect.poll`, which Vitest refuses outside a case.
    await vi.waitFor(
      async () => {
        expect(await unheld(indexes, store()), "an index of the sign-in store was left unbuilt").toStrictEqual([]);
      },
      { timeout: HELD_WITHIN_MS, interval: 200 },
    );
  });
}
