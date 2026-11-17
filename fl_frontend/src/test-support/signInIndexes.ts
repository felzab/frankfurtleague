import { beforeAll, expect } from "vitest";

import type * as authIndexes from "@/core/authIndexes";
import type { Db, MongoClient, ServerHeartbeatSucceededEvent } from "mongodb";

/** Every index `indexes` names that `store` does not hold, as `collection.name`. */
async function unheld(indexes: typeof authIndexes.AUTH_INDEXES, store: Db): Promise<string[]> {
  const collections = new Set((await store.listCollections({}, { nameOnly: true }).toArray()).map(({ name }) => name));
  const held = new Set<string>();
  for (const collection of collections) {
    for (const { name } of await store.collection(collection).indexes()) held.add(`${collection}.${String(name)}`);
  }
  return indexes.map(({ collection, options }) => `${collection}.${options.name}`).filter((index) => !held.has(index));
}

/** The next heartbeat a writable server answers `client` with, the one a rebuild the build armed runs on. */
function writableHeartbeat(client: MongoClient): Promise<void> {
  return new Promise((resolve) => {
    const answered = ({ reply }: ServerHeartbeatSucceededEvent): void => {
      if (reply["isWritablePrimary"] !== true) return;
      client.off("serverHeartbeatSucceeded", answered);
      resolve();
    };
    client.on("serverHeartbeatSucceeded", answered);
  });
}

/**
 * Production's indexes under every case of the file, so the library is driven over what it meets there: built once
 * for the file, as a boot builds them once, by the file's `buildAuthIndexes`, imported after its doubles, on `client`,
 * the store's client it builds with.
 */
export function signInIndexesForTheFile(
  { buildAuthIndexes, AUTH_INDEXES, MONGO_DB_NAME }: Pick<typeof authIndexes, "buildAuthIndexes" | "AUTH_INDEXES" | "MONGO_DB_NAME">,
  client: () => MongoClient,
): void {
  beforeAll(async () => {
    await buildAuthIndexes();
    // A call the store answered past the client's socket bound arms a rebuild for the next writable heartbeat, which
    // must run here rather than inside a case reading its lines. The armed rebuild is `rebuildOnRecovery`'s listener on
    // this client, the only one any file adds: registered before the wait's own,
    // it starts first, and the build after the wait queues behind it. A round with no call past the bound arms nothing;
    // a store answering no round within it is ended by the db project's hook bound, its unbuilt lines on the reporter.
    while (client().listenerCount("serverHeartbeatSucceeded") > 0) {
      await writableHeartbeat(client());
      await buildAuthIndexes();
    }
    // Every call of the last run either built its index or carries the store's refusal, which this names.
    expect(await unheld(AUTH_INDEXES, client().db(MONGO_DB_NAME)), "an index of the sign-in store was left unbuilt").toStrictEqual([]);
  });
}
