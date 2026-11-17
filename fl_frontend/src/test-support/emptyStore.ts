import type { Db } from "mongodb";

/**
 * Deletes every row of every collection `db` holds, the library's own beside ours, and keeps the indexes: a suite
 * builds them once, and a dropped collection would take its unique indexes with it.
 */
export async function emptyStore(db: Db): Promise<void> {
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  await Promise.all(collections.map(({ name }) => db.collection(name).deleteMany({})));
}
