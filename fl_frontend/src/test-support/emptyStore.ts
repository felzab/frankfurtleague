/** What `emptyStore` reads of a database: the driver's `Db`, or a suite's own view of one. */
type Store = {
  listCollections: (filter: object, options: { nameOnly: true }) => { toArray: () => Promise<{ name: string }[]> };
  collection: (name: string) => { deleteMany: (filter: object) => Promise<unknown> };
};

/**
 * Deletes every row of every collection `db` holds, the library's own beside ours, and keeps the indexes: a suite
 * builds them once, and a dropped collection would take its unique indexes with it.
 */
export async function emptyStore(db: Store): Promise<void> {
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  await Promise.all(collections.map(({ name }) => db.collection(name).deleteMany({})));
}
