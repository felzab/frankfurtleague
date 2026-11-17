import { assert, beforeAll } from "vitest";

import type * as authIndexes from "@/core/authIndexes";
import type { StartedMongoDBContainer } from "@testcontainers/mongodb";

/**
 * Production's indexes under every case of the file, created once in `mongod` by the shell inside its container, so the
 * library meets the unique indexes it meets there. Never through the file's client: it carries production's
 * three-second bounds, which a build on a loaded machine outlasts, and the builder re-arms itself for a later heartbeat,
 * which no hook can tell apart from done. The shell waits each build out, and stops at the first one the store refuses.
 */
export function signInIndexesForTheFile(
  { AUTH_INDEXES, MONGO_DB_NAME }: Pick<typeof authIndexes, "AUTH_INDEXES" | "MONGO_DB_NAME">,
  mongod: StartedMongoDBContainer,
): void {
  beforeAll(async () => {
    const store = `db.getSiblingDB(${JSON.stringify(MONGO_DB_NAME)})`;
    const script = AUTH_INDEXES.map(
      ({ collection, key, options }) =>
        `${store}.getCollection(${JSON.stringify(collection)}).createIndex(${JSON.stringify(key)}, ${JSON.stringify(options)});`,
    ).join("\n");
    const { exitCode, output } = await mongod.exec(["mongosh", "--quiet", "--eval", script]);
    assert.strictEqual(exitCode, 0, `the sign-in store's indexes were not built: ${output}`);
  });
}
